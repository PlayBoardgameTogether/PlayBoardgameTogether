import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry, GameRegistry } from '../../apps/api/src/registry/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { MatchService } from '../../apps/api/src/matches.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';
import { gamePackageFiles, zipSync, strToU8 } from '../fixtures/game-package.js';
import {
  assertReleaseCompatibility,
  requiredCapabilities,
} from '../../scripts/runtime-compatibility.mjs';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL!).pathname
) {
  throw new Error('An isolated test database is required');
}
const origin = 'http://127.0.0.1:5173';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

describe('optional ZIP public results in the authoritative transaction', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let registry: GameRegistry;
  let admin: Headers, alice: Headers, bob: Headers;
  const config = {
    NODE_ENV: 'test' as const,
    DATABASE_URL: url!,
    WEB_ORIGIN: origin,
    API_HOST: '127.0.0.1',
    API_PORT: 3001,
    ENABLE_DEV_LAB: false,
    LOG_LEVEL: 'silent' as const,
    AI_SCAN_INTERVAL_MS: 60000,
  };
  async function login(username: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'package results password' },
    });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    return {
      cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
        .map((value) => value.split(';')[0])
        .join('; '),
      origin,
      'x-csrf-token': String(response.json().data.csrfToken),
    };
  }
  beforeEach(async () => {
    db = createDatabase(url!);
    await db.query('TRUNCATE accounts CASCADE');
    await db.query(
      "DELETE FROM game_packages WHERE game_id LIKE 'online.%'; DELETE FROM game_installations WHERE game_id LIKE 'online.%'",
    );
    registry = createRegistry(false);
    app = await createApp({ db, config, registry });
    for (const [username, role] of [
      ['result_admin', 'administrator'],
      ['result_alice', 'user'],
      ['result_bob', 'user'],
    ] as const) {
      await createAccount(db, {
        username,
        displayName: username,
        password: 'package results password',
        role,
      });
    }
    admin = await login('result_admin');
    alice = await login('result_alice');
    bob = await login('result_bob');
  });
  afterEach(async () => {
    await app.close();
  });

  async function archive(projection: string, declared = true, extraSource = '', version = '1.0.0') {
    const files = await gamePackageFiles();
    const descriptor = JSON.parse(files['game.json'].toString());
    files['game.json'] = strToU8(
      JSON.stringify({ ...descriptor, ...(declared ? { publicResult: 'winners-scores-v1' } : {}) }),
    );
    files['server.js'] = Buffer.from(
      files['server.js'].toString().replace('>= 5', '>= 1') +
        `\ngame.getPublicResult = ${projection};\ngame.manifest.version = ${JSON.stringify(version)};\n${extraSource}`,
    );
    return Buffer.from(zipSync(files));
  }
  const write = (
    path: string,
    headers: Headers,
    payload: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ) => app.inject({ method, url: path, headers, payload });
  async function install(bytes: Buffer, catalogHash?: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/game-packages?requestId=${randomUUID()}${catalogHash ? `&expectedCatalogHash=${catalogHash}` : ''}`,
      headers: { ...admin, 'content-type': 'application/zip' },
      payload: bytes,
    });
    return response;
  }
  it('reads a pre-039 package table without requiring the new column', async () => {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE game_packages DROP COLUMN public_result_contract');
      expect(await requiredCapabilities(client)).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await db.query('SELECT public_result_contract FROM game_packages')).toBeDefined();
  });

  it('blocks legacy releases after installation, including disabled result versions', async () => {
    const legacy = await mkdtemp(join(tmpdir(), 'playboard-legacy-release-'));
    const env = { ...process.env, DATABASE_URL: url! };
    try {
      expect((await install(await archive('() => null', false))).statusCode).toBe(200);
      await assertReleaseCompatibility(legacy, env);
      const bytes = await archive('() => ({ winners: ["seat-1"] })', true, '', '1.1.0');
      const review = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/game-packages/review',
        headers: { ...admin, 'content-type': 'application/zip' },
        payload: bytes,
      });
      expect(review.statusCode).toBe(200);
      expect((await install(bytes, review.json().data.catalogHash)).statusCode).toBe(200);
      const before = await db.query(
        'SELECT game_version,package_hash FROM game_packages ORDER BY game_version',
      );
      await expect(assertReleaseCompatibility(legacy, env)).rejects.toMatchObject({
        code: 'RUNTIME_INCOMPATIBLE',
      });
      await assertReleaseCompatibility(resolve('.'), env);
      await db.query(
        "UPDATE game_installations SET enabled=false WHERE game_id='online.score-race' AND game_version='1.1.0'",
      );
      await expect(assertReleaseCompatibility(legacy, env)).rejects.toMatchObject({
        code: 'RUNTIME_INCOMPATIBLE',
      });
      await assertReleaseCompatibility(resolve('.'), env);
      expect(
        (
          await db.query(
            'SELECT game_version,package_hash FROM game_packages ORDER BY game_version',
          )
        ).rows,
      ).toEqual(before.rows);
    } finally {
      await rm(legacy, { recursive: true, force: true });
    }
  });

  it('refuses a saved legacy API before executing it and releases the supervisor lock', async () => {
    expect((await install(await archive('() => null'))).statusCode).toBe(200);
    const state = await mkdtemp(join(tmpdir(), 'playboard-supervisor-compat-'));
    const sha = 'a'.repeat(40);
    const legacy = join(state, 'releases', sha);
    const marker = join(state, 'legacy-api-executed');
    const portProbe = createServer();
    await new Promise<void>((done) => portProbe.listen(0, '127.0.0.1', done));
    const address = portProbe.address();
    if (!address || typeof address === 'string') throw new Error('Expected an isolated TCP port');
    await new Promise<void>((done, reject) =>
      portProbe.close((error) => (error ? reject(error) : done())),
    );
    try {
      await mkdir(join(legacy, 'apps/api/dist'), { recursive: true });
      await mkdir(join(legacy, 'apps/web/dist'), { recursive: true });
      await writeFile(join(legacy, 'apps/web/dist/index.html'), 'legacy');
      await writeFile(
        join(legacy, 'apps/api/dist/main.js'),
        `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`,
      );
      await writeFile(join(state, 'current.json'), JSON.stringify({ sha, path: legacy }));
      const result = promisify(execFile)(process.execPath, ['scripts/online-update.mjs'], {
        cwd: resolve('.'),
        timeout: 15000,
        env: {
          ...process.env,
          DATABASE_URL: url!,
          UPDATE_STATE_DIR: state,
          API_PORT: String(address.port),
          UPDATE_PORT: address.port === 8080 ? '8081' : '8080',
          UPDATE_ENABLED: 'false',
        },
      });
      await expect(result).rejects.toMatchObject({ code: 1 });
      await result.catch((error) => {
        expect(error.stderr).toContain('startup blocked');
        expect(error.stderr).not.toContain(url!);
      });
      await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(state, 'supervisor.lock'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(JSON.parse(await readFile(join(state, 'current.json'), 'utf8'))).toEqual({
        sha,
        path: legacy,
      });
    } finally {
      await rm(state, { recursive: true, force: true });
    }
  });
  async function start(computer = false, version = '1.0.0', owner = alice) {
    const created = await write('/api/v1/rooms', owner, {
      requestId: randomUUID(),
      name: '公开结果验收',
      gameId: 'online.score-race',
      version,
      seatCount: 2,
      options: {},
      ...(computer ? { computerOpponents: true } : {}),
    });
    expect(created.statusCode).toBe(200);
    const { roomId, inviteCode } = created.json().data;
    let revision = 0;
    if (!computer) {
      const joined = await write('/api/v1/rooms/join', bob, {
        requestId: randomUUID(),
        inviteCode,
      });
      expect(joined.statusCode).toBe(200);
      const seated = await write(
        `/api/v1/rooms/${roomId}/my-seat`,
        bob,
        {
          requestId: randomUUID(),
          expectedRoomRevision: joined.json().data.roomRevision,
          seatIndex: 1,
        },
        'PUT',
      );
      expect(seated.statusCode).toBe(200);
      revision = seated.json().data.roomRevision;
      const ready = await write(
        `/api/v1/rooms/${roomId}/my-ready`,
        bob,
        {
          requestId: randomUUID(),
          expectedRoomRevision: revision,
          ready: true,
        },
        'PUT',
      );
      expect(ready.statusCode).toBe(200);
      revision = ready.json().data.roomRevision;
    }
    const ready = await write(
      `/api/v1/rooms/${roomId}/my-ready`,
      owner,
      {
        requestId: randomUUID(),
        expectedRoomRevision: revision,
        ready: true,
      },
      'PUT',
    );
    expect(ready.statusCode).toBe(200);
    const started = await write(`/api/v1/rooms/${roomId}/start`, owner, {
      requestId: randomUUID(),
      expectedRoomRevision: ready.json().data.roomRevision,
    });
    expect(started.statusCode).toBe(200);
    return { roomId: String(roomId), matchId: String(started.json().data.matchId) };
  }
  const view = (matchId: string, headers = alice) =>
    app.inject({
      url: `/api/v1/matches/${matchId}/view`,
      headers,
    });
  const act = (
    matchId: string,
    command = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } },
  ) => write(`/api/v1/matches/${matchId}/actions`, alice, command);
  async function snapshot(matchId: string) {
    // One statement observes all persisted transaction effects at the same snapshot.
    return (
      await db.query(
        `SELECT to_jsonb(m) AS match,
      (SELECT jsonb_build_object('status',r.status,'revision',r.room_revision,'active',r.active_match_id)
       FROM rooms r WHERE r.id=m.room_id) AS room,
      (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.seat_index) FROM seats s WHERE s.room_id=m.room_id) AS seats,
      (SELECT count(*)::int FROM match_actions WHERE match_id=m.id) AS actions,
      (SELECT count(*)::int FROM match_replay_frames WHERE match_id=m.id) AS frames,
      (SELECT count(*)::int FROM command_receipts WHERE operation='match.action:' || m.id::text) AS receipts,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM ai_tasks t WHERE t.match_id=m.id) AS tasks
      FROM matches m WHERE id=$1`,
        [matchId],
      )
    ).rows[0];
  }

  it('serializes competing terminal requests and returns only the committed result on retry', async () => {
    expect((await install(await archive('(o) => ({winners:o.winners})'))).statusCode).toBe(200);
    const { matchId } = await start();
    const commands = [0, 1].map(() => ({
      requestId: randomUUID(),
      expectedRevision: 0,
      action: { type: 'claim' },
    }));
    const responses = await Promise.all(commands.map((command) => act(matchId, command)));
    const winner = responses.findIndex((response) => response.statusCode === 200);
    expect(winner).toBeGreaterThanOrEqual(0);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 422]);
    expect(responses[1 - winner].json().error.code).toBe('ACTION_NOT_ALLOWED');
    const saved = await snapshot(matchId);
    expect(saved).toMatchObject({ actions: 1, frames: 2, receipts: 1 });
    const retry = await act(matchId, commands[winner]);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.result).toEqual(responses[winner].json().data.result);
    expect(retry.json().data.events).toEqual([]);
    expect(await snapshot(matchId)).toEqual(saved);
  });

  it('retains participant, Origin, CSRF and revoked-session boundaries for public results', async () => {
    expect((await install(await archive('(o) => ({winners:o.winners})'))).statusCode).toBe(200);
    const { matchId } = await start();
    const before = await snapshot(matchId);
    const payload = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } };
    const path = `/api/v1/matches/${matchId}/actions`;
    expect((await write(path, admin, payload)).statusCode).toBe(404);
    expect((await write(path, bob, payload)).statusCode).toBe(422);
    expect(
      (await write(path, { ...alice, origin: 'https://untrusted.invalid' }, payload)).statusCode,
    ).toBe(403);
    expect((await write(path, { ...alice, 'x-csrf-token': 'invalid' }, payload)).statusCode).toBe(
      403,
    );
    expect(
      (await write(path, alice, { ...payload, seatId: before.match.state.seats[1] })).json().error
        .code,
    ).toBe('VALIDATION_ERROR');
    expect(await snapshot(matchId)).toEqual(before);
    expect((await act(matchId, payload)).statusCode).toBe(200);
    const saved = await snapshot(matchId);
    expect((await view(matchId, admin)).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/v1/matches/${matchId}/replay`, headers: admin })).statusCode,
    ).toBe(404);
    const otherHistory = await app.inject({ url: '/api/v1/profile/matches', headers: admin });
    expect(otherHistory.json().data.items).toEqual([]);
    expect(
      (await app.inject({ url: `/api/v1/matches/${matchId}/replay`, headers: bob })).statusCode,
    ).toBe(200);
    const logout = await write('/api/v1/auth/logout', alice, {});
    expect(logout.statusCode).toBe(200);
    for (const url of [
      `/api/v1/matches/${matchId}/view`,
      `/api/v1/matches/${matchId}/replay`,
      '/api/v1/profile/matches',
    ]) {
      expect((await app.inject({ url, headers: alice })).statusCode).toBe(401);
    }
    expect((await act(matchId, payload)).statusCode).toBe(401);
    expect(await snapshot(matchId)).toEqual(saved);
  });

  it('keeps old and declared versions independent and refuses a missing exact version after restart', async () => {
    expect(
      (await install(await archive('() => {throw new Error("must not run")}', false))).statusCode,
    ).toBe(200);
    const old = await start();
    const digest = registry.digest('online.score-race', '1.0.0');
    const bytes = await archive('(o) => ({winners:o.winners})', true, '', '1.1.0');
    const review = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/game-packages/review',
      headers: { ...admin, 'content-type': 'application/zip' },
      payload: bytes,
    });
    expect(review.statusCode).toBe(200);
    expect((await install(bytes, review.json().data.catalogHash)).statusCode).toBe(200);
    const current = await start(false, '1.1.0', admin);
    await app.close();
    db = createDatabase(url!);
    registry = createRegistry(false);
    app = await createApp({ db, config, registry });
    expect((await view(old.matchId)).json().data.gameVersion).toBe('1.0.0');
    expect(registry.digest('online.score-race', '1.0.0')).toEqual(digest);
    expect((await act(old.matchId)).statusCode).toBe(200);
    expect((await view(old.matchId)).json().data.result).toBeNull();
    expect(
      (
        await write(`/api/v1/matches/${current.matchId}/actions`, admin, {
          requestId: randomUUID(),
          expectedRevision: 0,
          action: { type: 'claim' },
        })
      ).statusCode,
    ).toBe(200);
    expect((await view(current.matchId, admin)).json().data.result.players).toEqual([
      { seatId: expect.any(String), winner: true },
      { seatId: expect.any(String), winner: false },
    ]);
    const saved = await snapshot(old.matchId);
    // Remove only the old test fixture's runtime row; retain the newer installed version.
    const removed = (
      await db.query(
        "DELETE FROM game_packages WHERE game_id='online.score-race' AND game_version='1.0.0' RETURNING *",
      )
    ).rows[0];
    try {
      await app.close();
      db = createDatabase(url!);
      registry = createRegistry(false);
      app = await createApp({ db, config, registry });
      for (const suffix of ['view', 'replay']) {
        const response = await app.inject({
          url: `/api/v1/matches/${old.matchId}/${suffix}`,
          headers: alice,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe('GAME_VERSION_UNAVAILABLE');
      }
      expect((await view(current.matchId, admin)).statusCode).toBe(200);
      expect(await snapshot(old.matchId)).toEqual(saved);
    } finally {
      await db.query(
        'INSERT INTO game_packages SELECT * FROM jsonb_populate_record(NULL::game_packages,$1)',
        [removed],
      );
    }
    expect((await view(old.matchId)).json().data.result).toBeNull();
    expect(await snapshot(old.matchId)).toEqual(saved);
  });

  it.each([
    ['exception', '() => {throw new Error("SECRET_RESULT_MARKER")}', 'ACTION_NOT_ALLOWED'],
    ['timeout', '() => {while(true){}}', 'ACTION_NOT_ALLOWED'],
    [
      'non-finite score',
      '(o) => ({winners:o.winners,scores:{...o.scores,[o.winners[0]]:NaN}})',
      'VALIDATION_ERROR',
    ],
  ])(
    'rolls back a terminal %s without leaking or consuming RNG on retry',
    async (_name, projection, code) => {
      expect((await install(await archive(projection))).statusCode).toBe(200);
      const { matchId } = await start();
      const before = await snapshot(matchId);
      const command = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } };
      for (let retry = 0; retry < 2; retry++) {
        const response = await act(matchId, command);
        expect(response.statusCode).toBe(422);
        expect(response.json().error.code).toBe(code);
        expect(response.body).not.toContain('SECRET_RESULT_MARKER');
        expect(await snapshot(matchId)).toEqual(before);
      }
    },
  );

  it.each(['invalid projection', 'late persistence failure'])(
    'keeps a frozen automation proposal atomic on %s',
    async (failure) => {
      const projection =
        failure === 'invalid projection'
          ? '() => ({winners:["outsider"]})'
          : '(o) => ({winners:o.winners})';
      const source = `game.getDecisionContext = (state, viewer) => game.getView(state, viewer).canClaim
        ? {decisionKey:'claim', legalActions:[{type:'claim'}]} : null;`;
      expect((await install(await archive(projection, true, source))).statusCode).toBe(200);
      const { matchId } = await start(true);
      // Explicit frozen-proposal fixture: no worker/model call or scheduler timing is mocked.
      await db.query("UPDATE matches SET state=jsonb_set(state,'{turn}','1') WHERE id=$1", [
        matchId,
      ]);
      const taskId = randomUUID();
      await db.query(
        `INSERT INTO ai_tasks(id,match_id,seat_id,source_revision,controller_epoch,decision_key,policy_id,policy_version,policy_hash,status,lease_owner,lease_until,lease_generation,request_id,proposed_action,proposal_hash)
      SELECT $1,match_id,seat_id,0,controller_epoch,'claim',policy_id,policy_version,policy_hash,'proposed','d19',now()+interval '1 hour',1,$2,'{"type":"claim"}'::jsonb,'frozen'
      FROM match_participants WHERE match_id=$3 AND occupant_kind='bot'`,
        [taskId, randomUUID(), matchId],
      );
      const service = new MatchService(db, registry);
      const before = await snapshot(matchId);
      await expect(service.actAutomation(taskId, 'wrong-worker', 1)).rejects.toMatchObject({
        code: 'AI_TASK_STALE',
      });
      expect(await snapshot(matchId)).toEqual(before);
      if (failure === 'late persistence failure') {
        await db.query(
          "CREATE FUNCTION fail_d19_task() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='succeeded' THEN RAISE EXCEPTION 'late task failure'; END IF; RETURN NEW; END $$",
        );
        await db.query(
          'CREATE TRIGGER fail_d19_task BEFORE UPDATE ON ai_tasks FOR EACH ROW EXECUTE FUNCTION fail_d19_task()',
        );
      }
      try {
        if (failure === 'invalid projection') {
          await expect(service.actAutomation(taskId, 'd19', 1)).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
          });
        } else {
          await expect(service.actAutomation(taskId, 'd19', 1)).rejects.toThrow(
            'late task failure',
          );
        }
        expect(await snapshot(matchId)).toEqual(before);
      } finally {
        if (failure === 'late persistence failure') {
          await db.query('DROP TRIGGER fail_d19_task ON ai_tasks');
          await db.query('DROP FUNCTION fail_d19_task()');
        }
      }
      if (failure === 'late persistence failure') {
        expect(await service.actAutomation(taskId, 'd19', 1)).toEqual({ revision: 1 });
        expect((await view(matchId)).json().data).toMatchObject({
          status: 'finished',
          revision: 1,
          result: { players: [{ winner: false }, { winner: true }] },
        });
        expect(await snapshot(matchId)).toMatchObject({
          actions: 1,
          frames: 2,
          receipts: 1,
          tasks: [{ status: 'succeeded', applied_revision: 1 }],
        });
      }
    },
  );

  it.each([
    ['single winner without scores', '(o) => ({winners:o.winners})', false, false],
    [
      'shared win with full scores',
      '(o) => ({winners:Object.keys(o.scores),scores:o.scores})',
      true,
      true,
    ],
    ['explicitly unknown', '() => null', false, false],
  ])(
    'persists %s, deduplicates the finish and restores after restart',
    async (_name, projection, shared, scored) => {
      expect((await install(await archive(projection))).statusCode).toBe(200);
      expect(
        (await db.query('SELECT public_result_contract FROM game_packages')).rows[0]
          .public_result_contract,
      ).toBe('winners-scores-v1');
      const { matchId, roomId } = await start();
      await app.close();
      db = createDatabase(url!);
      registry = createRegistry(false);
      app = await createApp({ db, config, registry });
      expect((await view(matchId)).json().data.status).toBe('active');
      expect(registry.resultSummaries.has('online.score-race@1.0.0')).toBe(true);
      const command = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } };
      const [first, duplicate] = await Promise.all([act(matchId, command), act(matchId, command)]);
      expect([first.statusCode, duplicate.statusCode]).toEqual([200, 200]);
      const final = (await view(matchId)).json().data;
      expect(final.status).toBe('finished');
      if (projection.includes('null')) expect(final.result).toBeNull();
      else {
        expect(final.result.players).toHaveLength(2);
        expect(final.result.players.map((p: { winner: boolean }) => p.winner)).toEqual([
          true,
          shared,
        ]);
        for (const player of final.result.players)
          expect(Object.hasOwn(player, 'score')).toBe(scored);
      }
      const saved = await snapshot(matchId);
      expect(saved).toMatchObject({
        actions: 1,
        frames: 2,
        receipts: 1,
        room: { status: 'waiting' },
      });
      expect(
        (await act(matchId, { ...command, action: { type: 'other' } })).json().error.code,
      ).toBe('REQUEST_ID_CONFLICT');
      expect((await view(matchId, admin)).statusCode).toBe(404);
      const history = await app.inject({
        url: '/api/v1/profile/matches?gameId=online.score-race',
        headers: alice,
      });
      expect(history.statusCode).toBe(200);
      expect(history.body).not.toContain('SECRET_RESULT_MARKER');
      expect(history.json().data.items[0].result).toEqual(
        projection.includes('null')
          ? null
          : {
              winner: true,
              sharedWin: shared,
              ...(scored ? { score: final.result.players[0].score } : {}),
            },
      );
      await app.close();
      db = createDatabase(url!);
      registry = createRegistry(false);
      app = await createApp({ db, config, registry });
      expect((await view(matchId)).json().data.result).toEqual(final.result);
      expect(registry.resultSummaries.has('online.score-race@1.0.0')).toBe(true);
      expect((await act(matchId, command)).statusCode).toBe(200);
      expect(await snapshot(matchId)).toEqual(saved);
      expect(
        (await db.query('SELECT status FROM rooms WHERE id=$1', [roomId])).rows[0].status,
      ).toBe('waiting');
    },
  );

  it('rolls back invalid terminal projection including RNG, replay, room state and receipts', async () => {
    expect(
      (await install(await archive('() => ({winners:["outsider"],hands:"SECRET_RESULT_MARKER"})')))
        .statusCode,
    ).toBe(200);
    const { matchId } = await start();
    const before = await snapshot(matchId);
    const command = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } };
    for (let retry = 0; retry < 2; retry++) {
      const failed = await act(matchId, command);
      expect(failed.statusCode).toBe(422);
      expect(failed.json().error.code).toBe('VALIDATION_ERROR');
      expect(failed.body).not.toContain('SECRET_RESULT_MARKER');
      expect(await snapshot(matchId)).toEqual(before);
    }
  });

  it('rolls back a late persistence failure and accepts the same terminal request after recovery', async () => {
    expect((await install(await archive('(o) => ({winners:o.winners})'))).statusCode).toBe(200);
    const { matchId } = await start();
    const before = await snapshot(matchId);
    const command = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } };
    await db.query(
      "CREATE FUNCTION fail_result_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER fail_result_action AFTER INSERT ON match_actions FOR EACH ROW EXECUTE FUNCTION fail_result_action()',
    );
    try {
      expect((await act(matchId, command)).statusCode).toBe(500);
      expect(await snapshot(matchId)).toEqual(before);
    } finally {
      await db.query('DROP TRIGGER fail_result_action ON match_actions');
      await db.query('DROP FUNCTION fail_result_action()');
    }
    expect((await act(matchId, command)).statusCode).toBe(200);
    expect((await view(matchId)).json().data).toMatchObject({
      status: 'finished',
      revision: 1,
      result: { players: [{ winner: true }, { winner: false }] },
    });
  });

  it('requires the declared method and rolls back installation metadata on database failure', async () => {
    const missing = await archive('undefined');
    expect((await install(missing)).json().error.code).toBe('VALIDATION_ERROR');
    expect((await db.query('SELECT count(*)::int AS count FROM game_packages')).rows[0].count).toBe(
      0,
    );
    const zip = await archive('(o) => ({winners:o.winners})');
    await db.query(
      "CREATE FUNCTION fail_result_install() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER fail_result_install AFTER INSERT ON game_packages FOR EACH ROW EXECUTE FUNCTION fail_result_install()',
    );
    try {
      expect((await install(zip)).statusCode).toBe(500);
      expect(
        (
          await db.query(
            "SELECT count(*)::int AS count FROM game_installations WHERE game_id='online.score-race'",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (await db.query('SELECT count(*)::int AS count FROM game_package_receipts')).rows[0].count,
      ).toBe(0);
      expect(registry.get('online.score-race', '1.0.0')).toBeUndefined();
      expect(registry.resultSummaries.has('online.score-race@1.0.0')).toBe(false);
    } finally {
      await db.query('DROP TRIGGER fail_result_install ON game_packages');
      await db.query('DROP FUNCTION fail_result_install()');
    }
  });

  it('does not call undeclared methods and preserves the exact legacy rule digest across restart', async () => {
    const zip = await archive('() => {throw new Error("must never be called")}', false);
    const data = readGamePackage(zip);
    const extension = (await PackageRuntime.create()).extension(data.server);
    const legacy = new GameRegistry();
    const hash = createHash('sha256').update(zip).digest('hex');
    legacy.register(
      extension,
      { ...extension.manifest.defaultAssetPack, language: 'zh-CN', assets: [] },
      [],
      Buffer.from(
        `boardgame-package-v1:quickjs-0.31.0:${hash}:${JSON.stringify({ server: data.server, rules: data.rules })}`,
      ),
    );
    expect((await install(zip)).statusCode).toBe(200);
    expect(registry.digest('online.score-race', '1.0.0')).toEqual(
      legacy.digest('online.score-race', '1.0.0'),
    );
    const { matchId } = await start();
    await app.close();
    db = createDatabase(url!);
    registry = createRegistry(false);
    app = await createApp({ db, config, registry });
    expect((await view(matchId)).statusCode).toBe(200);
    expect(registry.digest('online.score-race', '1.0.0')).toEqual(
      legacy.digest('online.score-race', '1.0.0'),
    );
    expect(registry.resultSummaries.has('online.score-race@1.0.0')).toBe(false);
    expect((await act(matchId)).statusCode).toBe(200);
    expect((await view(matchId)).json().data.result).toBeNull();
  });

  it('does not run projection for ongoing actions, view reads or replay reads', async () => {
    const zip = await archive(
      '() => {throw new Error("SECRET_RESULT_MARKER")}',
      true,
      "game.getOutcome = () => ({status:'ongoing'});",
    );
    expect((await install(zip)).statusCode).toBe(200);
    const { matchId } = await start();
    expect((await act(matchId)).statusCode).toBe(200);
    expect((await view(matchId)).json().data).toMatchObject({
      status: 'active',
      revision: 1,
      result: null,
    });
    const replay = await app.inject({ url: `/api/v1/matches/${matchId}/replay`, headers: alice });
    expect(replay.statusCode).toBe(422);
    expect(replay.body).not.toContain('SECRET_RESULT_MARKER');
  });

  it('validates an initially finished smoke state before any installation writes', async () => {
    const zip = await archive(
      '() => ({winners:["outsider"]})',
      true,
      "game.getOutcome = () => ({status:'finished'});",
    );
    expect((await install(zip)).json().error.code).toBe('VALIDATION_ERROR');
    expect((await db.query('SELECT count(*)::int AS count FROM game_packages')).rows[0].count).toBe(
      0,
    );
    expect(
      (await db.query('SELECT count(*)::int AS count FROM game_package_receipts')).rows[0].count,
    ).toBe(0);
  });

  it('records a real free-script terminal action through the same result adapter', async () => {
    const zip = await archive(
      '(o) => ({winners:o.winners})',
      true,
      `
      const originalSetup = game.setup;
      game.setup = input => { const value = originalSetup(input); value.state.turn = 1; return value; };
      game.getDecisionContext = (state,viewer) => game.getView(state,viewer).canClaim
        ? {decisionKey:'claim',legalActions:[{type:'claim'}]} : null;
    `,
    );
    expect((await install(zip)).statusCode).toBe(200);
    const { matchId } = await start(true);
    let final = (await view(matchId)).json().data;
    const deadline = Date.now() + 12000;
    while (final.status !== 'finished' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      final = (await view(matchId)).json().data;
    }
    expect(final).toMatchObject({
      status: 'finished',
      revision: 1,
      result: { players: [{ winner: false }, { winner: true }] },
    });
    expect(
      (await db.query('SELECT account_id FROM match_actions WHERE match_id=$1', [matchId])).rows,
    ).toEqual([{ account_id: null }]);
  }, 20000);
});
