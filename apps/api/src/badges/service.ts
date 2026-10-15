import type pg from 'pg';
import {
  badgeCollectionSchema,
  badgeDefinitionSchema,
  badgeDefinitionsSchema,
  type BadgeDefinitionInput,
  type BadgeDefinition,
  type Badge,
  type BadgeDisplayInput,
  type BadgeGrantInput,
} from '@boardgame/protocol';
import type { AuthContext } from '../auth.js';
import type { Database } from '../db/index.js';
import { AppError } from '../errors.js';

const definitions: Omit<Badge, 'progress' | 'earned' | 'awardedAt'>[] = [
  {
    id: 'welcome',
    name: '初来乍到',
    description: '加入 PlayBoard，开启桌游旅程。',
    kind: 'achievement',
    symbol: '🌱',
    target: 1,
  },
  {
    id: 'first-match',
    name: '初试身手',
    description: '完成 1 局正式游戏。',
    kind: 'achievement',
    symbol: '🎲',
    target: 1,
  },
  {
    id: 'ten-matches',
    name: '常来坐坐',
    description: '完成 10 局正式游戏。',
    kind: 'achievement',
    symbol: '🏅',
    target: 10,
  },
  {
    id: 'fifty-matches',
    name: '桌游老友',
    description: '完成 50 局正式游戏。',
    kind: 'achievement',
    symbol: '🏆',
    target: 50,
  },
  {
    id: 'explorer',
    name: '游戏探索家',
    description: '完成 3 种不同的正式游戏，同游戏不同版本只计一种。',
    kind: 'achievement',
    symbol: '🧭',
    target: 3,
  },
  {
    id: 'beta-player',
    name: '内测玩家',
    description: '参与平台内测，由管理员授予。',
    kind: 'honor',
    symbol: '🚀',
    target: 1,
  },
  {
    id: 'contributor',
    name: '社区贡献者',
    description: '为社区或平台作出贡献，由管理员授予。',
    kind: 'honor',
    symbol: '💚',
    target: 1,
  },
  {
    id: 'event-honor',
    name: '活动荣誉',
    description: '参与社区活动并获得认可，由管理员授予。',
    kind: 'honor',
    symbol: '👑',
    target: 1,
  },
];

export class BadgeService {
  constructor(private db: Database) {}

  async definitions() {
    const rows = await this.db.query(
      'SELECT id,name,description,symbol,enabled,revision,rule FROM badge_definitions ORDER BY id',
    );
    return badgeDefinitionsSchema.parse({ items: rows.rows });
  }

  // Called by AdminService inside its existing authorization/receipt transaction.
  async saveDefinition(client: pg.PoolClient, actorId: string, input: BadgeDefinitionInput) {
    const found = await client.query<{ revision: number; rule: BadgeDefinition['rule'] }>(
      'SELECT revision,rule FROM badge_definitions WHERE id=$1 FOR UPDATE',
      [input.id],
    );
    const old = found.rows[0];
    if ((old?.revision ?? 0) !== input.expectedRevision)
      throw new AppError('STATE_CONFLICT', '徽章设计已变化，请刷新后重试', 409);
    // Changing the award channel would reinterpret existing manual grants.
    if (old && old.rule.type !== input.rule.type)
      throw new AppError('ACTION_NOT_ALLOWED', '已有徽章不能切换授予方式，请新建徽章', 422);
    if (input.rule.type === 'automatic') {
      for (const condition of input.rule.conditions) {
        if (condition.metric !== 'gameFinished') continue;
        const game = await client.query(
          `SELECT 1 FROM game_installations WHERE game_id=$1
          AND COALESCE((manifest->>'developmentOnly')::boolean,false)=false LIMIT 1`,
          [condition.gameId],
        );
        if (!game.rowCount) throw new AppError('VALIDATION_ERROR', '请选择已安装的正式游戏', 422);
      }
    }
    const saved = await client.query(
      `INSERT INTO badge_definitions
      (id,name,description,symbol,enabled,revision,rule,created_by)
      VALUES($1,$2,$3,$4,$5,1,$6,$7)
      ON CONFLICT(id) DO UPDATE SET name=$2,description=$3,symbol=$4,enabled=$5,
        rule=$6,revision=badge_definitions.revision+1,updated_at=now()
      RETURNING id,name,description,symbol,enabled,revision,rule`,
      [input.id, input.name, input.description, input.symbol, input.enabled, input.rule, actorId],
    );
    return badgeDefinitionSchema.parse(saved.rows[0]);
  }

