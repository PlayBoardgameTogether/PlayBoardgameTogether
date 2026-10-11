import { requestIdSchema as requestId } from '@boardgame/protocol';
import {
  joinRoomInputSchema,
  roomRevisionInputSchema,
  roomSeatInputSchema,
  roomReadyInputSchema,
  roomHostInputSchema,
  roomConfigInputSchema,
} from '@boardgame/protocol';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { DeterministicRng } from '@boardgame/game-sdk';
import type { Database } from './db/index.js';
import type { ApiConfig } from './config.js';
import type { GameRegistry } from './registry/index.js';
import { AppError } from './errors.js';
import { hash, verify } from 'argon2';
import { defaultAssetBinding, lockAssetBinding } from './assets/bindings.js';
import {
  botSeatCommandSchema,
  createRoomInputSchema,
  lobbyPageSchema,
  lobbyQuerySchema,
  roomPasswordSchema,
} from '@boardgame/protocol';

type Client = pg.PoolClient;
type RoomRow = {
  asset_version_id: string | null;
  id: string;
  host_account_id: string;
  name: string;
  status: 'waiting' | 'in_game' | 'closed';
  game_id: string;
  game_version: string;
  options: unknown;
  seat_count: number;
  room_revision: number;
  active_match_id: string | null;
  visibility: 'public' | 'private';
  password_hash: string | null;
  created_at: Date;
  closed_at: Date | null;
};
export type { RoomSnapshot } from '@boardgame/protocol';
import type { RoomSnapshot } from '@boardgame/protocol';
export const createRoomSchema = createRoomInputSchema;
export const joinRoomSchema = joinRoomInputSchema;
export const revisionSchema = roomRevisionInputSchema;
export const seatSchema = roomSeatInputSchema;
export const readySchema = roomReadyInputSchema;
export const hostSchema = roomHostInputSchema;
export const configRoomSchema = roomConfigInputSchema;
export const botSeatSchema = botSeatCommandSchema;
export const listRoomsSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(512).optional(),
  })
  .strict();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
const fingerprint = (value: unknown) => sha(canonical(value));
const normalizeInvite = (value: string) => value.replace(/[ -]/g, '').toUpperCase();
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function inviteCode() {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i]! % 32];
  return out;
}

