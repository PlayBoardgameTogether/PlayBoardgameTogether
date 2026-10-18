import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import {
  modelProfileSchema,
  aiPointWalletSchema,
  aiPointLedgerSchema,
  officialAiOffersSchema,
  officialAiStatsSchema,
  officialAiEnrollmentSchema,
  officialAiOfferSchema,
  officialAiPublishSchema,
  officialAiStatusSchema,
  officialAiEnrollSchema,
  aiPointGrantSchema,
  officialAiTokenBillingSchema,
  type OfficialAiTokenPricing,
} from '@boardgame/protocol';
import type { AuthContext } from '../auth.js';
import type { Database } from '../db/index.js';
import { AppError } from '../errors.js';
import { tokenCharge } from './pricing.js';

type Reservation = {
  task_id: string;
  account_id: string;
  points: number;
  status: string;
  attempt_id: string;
  token_billing: unknown;
};
type RuntimeProfile = {
  offer_id: string;
  name: string;
  points_per_action: number;
  token_pricing: OfficialAiTokenPricing | null;
  official_match_budget: number;
  source_profile_id: string;
  source_owner: string;
  model_id: string;
  protocol: string;
  base_url: string;
};

export class OfficialAiService {
  constructor(
    private db: Database,
    private testMode = false,
  ) {}

  async profiles(accountId: string) {
    return modelProfileSchema.array().parse(
      (
        await this.db.query(
          `SELECT p.id,p.name,p.endpoint_id,
      '' AS base_url,'official' AS model_id,p.parameters,(p.enabled AND o.enabled) AS enabled,
      o.enabled AS has_credential,1 AS profile_version,p.official_offer_id,p.official_match_budget,
      o.points_per_action AS official_points_per_action,o.token_pricing AS official_token_pricing FROM model_profiles p
      JOIN official_ai_offers o ON o.id=p.official_offer_id
      WHERE p.owner_account_id=$1 AND p.deleted_at IS NULL ORDER BY p.created_at`,
          [accountId],
        )
      ).rows,
    );
  }

  static async assertAvailable(client: PoolClient, profileId: string) {
    const result = await client.query<{ official_offer_id: string | null; available: boolean }>(
      `SELECT p.official_offer_id,
      (o.enabled AND s.enabled AND s.deleted_at IS NULL AND e.enabled AND a.status='active'
        AND (e.protocol='mock' OR (c.id IS NOT NULL AND c.revoked_at IS NULL))) AS available
      FROM model_profiles p LEFT JOIN official_ai_offers o ON o.id=p.official_offer_id
      LEFT JOIN model_profiles s ON s.id=o.source_profile_id LEFT JOIN provider_endpoints e ON e.id=s.endpoint_id
      LEFT JOIN accounts a ON a.id=s.owner_account_id LEFT JOIN model_credentials c ON c.id=s.credential_id
      WHERE p.id=$1`,
      [profileId],
    );
    if (result.rows[0]?.official_offer_id && !result.rows[0].available)
      throw new AppError('FORBIDDEN', '官方 AI 已停用或服务凭证不可用', 403);
  }

  async offers(admin = false) {
    return officialAiOffersSchema.parse(
      (
        await this.db.query(
          `SELECT id,name,
      points_per_action AS "pointsPerAction",token_pricing AS "tokenPricing",enabled,revision FROM official_ai_offers
      WHERE ($1 OR enabled) ORDER BY created_at,id`,
          [admin],
        )
      ).rows,
    );
  }

  async wallet(accountId: string) {
    const row = (
      await this.db.query(
        `SELECT COALESCE(w.balance,0)::int AS balance,
      COALESCE(r.points,0)::int AS reserved,
      (COALESCE(w.balance,0)-COALESCE(r.points,0))::int AS available
      FROM (SELECT $1::uuid AS id) a LEFT JOIN ai_point_wallets w ON w.account_id=a.id
      LEFT JOIN LATERAL(SELECT sum(points) AS points FROM official_ai_reservations
        WHERE account_id=a.id AND status IN ('reserved','ready')) r ON true`,
        [accountId],
      )
    ).rows[0];
    return aiPointWalletSchema.parse(row);
  }