  // All derived progress, manual grants and selection share one SQL snapshot.
  async collection(accountId: string, query: Pick<Database, 'query'> = this.db) {
    const result = await query.query<{
      displayName: string;
      revision: number;
      displayed: unknown;
      finished: number;
      games: number;
      grants: { id: string; awardedAt: string }[];
      custom: unknown;
      gameCounts: Record<string, number>;
    }>(
      `WITH completed AS (
      SELECT m.game_id FROM match_participants p
      JOIN matches m ON m.id=p.match_id
      JOIN game_installations g ON g.game_id=m.game_id AND g.game_version=m.game_version
      WHERE p.account_id=$1 AND m.status='finished'
        AND COALESCE((g.manifest->>'developmentOnly')::boolean,false)=false
    )
    SELECT a.display_name AS "displayName", COALESCE(s.revision,0) AS revision, COALESCE(s.displayed,'[]') AS displayed,
      (SELECT count(*)::integer FROM completed) AS finished,
      (SELECT count(DISTINCT game_id)::integer FROM completed) AS games,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',badge_id,'awardedAt',awarded_at))
        FROM player_badge_grants WHERE account_id=a.id),'[]') AS grants,
      COALESCE((SELECT jsonb_object_agg(game_id,n) FROM
        (SELECT game_id,count(*)::integer AS n FROM completed GROUP BY game_id) counts),'{}') AS "gameCounts",
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,
        'symbol',symbol,'enabled',enabled,'revision',revision,'rule',rule) ORDER BY id)
        FROM badge_definitions WHERE enabled),'[]') AS custom
    FROM accounts a LEFT JOIN player_badge_settings s ON s.account_id=a.id WHERE a.id=$1`,
      [accountId],
    );
    const row = result.rows[0];
    if (!row) throw new AppError('VALIDATION_ERROR', '玩家不存在', 404);
    const items = definitions.map((definition) => {
      const grant = row.grants.find((item) => item.id === definition.id);
      const progress =
        definition.kind === 'honor'
          ? Number(!!grant)
          : definition.id === 'welcome'
            ? 1
            : definition.id === 'explorer'
              ? row.games
              : row.finished;
      return {
        ...definition,
        progress: Math.min(progress, definition.target),
        earned: progress >= definition.target,
        awardedAt: grant ? new Date(grant.awardedAt).toISOString() : null,
      };
    });
    for (const definition of badgeDefinitionsSchema.parse({ items: row.custom }).items) {
      const grant = row.grants.find((item) => item.id === definition.id);
      const rule = definition.rule;
      const ratios =
        rule.type === 'manual'
          ? []
          : rule.conditions.map((condition) => {
              const count =
                condition.metric === 'finished'
                  ? row.finished
                  : condition.metric === 'games'
                    ? row.games
                    : Object.hasOwn(row.gameCounts, condition.gameId)
                      ? row.gameCounts[condition.gameId]!
                      : 0;
              return Math.min(count / condition.target, 1);
            });
      const ratio =
        rule.type === 'manual'
          ? Number(!!grant)
          : rule.mode === 'all'
            ? Math.min(...ratios)
            : Math.max(...ratios);
      items.push({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        symbol: definition.symbol,
        kind: rule.type === 'manual' ? 'honor' : 'achievement',
        target: rule.type === 'manual' ? 1 : 100,
        progress: rule.type === 'manual' ? ratio : Math.floor(ratio * 100),
        earned: ratio >= 1,
        awardedAt: grant ? new Date(grant.awardedAt).toISOString() : null,
        rule,
      });
    }
    const displayed = (row.displayed as string[]).filter((id) =>
      items.some((item) => item.id === id && item.earned),
    );
    return badgeCollectionSchema.parse({
      accountId,
      displayName: row.displayName,
      revision: row.revision,
      displayed,
      items,
    });
  }

