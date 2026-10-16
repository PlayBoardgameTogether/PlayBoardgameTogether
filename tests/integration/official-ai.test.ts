import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAccount } from '../../apps/api/src/auth.js';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { MatchService } from '../../apps/api/src/matches.js';
import { AiScheduler } from '../../apps/api/src/ai-scheduler.js';
import { normalizeConfig } from '../../apps/api/src/config.js';
import { OfficialAiService } from '../../apps/api/src/official-ai/service.js';
import { MockModelAdapter } from '../../apps/api/src/model-ai.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
const origin = 'http://127.0.0.1:5173';
type Session = { cookie: string; csrf: string; id: string };

describe.skipIf(!url)('official AI points and authoritative actions', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  const registry = createRegistry(false);
  const config = normalizeConfig({
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: 3001,
    DATABASE_URL: url!,
    WEB_ORIGIN: origin,
    ENABLE_DEV_LAB: false,
    LOG_LEVEL: 'silent',
    AI_GLOBAL_CONCURRENCY: 0,
    AI_SCAN_INTERVAL_MS: 60000,
    AI_DECISION_TIMEOUT_MS: 1000,
  });
  let admin: Session;
  let alice: Session;
  let bob: Session;
  let service: OfficialAiService;
  let sourceId: string;
  let offerId: string;
  let profileId: string;

  async function login(username: string): Promise<Session> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'correct horse battery' },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    return {
      cookie: (Array.isArray(raw) ? raw : [String(raw)])
        .map((value) => value.split(';')[0])
        .join('; '),
      csrf: response.json().data.csrfToken,
      id: response.json().data.account.id,
    };
  }
  function write(
    session: Session,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    payload?: unknown,
  ) {
    return app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { origin, cookie: session.cookie, 'x-csrf-token': session.csrf },
      payload,
    });
  }
  async function get(session: Session, path: string) {
    const result = await app.inject({ url: `/api/v1${path}`, headers: { cookie: session.cookie } });
    expect(result.statusCode).toBe(200);
    return result.json().data;
  }
  async function grant(points: number) {
    const result = await write(admin, 'POST', '/admin/ai-points/grant', {
      requestId: randomUUID(),
      accountId: alice.id,
      points,
      note: '体验点数',
    });
    expect(result.statusCode).toBe(200);
  }
  async function roomCommand(roomId: string, path: string, payload = {}) {
    const snapshot = await get(alice, `/rooms/${roomId}`);
    const result = await write(
      alice,
      path === 'start' ? 'POST' : 'PUT',
      `/rooms/${roomId}/${path}`,
      { requestId: randomUUID(), expectedRoomRevision: snapshot.roomRevision, ...payload },
    );
    expect(result.statusCode, result.body).toBe(200);
    return result.json().data;
  }
  async function activeMatch() {
    const result = await write(alice, 'POST', '/rooms', {
      requestId: randomUUID(),
      name: 'Official AI',
      gameId: 'color-match',
      version: '1.0.0',
      options: {},
      seatCount: 2,
    });
    expect(result.statusCode).toBe(200);
    const { roomId, room } = result.json().data;
    const seatId = room.seats[1].seatId as string;
    await roomCommand(roomId, `seats/${seatId}/bot`, { controllerType: 'model', profileId });
    await roomCommand(roomId, 'my-ready', { ready: true });
    const { matchId } = await roomCommand(roomId, 'start');
    const draw = await write(alice, 'POST', `/matches/${matchId}/actions`, {
      requestId: randomUUID(),
      expectedRevision: 0,
      expectedControllerEpoch: 0,
      action: { type: 'draw_card' },
    });
    expect(draw.statusCode).toBe(200);
    const scheduler = new AiScheduler(db, registry, new MatchService(db, registry), config);
    await scheduler.reconcileMatch(matchId);
    const task = (
      await db.query<{ id: string; decision_key: string }>(
        'SELECT id,decision_key FROM ai_tasks WHERE match_id=$1 AND seat_id=$2 AND source_revision=1',
        [matchId, seatId],
      )
    ).rows[0]!;
    expect(task).toBeDefined();
    return {
      roomId: roomId as string,
      matchId: matchId as string,
      seatId,
      taskId: task.id,
      decisionKey: `revision:1:${task.decision_key}`,
    };
  }
  async function claim(taskId: string) {
    await db.query(
      `UPDATE ai_tasks SET status='running',lease_owner='official-test',lease_generation=1,
      lease_until=now()+interval '30 seconds',attempt_count=1 WHERE id=$1`,
      [taskId],
    );
    const profile = await service.runtime(profileId, alice.id);
    expect(profile).not.toBeNull();
    return profile!;
  }
  async function propose(taskId: string, action: unknown = { type: 'draw_card' }) {
    await service.ready(taskId);
    await db.query(
      "UPDATE ai_tasks SET status='proposed',proposed_action=$2,proposal_hash='test' WHERE id=$1",
      [taskId, action],
    );
  }
  beforeAll(async () => {
    db = createDatabase(url!);
    service = new OfficialAiService(db, true);
    app = await createApp({ db, registry, config });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await db.query('TRUNCATE accounts CASCADE');
    for (const username of ['admin', 'alice', 'bob'])
      await createAccount(db, {
        username,
        displayName: username,
        password: 'correct horse battery',
        role: username === 'admin' ? 'administrator' : 'user',
      });
    admin = await login('admin');
    alice = await login('alice');
    bob = await login('bob');
    const source = await write(admin, 'POST', '/me/model-profiles', {
      name: 'Platform source',
      endpointId: 'mock',
      modelId: 'mock-v1',
    });
    sourceId = source.json().data.id;
    const offer = await write(admin, 'POST', '/admin/official-ai/offers', {
      requestId: randomUUID(),
      name: '标准陪玩',
      profileId: sourceId,
      pointsPerAction: 2,
    });
    expect(offer.statusCode, offer.body).toBe(200);
    offerId = offer.json().data.id;
    const enrollment = await write(alice, 'POST', '/me/official-ai/enroll', {
      requestId: randomUUID(),
      offerId,
      matchBudget: 10,
    });
    expect(enrollment.statusCode, enrollment.body).toBe(200);
    profileId = enrollment.json().data.profileId;
  });

  it('protects grants, replays receipts before new state, and isolates wallet/ledger/catalog credentials', async () => {
    const input = { requestId: randomUUID(), accountId: alice.id, points: 25, note: '首批体验' };
    expect((await write(alice, 'POST', '/admin/ai-points/grant', input)).statusCode).toBe(403);
    const csrf = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ai-points/grant',
      headers: { origin, cookie: admin.cookie },
      payload: input,
    });
    expect(csrf.statusCode).toBe(403);
    const [first, second] = await Promise.all([
      write(admin, 'POST', '/admin/ai-points/grant', input),
      write(admin, 'POST', '/admin/ai-points/grant', input),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
    expect(
      (await write(admin, 'POST', '/admin/ai-points/grant', { ...input, points: 26 })).statusCode,
    ).toBe(409);
    expect(await get(alice, '/me/ai-points')).toEqual({ balance: 25, reserved: 0, available: 25 });
    expect(await get(bob, '/me/ai-points')).toEqual({ balance: 0, reserved: 0, available: 0 });
    const ledger = await get(alice, '/me/ai-points/ledger');
    expect(ledger.items).toHaveLength(1);
    expect((await get(bob, `/me/ai-points/ledger?before=${ledger.items[0].id}`)).items).toEqual([]);
    expect(JSON.stringify(await get(alice, '/official-ai/offers'))).not.toContain(sourceId);
    expect(await get(alice, '/me/model-profiles')).toEqual([]);
    expect(
      (await get(alice, '/model-endpoints')).some(
        (item: { id: string }) => item.id === 'official-ai',
      ),
    ).toBe(false);
    expect(
      (
        await write(alice, 'POST', '/me/model-profiles', {
          name: 'Bypass',
          endpointId: 'official-ai',
          modelId: 'official',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await write(alice, 'POST', `/me/model-profiles/${profileId}/test`, {})).statusCode,
    ).toBe(404);
    expect(
      (
        await write(alice, 'PUT', `/me/model-profiles/${profileId}/credential`, {
          apiKey: 'fake-key',
        })
      ).statusCode,
    ).not.toBe(200);
    expect((await write(admin, 'DELETE', `/me/model-profiles/${sourceId}`)).statusCode).toBe(409);
    expect(await new OfficialAiService(db, false).runtime(profileId, alice.id)).toBeNull();
  });

  it('reserves funds, charges atomically with the legal action, and never charges a recovered action twice', async () => {
    await grant(20);
    const match = await activeMatch();
    const profile = await claim(match.taskId);
    await service.reserve(match.taskId, 'official-test', 1, profile, alice.id, match.decisionKey);
    expect(await service.wallet(alice.id)).toEqual({ balance: 20, reserved: 2, available: 18 });
    await service.recordResponse(match.taskId, { inputTokens: 100, outputTokens: 10 }, 12);
    await propose(match.taskId);
    const matches = new MatchService(db, registry);
    expect(await matches.actAutomation(match.taskId, 'official-test', 1)).toMatchObject({
      revision: 2,
    });
    expect(await service.wallet(alice.id)).toEqual({ balance: 18, reserved: 0, available: 18 });
    await db.query("UPDATE ai_tasks SET status='proposed' WHERE id=$1", [match.taskId]);
    await matches.actAutomation(match.taskId, 'official-test', 1);
    expect(
      (await service.ledger(alice.id)).items.filter((item) => item.kind === 'action'),
    ).toHaveLength(1);
    expect((await service.stats()).inputTokens).toBe(100);
    expect(
      (
        await app.inject({
          url: `/api/v1/matches/${match.matchId}/view`,
          headers: { cookie: bob.cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('rolls back the action, RNG, receipt and point debit together if ledger persistence fails', async () => {
    await grant(20);
    const match = await activeMatch();
    const profile = await claim(match.taskId);
    await service.reserve(match.taskId, 'official-test', 1, profile, alice.id, match.decisionKey);
    await propose(match.taskId);
    const before = (
      await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [match.matchId])
    ).rows[0];
    await db.query(`CREATE FUNCTION official_ai_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind='action' THEN RAISE EXCEPTION 'injected official AI ledger failure'; END IF; RETURN NEW; END $$`);
    await db.query(
      'CREATE TRIGGER official_ai_test_fail BEFORE INSERT ON ai_point_ledger FOR EACH ROW EXECUTE FUNCTION official_ai_test_fail()',
    );
    const matches = new MatchService(db, registry);
    try {
      await expect(matches.actAutomation(match.taskId, 'official-test', 1)).rejects.toThrow(
        'injected',
      );
    } finally {
      await db.query('DROP TRIGGER official_ai_test_fail ON ai_point_ledger');
      await db.query('DROP FUNCTION official_ai_test_fail()');
    }
    expect(
      (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [match.matchId]))
        .rows[0],
    ).toEqual(before);
    expect(await service.wallet(alice.id)).toEqual({ balance: 20, reserved: 2, available: 18 });
    expect(
      (
        await db.query(
          "SELECT 1 FROM command_receipts WHERE principal_key LIKE 'automation:%' AND operation=$1",
          [`match.action:${match.matchId}`],
        )
      ).rowCount,
    ).toBe(0);
    await matches.actAutomation(match.taskId, 'official-test', 1);
    expect((await service.wallet(alice.id)).balance).toBe(18);
  });

  it('serializes concurrent reservations across matches and releases unknown calls after lease expiry', async () => {
    await grant(2);
    const first = await activeMatch();
    // Close the first room while retaining its task record, then restore it only as a test interleaving fixture.
    await write(alice, 'POST', `/rooms/${first.roomId}/close`, {
      requestId: randomUUID(),
      expectedRoomRevision: (await get(alice, `/rooms/${first.roomId}`)).roomRevision,
    });
    const second = await activeMatch();
    await db.query("UPDATE matches SET status='active' WHERE id=$1", [first.matchId]);
    const p1 = await claim(first.taskId);
    const p2 = await claim(second.taskId);
    const result = await Promise.allSettled([
      service.reserve(first.taskId, 'official-test', 1, p1, alice.id, first.decisionKey),
      service.reserve(second.taskId, 'official-test', 1, p2, alice.id, second.decisionKey),
    ]);
    expect(result.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await service.wallet(alice.id)).toEqual({ balance: 2, reserved: 2, available: 0 });
    await db.query(
      "UPDATE ai_tasks SET lease_until=now()-interval '1 second' WHERE id=ANY($1::uuid[])",
      [[first.taskId, second.taskId]],
    );
    await service.recover();
    expect(await service.wallet(alice.id)).toEqual({ balance: 2, reserved: 0, available: 2 });
    expect((await service.stats()).unknownCalls).toBe(1);
    const reserved = (
      await db.query<{ task_id: string }>('SELECT task_id FROM official_ai_reservations')
    ).rows[0]!;
    await expect(service.ready(reserved.task_id)).rejects.toThrow();
  });

  it('does not charge failed or stale decisions and preserves a ready proposal during restart recovery', async () => {
    await grant(20);
    const match = await activeMatch();
    const profile = await claim(match.taskId);
    await service.reserve(match.taskId, 'official-test', 1, profile, alice.id, match.decisionKey);
    await service.recordResponse(match.taskId, { inputTokens: null, outputTokens: null }, 20);
    await propose(match.taskId);
    await db.query("UPDATE ai_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [
      match.taskId,
    ]);
    await service.recover();
    expect((await service.wallet(alice.id)).reserved).toBe(2);
    const closed = await write(alice, 'POST', `/rooms/${match.roomId}/close`, {
      requestId: randomUUID(),
      expectedRoomRevision: (await get(alice, `/rooms/${match.roomId}`)).roomRevision,
    });
    expect(closed.statusCode).toBe(200);
    await service.recover();
    expect((await service.wallet(alice.id)).balance).toBe(20);
    expect((await service.wallet(alice.id)).reserved).toBe(0);
    expect((await service.stats()).missingUsageCalls).toBe(1);
    expect((await service.ledger(alice.id)).items.filter((item) => item.kind === 'action')).toEqual(
      [],
    );
  });

  it.each(['unknown', 'ready'] as const)(
    'recovers a %s call with a free fallback without sending another provider request',
    async (outcome) => {
      await grant(20);
      const match = await activeMatch();
      const profile = await claim(match.taskId);
      await service.reserve(match.taskId, 'official-test', 1, profile, alice.id, match.decisionKey);
      if (outcome === 'ready') {
        await service.recordResponse(match.taskId, { inputTokens: 100, outputTokens: 10 }, 12);
        await service.ready(match.taskId);
      }
      await db.query("UPDATE ai_tasks SET lease_until=now()-interval '1 second' WHERE id=$1", [
        match.taskId,
      ]);
      const reply = vi.spyOn(MockModelAdapter.prototype, 'decide').mockImplementation(async () => {
        throw new Error('fixture: unrelated later decisions also fall back for free');
      });
      const scheduler = new AiScheduler(db, registry, new MatchService(db, registry), {
        ...config,
        AI_GLOBAL_CONCURRENCY: 1,
        AI_SCAN_INTERVAL_MS: 100,
      });
      scheduler.start();
      try {
        await expect
          .poll(
            async () =>
              (await db.query('SELECT status FROM ai_tasks WHERE id=$1', [match.taskId])).rows[0]
                ?.status,
            { timeout: 5000 },
          )
          .toBe('succeeded');
        expect(reply.mock.calls.some(([input]) => input.decisionId === match.taskId)).toBe(false);
        expect((await service.wallet(alice.id)).balance).toBe(20);
        const attempt = (
          await db.query(
            `SELECT a.status FROM model_attempts a JOIN official_ai_reservations r ON r.attempt_id=a.id WHERE r.task_id=$1`,
            [match.taskId],
          )
        ).rows[0];
        expect(attempt.status).toBe(outcome === 'ready' ? 'completed' : 'unknown');
        expect(
          (await service.ledger(alice.id)).items.filter((item) => item.kind === 'action'),
        ).toEqual([]);
      } finally {
        await scheduler.close();
        reply.mockRestore();
      }
    },
    15000,
  );

  it('records invalid provider usage but commits a free script fallback without charging points', async () => {
    await grant(20);
    const match = await activeMatch();
    const reply = vi.spyOn(MockModelAdapter.prototype, 'decide').mockResolvedValue({
      raw: '{"choiceId":"forged"}',
      inputTokens: 5,
      outputTokens: 3,
    });
    const scheduler = new AiScheduler(db, registry, new MatchService(db, registry), {
      ...config,
      AI_GLOBAL_CONCURRENCY: 1,
      AI_SCAN_INTERVAL_MS: 100,
    });
    scheduler.start();
    try {
      await expect
        .poll(
          async () =>
            (await db.query('SELECT status FROM ai_tasks WHERE id=$1', [match.taskId])).rows[0]
              ?.status,
          { timeout: 5000 },
        )
        .toBe('succeeded');
      expect(
        (await db.query('SELECT safe_error_code FROM ai_tasks WHERE id=$1', [match.taskId])).rows[0]
          ?.safe_error_code,
      ).toBe('AI_FALLBACK_USED');
      expect((await service.wallet(alice.id)).balance).toBe(20);
      expect((await service.stats()).failedCalls).toBeGreaterThan(0);
      expect((await service.stats()).inputTokens).toBeGreaterThanOrEqual(5);
      expect(
        (await service.ledger(alice.id)).items.filter((item) => item.kind === 'action'),
      ).toEqual([]);
    } finally {
      await scheduler.close();
      reply.mockRestore();
    }
  }, 15000);

  it('resumes an unfunded official task after a grant without losing its unique decision key', async () => {
    const match = await activeMatch();
    const scheduler = new AiScheduler(db, registry, new MatchService(db, registry), {
      ...config,
      AI_GLOBAL_CONCURRENCY: 1,
      AI_SCAN_INTERVAL_MS: 100,
    });
    scheduler.start();
    try {
      await expect
        .poll(
          async () =>
            (await db.query('SELECT status FROM ai_tasks WHERE id=$1', [match.taskId])).rows[0]
              ?.status,
          { timeout: 5000 },
        )
        .toBe('blocked');
      expect((await service.stats()).calls).toBe(0);
      await grant(20);
      expect(
        (await write(bob, 'POST', `/matches/${match.matchId}/seats/${match.seatId}/ai-retry`, {}))
          .statusCode,
      ).toBe(403);
      const retried = await write(
        alice,
        'POST',
        `/matches/${match.matchId}/seats/${match.seatId}/ai-retry`,
        {},
      );
      expect(retried.statusCode, retried.body).toBe(200);
      await expect
        .poll(async () => (await service.wallet(alice.id)).balance, { timeout: 5000 })
        .toBeLessThan(20);
      expect(
        (await db.query('SELECT status FROM ai_tasks WHERE id=$1', [match.taskId])).rows[0]?.status,
      ).toBe('succeeded');
    } finally {
      await scheduler.close();
    }
  }, 15000);

  it('runs the existing scheduler through the official provider and pauses at the per-seat match cap', async () => {
    await grant(20);
    await write(alice, 'POST', '/me/official-ai/enroll', {
      requestId: randomUUID(),
      offerId,
      matchBudget: 2,
    });
    const match = await activeMatch();
    const scheduler = new AiScheduler(db, registry, new MatchService(db, registry), {
      ...config,
      AI_GLOBAL_CONCURRENCY: 1,
      AI_SCAN_INTERVAL_MS: 100,
    });
    scheduler.start();
    try {
      await expect
        .poll(async () => (await service.wallet(alice.id)).balance, { timeout: 5000 })
        .toBe(18);
      let view = await get(alice, `/matches/${match.matchId}/view`);
      // Allow any target subdecision to stop at the same cap; otherwise hand the next turn back to the bot.
      if (view.view.canDraw) {
        await write(alice, 'POST', `/matches/${match.matchId}/actions`, {
          requestId: randomUUID(),
          expectedRevision: view.revision,
          expectedControllerEpoch: 0,
          action: { type: 'draw_card' },
        });
      }
      await expect
        .poll(
          async () =>
            (
              await db.query("SELECT 1 FROM ai_tasks WHERE match_id=$1 AND status='blocked'", [
                match.matchId,
              ])
            ).rowCount,
          { timeout: 5000 },
        )
        .toBeGreaterThan(0);
      view = await get(alice, `/matches/${match.matchId}/view`);
      expect(view.status).toBe('active');
      expect((await service.wallet(alice.id)).balance).toBe(18);
      expect((await service.stats()).calls).toBe(1);
      expect(
        (await service.ledger(alice.id)).items.filter((item) => item.kind === 'action'),
      ).toHaveLength(1);
      const increased = await write(alice, 'POST', '/me/official-ai/enroll', {
        requestId: randomUUID(),
        offerId,
        matchBudget: 4,
      });
      expect(increased.statusCode, increased.body).toBe(200);
      await expect
        .poll(async () => (await service.wallet(alice.id)).balance, { timeout: 5000 })
        .toBe(16);
      const lowered = await write(alice, 'POST', '/me/official-ai/enroll', {
        requestId: randomUUID(),
        offerId,
        matchBudget: 2,
      });
      expect(lowered.statusCode).toBe(409);
    } finally {
      await scheduler.close();
    }
  }, 15000);
});
