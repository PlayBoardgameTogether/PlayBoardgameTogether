import type pg from 'pg';
import {
  adminAccountSchema,
  adminAccountPageSchema,
  adminGameSchema,
  adminOverviewSchema,
  type AdminAccountCommand,
  type AdminGameCommand,
} from '@boardgame/protocol';
import { manifestSchema } from '@boardgame/game-sdk';
import type { AuthContext } from '../auth.js';
import type { Database } from '../db/index.js';
import type { GameRegistry } from '../registry/index.js';
import { AppError } from '../errors.js';
import { BadgeService } from '../badges/service.js';
import { badgeCollectionSchema, type BadgeGrantInput } from '@boardgame/protocol';

type AccountRow = {
  id: string;
  username_canonical: string;
  display_name: string;
  role: string;
  status: string;
  admin_revision: number;
  created_at: Date;
};
type GameRow = { manifest: unknown; enabled: boolean; admin_revision: number };
const accountDto = (row: AccountRow) =>
  adminAccountSchema.parse({
    id: row.id,
    username: row.username_canonical,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    revision: row.admin_revision,
    createdAt: row.created_at.toISOString(),
  });
const accountColumns =
  'id,username_canonical,display_name,role,status,admin_revision,created_at';

export class AdminService {
  async badges(accountId: string) {
    return new BadgeService(this.db).collection(accountId);
  }

  async setBadge(current: AuthContext, accountId: string, input: BadgeGrantInput) {
    return badgeCollectionSchema.parse(
      await this.command(
        current,
        input.requestId,
        { operation: 'badge.grant', accountId, ...input },
        client => new BadgeService(this.db).grant(client, current.account.id, accountId, input),
      ),
    );
  }
  constructor(
    private db: Database,
    private registry: GameRegistry,
    private production: boolean,
  ) {}

  private gameDto(row: GameRow) {
    const manifest = manifestSchema.parse(row.manifest);
    const extension = this.registry.get(manifest.id, manifest.version);
    const available =
      !!extension &&
      this.registry.hasResourcePack(manifest.id, manifest.version) &&
      JSON.stringify(manifestSchema.parse(extension.manifest)) ===
        JSON.stringify(manifest);
    return adminGameSchema.parse({
      id: manifest.id,
      version: manifest.version,
      name: manifest.name,
      enabled: row.enabled,
      revision: row.admin_revision,
      available,
      developmentOnly: manifest.developmentOnly ?? false,
    });
  }

  async overview() {
    // Scalar subqueries share one statement snapshot; no private state is read.
    const result = await this.db.query(`SELECT
      (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM accounts WHERE status='disabled') AS "disabledAccounts",
      (SELECT count(*)::int FROM rooms WHERE status!='closed') AS "openRooms",
      (SELECT count(*)::int FROM matches WHERE status='active') AS "activeMatches",
      (SELECT count(*)::int FROM game_installations) AS "installedGames",
      (SELECT count(*)::int FROM game_installations WHERE enabled) AS "enabledGames",
      (SELECT count(*)::int FROM game_submissions WHERE status='pending') AS "pendingSubmissions"`);
    return adminOverviewSchema.parse(result.rows[0]);
  }

  async accounts(search: string, before?: string) {
    const result = await this.db.query<AccountRow>(
      `SELECT ${accountColumns} FROM accounts
      WHERE (strpos(username_canonical,lower($1))>0 OR strpos(display_name,$1)>0)
      AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM accounts WHERE id=$2))
      ORDER BY created_at DESC,id DESC LIMIT 21`,
      [search, before ?? null],
    );
    const items = result.rows.slice(0, 20).map(accountDto);
    return adminAccountPageSchema.parse({
      items,
      nextCursor: result.rows.length > 20 ? items.at(-1)!.id : null,
    });
  }

  async games() {
    const rows = await this.db.query<GameRow>(
      'SELECT manifest,enabled,admin_revision FROM game_installations ORDER BY game_id,game_version',
    );
    return rows.rows.map((row) => this.gameDto(row));
  }