  async lock(client: pg.PoolClient, accountId: string, revision: number) {
    const account = await client.query('SELECT 1 FROM accounts WHERE id=$1', [accountId]);
    if (!account.rowCount) throw new AppError('VALIDATION_ERROR', '玩家不存在', 404);
    await client.query(
      'INSERT INTO player_badge_settings(account_id) VALUES($1) ON CONFLICT DO NOTHING',
      [accountId],
    );
    const state = await client.query<{ revision: number }>(
      'SELECT revision FROM player_badge_settings WHERE account_id=$1 FOR UPDATE',
      [accountId],
    );
    if (state.rows[0]!.revision !== revision)
      throw new AppError('STATE_CONFLICT', '徽章已变化，请刷新后重试', 409);
  }

  // Called inside the existing administrator receipt/authorization transaction.
  async grant(client: pg.PoolClient, actorId: string, accountId: string, input: BadgeGrantInput) {
    await this.lock(client, accountId, input.expectedRevision);
    const collection = await this.collection(accountId, client);
    if (!collection.items.some((item) => item.id === input.badgeId && item.kind === 'honor'))
      throw new AppError('ACTION_NOT_ALLOWED', '只能授予已启用的手动徽章', 422);
    if (input.granted) {
      await client.query(
        `INSERT INTO player_badge_grants(account_id,badge_id,awarded_by)
        VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [accountId, input.badgeId, actorId],
      );
    } else {
      await client.query('DELETE FROM player_badge_grants WHERE account_id=$1 AND badge_id=$2', [
        accountId,
        input.badgeId,
      ]);
      await client.query(
        `UPDATE player_badge_settings SET displayed=(
        SELECT COALESCE(jsonb_agg(value ORDER BY ord),'[]')
        FROM jsonb_array_elements(displayed) WITH ORDINALITY AS x(value,ord) WHERE value<>to_jsonb($2::text)
      ) WHERE account_id=$1`,
        [accountId, input.badgeId],
      );
    }
    await client.query('UPDATE player_badge_settings SET revision=revision+1 WHERE account_id=$1', [
      accountId,
    ]);
    return this.collection(accountId, client);
  }

  async display(current: AuthContext, input: BadgeDisplayInput) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Same account -> session -> settings order as administrative writes.
      const actor = await client.query(
        "SELECT 1 FROM accounts WHERE id=$1 AND status='active' FOR SHARE",
        [current.account.id],
      );
      const session = await client.query(
        `SELECT 1 FROM sessions WHERE id=$1 AND account_id=$2 AND token_hash=$3
        AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
        [current.sessionId, current.account.id, current.tokenHash],
      );
      if (!actor.rowCount || !session.rowCount)
        throw new AppError('UNAUTHENTICATED', '会话已失效，请重新登录', 401);
      // Serialize commands before reading receipts, including concurrent first writes.
      await client.query(
        'INSERT INTO player_badge_settings(account_id) VALUES($1) ON CONFLICT DO NOTHING',
        [current.account.id],
      );
      await client.query('SELECT 1 FROM player_badge_settings WHERE account_id=$1 FOR UPDATE', [
        current.account.id,
      ]);
      const receipt = await client.query<{ result: unknown; same: boolean }>(
        'SELECT result,input=$3::jsonb AS same FROM player_badge_receipts WHERE account_id=$1 AND request_id=$2',
        [current.account.id, input.requestId, input],
      );
      if (receipt.rows[0]) {
        if (!receipt.rows[0].same)
          throw new AppError('REQUEST_ID_CONFLICT', '请求 ID 已用于其他操作', 409);
        await client.query('COMMIT');
        return badgeCollectionSchema.parse(receipt.rows[0].result);
      }
      await this.lock(client, current.account.id, input.expectedRevision);
      const collection = await this.collection(current.account.id, client);
      if (input.displayed.some((id) => !collection.items.find((item) => item.id === id)?.earned))
        throw new AppError('ACTION_NOT_ALLOWED', '只能展示已获得的徽章', 422);
      await client.query(
        'UPDATE player_badge_settings SET displayed=$2,revision=revision+1 WHERE account_id=$1',
        [current.account.id, JSON.stringify(input.displayed)],
      );
      const saved = await this.collection(current.account.id, client);
      await client.query(
        'INSERT INTO player_badge_receipts(account_id,request_id,input,result) VALUES($1,$2,$3,$4)',
        [current.account.id, input.requestId, input, saved],
      );
      await client.query('COMMIT');
      return saved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