  async ledger(accountId: string, before?: string) {
    const rows = (
      await this.db.query(
        `SELECT id,delta,balance_after AS "balanceAfter",kind,note,
      match_id AS "matchId",token_billing AS "tokenBilling",created_at FROM ai_point_ledger WHERE account_id=$1 AND
      ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM ai_point_ledger WHERE id=$2 AND account_id=$1))
      ORDER BY created_at DESC,id DESC LIMIT 21`,
        [accountId, before ?? null],
      )
    ).rows;
    const items = rows
      .slice(0, 20)
      .map((row) => ({ ...row, createdAt: (row.created_at as Date).toISOString() }));
    return aiPointLedgerSchema.parse({
      items,
      nextCursor: rows.length > 20 ? items.at(-1)!.id : null,
    });
  }

  async stats() {
    return officialAiStatsSchema.parse(
      (
        await this.db.query(`SELECT
      (SELECT COALESCE(sum(delta),0)::float8 FROM ai_point_ledger WHERE kind='grant') AS "grantedPoints",
      (SELECT COALESCE(-sum(delta),0)::float8 FROM ai_point_ledger WHERE kind='action') AS "chargedPoints",
      (SELECT COALESCE(sum(points),0)::float8 FROM official_ai_reservations WHERE status IN ('reserved','ready')) AS "reservedPoints",
      count(*)::int AS calls, count(*) FILTER(WHERE a.status='failed')::int AS "failedCalls",
      count(*) FILTER(WHERE a.status='unknown')::int AS "unknownCalls",
      COALESCE(sum(a.input_tokens),0)::float8 AS "inputTokens",
      COALESCE(sum(a.output_tokens),0)::float8 AS "outputTokens",
      count(*) FILTER(WHERE a.status='completed' AND (a.input_tokens IS NULL OR a.output_tokens IS NULL))::int AS "missingUsageCalls"
      FROM official_ai_reservations r JOIN model_attempts a ON a.id=r.attempt_id`)
      ).rows[0],
    );
  }

