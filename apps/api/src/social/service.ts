import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  socialPersonSchema, socialIdentitySchema, socialOverviewSchema, friendshipSchema,
  socialMessageSchema, messagePageSchema, friendInviteSchema, socialDoneSchema,
  socialSettingsSchema, socialUpdatesSchema, publicMessageSchema, publicMessagePageSchema, type SocialSettingsInput,
  type FriendshipCommand, type FriendInviteCommand, type FriendRequestInput,
} from '@boardgame/protocol';
import type { AuthContext } from '../auth.js';
import type { Database } from '../db/index.js';
import { AppError } from '../errors.js';
import type { RoomService } from '../rooms.js';

type Client = pg.PoolClient;
type PersonRow = { id: string; friendId: string; displayName: string; avatar: string };
type Relation = { status: string; requested_by: string; revision: number; updated_at: Date };
const personColumns = 'id, friend_id AS "friendId", display_name AS "displayName", avatar';
const pair = (a: string, b: string) => [a, b].sort();
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
const fingerprint = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

export class SocialService {
  constructor(private db: Database, private rooms: RoomService) {}

  private async identity(client: Client, accountId: string) {
    const result = await client.query(`SELECT friend_id AS "friendId",social_revision AS revision,
      s.friend_id_change_days AS "changeIntervalDays",
      CASE WHEN friend_id_changed_at IS NULL OR s.friend_id_change_days=0 THEN NULL
        ELSE friend_id_changed_at + s.friend_id_change_days * interval '24 hours' END AS next_change_at,
      (friend_id_changed_at IS NULL OR s.friend_id_change_days=0 OR
        clock_timestamp() >= friend_id_changed_at + s.friend_id_change_days * interval '24 hours') AS "canChange"
      FROM accounts CROSS JOIN social_settings s WHERE id=$1`, [accountId]);
    const row = result.rows[0];
    return socialIdentitySchema.parse({ ...row, nextChangeAt: row.next_change_at?.toISOString() ?? null });
  }

  private async assertAdministrator(client: Client, current: AuthContext) {
    const actor = await client.query('SELECT role FROM accounts WHERE id=$1', [current.account.id]);
    if (actor.rows[0]?.role !== 'administrator') throw new AppError('FORBIDDEN', '需要管理员权限', 403);
  }

  settings(current: AuthContext) {
    return this.read(current, async client => {
      await this.assertAdministrator(client, current);
      const result = await client.query('SELECT friend_id_change_days AS "friendIdChangeDays",revision FROM social_settings');
      return socialSettingsSchema.parse(result.rows[0]);
    });
  }

  async setSettings(current: AuthContext, input: SocialSettingsInput) {
    return socialSettingsSchema.parse(await this.write(current, input.requestId,
      { operation: 'settings', ...input }, async client => {
        await this.assertAdministrator(client, current);
        const row = await client.query('SELECT revision FROM social_settings FOR UPDATE');
        if (row.rows[0].revision !== input.expectedRevision)
          throw new AppError('STATE_CONFLICT', '修改间隔已变化，请刷新后重试', 409);
        const saved = await client.query(`UPDATE social_settings SET friend_id_change_days=$1,revision=revision+1
          RETURNING friend_id_change_days AS "friendIdChangeDays",revision`, [input.friendIdChangeDays]);
        return saved.rows[0];
      }, undefined, true));
  }

  private async assertSession(client: Client, current: AuthContext, write: boolean) {
    const account = await client.query(
      `SELECT 1 FROM accounts WHERE id=$1 AND status='active'${write ? ' FOR SHARE' : ''}`, [current.account.id],
    );
    const session = await client.query(
      `SELECT 1 FROM sessions WHERE id=$1 AND account_id=$2 AND token_hash=$3
       AND revoked_at IS NULL AND expires_at>now()${write ? ' FOR SHARE' : ''}`,
      [current.sessionId, current.account.id, current.tokenHash],
    );
    if (!account.rowCount || !session.rowCount) throw new AppError('UNAUTHENTICATED', '请重新登录', 401);
  }

