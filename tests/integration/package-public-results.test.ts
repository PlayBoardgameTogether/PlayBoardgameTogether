import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry, GameRegistry } from '../../apps/api/src/registry/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';
import { gamePackageFiles, zipSync, strToU8 } from '../fixtures/game-package.js';

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

  async function archive(projection: string, declared = true, extraSource = '') {
    const files = await gamePackageFiles();
    const descriptor = JSON.parse(files['game.json'].toString());
    files['game.json'] = strToU8(
      JSON.stringify({ ...descriptor, ...(declared ? { publicResult: 'winners-scores-v1' } : {}) }),
    );
    files['server.js'] = Buffer.from(
      files['server.js'].toString().replace('>= 5', '>= 1') +
        `\ngame.getPublicResult = ${projection};\n${extraSource}`,
    );
    return Buffer.from(zipSync(files));
  }
  const write = (
    path: string,
    headers: Headers,
    payload: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ) => app.inject({ method, url: path, headers, payload });
  async function install(bytes: Buffer) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/game-packages?requestId=${randomUUID()}`,
      headers: { ...admin, 'content-type': 'application/zip' },
      payload: bytes,
    });
    return response;
  }
  async function start(computer = false) {
    const created = await write('/api/v1/rooms', alice, {
      requestId: randomUUID(),
      name: '公开结果验收',
      gameId: 'online.score-race',
      version: '1.0.0',
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
      alice,
      {
        requestId: randomUUID(),
        expectedRoomRevision: revision,
        ready: true,
      },
      'PUT',
    );
    expect(ready.statusCode).toBe(200);
    const started = await write(`/api/v1/rooms/${roomId}/start`, alice, {
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
      (SELECT count(*)::int FROM command_receipts WHERE operation='match.action:' || m.id::text) AS receipts
      FROM matches m WHERE id=$1`,
        [matchId],
      )
    ).rows[0];
  }

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