export class RoomService {
  private listeners = new Set<(roomId: string) => void>();
  constructor(
    private db: Database,
    private registry: GameRegistry,
    private config: ApiConfig,
  ) {}
  onChanged(listener: (roomId: string) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private changed(roomId: string) {
    for (const listener of this.listeners) listener(roomId);
  }
  // Only authenticated member visits/healthy subscriptions renew this lease.
  // Lobby listing and AI actions intentionally do not keep abandoned rooms alive.
  async recordActivity(roomId: string, accountId: string) {
    await this.db.query(
      `UPDATE rooms r SET last_activity_at=clock_timestamp()
      WHERE r.id=$1 AND r.status<>'closed'
        AND r.last_activity_at < clock_timestamp() - interval '30 seconds'
        AND EXISTS (SELECT 1 FROM room_members m WHERE m.room_id=r.id AND m.account_id=$2)`,
      [roomId, accountId],
    );
  }

  async recordSubscriptionActivity(
    subscriptions: Array<{ roomId: string; accountId: string; sessionId: string }>,
  ) {
    if (!subscriptions.length) return;
    // One renewal per room, regardless of players or tabs. Recheck membership and
    // active sessions inside SQL so a revocation during heartbeat cannot renew it.
    await this.db.query(
      `WITH eligible AS (
        SELECT r.id FROM rooms r
        WHERE r.status<>'closed'
          AND r.last_activity_at < clock_timestamp() - interval '30 seconds'
          AND EXISTS (
            SELECT 1 FROM jsonb_to_recordset($1::jsonb)
              AS v("roomId" uuid,"accountId" uuid,"sessionId" uuid)
            JOIN room_members m ON m.room_id=v."roomId" AND m.account_id=v."accountId"
            JOIN sessions s ON s.id=v."sessionId" AND s.account_id=v."accountId"
            JOIN accounts a ON a.id=s.account_id
            WHERE v."roomId"=r.id AND s.revoked_at IS NULL
              AND s.expires_at>now() AND a.status='active'
          )
        ORDER BY r.id FOR UPDATE OF r SKIP LOCKED
      )
      UPDATE rooms r SET last_activity_at=clock_timestamp()
      FROM eligible e WHERE r.id=e.id`,
      [JSON.stringify(subscriptions)],
    );
  }

  async assertAccess(roomId: string, accountId: string) {
    const result = await this.db.query(
      `SELECT 1 FROM rooms r JOIN room_members m ON m.room_id=r.id
       WHERE r.id=$1 AND m.account_id=$2`,
      [roomId, accountId],
    );
    if (!result.rowCount) throw new AppError('ROOM_NOT_FOUND', 'Room not found', 404);
  }

  async closeIdleRooms() {
    const closed = await this.transaction(async (client) => {
      // The predicate is checked under the room lock, including concurrent renewals.
      const rooms = await client.query<{ id: string; active_match_id: string | null }>(`
        SELECT id,active_match_id FROM rooms
        WHERE status<>'closed' AND last_activity_at < clock_timestamp() - interval '30 minutes'
        ORDER BY last_activity_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`);
      for (const room of rooms.rows) {
        if (room.active_match_id)
          await client.query(
            "UPDATE matches SET status='aborted' WHERE id=$1 AND status='active'",
            [room.active_match_id],
          );
        await client.query(
          `UPDATE rooms SET status='closed',closed_at=clock_timestamp(),
          room_revision=room_revision+1 WHERE id=$1`,
          [room.id],
        );
        await client.query('DELETE FROM room_invites WHERE room_id=$1', [room.id]);
      }
      return rooms.rows.map((room) => room.id);
    });
    for (const roomId of closed) this.changed(roomId);
    return closed;
  }
  private async transaction<T>(fn: (client: Client) => Promise<T>) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  private async lockRequest(client: Client, accountId: string, operation: string, id: string) {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `request:${accountId}:${operation}:${id}`,
    ]);
  }
  private async receipt(
    client: Client,
    accountId: string,
    operation: string,
    requestIdValue: string,
    body: unknown,
  ) {
    await client.query(
      'DELETE FROM command_receipts WHERE account_id=$1 AND operation=$2 AND request_id=$3 AND expires_at<=now()',
      [accountId, operation, requestIdValue],
    );
    const hash = fingerprint(body);
    const found = await client.query<{
      request_hash: string;
      result_ref: any;
      room_id: string | null;
    }>(
      'SELECT request_hash,result_ref,room_id FROM command_receipts WHERE account_id=$1 AND operation=$2 AND request_id=$3 AND expires_at>now()',
      [accountId, operation, requestIdValue],
    );
    if (!found.rowCount) return null;
    if (found.rows[0]!.request_hash !== hash) {
      // Before model bots, add/remove receipts did not include the seat in the
      // hash. Keep exact legacy retries working; all new writes bind the seat.
      let legacyHash: string | undefined;
      if (
        (operation === 'room.bot.add' || operation === 'room.bot.remove') &&
        body &&
        typeof body === 'object' &&
        'seatId' in body
      ) {
        const legacy = Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'seatId'));
        if (
          operation === 'room.bot.remove' ||
          ('policyId' in legacy && legacy.policyId === 'basic-v1' && !('controllerType' in legacy))
        ) {
          legacyHash = fingerprint(legacy);
        }
      }
      if (found.rows[0]!.request_hash !== legacyHash)
        throw new AppError(
          'REQUEST_ID_CONFLICT',
          'requestId was already used with different content',
          409,
        );
    }
    return found.rows[0]!;
  }
  private saveReceipt(
    client: Client,
    accountId: string,
    operation: string,
    requestIdValue: string,
    body: unknown,
    roomId: string | null,
    resultRef: unknown,
  ) {
    return client.query(
      `INSERT INTO command_receipts(account_id,principal_key,operation,request_id,request_hash,room_id,result_ref,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '7 days')`,
      [
        accountId,
        `human:${accountId}`,
        operation,
        requestIdValue,
        fingerprint(body),
        roomId,
        resultRef,
      ],
    );
  }
  private async locked(client: Client, roomId: string) {
    const r = await client.query<RoomRow>('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [roomId]);
    if (!r.rowCount) throw new AppError('ROOM_NOT_FOUND', 'Room not found', 404);
    return r.rows[0]!;
  }
  private assertRevision(room: RoomRow, revision: number) {
    if (room.room_revision !== revision)
      throw new AppError('ROOM_CONFIG_CHANGED', 'Room changed; reload and retry', 409, true);
  }
  private assertWaiting(room: RoomRow) {
    if (room.status !== 'waiting')
      throw new AppError('ROOM_NOT_WAITING', 'Room is not waiting', 409);
  }
  private async assertMember(client: Client, roomId: string, accountId: string) {
    const r = await client.query('SELECT 1 FROM room_members WHERE room_id=$1 AND account_id=$2', [
      roomId,
      accountId,
    ]);
    if (!r.rowCount) throw new AppError('ROOM_NOT_FOUND', 'Room not found', 404);
  }
  private assertHost(room: RoomRow, accountId: string) {
    if (room.host_account_id !== accountId)
      throw new AppError('FORBIDDEN', 'Host permission required', 403);
  }
  private async assertInstalled(client: Client, gameId: string, version: string) {
    const installed = await client.query<{ manifest: unknown }>(
      'SELECT manifest FROM game_installations WHERE game_id=$1 AND game_version=$2 AND enabled=true FOR SHARE',
      [gameId, version],
    );
    const extension = this.registry.get(gameId, version);
    if (
      !installed.rowCount ||
      !extension ||
      !this.registry.hasResourcePack(gameId, version) ||
      canonical(installed.rows[0]!.manifest) !== canonical(extension.manifest)
    )
      throw new AppError(
        'GAME_VERSION_UNAVAILABLE',
        'Game version or resource manifest is unavailable',
        422,
      );
  }
  async snapshot(roomId: string, accountId: string): Promise<RoomSnapshot> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const snapshot = await this.snapshotWithClient(roomId, accountId, client);
      await client.query('COMMIT');
      return snapshot;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async snapshotWithClient(
    roomId: string,
    accountId: string,
    client: Client,
  ): Promise<RoomSnapshot> {
    const rr = await client.query<RoomRow>('SELECT * FROM rooms WHERE id=$1', [roomId]);
    if (!rr.rowCount) throw new AppError('ROOM_NOT_FOUND', 'Room not found', 404);
    await this.assertMember(client, roomId, accountId);
    const room = rr.rows[0]!;
    const members = await client.query<{
      account_id: string;
      display_name: string;
      joined_at: Date;
      status: string;
    }>(
      'SELECT m.account_id,a.display_name,m.joined_at,a.status FROM room_members m JOIN accounts a ON a.id=m.account_id WHERE m.room_id=$1 ORDER BY m.joined_at,m.account_id',
      [roomId],
    );
    const seats = await client.query<{
      id: string;
      seat_index: number;
      owner_account_id: string | null;
      occupant_kind: 'human' | 'bot';
      bot_name: string | null;
      bot_policy_id: string | null;
      bot_model_profile_id: string | null;
      ready: boolean;
    }>(
      'SELECT id,seat_index,owner_account_id,occupant_kind,bot_name,bot_policy_id,bot_model_profile_id,ready FROM seats WHERE room_id=$1 ORDER BY seat_index',
      [roomId],
    );
    const blockers: string[] = [];
    if (seats.rows.some((s) => !s.owner_account_id && s.occupant_kind !== 'bot'))
      blockers.push('尚有空座位');
    if (seats.rows.some((s) => s.occupant_kind === 'human' && s.owner_account_id && !s.ready))
      blockers.push('有玩家未准备');
    if (
      seats.rows.some(
        (s) => s.occupant_kind === 'bot' && !['basic-v1', 'model'].includes(s.bot_policy_id ?? ''),
      )
    )
      blockers.push('脚本 AI 策略不可用');
    if (members.rowCount !== seats.rows.filter((s) => s.owner_account_id).length)
      blockers.push('有候场成员');
    if (members.rows.some((m) => m.status !== 'active')) blockers.push('有账户不可用');
    const installed = await client.query<{ manifest: unknown }>(
      'SELECT manifest FROM game_installations WHERE game_id=$1 AND game_version=$2 AND enabled=true',
      [room.game_id, room.game_version],
    );
    const extension = this.registry.get(room.game_id, room.game_version);
    if (
      !extension ||
      !this.registry.hasResourcePack(room.game_id, room.game_version) ||
      !installed.rowCount ||
      canonical(installed.rows[0]!.manifest) !== canonical(extension.manifest)
    )
      blockers.push('扩展不可用');
    if (seats.rows.some((s) => s.occupant_kind === 'bot') && !extension?.getDecisionContext)
      blockers.push('游戏不支持脚本 AI');
    for (const seat of seats.rows.filter((seat) => seat.bot_policy_id === 'model')) {
      try {
        await this.requireBotProfile(
          client,
          room.host_account_id,
          seat.bot_model_profile_id,
          false,
        );
      } catch {
        blockers.push('模型 AI 配置不可用，请房主重新选择模型或切换为脚本 AI');
        break;
      }
    }
    const match = room.active_match_id
      ? await client.query<{ status: string }>('SELECT status FROM matches WHERE id=$1', [
          room.active_match_id,
        ])
      : null;
    return {
      assetVersionId: room.asset_version_id,
      visibility: room.visibility,
      hasPassword: !!room.password_hash,
      matchStatus: match?.rows[0]?.status ?? null,
      id: room.id,
      name: room.name,
      status: room.status,
      hostAccountId: room.host_account_id,
      gameId: room.game_id,
      gameVersion: room.game_version,
      options: room.options,
      seatCount: room.seat_count,
      roomRevision: room.room_revision,
      activeMatchId: room.active_match_id,
      members: members.rows.map((m) => ({
        accountId: m.account_id,
        displayName: m.display_name,
        joinedAt: m.joined_at.toISOString(),
      })),
      seats: seats.rows.map((s) => ({
        seatId: s.id,
        seatIndex: s.seat_index,
        ownerAccountId: s.owner_account_id,
        occupantKind: s.occupant_kind,
        botName: s.bot_name,
        botPolicyId: s.bot_policy_id,
        botModelProfileId: accountId === room.host_account_id ? s.bot_model_profile_id : null,
        ready: s.occupant_kind === 'bot' || s.ready,
      })),
      permissions: {
        isHost: room.host_account_id === accountId,
        canConfigure: room.host_account_id === accountId && room.status === 'waiting',
        canStart:
          room.host_account_id === accountId && room.status === 'waiting' && blockers.length === 0,
      },
      startBlockers: blockers,
    };
  }
  async list(accountId: string, raw: unknown) {
    const query = listRoomsSchema.parse(raw);
    let cursor: { createdAt: string; id: string } | null = null;
    if (query.cursor) {
      try {
        const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString()) as unknown;
        cursor = z
          .object({ createdAt: z.iso.datetime(), id: z.string().uuid() })
          .strict()
          .parse(parsed);
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Invalid room cursor', 400);
      }
    }
    const r = await this.db.query<{ id: string; created_at: string }>(
      `SELECT r.id,to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.account_id=$1 AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT $4`,
      [accountId, cursor?.createdAt ?? null, cursor?.id ?? null, query.limit + 1],
    );
    const page = r.rows.slice(0, query.limit);
    const items = await Promise.all(page.map((row) => this.snapshot(row.id, accountId)));
    const last = page.at(-1);
    const nextCursor =
      r.rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString(
            'base64url',
          )
        : null;
    return { items, nextCursor };
  }
  async create(accountId: string, raw: unknown) {
    const body = createRoomSchema.parse(raw);
    const ext = this.registry.get(body.gameId, body.version);
    if (!ext || ext.manifest.developmentOnly)
      throw new AppError('GAME_VERSION_UNAVAILABLE', 'Game version is unavailable', 422);
    const options = ext.validateOptions(body.options);
    if (body.seatCount < ext.manifest.players.min || body.seatCount > ext.manifest.players.max)
      throw new AppError('VALIDATION_ERROR', 'seatCount is outside game limits', 400);
    let invite = '';
    const result = await this.transaction(async (client) => {
      await this.lockRequest(client, accountId, 'room.create', body.requestId);
      const old = await this.receipt(client, accountId, 'room.create', body.requestId, body);
      if (old)
        return {
          roomId: old.room_id!,
          inviteCode: null,
          inviteIssuedAt: old.result_ref.inviteIssuedAt as string,
        };
      await this.assertInstalled(client, body.gameId, body.version);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `room-quota:${accountId}`,
      ]);
      const count = await client.query<{ count: string }>(
        "SELECT count(*) FROM rooms WHERE creator_account_id=$1 AND status<>'closed'",
        [accountId],
      );
      if (Number(count.rows[0]!.count) >= 1)
        throw new AppError('ROOM_CONFIG_CHANGED', '你已创建一个有效房间，请先关闭原房间。', 409);
      const roomId = randomUUID();
      const assets = await defaultAssetBinding(client, this.registry, body.gameId);
      const passwordHash = body.password ? await hash(body.password) : null;
      await client.query(
        'INSERT INTO rooms(id,host_account_id,creator_account_id,name,game_id,game_version,options,seat_count,visibility,password_hash) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          roomId,
          accountId,
          body.name,
          body.gameId,
          body.version,
          options,
          body.seatCount,
          body.visibility ?? 'private',
          passwordHash,
        ],
      );
      if (assets)
        await client.query('UPDATE rooms SET asset_version_id=$2 WHERE id=$1', [
          roomId,
          assets.versionId,
        ]);
      await client.query('INSERT INTO room_members(room_id,account_id) VALUES($1,$2)', [
        roomId,
        accountId,
      ]);
      for (let i = 0; i < body.seatCount; i++)
        await client.query(
          'INSERT INTO seats(id,room_id,seat_index,owner_account_id) VALUES($1,$2,$3,$4)',
          [randomUUID(), roomId, i, i === 0 ? accountId : null],
        );
      invite = inviteCode();
      const issuedAt = new Date();
      await client.query(
        'INSERT INTO room_invites(room_id,code_hash,issued_at,expires_at) VALUES($1,$2,$3,$4)',
        [roomId, sha(invite), issuedAt, new Date(issuedAt.getTime() + this.config.INVITE_TTL_MS)],
      );
      await this.saveReceipt(client, accountId, 'room.create', body.requestId, body, roomId, {
        roomId,
        inviteIssuedAt: issuedAt.toISOString(),
      });
      return { roomId, inviteCode: invite, inviteIssuedAt: issuedAt.toISOString() };
    });
    this.changed(result.roomId);
    return { ...result, room: await this.snapshot(result.roomId, accountId) };
  }
  async lobby(accountId: string, raw: unknown) {
    const query = lobbyQuerySchema.parse(raw);
    let cursor: { createdAt: string; id: string } | null = null;
    if (query.cursor) {
      try {
        cursor = z
          .object({ createdAt: z.iso.datetime(), id: z.string().uuid() })
          .strict()
          .parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString()));
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Invalid room cursor', 400);
      }
    }
    const result = await this.db.query<{
      id: string;
      name: string;
      game_id: string;
      game_version: string;
      display_status: string;
      seat_count: number;
      occupied_count: number;
      has_password: boolean;
      is_member: boolean;
      created_at: string;
      host_display_name: string;
      host_friend_id: string;
    }>(
      `SELECT r.id,r.name,r.game_id,r.game_version,r.seat_count,
      host.display_name AS host_display_name,host.friend_id AS host_friend_id,
      CASE WHEN r.status='in_game' AND m.status='finished' THEN 'finished' ELSE r.status END AS display_status,
      (r.password_hash IS NOT NULL) AS has_password,
      EXISTS(SELECT 1 FROM room_members WHERE room_id=r.id AND account_id=$1) AS is_member,
      ((SELECT count(*) FROM room_members WHERE room_id=r.id)+(SELECT count(*) FROM seats WHERE room_id=r.id AND occupant_kind='bot'))::int AS occupied_count,
      to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM rooms r LEFT JOIN matches m ON m.id=r.active_match_id
      JOIN accounts host ON host.id=r.host_account_id
      WHERE r.visibility='public'
        AND ($2::text IS NULL OR r.game_id=$2)
        AND ($3::text IS NULL OR ($3='password')=(r.password_hash IS NOT NULL))
        AND ($4::text IS NULL OR (CASE WHEN r.status='in_game' AND m.status='finished' THEN 'finished' ELSE r.status END)=$4)
        AND ($5::timestamptz IS NULL OR (r.created_at,r.id)<($5::timestamptz,$6::uuid))
      ORDER BY r.created_at DESC,r.id DESC LIMIT $7`,
      [
        accountId,
        query.gameId ?? null,
        query.roomType ?? null,
        query.status ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        query.limit + 1,
      ],
    );
    const page = result.rows.slice(0, query.limit),
      last = page.at(-1);
    return lobbyPageSchema.parse({
      items: page.map((row) => ({
        id: row.id,
        name: row.name,
        gameId: row.game_id,
        gameVersion: row.game_version,
        status: row.display_status,
        seatCount: row.seat_count,
        occupiedCount: row.occupied_count,
        hasPassword: row.has_password,
        isMember: row.is_member,
        hostDisplayName: row.host_display_name,
        hostFriendId: row.host_friend_id,
      })),
      nextCursor:
        result.rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString(
              'base64url',
            )
          : null,
    });
  }

  async join(accountId: string, raw: unknown, publicRoomId?: string) {
    const body = publicRoomId
      ? z.object({ requestId, password: roomPasswordSchema.optional() }).strict().parse(raw)
      : joinRoomSchema.parse(raw);
    const code =
      'inviteCode' in body && typeof body.inviteCode === 'string'
        ? normalizeInvite(body.inviteCode)
        : undefined;
    if (code && !/^[0-9A-HJKMNP-TV-Z]{12}$/.test(code))
      throw new AppError('INVITE_UNAVAILABLE', '邀请码不可用', 404);
    const receiptBody = publicRoomId
      ? { ...body, roomId: publicRoomId }
      : { ...body, inviteCode: code };
    const result = await this.transaction(async (client) => {
      await this.lockRequest(client, accountId, 'room.join', body.requestId);
      const old = await this.receipt(client, accountId, 'room.join', body.requestId, receiptBody);
      if (old) return { roomId: old.room_id! };
      const invite = code
        ? await client.query<{ room_id: string }>(
            'SELECT room_id FROM room_invites WHERE code_hash=$1 AND expires_at>now()',
            [sha(code)],
          )
        : null;
      const id = publicRoomId ?? invite?.rows[0]?.room_id;
      if (!id) throw new AppError('INVITE_UNAVAILABLE', '邀请码不可用', 404);
      const room = await this.locked(client, id);
      if (publicRoomId && room.visibility !== 'public')
        throw new AppError('ROOM_NOT_FOUND', 'Room not found', 404);
      if (code) {
        const current = await client.query(
          'SELECT 1 FROM room_invites WHERE room_id=$1 AND code_hash=$2 AND expires_at>now()',
          [id, sha(code)],
        );
        if (!current.rowCount) throw new AppError('INVITE_UNAVAILABLE', '邀请码不可用', 404);
      }
      await this.joinMemberWithClient(client, id, accountId, body.password, !!code);
      await this.saveReceipt(client, accountId, 'room.join', body.requestId, receiptBody, id, {
        roomId: id,
      });
      return { roomId: id };
    });
    this.changed(result.roomId);
    return this.snapshot(result.roomId, accountId);
  }

  // Trusted service boundary: callers must first authorize the public/code/friend
  // invitation in this same transaction. This method never grants that authority.
  async joinMemberWithClient(
    client: Client,
    roomId: string,
    accountId: string,
    password?: string,
    codeEntry = false,
  ) {
    const room = await this.locked(client, roomId);
    const member = await client.query(
      'SELECT 1 FROM room_members WHERE room_id=$1 AND account_id=$2',
      [roomId, accountId],
    );
    if (member.rowCount) return;
    if (codeEntry && room.status !== 'waiting')
      throw new AppError('INVITE_UNAVAILABLE', '邀请码不可用', 404);
    this.assertWaiting(room);
    if (room.password_hash && (!password || !(await verify(room.password_hash, password))))
      throw new AppError('FORBIDDEN', '房间密码不正确', 403);
    const count = await client.query<{ count: string }>(
      "SELECT (SELECT count(*) FROM room_members WHERE room_id=$1)+(SELECT count(*) FROM seats WHERE room_id=$1 AND occupant_kind='bot') AS count",
      [roomId],
    );
    if (Number(count.rows[0]!.count) >= room.seat_count)
      throw new AppError(
        codeEntry ? 'INVITE_UNAVAILABLE' : 'ROOM_FULL',
        codeEntry ? '邀请码不可用' : '房间已满',
        codeEntry ? 404 : 409,
      );
    await client.query('INSERT INTO room_members(room_id,account_id) VALUES($1,$2)', [
      roomId,
      accountId,
    ]);
    await client.query("UPDATE seats SET ready=false WHERE room_id=$1 AND occupant_kind='human'", [
      roomId,
    ]);
    await client.query('UPDATE rooms SET room_revision=room_revision+1 WHERE id=$1', [roomId]);
  }

  notifyJoined(roomId: string) {
    this.changed(roomId);
  }

  private async assertNotPlaying(client: Client, room: RoomRow) {
    if (!room.active_match_id) return;
    const match = await client.query<{ status: string }>(
      'SELECT status FROM matches WHERE id=$1 FOR UPDATE',
      [room.active_match_id],
    );
    if (match.rows[0]?.status === 'active')
      throw new AppError(
        'ROOM_ALREADY_STARTED',
        '对局进行中，不能退出或关闭房间。请完成本局。',
        409,
      );
  }

  private async mutate(
    accountId: string,
    roomId: string,
    operation: string,
    body: { requestId: string; expectedRoomRevision: number; seatId?: string },
    fn: (client: Client, room: RoomRow) => Promise<boolean | void>,
  ) {
    const receiptBody = { roomId, ...body };
    const repeated = await this.transaction(async (client) => {
      await this.lockRequest(client, accountId, operation, body.requestId);
      const old = await this.receipt(client, accountId, operation, body.requestId, receiptBody);
      if (old) return true;
      const room = await this.locked(client, roomId);
      await this.assertMember(client, roomId, accountId);
      if (!(operation === 'room.close' && room.status === 'closed'))
        this.assertRevision(room, body.expectedRoomRevision);
      const changed = (await fn(client, room)) !== false;
      if (changed)
        await client.query('UPDATE rooms SET room_revision=room_revision+1 WHERE id=$1', [roomId]);
      await this.saveReceipt(client, accountId, operation, body.requestId, receiptBody, roomId, {
        roomId,
      });
      return false;
    });
    if (!repeated) this.changed(roomId);
    return this.snapshot(roomId, accountId);
  }
  seat(accountId: string, roomId: string, raw: unknown) {
    const body = seatSchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.seat', body, async (c, r) => {
      this.assertWaiting(r);
      const target = await c.query<{ owner_account_id: string | null; occupant_kind: string }>(
        'SELECT owner_account_id,occupant_kind FROM seats WHERE room_id=$1 AND seat_index=$2',
        [roomId, body.seatIndex],
      );
      if (!target.rowCount) throw new AppError('VALIDATION_ERROR', 'Seat does not exist', 400);
      if (target.rows[0]!.owner_account_id === accountId) return false;
      if (target.rows[0]!.owner_account_id || target.rows[0]!.occupant_kind === 'bot')
        throw new AppError('SEAT_OCCUPIED', 'Seat is occupied', 409);
      await c.query(
        'UPDATE seats SET owner_account_id=NULL,ready=false WHERE room_id=$1 AND owner_account_id=$2',
        [roomId, accountId],
      );
      await c.query(
        "UPDATE seats SET owner_account_id=$1,occupant_kind='human',ready=false WHERE room_id=$2 AND seat_index=$3",
        [accountId, roomId, body.seatIndex],
      );
      await c.query("UPDATE seats SET ready=false WHERE room_id=$1 AND occupant_kind='human'", [
        roomId,
      ]);
    });
  }
  private async requireBotProfile(
    client: Client,
    owner: string,
    profileId: string | null,
    lock = true,
  ) {
    if (!profileId) throw new AppError('FORBIDDEN', '请选择房主自己的模型配置', 403);
    const result = await client.query<{ protocol: string; has_credential: boolean }>(
      `SELECT e.protocol, (c.id IS NOT NULL AND c.revoked_at IS NULL) AS has_credential
       FROM model_profiles p JOIN provider_endpoints e ON e.id=p.endpoint_id
       JOIN accounts a ON a.id=p.owner_account_id
       LEFT JOIN model_credentials c ON c.id=p.credential_id
       WHERE p.id=$1 AND p.owner_account_id=$2 AND p.enabled=true AND p.deleted_at IS NULL
         AND e.enabled=true AND a.status='active' ${lock ? 'FOR SHARE OF p' : ''}`,
      [profileId, owner],
    );
    const profile = result.rows[0];
    if (!profile || (profile.protocol !== 'mock' && !profile.has_credential)) {
      throw new AppError('FORBIDDEN', '模型配置或凭证不可用，请重新选择', 403);
    }
    if (
      profile.protocol !== 'mock' &&
      Buffer.from(this.config.MODEL_CREDENTIALS_KEY ?? '', 'base64').length !== 32
    ) {
      throw new AppError('SERVICE_UNAVAILABLE', '模型凭证加密尚未配置，请联系管理员', 503);
    }
  }

  addBot(accountId: string, roomId: string, seatId: string, raw: unknown) {
    return this.writeBot(accountId, roomId, seatId, raw, false);
  }

  configureBot(accountId: string, roomId: string, seatId: string, raw: unknown) {
    return this.writeBot(accountId, roomId, seatId, raw, true);
  }

  private writeBot(
    accountId: string,
    roomId: string,
    seatId: string,
    raw: unknown,
    editing: boolean,
  ) {
    const body = botSeatSchema.parse(raw);
    // Bind receipts to the target seat as well as the chosen configuration.
    return this.mutate(
      accountId,
      roomId,
      editing ? 'room.bot.configure' : 'room.bot.add',
      { ...body, seatId },
      async (client, room) => {
        this.assertHost(room, accountId);
        this.assertWaiting(room);
        if (!this.registry.get(room.game_id, room.game_version)?.getDecisionContext) {
          throw new AppError('AI_NOT_SUPPORTED', 'Game does not support AI', 422);
        }
        const result = await client.query<{
          seat_index: number;
          owner_account_id: string | null;
          occupant_kind: string;
          bot_policy_id: string | null;
          bot_model_profile_id: string | null;
        }>(
          'SELECT seat_index,owner_account_id,occupant_kind,bot_policy_id,bot_model_profile_id FROM seats WHERE id=$1 AND room_id=$2 FOR UPDATE',
          [seatId, roomId],
        );
        const seat = result.rows[0];
        if (!seat) throw new AppError('VALIDATION_ERROR', 'Seat does not exist', 400);
        if (
          seat.owner_account_id ||
          (editing ? seat.occupant_kind !== 'bot' : seat.occupant_kind === 'bot')
        ) {
          throw new AppError('SEAT_OCCUPIED', 'Seat is unavailable for this AI operation', 409);
        }
        if (!editing) {
          const capacity = await client.query<{ count: string }>(
            `SELECT (SELECT count(*) FROM room_members WHERE room_id=$1)
          +(SELECT count(*) FROM seats WHERE room_id=$1 AND occupant_kind='bot') AS count`,
            [roomId],
          );
          if (Number(capacity.rows[0]!.count) >= room.seat_count)
            throw new AppError('ROOM_FULL', 'Room is full', 409);
        }
        const model = body.controllerType === 'model';
        const profileId = model ? body.profileId : null;
        if (model) await this.requireBotProfile(client, accountId, profileId);
        const policyId = model ? 'model' : 'basic-v1';
        if (editing && seat.bot_policy_id === policyId && seat.bot_model_profile_id === profileId)
          return false;
        await client.query(
          `UPDATE seats SET occupant_kind='bot',bot_name=$1,bot_policy_id=$2,
        bot_policy_version='1.0.0',bot_model_profile_id=$3,ready=false WHERE id=$4`,
          [`电脑 ${seat.seat_index + 1}`, policyId, profileId, seatId],
        );
        await client.query(
          "UPDATE seats SET ready=false WHERE room_id=$1 AND occupant_kind='human'",
          [roomId],
        );
      },
    );
  }
  removeBot(accountId: string, roomId: string, seatId: string, raw: unknown) {
    const body = revisionSchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.bot.remove', { ...body, seatId }, async (c, r) => {
      this.assertHost(r, accountId);
      this.assertWaiting(r);
      const result = await c.query(
        "UPDATE seats SET occupant_kind='human',bot_name=NULL,bot_policy_id=NULL,bot_policy_version=NULL,bot_model_profile_id=NULL,ready=false WHERE id=$1 AND room_id=$2 AND occupant_kind='bot'",
        [seatId, roomId],
      );
      if (!result.rowCount) return false;
      await c.query("UPDATE seats SET ready=false WHERE room_id=$1 AND occupant_kind='human'", [
        roomId,
      ]);
    });
  }
  ready(accountId: string, roomId: string, raw: unknown) {
    const body = readySchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.ready', body, async (c, r) => {
      this.assertWaiting(r);
      const seat = await c.query<{ ready: boolean }>(
        'SELECT ready FROM seats WHERE room_id=$1 AND owner_account_id=$2',
        [roomId, accountId],
      );
      if (!seat.rowCount) throw new AppError('NOT_SEATED', 'Take a seat first', 409);
      if (seat.rows[0]!.ready === body.ready) return false;
      await c.query('UPDATE seats SET ready=$1 WHERE room_id=$2 AND owner_account_id=$3', [
        body.ready,
        roomId,
        accountId,
      ]);
    });
  }
  unseat(accountId: string, roomId: string, raw: unknown) {
    const body = revisionSchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.unseat', body, async (c, r) => {
      this.assertWaiting(r);
      const result = await c.query(
        'UPDATE seats SET owner_account_id=NULL,ready=false WHERE room_id=$1 AND owner_account_id=$2',
        [roomId, accountId],
      );
      if (!result.rowCount) return false;
      await c.query('UPDATE seats SET ready=false WHERE room_id=$1', [roomId]);
    });
  }
  transfer(accountId: string, roomId: string, raw: unknown) {
    const body = hostSchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.host', body, async (c, r) => {
      this.assertHost(r, accountId);
      const member = await c.query(
        'SELECT 1 FROM room_members WHERE room_id=$1 AND account_id=$2',
        [roomId, body.targetAccountId],
      );
      if (!member.rowCount) throw new AppError('VALIDATION_ERROR', 'Target is not a member', 400);
      if (body.targetAccountId === accountId) return false;
      await c.query('UPDATE rooms SET host_account_id=$1 WHERE id=$2', [
        body.targetAccountId,
        roomId,
      ]);
    });
  }
  async leave(accountId: string, roomId: string, raw: unknown) {
    const body = revisionSchema.parse(raw);
    const receiptBody = { roomId, ...body };
    const changed = await this.transaction(async (c) => {
      await this.lockRequest(c, accountId, 'room.leave', body.requestId);
      const old = await this.receipt(c, accountId, 'room.leave', body.requestId, receiptBody);
      if (old) return false;
      const r = await this.locked(c, roomId);
      await this.assertMember(c, roomId, accountId);
      this.assertRevision(r, body.expectedRoomRevision);
      await this.assertNotPlaying(c, r);
      await c.query(
        'UPDATE seats SET owner_account_id=NULL,ready=false WHERE room_id=$1 AND owner_account_id=$2',
        [roomId, accountId],
      );
      await c.query('DELETE FROM room_members WHERE room_id=$1 AND account_id=$2', [
        roomId,
        accountId,
      ]);
      await c.query('UPDATE seats SET ready=false WHERE room_id=$1', [roomId]);
      if (r.host_account_id === accountId) {
        const next = await c.query<{ account_id: string }>(
          'SELECT account_id FROM room_members WHERE room_id=$1 ORDER BY joined_at,account_id LIMIT 1',
          [roomId],
        );
        if (next.rowCount)
          await c.query('UPDATE rooms SET host_account_id=$1 WHERE id=$2', [
            next.rows[0]!.account_id,
            roomId,
          ]);
        else
          await c.query("UPDATE rooms SET status='closed',closed_at=now() WHERE id=$1", [roomId]);
      }
      await c.query('UPDATE rooms SET room_revision=room_revision+1 WHERE id=$1', [roomId]);
      await this.saveReceipt(c, accountId, 'room.leave', body.requestId, receiptBody, roomId, {
        left: true,
      });
      return true;
    });
    if (changed) this.changed(roomId);
    return { left: true };
  }
  configRoom(accountId: string, roomId: string, raw: unknown) {
    const body = configRoomSchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.config', body, async (c, r) => {
      this.assertHost(r, accountId);
      this.assertWaiting(r);
      const ext = this.registry.get(body.gameId, body.version);
      if (!ext || ext.manifest.developmentOnly)
        throw new AppError('GAME_VERSION_UNAVAILABLE', 'Game version unavailable', 422);
      await this.assertInstalled(c, body.gameId, body.version);
      const options = ext.validateOptions(body.options);
      if (body.seatCount < ext.manifest.players.min || body.seatCount > ext.manifest.players.max)
        throw new AppError('VALIDATION_ERROR', 'seatCount outside game limits', 400);
      if (body.gameId !== r.game_id || body.version !== r.game_version) {
        const assets = await defaultAssetBinding(c, this.registry, body.gameId);
        await c.query('UPDATE rooms SET asset_version_id=$2 WHERE id=$1', [
          roomId,
          assets?.versionId ?? null,
        ]);
      }
      const gameChanged =
        body.gameId !== r.game_id ||
        body.version !== r.game_version ||
        canonical(options) !== canonical(r.options) ||
        body.seatCount !== r.seat_count;
      if (!gameChanged && body.name === r.name) return false;
      const members = await c.query<{ count: string }>(
        'SELECT count(*) FROM room_members WHERE room_id=$1',
        [roomId],
      );
      if (Number(members.rows[0]!.count) > body.seatCount)
        throw new AppError('ROOM_FULL', 'Too many members for seat count', 409);
      const occupied = await c.query(
        "SELECT 1 FROM seats WHERE room_id=$1 AND seat_index >= $2 AND (owner_account_id IS NOT NULL OR occupant_kind='bot')",
        [roomId, body.seatCount],
      );
      if (occupied.rowCount)
        throw new AppError(
          'SEAT_OCCUPIED',
          'High seats must be empty before reducing capacity',
          409,
        );
      if (body.seatCount < r.seat_count)
        await c.query('DELETE FROM seats WHERE room_id=$1 AND seat_index >= $2', [
          roomId,
          body.seatCount,
        ]);
      else
        for (let i = r.seat_count; i < body.seatCount; i++)
          await c.query('INSERT INTO seats(id,room_id,seat_index) VALUES($1,$2,$3)', [
            randomUUID(),
            roomId,
            i,
          ]);
      await c.query(
        'UPDATE rooms SET name=$1,game_id=$2,game_version=$3,options=$4,seat_count=$5 WHERE id=$6',
        [body.name, body.gameId, body.version, options, body.seatCount, roomId],
      );
      if (gameChanged) await c.query('UPDATE seats SET ready=false WHERE room_id=$1', [roomId]);
    });
  }
  selectAssets(accountId: string, roomId: string, raw: unknown) {
    const body = revisionSchema.extend({ versionId: z.string().uuid() }).parse(raw);
    return this.mutate(accountId, roomId, 'room.assets', body, async (client, room) => {
      this.assertHost(room, accountId);
      this.assertWaiting(room);
      if (room.asset_version_id === body.versionId) return false;
      const binding = await lockAssetBinding(client, this.registry, room.game_id, body.versionId);
      await client.query('UPDATE rooms SET asset_version_id=$2 WHERE id=$1', [
        roomId,
        binding.versionId,
      ]);
      await client.query(
        "UPDATE seats SET ready=false WHERE room_id=$1 AND occupant_kind='human'",
        [roomId],
      );
    });
  }
  async rotateInvite(accountId: string, roomId: string, raw: unknown) {
    const body = revisionSchema.parse(raw);
    const receiptBody = { roomId, ...body };
    let code = '';
    const result = await this.transaction(async (c) => {
      await this.lockRequest(c, accountId, 'room.invite', body.requestId);
      const old = await this.receipt(c, accountId, 'room.invite', body.requestId, receiptBody);
      if (old) return { inviteCode: null, inviteIssuedAt: old.result_ref.inviteIssuedAt as string };
      const room = await this.locked(c, roomId);
      await this.assertMember(c, roomId, accountId);
      this.assertHost(room, accountId);
      this.assertWaiting(room);
      this.assertRevision(room, body.expectedRoomRevision);
      code = inviteCode();
      const at = new Date();
      await c.query(
        'INSERT INTO room_invites(room_id,code_hash,issued_at,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(room_id) DO UPDATE SET code_hash=excluded.code_hash,issued_at=excluded.issued_at,expires_at=excluded.expires_at',
        [roomId, sha(code), at, new Date(at.getTime() + this.config.INVITE_TTL_MS)],
      );
      await c.query('UPDATE rooms SET room_revision=room_revision+1 WHERE id=$1', [roomId]);
      await this.saveReceipt(c, accountId, 'room.invite', body.requestId, receiptBody, roomId, {
        inviteIssuedAt: at.toISOString(),
      });
      return { inviteCode: code, inviteIssuedAt: at.toISOString() };
    });
    this.changed(roomId);
    return { ...result, room: await this.snapshot(roomId, accountId) };
  }
  async start(accountId: string, roomId: string, raw: unknown) {
    const body = revisionSchema.parse(raw);
    const receiptBody = { roomId, ...body };
    const result = await this.transaction(async (c) => {
      await this.lockRequest(c, accountId, 'room.start', body.requestId);
      const old = await this.receipt(c, accountId, 'room.start', body.requestId, receiptBody);
      if (old) return { matchId: old.result_ref.matchId as string };
      const room = await this.locked(c, roomId);
      await this.assertMember(c, roomId, accountId);
      this.assertHost(room, accountId);
      if (room.status === 'in_game' && room.active_match_id)
        return { matchId: room.active_match_id };
      this.assertWaiting(room);
      this.assertRevision(room, body.expectedRoomRevision);
      const ext = this.registry.get(room.game_id, room.game_version);
      if (!ext || ext.manifest.developmentOnly)
        throw new AppError('GAME_VERSION_UNAVAILABLE', 'Game version unavailable', 422);
      await this.assertInstalled(c, room.game_id, room.game_version);
      const seats = await c.query<{
        id: string;
        seat_index: number;
        owner_account_id: string | null;
        occupant_kind: 'human' | 'bot';
        bot_policy_id: string | null;
        bot_policy_version: string | null;
        bot_model_profile_id: string | null;
        ready: boolean;
        status: string | null;
        display_name: string | null;
      }>(
        'SELECT s.id,s.seat_index,s.owner_account_id,s.occupant_kind,s.bot_policy_id,s.bot_policy_version,s.bot_model_profile_id,s.ready,a.status,COALESCE(a.display_name,s.bot_name) AS display_name FROM seats s LEFT JOIN accounts a ON a.id=s.owner_account_id WHERE s.room_id=$1 ORDER BY s.seat_index FOR UPDATE OF s',
        [roomId],
      );
      const members = await c.query<{ count: string }>(
        'SELECT count(*) FROM room_members WHERE room_id=$1',
        [roomId],
      );
      if (
        seats.rows.length !== room.seat_count ||
        seats.rows.some((s) =>
          s.occupant_kind === 'human'
            ? !s.owner_account_id || !s.ready || s.status !== 'active'
            : !['basic-v1', 'model'].includes(s.bot_policy_id ?? ''),
        ) ||
        Number(members.rows[0]!.count) !==
          seats.rows.filter((s) => s.occupant_kind === 'human').length
      )
        throw new AppError(
          'NOT_ALL_READY',
          'Every human must be seated and ready and every bot must have an available policy',
          409,
        );
      if (seats.rows.some((seat) => seat.occupant_kind === 'bot') && !ext.getDecisionContext) {
        throw new AppError('AI_NOT_SUPPORTED', 'Game does not support AI', 422);
      }
      // Lock profiles before creating any match data so deletion/editing cannot race activation.
      for (const seat of seats.rows
        .filter((seat) => seat.bot_policy_id === 'model')
        .sort((a, b) =>
          (a.bot_model_profile_id ?? '').localeCompare(b.bot_model_profile_id ?? ''),
        )) {
        await this.requireBotProfile(c, room.host_account_id, seat.bot_model_profile_id);
      }
      const assets = room.asset_version_id
        ? await lockAssetBinding(c, this.registry, room.game_id, room.asset_version_id, true)
        : null;
      const matchId = randomUUID();
      const rng = new DeterministicRng(randomBytes(4).readUInt32LE());
      let serialized: unknown;
      try {
        const setup = ext.setup({
          seats: seats.rows.map((s) => s.id),
          options: ext.validateOptions(room.options),
          rng,
        });
        serialized = ext.serialize(setup.state);
        ext.deserialize(serialized);
      } catch {
        throw new AppError('GAME_SETUP_FAILED', 'Game setup failed; room was unchanged', 422);
      }
      const digest = this.registry.digest(room.game_id, room.game_version);
      if (!digest)
        throw new AppError('GAME_VERSION_UNAVAILABLE', 'Game version digest unavailable', 422);
      await c.query(
        'INSERT INTO matches(id,room_id,game_id,game_version,content_version,resource_pack_id,resource_pack_version,state,rng_state,state_schema_version,rule_digest,resource_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          matchId,
          roomId,
          room.game_id,
          room.game_version,
          ext.manifest.contentVersion,
          ext.manifest.defaultAssetPack.id,
          ext.manifest.defaultAssetPack.version,
          serialized,
          rng.snapshot(),
          '1',
          digest.rule,
          digest.resource,
        ],
      );
      if (assets)
        await c.query(
          'UPDATE matches SET asset_version_id=$2,asset_manifest_hash=$3,asset_contract_version=$4,resource_pack_id=$5,resource_pack_version=$6 WHERE id=$1',
          [
            matchId,
            assets.versionId,
            assets.manifestHash,
            assets.contractVersion,
            assets.packId,
            assets.version,
          ],
        );
      for (const seat of seats.rows) {
        if (seat.occupant_kind === 'bot' && seat.bot_policy_id === 'model') {
          await c.query(
            `INSERT INTO match_participants(match_id,seat_id,account_id,seat_index,occupant_kind,controller_type,
            policy_id,policy_version,policy_hash,model_profile_id,model_owner_account_id)
            VALUES($1,$2,NULL,$3,'bot','model','model','1.0.0',$4,$5,$6)`,
            [
              matchId,
              seat.id,
              seat.seat_index,
              sha(`${room.game_id}:model:1.0.0:${seat.bot_model_profile_id}`),
              seat.bot_model_profile_id,
              room.host_account_id,
            ],
          );
        } else if (seat.occupant_kind === 'bot')
          await c.query(
            "INSERT INTO match_participants(match_id,seat_id,account_id,seat_index,occupant_kind,controller_type,policy_id,policy_version,policy_hash) VALUES($1,$2,NULL,$3,'bot','script',$4,$5,$6)",
            [
              matchId,
              seat.id,
              seat.seat_index,
              seat.bot_policy_id,
              seat.bot_policy_version,
              sha(`${room.game_id}:${seat.bot_policy_id}:${seat.bot_policy_version}`),
            ],
          );
        else
          await c.query(
            "INSERT INTO match_participants(match_id,seat_id,account_id,seat_index,occupant_kind,controller_type) VALUES($1,$2,$3,$4,'human','human')",
            [matchId, seat.id, seat.owner_account_id, seat.seat_index],
          );
        await c.query(
          'UPDATE match_participants SET display_name=$3 WHERE match_id=$1 AND seat_id=$2',
          [matchId, seat.id, seat.display_name],
        );
      }
      await c.query(
        "UPDATE rooms SET status='in_game',active_match_id=$1,room_revision=room_revision+1 WHERE id=$2",
        [matchId, roomId],
      );
      await c.query('DELETE FROM room_invites WHERE room_id=$1', [roomId]);
      await this.saveReceipt(c, accountId, 'room.start', body.requestId, receiptBody, roomId, {
        matchId,
      });
      return { matchId };
    });
    this.changed(roomId);
    return result;
  }
  async closeRoom(accountId: string, roomId: string, raw: unknown) {
    const body = revisionSchema.parse(raw);
    return this.mutate(accountId, roomId, 'room.close', body, async (client, room) => {
      this.assertHost(room, accountId);
      if (room.status === 'closed') return false;
      // Room is already locked; use the same room -> match order as actions.
      if (room.active_match_id)
        await client.query("UPDATE matches SET status='aborted' WHERE id=$1 AND status='active'", [
          room.active_match_id,
        ]);
      await client.query("UPDATE rooms SET status='closed',closed_at=now() WHERE id=$1", [roomId]);
      await client.query('DELETE FROM room_invites WHERE room_id=$1', [roomId]);
    });
  }
}