  private async command(
    current: AuthContext,
    input: { requestId: string },
    operation: string,
    admin: boolean,
    apply: (client: PoolClient) => Promise<unknown>,
  ) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Same actor's retries and grants are serialized before touching any wallet.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `official-ai:${current.account.id}`,
      ]);
      const actor = await client.query<{ role: string }>(
        `SELECT role FROM accounts WHERE id=$1 AND status='active' FOR SHARE`,
        [current.account.id],
      );
      const session = await client.query(
        `SELECT 1 FROM sessions WHERE id=$1 AND account_id=$2 AND token_hash=$3
        AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`,
        [current.sessionId, current.account.id, current.tokenHash],
      );
      if (!actor.rowCount || !session.rowCount)
        throw new AppError('UNAUTHENTICATED', '会话已失效', 401);
      if (admin && actor.rows[0]!.role !== 'administrator')
        throw new AppError('FORBIDDEN', '需要管理员权限', 403);
      const body = { operation, ...input };
      const old = await client.query<{ result: unknown; same: boolean }>(
        `SELECT result,input=$3::jsonb AS same
        FROM ai_point_receipts WHERE account_id=$1 AND request_id=$2`,
        [current.account.id, input.requestId, body],
      );
      let result: unknown;
      if (old.rows[0]) {
        if (!old.rows[0].same)
          throw new AppError('REQUEST_ID_CONFLICT', '请求 ID 已用于其他操作', 409);
        result = old.rows[0].result;
      } else {
        result = await apply(client);
        await client.query(
          'INSERT INTO ai_point_receipts(account_id,request_id,input,result) VALUES($1,$2,$3,$4)',
          [current.account.id, input.requestId, body, result],
        );
      }
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async publish(current: AuthContext, raw: unknown) {
    const input = officialAiPublishSchema.parse(raw);
    return officialAiOfferSchema.parse(
      await this.command(current, input, 'publish', true, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(73420,1)');
        const source = await client.query<{ protocol: string; has_credential: boolean }>(
          `SELECT e.protocol,
        (c.id IS NOT NULL AND c.revoked_at IS NULL) AS has_credential
        FROM model_profiles p JOIN provider_endpoints e ON e.id=p.endpoint_id
        LEFT JOIN model_credentials c ON c.id=p.credential_id WHERE p.id=$1 AND p.owner_account_id=$2
        AND p.official_offer_id IS NULL AND p.enabled AND p.deleted_at IS NULL AND e.enabled FOR SHARE OF p`,
          [input.profileId, current.account.id],
        );
        const profile = source.rows[0];
        if (!profile || (profile.protocol === 'mock' ? !this.testMode : !profile.has_credential))
          throw new AppError(
            'FORBIDDEN',
            '请选择本人已配置有效密钥的真实模型；模拟服务仅用于自动测试',
            403,
          );
        const count = await client.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM official_ai_offers',
        );
        if (count.rows[0]!.count >= 100)
          throw new AppError('RATE_LIMITED', '官方模型目录已达上限', 429);
        const id = randomUUID();
        await client.query(
          'INSERT INTO official_ai_offers(id,name,source_profile_id,points_per_action,token_pricing) VALUES($1,$2,$3,$4,$5)',
          [id, input.name, input.profileId, input.pointsPerAction, input.tokenPricing ?? null],
        );
        return {
          id,
          name: input.name,
          pointsPerAction: input.pointsPerAction,
          tokenPricing: input.tokenPricing ?? null,
          enabled: true,
          revision: 1,
        };
      }),
    );
  }

  async setStatus(current: AuthContext, id: string, raw: unknown) {
    z.string().uuid().parse(id);
    const input = officialAiStatusSchema.parse(raw);
    return officialAiOfferSchema.parse(
      await this.command(current, input, `status:${id}`, true, async (client) => {
        const offer = await client.query(
          `UPDATE official_ai_offers SET enabled=$3,revision=revision+1 WHERE id=$1 AND revision=$2
        RETURNING id,name,points_per_action AS "pointsPerAction",token_pricing AS "tokenPricing",enabled,revision`,
          [id, input.expectedRevision, input.enabled],
        );
        if (!offer.rowCount) throw new AppError('STATE_CONFLICT', '官方模型已更改，请刷新', 409);
        return offer.rows[0];
      }),
    );
  }

  async grant(current: AuthContext, raw: unknown) {
    const input = aiPointGrantSchema.parse(raw);
    const result = aiPointWalletSchema.parse(
      await this.command(current, input, 'grant', true, async (client) => {
        const target = await client.query(
          "SELECT id FROM accounts WHERE id=$1 AND status='active' FOR SHARE",
          [input.accountId],
        );
        if (!target.rowCount) throw new AppError('FORBIDDEN', '账户不存在或已停用', 403);
        await client.query(
          'INSERT INTO ai_point_wallets(account_id) VALUES($1) ON CONFLICT DO NOTHING',
          [input.accountId],
        );
        const wallet = await client.query<{ balance: number }>(
          `UPDATE ai_point_wallets SET balance=balance+$2
        WHERE account_id=$1 AND balance <= 1000000000-$2 RETURNING balance`,
          [input.accountId, input.points],
        );
        if (!wallet.rowCount) throw new AppError('STATE_CONFLICT', '点数余额超过上限', 409);
        await client.query(
          `INSERT INTO ai_point_ledger(id,account_id,delta,balance_after,kind,note)
        VALUES($1,$2,$3,$4,'grant',$5)`,
          [randomUUID(), input.accountId, input.points, wallet.rows[0]!.balance, input.note],
        );
        const held = await client.query<{ points: number }>(
          `SELECT COALESCE(sum(points),0)::int AS points
        FROM official_ai_reservations WHERE account_id=$1 AND status IN ('reserved','ready')`,
          [input.accountId],
        );
        return {
          balance: wallet.rows[0]!.balance,
          reserved: held.rows[0]!.points,
          available: wallet.rows[0]!.balance - held.rows[0]!.points,
        };
      }),
    );
    await this.resume(input.accountId);
    return result;
  }

  async enroll(current: AuthContext, raw: unknown) {
    const input = officialAiEnrollSchema.parse(raw);
    const result = officialAiEnrollmentSchema.parse(
      await this.command(current, input, 'enroll', false, async (client) => {
        const offer = (
          await client.query<{
            name: string;
            points_per_action: number;
            token_pricing: OfficialAiTokenPricing | null;
          }>(
            'SELECT name,points_per_action,token_pricing FROM official_ai_offers WHERE id=$1 AND enabled FOR SHARE',
            [input.offerId],
          )
        ).rows[0];
        if (!offer) throw new AppError('FORBIDDEN', '官方模型当前不可用', 403);
        if (!offer.token_pricing && input.matchBudget < offer.points_per_action)
          throw new AppError('VALIDATION_ERROR', '单局上限不能低于一次行动的点数', 400);
        const previous = (
          await client.query<{ id: string; official_match_budget: number }>(
            `SELECT id,official_match_budget FROM model_profiles WHERE owner_account_id=$1
        AND official_offer_id=$2 AND deleted_at IS NULL FOR UPDATE`,
            [current.account.id, input.offerId],
          )
        ).rows[0];
        const id = previous?.id ?? randomUUID();
        if (previous) {
          const active = await client.query(
            `SELECT 1 FROM match_participants p JOIN matches m ON m.id=p.match_id
          WHERE p.model_profile_id=$1 AND p.controller_type='model' AND m.status='active'`,
            [id],
          );
          if (active.rowCount && input.matchBudget < previous.official_match_budget)
            throw new AppError(
              'STATE_CONFLICT',
              '进行中的官方 AI 只能提高上限；降低上限请先结束对局或收回控制',
              409,
            );
          await client.query('UPDATE model_profiles SET official_match_budget=$2 WHERE id=$1', [
            id,
            input.matchBudget,
          ]);
        } else {
          await client.query(
            `INSERT INTO model_profiles(id,owner_account_id,name,endpoint_id,model_id,official_offer_id,official_match_budget)
          VALUES($1,$2,$3,'official-ai','official',$4,$5)`,
            [id, current.account.id, `官方 AI · ${offer.name}`, input.offerId, input.matchBudget],
          );
          await client.query(
            `INSERT INTO model_profile_versions(profile_id,version,snapshot) VALUES($1,1,$2)`,
            [id, { officialOfferId: input.offerId, matchBudget: input.matchBudget }],
          );
        }
        return { profileId: id, offerId: input.offerId, matchBudget: input.matchBudget };
      }),
    );
    await this.resume(current.account.id);
    return result;
  }

  // Run after the wallet/profile transaction commits, avoiding wallet -> task lock inversion.
  private async resume(accountId: string) {
    await this.db.query(
      `UPDATE ai_tasks t SET status='queued',attempt_count=0,available_at=now(),
      lease_owner=NULL,lease_until=NULL,safe_error_code=NULL,updated_at=now()
      FROM match_participants p JOIN model_profiles profile ON profile.id=p.model_profile_id
      JOIN matches m ON m.id=p.match_id
      WHERE t.match_id=p.match_id AND t.seat_id=p.seat_id AND t.status='blocked'
      AND p.controller_type='model' AND profile.official_offer_id IS NOT NULL
      AND COALESCE(p.model_owner_account_id,p.account_id)=$1 AND p.controller_epoch=t.controller_epoch
      AND m.status='active' AND m.revision=t.source_revision
      AND NOT EXISTS(SELECT 1 FROM official_ai_reservations r WHERE r.task_id=t.id)`,
      [accountId],
    );
  }

  async runtime(profileId: string, owner: string): Promise<RuntimeProfile | null> {
    return (
      (
        await this.db.query<RuntimeProfile>(
          `SELECT o.id AS offer_id,o.name,o.points_per_action,o.token_pricing,p.official_match_budget,
      s.id AS source_profile_id,s.owner_account_id AS source_owner,s.model_id,e.protocol,e.base_url
      FROM model_profiles p JOIN official_ai_offers o ON o.id=p.official_offer_id
      JOIN model_profiles s ON s.id=o.source_profile_id JOIN provider_endpoints e ON e.id=s.endpoint_id
      JOIN accounts a ON a.id=s.owner_account_id JOIN accounts payer ON payer.id=p.owner_account_id
      LEFT JOIN model_credentials c ON c.id=s.credential_id
      WHERE p.id=$1 AND p.owner_account_id=$2 AND p.deleted_at IS NULL AND p.enabled AND o.enabled
      AND s.enabled AND s.deleted_at IS NULL AND e.enabled AND a.status='active' AND payer.status='active'
      AND ((e.protocol='mock' AND $3) OR (c.id IS NOT NULL AND c.revoked_at IS NULL))`,
          [profileId, owner, this.testMode],
        )
      ).rows[0] ?? null
    );
  }

  async reserve(
    taskId: string,
    leaseOwner: string,
    generation: number,
    profile: RuntimeProfile,
    accountId: string,
    decisionKey: string,
  ) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const task = (
        await client.query<{ match_id: string; seat_id: string; controller_epoch: number }>(
          `SELECT t.match_id,t.seat_id,t.controller_epoch FROM ai_tasks t
        JOIN matches m ON m.id=t.match_id JOIN match_participants p ON p.match_id=t.match_id AND p.seat_id=t.seat_id
        WHERE t.id=$1 AND t.status='running' AND t.lease_owner=$2 AND t.lease_generation=$3 AND t.lease_until>clock_timestamp()
        AND m.status='active' AND m.revision=t.source_revision AND p.controller_epoch=t.controller_epoch
        AND p.controller_type='model' AND COALESCE(p.model_owner_account_id,p.account_id)=$4 FOR UPDATE OF t`,
          [taskId, leaseOwner, generation, accountId],
        )
      ).rows[0];
      if (!task) throw new AppError('AI_TASK_STALE', 'AI 决策已过期', 409);
      const authorization = await client.query(
        `SELECT o.id FROM official_ai_offers o
        JOIN model_profiles s ON s.id=o.source_profile_id JOIN accounts a ON a.id=s.owner_account_id
        JOIN accounts payer ON payer.id=$2 WHERE o.id=$1 AND o.enabled AND s.enabled AND s.deleted_at IS NULL
        AND a.status='active' AND payer.status='active' FOR SHARE OF o,a,payer`,
        [profile.offer_id, accountId],
      );
      if (!authorization.rowCount)
        throw new AppError('AI_BLOCKED', '官方 AI 或付款授权已失效', 409);
      if (
        (await client.query('SELECT 1 FROM official_ai_reservations WHERE task_id=$1', [taskId]))
          .rowCount
      )
        throw new AppError(
          'AI_PROVIDER_FAILED',
          '本次模型调用已记录，恢复时不重复调用，使用免费兜底',
          503,
        );
      await client.query(
        'INSERT INTO ai_point_wallets(account_id) VALUES($1) ON CONFLICT DO NOTHING',
        [accountId],
      );
      const wallet = (
        await client.query<{ balance: number }>(
          'SELECT balance FROM ai_point_wallets WHERE account_id=$1 FOR UPDATE',
          [accountId],
        )
      ).rows[0]!;
      const totals = (
        await client.query<{ reserved: number; used: number }>(
          `SELECT
        COALESCE(sum(points) FILTER(WHERE status IN ('reserved','ready')),0)::int AS reserved,
        COALESCE(sum(points) FILTER(WHERE match_id=$2 AND seat_id=$3 AND status IN ('reserved','ready','charged')),0)::int AS used
        FROM official_ai_reservations WHERE account_id=$1`,
          [accountId, task.match_id, task.seat_id],
        )
      ).rows[0]!;
      const available = wallet.balance - totals.reserved;
      const remaining = profile.official_match_budget - totals.used;
      const reservedPoints = profile.token_pricing
        ? Math.min(profile.points_per_action, available, remaining)
        : profile.points_per_action;
      if (available < reservedPoints || available < 1)
        throw new AppError('AI_BLOCKED', 'AI 点数不足，请补充点数后重试或收回控制', 409);
      if (remaining < reservedPoints || remaining < 1)
        throw new AppError('AI_BLOCKED', '此席位已达到单局 AI 点数上限', 409);
      const group = await client.query(
        `INSERT INTO ai_decision_groups(match_id,seat_id,controller_epoch,decision_key,external_attempts)
        VALUES($1,$2,$3,$4,1) ON CONFLICT(match_id,seat_id,controller_epoch,decision_key)
        DO UPDATE SET external_attempts=ai_decision_groups.external_attempts+1,updated_at=now()
        WHERE ai_decision_groups.external_attempts<2 RETURNING external_attempts`,
        [task.match_id, task.seat_id, task.controller_epoch, decisionKey],
      );
      if (!group.rowCount) throw new AppError('AI_BLOCKED', '本次决策已达到模型调用上限', 409);
      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO model_attempts(id,owner_account_id,profile_id,purpose,status)
        VALUES($1,$2,$3,'decision','dispatching')`,
        [attemptId, accountId, profile.source_profile_id],
      );
      await client.query(
        `INSERT INTO official_ai_reservations(task_id,attempt_id,account_id,offer_id,match_id,seat_id,points,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,'reserved')`,
        [
          taskId,
          attemptId,
          accountId,
          profile.offer_id,
          task.match_id,
          task.seat_id,
          reservedPoints,
        ],
      );
      await client.query('COMMIT');
      return attemptId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordResponse(
    taskId: string,
    response: {
      requestId?: string;
      model?: string;
      inputTokens: number | null;
      outputTokens: number | null;
    },
    latency: number,
  ) {
    await this.db.query(
      `UPDATE model_attempts a SET status='completed',provider_request_id=$2,returned_model_id=$3,
      input_tokens=$4,output_tokens=$5,latency_ms=$6,finished_at=now() FROM official_ai_reservations r
      WHERE r.task_id=$1 AND a.id=r.attempt_id`,
      [
        taskId,
        response.requestId ?? null,
        response.model ?? null,
        response.inputTokens,
        response.outputTokens,
        latency,
      ],
    );
  }

  async ready(taskId: string) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Match commit, release and recovery all acquire task before wallet.
      await client.query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE', [taskId]);
      const row = (
        await client.query<
          Reservation & {
            offer_id: string;
            token_pricing: OfficialAiTokenPricing | null;
            input_tokens: number | null;
            output_tokens: number | null;
          }
        >(
          `SELECT r.*,o.token_pricing,a.input_tokens,a.output_tokens
        FROM official_ai_reservations r JOIN official_ai_offers o ON o.id=r.offer_id
        JOIN model_attempts a ON a.id=r.attempt_id WHERE r.task_id=$1`,
          [taskId],
        )
      ).rows[0];
      if (!row || row.status !== 'reserved')
        throw new AppError('AI_TASK_STALE', '本次 AI 额度预留已释放', 409);
      await client.query('SELECT account_id FROM ai_point_wallets WHERE account_id=$1 FOR UPDATE', [
        row.account_id,
      ]);
      const charge = row.token_pricing
        ? tokenCharge(row.token_pricing, row.input_tokens, row.output_tokens, row.points)
        : row.points;
      const billing = row.token_pricing
        ? officialAiTokenBillingSchema.parse({
            offerId: row.offer_id,
            pricing: row.token_pricing,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            chargedPoints: charge,
          })
        : null;
      await client.query(
        `UPDATE official_ai_reservations SET status='ready',points=$2,token_billing=$3 WHERE task_id=$1`,
        [taskId, charge, billing],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async release(taskId: string, failed = false, recoverOnly = false) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM ai_tasks WHERE id=$1 FOR UPDATE', [taskId]);
      if (recoverOnly) {
        const expired = await client.query(
          `SELECT 1 FROM ai_tasks t JOIN official_ai_reservations r ON r.task_id=t.id
          JOIN matches m ON m.id=t.match_id JOIN match_participants p ON p.match_id=t.match_id AND p.seat_id=t.seat_id
          WHERE t.id=$1 AND (m.status<>'active' OR m.revision<>t.source_revision OR p.controller_epoch<>t.controller_epoch
          OR t.status IN ('stale','cancelled','blocked') OR
          (r.status='reserved' AND (t.lease_until IS NULL OR t.lease_until<clock_timestamp())))`,
          [taskId],
        );
        if (!expired.rowCount) {
          await client.query('COMMIT');
          return;
        }
      }
      const row = (
        await client.query<Reservation>('SELECT * FROM official_ai_reservations WHERE task_id=$1', [
          taskId,
        ])
      ).rows[0];
      if (row && ['reserved', 'ready'].includes(row.status)) {
        await client.query(
          'SELECT account_id FROM ai_point_wallets WHERE account_id=$1 FOR UPDATE',
          [row.account_id],
        );
        await client.query(
          "UPDATE official_ai_reservations SET status='released' WHERE task_id=$1",
          [taskId],
        );
        await client.query(
          `UPDATE model_attempts SET status=$2,safe_error_code=$3,finished_at=now() WHERE id=$1 AND (status='dispatching' OR $4)`,
          [
            row.attempt_id,
            failed ? 'failed' : 'unknown',
            failed ? 'AI_PROVIDER_FAILED' : 'AI_TIMEOUT',
            failed,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recover() {
    const rows = await this.db.query<{
      task_id: string;
    }>(`SELECT r.task_id FROM official_ai_reservations r
      JOIN ai_tasks t ON t.id=r.task_id JOIN matches m ON m.id=t.match_id
      JOIN match_participants p ON p.match_id=t.match_id AND p.seat_id=t.seat_id
      WHERE r.status IN ('reserved','ready') AND
      (m.status<>'active' OR m.revision<>t.source_revision OR p.controller_epoch<>t.controller_epoch
      OR t.status IN ('stale','cancelled','blocked') OR (r.status='reserved' AND
        (t.lease_until IS NULL OR t.lease_until<clock_timestamp()))) LIMIT 100`);
    for (const row of rows.rows) await this.release(row.task_id, false, true);
  }

  // Called while the original match action transaction holds room/match/task locks.
  static async charge(client: PoolClient, taskId: string) {
    const row = (
      await client.query<Reservation>('SELECT * FROM official_ai_reservations WHERE task_id=$1', [
        taskId,
      ])
    ).rows[0];
    if (!row || row.status === 'released' || row.status === 'charged') return;
    if (row.status !== 'ready') throw new AppError('AI_BLOCKED', '官方 AI 尚未完成有效决策', 409);
    if (row.points === 0) {
      // Zero usage (or usage only on a free token direction) creates no debit ledger entry.
      await client.query("UPDATE official_ai_reservations SET status='released' WHERE task_id=$1", [
        taskId,
      ]);
      return;
    }
    const wallet = (
      await client.query<{ balance: number }>(
        `UPDATE ai_point_wallets SET balance=balance-$2
      WHERE account_id=$1 AND balance>=$2 RETURNING balance`,
        [row.account_id, row.points],
      )
    ).rows[0];
    if (!wallet) throw new AppError('AI_BLOCKED', 'AI 点数余额不足', 409);
    const id = randomUUID();
    await client.query(
      `INSERT INTO ai_point_ledger(id,account_id,delta,balance_after,kind,note,match_id,token_billing)
      SELECT $2,account_id,-points,$3,'action',CASE WHEN token_billing IS NULL THEN '官方 AI 成功行动'
        ELSE '官方 AI token 用量' END,match_id,token_billing FROM official_ai_reservations WHERE task_id=$1`,
      [taskId, id, wallet.balance],
    );
    await client.query(
      "UPDATE official_ai_reservations SET status='charged',ledger_id=$2 WHERE task_id=$1",
      [taskId, id],
    );
  }
}