  private async read<T>(current: AuthContext, fn: (client: Client) => Promise<T>) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await this.assertSession(client, current, false);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async write<T>(current: AuthContext, requestId: string, input: unknown, fn: (client: Client) => Promise<T>, roomId?: string, administrator = false): Promise<T | unknown> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Small single-instance platform: one short social write at a time keeps
      // relation changes, read watermarks and request receipts ordered in DB.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('social-write', 0))");
      if (roomId) {
        const room = await client.query('SELECT 1 FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
        if (!room.rowCount) throw new AppError('ROOM_NOT_FOUND', '房间不存在', 404);
      }
      await this.assertSession(client, current, true);
      if (administrator) await this.assertAdministrator(client, current);
      const hash = fingerprint(input);
      const old = await client.query<{ input_hash: string; result: unknown }>(
        'SELECT input_hash,result FROM social_command_receipts WHERE account_id=$1 AND request_id=$2', [current.account.id, requestId],
      );
      if (old.rowCount) {
        if (old.rows[0]!.input_hash !== hash) throw new AppError('REQUEST_ID_CONFLICT', '请求编号已用于其他内容', 409);
        // Receipts written before policy metadata existed retain their original
        // ID/revision, with current eligibility added for the new DTO.
        let result = old.rows[0]!.result;
        if (input && typeof input === 'object' && 'operation' in input && input.operation === 'id'
          && result && typeof result === 'object' && !('canChange' in result)) {
          result = { ...await this.identity(client, current.account.id), ...result };
        }
        await client.query('COMMIT');
        return result;
      }
      const quota = await client.query<{ count: string }>(
        "SELECT count(*) FROM social_command_receipts WHERE account_id=$1 AND created_at>now()-interval '1 minute'", [current.account.id],
      );
      if (Number(quota.rows[0]!.count) >= 120) throw new AppError('RATE_LIMITED', '操作过于频繁，请稍后重试', 429, true);
      const result = await fn(client);
      await client.query('INSERT INTO social_command_receipts(account_id,request_id,input_hash,result) VALUES($1,$2,$3,$4)', [current.account.id, requestId, hash, result]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async person(client: Client, id: string, lock = false) {
    const result = await client.query<PersonRow>(
      `SELECT ${personColumns} FROM accounts WHERE id=$1 AND status='active'${lock ? ' FOR SHARE' : ''}`, [id],
    );
    if (!result.rowCount) throw new AppError('FORBIDDEN', '该用户不可用', 403);
    return socialPersonSchema.parse(result.rows[0]);
  }
  private async relation(client: Client, accountId: string, peerId: string) {
    const result = await client.query<Relation>('SELECT status,requested_by,revision,updated_at FROM friendships WHERE account_low=$1 AND account_high=$2', pair(accountId, peerId));
    return result.rows[0];
  }
  private async requireFriend(client: Client, accountId: string, peerId: string, lock = false) {
    const person = await this.person(client, peerId, lock);
    const relation = await this.relation(client, accountId, peerId);
    if (relation?.status !== 'accepted') throw new AppError('FORBIDDEN', '只有好友之间可以私聊和邀请', 403);
    return person;
  }
  private async friendship(client: Client, accountId: string, peerId: string) {
    const person = await this.person(client, peerId);
    const relation = await this.relation(client, accountId, peerId);
    return friendshipSchema.parse({ person, ...relation, direction: relation?.requested_by === accountId ? 'outgoing' : 'incoming', unread: 0 });
  }

  overview(current: AuthContext) {
    return this.read(current, async client => {
      const accountId = current.account.id;
      const identity = await this.identity(client, accountId);
      const relations = await client.query<PersonRow & Relation & { unread: number }>(
        `SELECT a.id,a.friend_id AS "friendId",a.display_name AS "displayName",a.avatar,f.status,f.requested_by,f.revision,
         (SELECT count(*)::int FROM direct_messages m WHERE m.sender_id=a.id AND m.recipient_id=$1
          AND m.sequence>COALESCE((SELECT last_sequence FROM direct_message_reads WHERE account_id=$1 AND peer_id=a.id),0)) AS unread
         FROM friendships f JOIN accounts a ON a.id=CASE WHEN f.account_low=$1 THEN f.account_high ELSE f.account_low END
         WHERE (f.account_low=$1 OR f.account_high=$1) AND f.status IN ('pending','accepted') AND a.status='active'
         ORDER BY a.display_name,a.id`, [accountId],
      );
      const invites = await this.invitations(client, accountId);
      const items = relations.rows.map(row => ({ person: socialPersonSchema.parse(row), status: row.status, revision: row.revision, direction: row.requested_by === accountId ? 'outgoing' : 'incoming', unread: row.unread }));
      return socialOverviewSchema.parse({ identity, friends: items.filter(item => item.status === 'accepted'), requests: items.filter(item => item.status === 'pending'), invitations: invites });
    });
  }

  async updates(current: AuthContext, previousVersion?: string) {
    // Recompute from an authorized consistent snapshot, including time-based eligibility.
    // This is a response validator, never an authorization token or a stored server cache.
    const overview = await this.overview(current);
    const version = fingerprint({ accountId: current.account.id, overview });
    return socialUpdatesSchema.parse(version === previousVersion
      ? { changed: false, version }
      : { changed: true, version, overview });
  }

  lookup(current: AuthContext, friendId: string) {
    return this.read(current, async client => {
      const result = await client.query<PersonRow>(`SELECT ${personColumns} FROM accounts WHERE friend_id=$1 AND status='active'`, [friendId]);
      return result.rowCount ? socialPersonSchema.parse(result.rows[0]) : null;
    });
  }

  async changeId(current: AuthContext, input: { requestId: string; friendId: string; expectedRevision: number }) {
    return socialIdentitySchema.parse(await this.write(current, input.requestId, { operation: 'id', ...input }, async client => {
      const row = await client.query<{ friend_id: string; social_revision: number }>('SELECT friend_id,social_revision FROM accounts WHERE id=$1 FOR UPDATE', [current.account.id]);
      if (row.rows[0]!.social_revision !== input.expectedRevision) throw new AppError('STATE_CONFLICT', '好友 ID 已变更，请刷新', 409);
      const identity = await this.identity(client, current.account.id);
      if (row.rows[0]!.friend_id === input.friendId) return identity;
      if (!identity.canChange) throw new AppError('RATE_LIMITED', `好友 ID 每 ${identity.changeIntervalDays} 天可修改一次，下次可修改时间：${identity.nextChangeAt}`, 429);
      const owner = await client.query('SELECT 1 FROM accounts WHERE friend_id=$1 AND id<>$2', [input.friendId, current.account.id]);
      if (owner.rowCount) throw new AppError('STATE_CONFLICT', '这个好友 ID 已被使用', 409);
      await client.query('UPDATE accounts SET friend_id=$2,social_revision=social_revision+1,friend_id_changed_at=clock_timestamp() WHERE id=$1', [current.account.id, input.friendId]);
      return this.identity(client, current.account.id);
    }));
  }

  async requestFriend(current: AuthContext, input: FriendRequestInput) {
    return friendshipSchema.parse(await this.write(current, input.requestId, { operation: 'request', ...input }, async client => {
      const peer = await client.query<{ id: string }>("SELECT id FROM accounts WHERE friend_id=$1 AND status='active' FOR SHARE", [input.friendId]);
      const peerId = peer.rows[0]?.id;
      const accountId = current.account.id;
      if (!peerId || peerId === accountId) throw new AppError('FORBIDDEN', '不能向该 ID 发送好友申请', 403);
      if (input.expectedAccountId && input.expectedAccountId !== peerId)
        throw new AppError('STATE_CONFLICT', '对方好友 ID 已变化，请刷新聊天后重新打开名片', 409);
      const relation = await this.relation(client, accountId, peerId);
      if (relation && ['pending', 'accepted'].includes(relation.status)) return this.friendship(client, accountId, peerId);
      if (relation && relation.updated_at.getTime() > Date.now() - 15_000) {
        throw new AppError('RATE_LIMITED', '请在 15 秒后重新申请', 429);
      }
      const count = await client.query<{ count: string }>("SELECT count(*) FROM friendships WHERE (account_low=$1 OR account_high=$1 OR account_low=$2 OR account_high=$2) AND status IN ('pending','accepted')", [accountId, peerId]);
      if (Number(count.rows[0]!.count) >= 200) throw new AppError('RATE_LIMITED', '好友或申请数量已达上限', 429);
      await client.query(`INSERT INTO friendships(account_low,account_high,requested_by,status) VALUES($1,$2,$3,'pending')
        ON CONFLICT(account_low,account_high) DO UPDATE SET requested_by=$3,status='pending',revision=friendships.revision+1,updated_at=now()`, [...pair(accountId, peerId), accountId]);
      return this.friendship(client, accountId, peerId);
    }));
  }

  async updateFriend(current: AuthContext, peerId: string, input: FriendshipCommand) {
    return socialDoneSchema.parse(await this.write(current, input.requestId, { operation: 'friend', peerId, ...input }, async client => {
      const accountId = current.account.id;
      const relation = await this.relation(client, accountId, peerId);
      if (!relation) throw new AppError('FORBIDDEN', '好友关系不可用', 403);
      if (relation.revision !== input.expectedRevision) throw new AppError('STATE_CONFLICT', '好友关系已变更，请刷新', 409);
      const receiving = relation.requested_by !== accountId;
      const valid = input.action === 'remove' ? relation.status === 'accepted'
        : relation.status === 'pending' && (input.action === 'cancel' ? !receiving : receiving);
      if (!valid) throw new AppError('FORBIDDEN', '不能执行此好友操作', 403);
      if (input.action === 'accept') await this.person(client, peerId, true);
      const status = input.action === 'accept' ? 'accepted' : input.action === 'reject' ? 'rejected' : 'removed';
      await client.query('UPDATE friendships SET status=$3,revision=revision+1,updated_at=now() WHERE account_low=$1 AND account_high=$2', [...pair(accountId, peerId), status]);
      if (status === 'removed') await client.query(`UPDATE friend_room_invitations SET status='rejected' WHERE status='pending'
        AND ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))`, [accountId, peerId]);
      return { done: true };
    }));
  }

  messages(current: AuthContext, peerId: string, before?: string, after?: string) {
    return this.read(current, async client => {
      await this.requireFriend(client, current.account.id, peerId);
      const result = await client.query<{ id: string; senderId: string; text: string; createdAt: Date }>(
        `SELECT id,sequence::text,sender_id AS "senderId",text,created_at AS "createdAt" FROM direct_messages
         WHERE ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))
         AND ($3::uuid IS NULL OR sequence<(SELECT sequence FROM direct_messages WHERE id=$3
           AND ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))))
         AND ($4::uuid IS NULL OR sequence>(SELECT sequence FROM direct_messages WHERE id=$4
           AND ((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1))))
         ORDER BY direct_messages.sequence ${after ? 'ASC' : 'DESC'} LIMIT 31`, [current.account.id, peerId, before ?? null, after ?? null],
      );
      const page = result.rows.slice(0, 30);
      const items = page.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
      return messagePageSchema.parse({ items: after ? items : items.reverse(), nextCursor: result.rows.length > 30 ? page.at(-1)!.id : null });
    });
  }

  async sendMessage(current: AuthContext, peerId: string, input: { requestId: string; text: string }) {
    return socialMessageSchema.parse(await this.write(current, input.requestId, { operation: 'message', peerId, ...input }, async client => {
      await this.requireFriend(client, current.account.id, peerId, true);
      const quota = await client.query<{ count: string }>('SELECT count(*) FROM direct_messages WHERE sender_id=$1', [current.account.id]);
      if (Number(quota.rows[0]!.count) >= 20000) throw new AppError('RATE_LIMITED', '私聊存储已达上限，请联系维护者', 429);
      const result = await client.query<{ id: string; senderId: string; text: string; createdAt: Date }>(
        'INSERT INTO direct_messages(id,sender_id,recipient_id,text) VALUES($1,$2,$3,$4) RETURNING id,sequence::text,sender_id AS "senderId",text,created_at AS "createdAt"', [randomUUID(), current.account.id, peerId, input.text],
      );
      return { ...result.rows[0], createdAt: result.rows[0]!.createdAt.toISOString() };
    }));
  }

  publicMessages(current: AuthContext, before?: string, after?: string) {
    return this.read(current, async client => {
      const result = await client.query<{
        id: string; sequence: string; senderId: string; text: string; createdAt: Date; sender: PersonRow;
      }>(`SELECT m.id,m.sequence::text,m.sender_id AS "senderId",m.text,m.created_at AS "createdAt",
        json_build_object('id',a.id,'friendId',a.friend_id,'displayName',a.display_name,'avatar',a.avatar) AS sender
        FROM public_messages m JOIN accounts a ON a.id=m.sender_id
        WHERE ($1::uuid IS NULL OR m.sequence<(SELECT sequence FROM public_messages WHERE id=$1))
          AND ($2::uuid IS NULL OR m.sequence>(SELECT sequence FROM public_messages WHERE id=$2))
        ORDER BY m.sequence ${after ? 'ASC' : 'DESC'} LIMIT 31`, [before ?? null, after ?? null]);
      const page = result.rows.slice(0, 30);
      const items = page.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }));
      return publicMessagePageSchema.parse({
        items: after ? items : items.reverse(), nextCursor: result.rows.length > 30 ? page.at(-1)!.id : null,
      });
    });
  }

  async sendPublicMessage(current: AuthContext, input: { requestId: string; text: string }) {
    return publicMessageSchema.parse(await this.write(current, input.requestId,
      { operation: 'public-message', ...input }, async client => {
        const quota = await client.query<{ total: string; recent: string }>(`SELECT count(*) AS total,
          count(*) FILTER (WHERE created_at>clock_timestamp()-interval '1 minute') AS recent
          FROM public_messages WHERE sender_id=$1`, [current.account.id]);
        if (Number(quota.rows[0]!.recent) >= 20)
          throw new AppError('RATE_LIMITED', '发言过于频繁，请稍后再发送', 429);
        if (Number(quota.rows[0]!.total) >= 20000)
          throw new AppError('RATE_LIMITED', '公共消息存储已达上限，请联系维护者', 429);
        const result = await client.query<{ id: string; sequence: string; senderId: string; text: string; createdAt: Date }>(
          `INSERT INTO public_messages(id,sender_id,text) VALUES($1,$2,$3)
           RETURNING id,sequence::text,sender_id AS "senderId",text,created_at AS "createdAt"`,
          [randomUUID(), current.account.id, input.text],
        );
        return { ...result.rows[0], sender: await this.person(client, current.account.id),
          createdAt: result.rows[0]!.createdAt.toISOString() };
      }));
  }

  async markRead(current: AuthContext, peerId: string, input: { requestId: string; messageId: string }) {
    return socialDoneSchema.parse(await this.write(current, input.requestId, { operation: 'read', peerId, ...input }, async client => {
      await this.requireFriend(client, current.account.id, peerId, true);
      const message = await client.query<{ sequence: string }>(`SELECT sequence FROM direct_messages WHERE id=$1
        AND ((sender_id=$2 AND recipient_id=$3) OR (sender_id=$3 AND recipient_id=$2))`, [input.messageId, current.account.id, peerId]);
      if (!message.rowCount) throw new AppError('FORBIDDEN', '消息不可用', 403);
      await client.query(`INSERT INTO direct_message_reads(account_id,peer_id,last_sequence) VALUES($1,$2,$3)
        ON CONFLICT(account_id,peer_id) DO UPDATE SET last_sequence=GREATEST(direct_message_reads.last_sequence,excluded.last_sequence)`, [current.account.id, peerId, message.rows[0]!.sequence]);
      return { done: true };
    }));
  }

  private async invitations(client: Client, accountId: string, id?: string) {
    const result = await client.query<{
      id: string; roomId: string; roomName: string; hasPassword: boolean; status: string; expiresAt: Date;
      sender: PersonRow; recipient: PersonRow; available: boolean;
    }>(`SELECT i.id,i.room_id AS "roomId",r.name AS "roomName",(r.password_hash IS NOT NULL) AS "hasPassword",i.status,i.expires_at AS "expiresAt",
      json_build_object('id',s.id,'friendId',s.friend_id,'displayName',s.display_name,'avatar',s.avatar) AS sender,
      json_build_object('id',t.id,'friendId',t.friend_id,'displayName',t.display_name,'avatar',t.avatar) AS recipient,
      (i.status='pending' AND i.expires_at>now() AND r.status='waiting' AND s.status='active' AND t.status='active'
        AND EXISTS(SELECT 1 FROM room_members WHERE room_id=r.id AND account_id=s.id)
        AND EXISTS(SELECT 1 FROM friendships WHERE account_low=LEAST(s.id,t.id) AND account_high=GREATEST(s.id,t.id) AND status='accepted')) AS available
      FROM friend_room_invitations i JOIN rooms r ON r.id=i.room_id JOIN accounts s ON s.id=i.sender_id JOIN accounts t ON t.id=i.recipient_id
      WHERE (i.sender_id=$1 OR i.recipient_id=$1) AND ($2::uuid IS NULL OR i.id=$2)
      ORDER BY i.created_at DESC,i.id DESC LIMIT 50`, [accountId, id ?? null]);
    return result.rows.map(row => friendInviteSchema.parse({ ...row, expiresAt: row.expiresAt.toISOString() }));
  }

  private async invitation(client: Client, id: string, accountId: string) {
    const items = await this.invitations(client, accountId, id);
    if (!items[0]) throw new AppError('INVITE_UNAVAILABLE', '邀请不可用', 404);
    return items[0];
  }

  async invite(current: AuthContext, roomId: string, input: { requestId: string; friendAccountId: string; expectedRoomRevision: number }) {
    return friendInviteSchema.parse(await this.write(current, input.requestId, { operation: 'invite', roomId, ...input }, async client => {
      await this.requireFriend(client, current.account.id, input.friendAccountId, true);
      const room = await client.query<{ room_revision: number; status: string }>('SELECT room_revision,status FROM rooms WHERE id=$1', [roomId]);
      const member = await client.query('SELECT 1 FROM room_members WHERE room_id=$1 AND account_id=$2', [roomId, current.account.id]);
      if (!member.rowCount) throw new AppError('ROOM_NOT_FOUND', '房间不可用', 404);
      if (room.rows[0]!.status !== 'waiting') throw new AppError('ROOM_NOT_WAITING', '只能邀请加入等待中的房间', 409);
      if (room.rows[0]!.room_revision !== input.expectedRoomRevision) throw new AppError('ROOM_CONFIG_CHANGED', '房间已变更，请刷新', 409);
      const target = await client.query('SELECT 1 FROM room_members WHERE room_id=$1 AND account_id=$2', [roomId, input.friendAccountId]);
      if (target.rowCount) throw new AppError('STATE_CONFLICT', '好友已在房间中', 409);
      const old = await client.query<{ id: string }>("SELECT id FROM friend_room_invitations WHERE room_id=$1 AND sender_id=$2 AND recipient_id=$3 AND status='pending' AND expires_at>now()", [roomId, current.account.id, input.friendAccountId]);
      if (old.rowCount) return this.invitation(client, old.rows[0]!.id, current.account.id);
      const quota = await client.query<{ count: string }>("SELECT count(*) FROM friend_room_invitations WHERE sender_id=$1 AND created_at>now()-interval '24 hours'", [current.account.id]);
      if (Number(quota.rows[0]!.count) >= 100) throw new AppError('RATE_LIMITED', '今天的房间邀请已达上限', 429);
      const id = randomUUID();
      await client.query('INSERT INTO friend_room_invitations(id,room_id,sender_id,recipient_id) VALUES($1,$2,$3,$4)', [id, roomId, current.account.id, input.friendAccountId]);
      return this.invitation(client, id, current.account.id);
    }, roomId));
  }

  async respondInvite(current: AuthContext, id: string, input: FriendInviteCommand) {
    // Resolve only recipient-owned invitations, then take room before account
    // locks. Re-check ownership/state inside the transaction before any effect.
    const found = await this.db.query<{ room_id: string }>('SELECT room_id FROM friend_room_invitations WHERE id=$1 AND recipient_id=$2', [id, current.account.id]);
    if (!found.rowCount) throw new AppError('INVITE_UNAVAILABLE', '邀请不可用', 404);
    const roomId = found.rows[0]!.room_id;
    const result = friendInviteSchema.parse(await this.write(current, input.requestId, { operation: 'respond', id, ...input }, async client => {
      const invite = await this.invitation(client, id, current.account.id);
      if (invite.recipient.id !== current.account.id || invite.status !== 'pending') throw new AppError('STATE_CONFLICT', '邀请已处理', 409);
      if (input.action === 'accept') {
        if (!invite.available) throw new AppError('INVITE_UNAVAILABLE', '邀请已失效或房间不可加入', 404);
        await this.requireFriend(client, current.account.id, invite.sender.id, true);
        await this.rooms.joinMemberWithClient(client, roomId, current.account.id, input.password);
      }
      await client.query('UPDATE friend_room_invitations SET status=$2 WHERE id=$1', [id, input.action === 'accept' ? 'accepted' : 'rejected']);
      return this.invitation(client, id, current.account.id);
    }, roomId));
    if (input.action === 'accept') this.rooms.notifyJoined(roomId);
    return result;
  }
}