  private async command(
    current: AuthContext,
    requestId: string,
    input: unknown,
    apply: (client: pg.PoolClient) => Promise<unknown>,
  ) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Serializes rare administrative mutations, including cross-account writes.
      await client.query('SELECT pg_advisory_xact_lock(73419, 1)');
      const actor = await client.query<{ role: string }>(
        "SELECT role FROM accounts WHERE id=$1 AND status='active' FOR UPDATE",
        [current.account.id],
      );
      const session = await client.query(
        `SELECT 1 FROM sessions WHERE id=$1 AND account_id=$2 AND token_hash=$3
        AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
        [current.sessionId, current.account.id, current.tokenHash],
      );
      if (!actor.rowCount || !session.rowCount)
        throw new AppError('UNAUTHENTICATED', '会话已失效，请重新登录', 401);
      if (actor.rows[0]!.role !== 'administrator')
        throw new AppError('FORBIDDEN', '需要管理员权限', 403);
      const old = await client.query<{ input: unknown; result: unknown }>(
        'SELECT input,result FROM admin_command_receipts WHERE account_id=$1 AND request_id=$2',
        [current.account.id, requestId],
      );
      if (old.rows[0]) {
        // JSONB canonical equality avoids relying on property order after storage.
        const same = await client.query<{ same: boolean }>(
          'SELECT $1::jsonb=$2::jsonb AS same',
          [old.rows[0].input, input],
        );
        if (!same.rows[0]!.same)
          throw new AppError(
            'REQUEST_ID_CONFLICT',
            '请求 ID 已用于其他操作',
            409,
          );
        await client.query('COMMIT');
        return old.rows[0].result;
      }
      const result = await apply(client);
      await client.query(
        'INSERT INTO admin_command_receipts(account_id,request_id,input,result) VALUES($1,$2,$3,$4)',
        [current.account.id, requestId, input, result],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setAccount(
    current: AuthContext,
    id: string,
    input: AdminAccountCommand,
  ) {
    return adminAccountSchema.parse(
      await this.command(
        current,
        input.requestId,
        { operation: 'account.status', id, ...input },
        async (client) => {
          const found = await client.query<AccountRow>(
            `SELECT ${accountColumns} FROM accounts WHERE id=$1 FOR UPDATE`,
            [id],
          );
          const row = found.rows[0];
          if (!row) throw new AppError('VALIDATION_ERROR', '账户不存在', 404);
          // Keep administrator lifecycle in the established CLI; no self-lockout or last-admin loss.
          if (row.role === 'administrator')
            throw new AppError('FORBIDDEN', '后台仅管理普通账户的启停', 403);
          if (row.admin_revision !== input.expectedRevision)
            throw new AppError(
              'STATE_CONFLICT',
              '账户已变化，请刷新后重试',
              409,
            );
          if (row.status === input.status) return accountDto(row);
          const saved = await client.query<AccountRow>(
            `UPDATE accounts SET status=$2 WHERE id=$1 RETURNING ${accountColumns}`,
            [id, input.status],
          );
          if (input.status === 'disabled') {
            await client.query(
              'UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE account_id=$1',
              [id],
            );
            await client.query(
              "SELECT pg_notify('boardgame_session_revoked',$1)",
              [id],
            );
          }
          return accountDto(saved.rows[0]!);
        },
      ),
    );
  }

  async setGame(
    current: AuthContext,
    id: string,
    version: string,
    input: AdminGameCommand,
  ) {
    return adminGameSchema.parse(
      await this.command(
        current,
        input.requestId,
        { operation: 'game.enabled', id, version, ...input },
        async (client) => {
          const found = await client.query<GameRow>(
            'SELECT manifest,enabled,admin_revision FROM game_installations WHERE game_id=$1 AND game_version=$2 FOR UPDATE',
            [id, version],
          );
          const row = found.rows[0];
          if (!row) throw new AppError('GAME_NOT_FOUND', '游戏版本未安装', 404);
          const game = this.gameDto(row);
          if (game.revision !== input.expectedRevision)
            throw new AppError(
              'STATE_CONFLICT',
              '游戏状态已变化，请刷新后重试',
              409,
            );
          if (
            input.enabled &&
            (!game.available || (this.production && game.developmentOnly))
          ) {
            throw new AppError(
              'GAME_VERSION_UNAVAILABLE',
              '此版本没有可用的可信规则与资源',
              422,
            );
          }
          const saved = await client.query<GameRow>(
            'UPDATE game_installations SET enabled=$3 WHERE game_id=$1 AND game_version=$2 RETURNING manifest,enabled,admin_revision',
            [id, version, input.enabled],
          );
          return this.gameDto(saved.rows[0]!);
        },
      ),
    );
  }
}
