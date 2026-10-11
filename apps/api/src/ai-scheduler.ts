import { ModelProfileService } from './model-profiles.js';
import { createHash, randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { DeterministicRng } from '@boardgame/game-sdk';
import { MockModelAdapter, OpenAiChatAdapter, parseModelChoice } from './model-ai.js';
import type { Database } from './db/index.js';
import type { ApiConfig } from './config.js';
import type { MatchService } from './matches.js';
import type { GameRegistry } from './registry/index.js';
type Claim = {
  id: string;
  match_id: string;
  seat_id: string;
  source_revision: number;
  controller_epoch: number;
  policy_id: string;
  policy_version: string;
  policy_hash: string;
  lease_generation: number;
  proposed_action: unknown | null;
  controller_type: 'script' | 'model';
  model_profile_id: string | null;
};
type Context = {
  publicRules: string;
  gameId: string;
  view: unknown;
  legalActions: unknown[];
  actionSpec: unknown;
};
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
          .join(',')}}`
      : JSON.stringify(v);
const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export class AiScheduler {
  private timer: NodeJS.Timeout | undefined;
  private cycleWork: Promise<void> | undefined;
  private active = 0;
  private closed = false;
  private readonly owner = `api-${process.pid}-${randomUUID()}`;
  private readonly inflight = new Set<Promise<void>>();
  private readonly workers = new Set<Worker>();
  private readonly models: ModelProfileService;
  constructor(
    private db: Database,
    private registry: GameRegistry,
    private matches: MatchService,
    private config: ApiConfig,
  ) {
    this.models = new ModelProfileService(db, config.MODEL_CREDENTIALS_KEY);
  }
  start() {
    if (this.timer) return;
    this.scheduleCycle();
    this.timer = setInterval(() => this.scheduleCycle(), this.config.AI_SCAN_INTERVAL_MS);
    this.timer.unref();
  }
  async close() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.cycleWork;
    for (const w of this.workers) void w.terminate();
    await Promise.allSettled([...this.inflight]);
  }
  wake(matchId?: string) {
    void matchId;
    this.scheduleCycle();
  }
  private scheduleCycle() {
    if (this.closed || this.cycleWork) return;
    const work = this.cycle().finally(() => {
      if (this.cycleWork === work) this.cycleWork = undefined;
    });
    this.cycleWork = work;
    void work;
  }
  private async cycle() {
    if (this.closed) return;
    try {
      await this.db.query(
        `UPDATE ai_tasks SET status=CASE WHEN attempt_count<$1 THEN 'queued' ELSE 'blocked' END,available_at=now(),lease_owner=NULL,lease_until=NULL,updated_at=now(),safe_error_code=CASE WHEN attempt_count<$1 THEN safe_error_code ELSE 'AI_TIMEOUT' END WHERE status IN ('running','proposed','submitting') AND lease_until<now()`,
        [this.config.AI_MAX_ATTEMPTS],
      );
      const active = await this.db.query<{ id: string }>(
        "SELECT id FROM matches WHERE status='active' ORDER BY created_at LIMIT 100",
      );
      for (const row of active.rows) await this.reconcileMatch(row.id);
      while (!this.closed && this.active < this.config.AI_GLOBAL_CONCURRENCY) {
        const claim = await this.claim();
        if (!claim) break;
        this.active++;
        const work = this.process(claim).finally(() => {
          this.active--;
          this.inflight.delete(work);
          if (!this.closed) queueMicrotask(() => this.scheduleCycle());
        });
        this.inflight.add(work);
        void work;
      }
    } catch {
      /* compensated by next scan */
    }
  }
  async reconcileMatch(matchId: string) {
    const result = await this.db.query<any>(
      `SELECT m.game_id,m.game_version,m.state,m.revision,p.seat_id,p.controller_epoch,p.controller_type,p.policy_id,p.policy_version,p.policy_hash FROM matches m JOIN match_participants p ON p.match_id=m.id WHERE m.id=$1 AND m.status='active' AND (p.controller_type='model' OR (p.controller_type='script' AND p.occupant_kind='bot'))`,
      [matchId],
    );
    if (!result.rowCount) return;
    try {
      const first = result.rows[0];
      const ext = this.registry.get(first.game_id, first.game_version);
      if (!ext?.getDecisionContext) return;
      const state = ext.deserialize(first.state);
      const requests = ext.getDecisionRequests?.(state);
      for (const row of result.rows) {
        if (requests && !requests.some((item) => item.seatId === row.seat_id)) continue;
        const decision = ext.getDecisionContext(state, { kind: 'seat', seatId: row.seat_id });
        if (!decision) continue;
        await this.db.query(
          `INSERT INTO ai_tasks(id,match_id,seat_id,source_revision,controller_epoch,decision_key,policy_id,policy_version,policy_hash,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(match_id,seat_id,source_revision,controller_epoch,decision_key) DO NOTHING`,
          [
            randomUUID(),
            matchId,
            row.seat_id,
            row.revision,
            row.controller_epoch,
            decision.decisionKey,
            row.policy_id,
            row.policy_version,
            row.policy_hash,
            randomUUID(),
          ],
        );
      }
    } catch {
      for (const row of result.rows)
        await this.blockParticipant(matchId, row.seat_id, 'AI_CONTEXT_INVALID');
    }
  }
  private async claim(): Promise<Claim | null> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      const picked = await c.query<Claim>(
        `SELECT t.id,t.match_id,t.seat_id,t.source_revision,t.controller_epoch,t.policy_id,t.policy_version,t.policy_hash,t.lease_generation,t.proposed_action,p.controller_type,p.model_profile_id FROM ai_tasks t JOIN match_participants p ON p.match_id=t.match_id AND p.seat_id=t.seat_id WHERE t.status='queued' AND t.available_at<=now() AND NOT EXISTS(SELECT 1 FROM ai_tasks x WHERE x.match_id=t.match_id AND x.status IN ('running','proposed','submitting')) ORDER BY t.available_at,t.created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!picked.rowCount) {
        await c.query('COMMIT');
        return null;
      }
      const row = picked.rows[0]!;
      const result = await c.query<Claim>(
        `UPDATE ai_tasks SET status='running',attempt_count=attempt_count+1,lease_owner=$2,lease_until=now()+($3::text||' milliseconds')::interval,lease_generation=lease_generation+1,deadline=now()+($4::text||' milliseconds')::interval,updated_at=now() WHERE id=$1 RETURNING id,match_id,seat_id,source_revision,controller_epoch,policy_id,policy_version,policy_hash,lease_generation,proposed_action`,
        [row.id, this.owner, this.config.AI_LEASE_MS, this.config.AI_DECISION_TIMEOUT_MS],
      );
      await c.query(
        "UPDATE match_participants SET ai_status='running',ai_status_version=ai_status_version+1 WHERE match_id=$1 AND seat_id=$2",
        [row.match_id, row.seat_id],
      );
      await c.query('COMMIT');
      return {
        ...result.rows[0]!,
        controller_type: row.controller_type,
        model_profile_id: row.model_profile_id,
      };
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
  private async context(t: Claim): Promise<Context | null> {
    const r = await this.db.query<any>(
      `SELECT m.game_id,m.game_version,m.state,m.rng_state,m.status,m.revision,p.controller_type,p.controller_epoch,p.policy_id,p.policy_version,p.policy_hash FROM matches m JOIN match_participants p ON p.match_id=m.id WHERE m.id=$1 AND p.seat_id=$2`,
      [t.match_id, t.seat_id],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0]!;
    if (
      row.status !== 'active' ||
      row.revision !== t.source_revision ||
      !['script', 'model'].includes(row.controller_type) ||
      row.controller_epoch !== t.controller_epoch ||
      row.policy_id !== t.policy_id ||
      row.policy_version !== t.policy_version ||
      row.policy_hash !== t.policy_hash
    )
      return null;
    const ext = this.registry.get(row.game_id, row.game_version);
    if (!ext?.getDecisionContext) return null;
    DeterministicRng.restore(row.rng_state);
    const state = ext.deserialize(row.state);
    const view = ext.getView(state, { kind: 'seat', seatId: t.seat_id });
    const decision = ext.getDecisionContext(state, { kind: 'seat', seatId: t.seat_id });
    return decision
      ? {
          publicRules:
            this.registry.rules.get(`${row.game_id}@${row.game_version}`) ??
            ext.manifest.description,
          gameId: row.game_id,
          view: structuredClone(view),
          legalActions: structuredClone(decision.legalActions),
          actionSpec: structuredClone(
            ext.getActionSpec(state, { kind: 'seat', seatId: t.seat_id }),
          ),
        }
      : null;
  }
  private script(t: Claim, c: Context) {
    return new Promise<unknown>((resolve, reject) => {
      const w = new Worker(new URL('../src/ai-policy-worker.mjs', import.meta.url));
      this.workers.add(w);
      const done = () => {
        this.workers.delete(w);
        void w.terminate();
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error('AI_TIMEOUT'));
      }, this.config.AI_DECISION_TIMEOUT_MS);
      w.once('message', (m: any) => {
        clearTimeout(timer);
        done();
        if (m?.ok) resolve(m.action);
        else reject(new Error(m?.error ?? 'AI_POLICY_FAILED'));
      });
      w.once('error', (e) => {
        clearTimeout(timer);
        done();
        reject(e);
      });
      w.postMessage({
        policyId: t.policy_id,
        gameId: c.gameId,
        view: c.view,
        legalActions: c.legalActions,
        publicRules: c.publicRules,
        testMode: this.config.NODE_ENV === 'test',
      });
    });
  }
  private async model(t: Claim, context: Context) {
    if (!t.model_profile_id) throw new Error('AI_PROFILE_UNAVAILABLE');
    const task = await this.db.query<{ decision_key: string }>(
      'SELECT decision_key FROM ai_tasks WHERE id=$1',
      [t.id],
    );
    const version = await this.db.query<{ game_version: string }>(
      'SELECT game_version FROM matches WHERE id=$1',
      [t.match_id],
    );
    const extension = this.registry.get(context.gameId, version.rows[0]!.game_version);
    // A committed action ends a single-actor decision. Simultaneous games keep
    // their shared decision key across revisions while other players submit.
    const decisionKey = extension?.getDecisionRequests
      ? task.rows[0]!.decision_key
      : `revision:${t.source_revision}:${task.rows[0]!.decision_key}`;
    const group = await this.db.query(
      `INSERT INTO ai_decision_groups(match_id,seat_id,controller_epoch,decision_key,external_attempts)
     VALUES($1,$2,$3,$4,1) ON CONFLICT(match_id,seat_id,controller_epoch,decision_key)
     DO UPDATE SET external_attempts=ai_decision_groups.external_attempts+1,updated_at=now()
     WHERE ai_decision_groups.external_attempts<2 RETURNING external_attempts`,
      [t.match_id, t.seat_id, t.controller_epoch, decisionKey],
    );
    if (!group.rowCount) throw new Error('AI_DECISION_GROUP_LIMIT');
    const participant = await this.db.query<{ account_id: string | null }>(
      'SELECT COALESCE(model_owner_account_id,account_id) AS account_id FROM match_participants WHERE match_id=$1 AND seat_id=$2',
      [t.match_id, t.seat_id],
    );
    const owner = participant.rows[0]?.account_id;
    if (!owner) throw new Error('AI_PROFILE_UNAVAILABLE');
    const profiles = await this.db.query<{ model_id: string; protocol: string; base_url: string }>(
      `SELECT p.model_id,e.protocol,e.base_url
     FROM model_profiles p JOIN provider_endpoints e ON e.id=p.endpoint_id JOIN accounts a ON a.id=p.owner_account_id
     WHERE a.status='active' AND e.enabled=true AND p.id=$1 AND p.owner_account_id=$2 AND p.enabled=true AND p.deleted_at IS NULL`,
      [t.model_profile_id, owner],
    );
    const profile = profiles.rows[0];
    if (!profile) throw new Error('AI_PROFILE_UNAVAILABLE');
    const choices = context.legalActions.map((action, index) => ({
      id: `a${index.toString(36)}`,
      description: canonical(action),
    }));
    const adapter = profile.protocol === 'mock' ? new MockModelAdapter() : new OpenAiChatAdapter();
    const key =
      profile.protocol === 'mock'
        ? 'mock'
        : await this.models.decryptCredential(owner, t.model_profile_id);
    const response = await adapter.decide(
      {
        endpoint: profile.base_url,
        model: profile.model_id,
        apiKey: key,
        decisionId: t.id,
        choices,
        rules: context.publicRules,
        view: context.view,
        timeoutMs: this.config.AI_DECISION_TIMEOUT_MS,
      },
      new AbortController().signal,
    );
    const selected = parseModelChoice(
      response.raw,
      t.id,
      new Set(choices.map((choice) => choice.id)),
    );
    return context.legalActions[choices.findIndex((choice) => choice.id === selected.choiceId)];
  }
  private async process(t: Claim) {
    try {
      const c = await this.context(t);
      if (!c) {
        await this.stale(t);
        return;
      }
      let action = t.proposed_action;
      let fallback = false;
      if (action === null) {
        try {
          action = t.controller_type === 'model' ? await this.model(t, c) : await this.script(t, c);
        } catch {
          const ext = this.registry.get(
            c.gameId,
            (
              await this.db.query<{ game_version: string }>(
                'SELECT game_version FROM matches WHERE id=$1',
                [t.match_id],
              )
            ).rows[0]!.game_version,
          );
          action = ext?.getFallbackAction(c.view as any, c.actionSpec as any);
          fallback = true;
          if (action == null) throw new Error('AI_FALLBACK_FAILED');
        }
      }
      if (!c.legalActions.some((x) => canonical(x) === canonical(action))) {
        const ext = this.registry.get(
          c.gameId,
          (
            await this.db.query<{ game_version: string }>(
              'SELECT game_version FROM matches WHERE id=$1',
              [t.match_id],
            )
          ).rows[0]!.game_version,
        );
        action = ext?.getFallbackAction(c.view as any, c.actionSpec as any);
        fallback = true;
      }
      const frozen = await this.db.query(
        `UPDATE ai_tasks t SET status='proposed',proposed_action=$4,proposal_hash=$5,safe_error_code=$6,updated_at=now() FROM matches m,match_participants p WHERE t.id=$1 AND t.match_id=m.id AND p.match_id=t.match_id AND p.seat_id=t.seat_id AND t.lease_owner=$2 AND t.lease_generation=$3 AND t.status='running' AND t.lease_until>now() AND m.revision=t.source_revision AND p.controller_epoch=t.controller_epoch AND p.controller_type IN ('script','model') RETURNING t.id`,
        [
          t.id,
          this.owner,
          t.lease_generation,
          action,
          digest(action),
          fallback ? 'AI_FALLBACK_USED' : null,
        ],
      );
      if (!frozen.rowCount) {
        await this.stale(t);
        return;
      }
      await this.db.query("UPDATE ai_tasks SET status='submitting' WHERE id=$1", [t.id]);
      await this.matches.actAutomation(t.id, this.owner, t.lease_generation);
      this.wake(t.match_id);
    } catch {
      const retry = await this.db.query<{ attempt_count: number }>(
        'SELECT attempt_count FROM ai_tasks WHERE id=$1',
        [t.id],
      );
      if (retry.rowCount && retry.rows[0]!.attempt_count < this.config.AI_MAX_ATTEMPTS)
        await this.db.query(
          "UPDATE ai_tasks SET status='queued',lease_owner=NULL,lease_until=NULL,available_at=now()+interval '1 second' WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3",
          [t.id, this.owner, t.lease_generation],
        );
      else
        await this.db.query(
          "UPDATE ai_tasks SET status='blocked',safe_error_code='AI_POLICY_FAILED',lease_owner=NULL,lease_until=NULL WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3",
          [t.id, this.owner, t.lease_generation],
        );
    }
  }
  private async stale(t: Claim) {
    await this.db.query("UPDATE ai_tasks SET status='stale' WHERE id=$1 AND lease_generation=$2", [
      t.id,
      t.lease_generation,
    ]);
  }
  private async blockParticipant(matchId: string, seatId: string, code: string) {
    await this.db.query(
      "UPDATE match_participants SET ai_status='blocked',ai_error_code=$3,ai_status_version=ai_status_version+1 WHERE match_id=$1 AND seat_id=$2",
      [matchId, seatId, code],
    );
  }
}
