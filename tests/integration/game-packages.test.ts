import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { gamePackageZip } from '../fixtures/game-package.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (!url || url === process.env.DATABASE_URL || new URL(url).pathname === new URL(process.env.DATABASE_URL!).pathname) throw new Error('An isolated test database is required');
const origin = 'http://127.0.0.1:5173';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

describe('administrator instant game installation', () => {
  let db: Database, app: Awaited<ReturnType<typeof createApp>>;
  let admin: Headers, alice: Headers, bob: Headers;
  const config = { NODE_ENV: 'test' as const, API_HOST: '127.0.0.1', API_PORT: 3001, DATABASE_URL: url!, WEB_ORIGIN: origin, ENABLE_DEV_LAB: false, LOG_LEVEL: 'silent' as const };
  async function login(username: string) {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password: 'game package password' } });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    return { cookie: (Array.isArray(raw) ? raw : [String(raw)]).map(value => value.split(';')[0]).join('; '), origin, 'x-csrf-token': String(response.json().data.csrfToken) };
  }
  const upload = (bytes: Buffer, requestId = randomUUID(), headers = admin) => app.inject({ method: 'POST', url: `/api/v1/admin/game-packages?requestId=${requestId}`, headers: { ...headers, 'content-type': 'application/zip' }, payload: bytes });
  const review = (bytes: Buffer, headers = admin) => app.inject({
    method: 'POST', url: '/api/v1/admin/game-packages/review',
    headers: { ...headers, 'content-type': 'application/zip' }, payload: bytes,
  });
  const publish = (bytes: Buffer, catalogHash: string, requestId = randomUUID()) => app.inject({
    method: 'POST', url: `/api/v1/admin/game-packages?requestId=${requestId}&expectedCatalogHash=${catalogHash}`,
    headers: { ...admin, 'content-type': 'application/zip' }, payload: bytes,
  });
  const write = (path: string, headers: Headers, payload: unknown, method: 'POST' | 'PUT' = 'POST') => app.inject({ method, url: path, headers, payload });
  beforeAll(async () => {
    db = createDatabase(url!);
    await db.query('TRUNCATE accounts CASCADE');
    await db.query("DELETE FROM game_package_receipts; DELETE FROM game_packages WHERE game_id LIKE 'online.%'; DELETE FROM game_installations WHERE game_id LIKE 'online.%'");
    app = await createApp({ db, config, registry: createRegistry(false) });
    for (const [username, role] of [['package_admin', 'administrator'], ['package_alice', 'user'], ['package_bob', 'user']] as const) await createAccount(db, { username, displayName: username, password: 'game package password', role });
    admin = await login('package_admin'); alice = await login('package_alice'); bob = await login('package_bob');
  });
  afterAll(async () => {
    await db.query('TRUNCATE accounts CASCADE');
    await db.query("DELETE FROM game_packages WHERE game_id LIKE 'online.%'; DELETE FROM game_installations WHERE game_id LIKE 'online.%'");
    await app.close();
  });
  it('checks admin/Origin/CSRF before parsing archives and keeps failed uploads atomic', async () => {
    const zip = await gamePackageZip();
    expect((await review(zip, alice)).statusCode).toBe(403);
    expect((await review(zip, { ...admin, origin: 'https://wrong.example' })).statusCode).toBe(403);
    expect((await review(zip, { ...admin, 'x-csrf-token': 'wrong' })).statusCode).toBe(403);
    const checked = await review(zip);
    expect(checked.statusCode).toBe(200);
    expect(checked.json().data).toMatchObject({ kind: 'new', installedVersions: [] });
    expect((await db.query('SELECT count(*)::int AS count FROM game_packages')).rows[0].count).toBe(0);
    expect((await upload(zip, randomUUID(), alice)).statusCode).toBe(403);
    expect((await upload(zip, randomUUID(), { ...admin, origin: 'https://wrong.example' })).statusCode).toBe(403);
    expect((await upload(zip, randomUUID(), { ...admin, 'x-csrf-token': 'wrong' })).statusCode).toBe(403);
    expect((await upload(Buffer.from('broken'))).statusCode).toBe(400);
    const bad = await gamePackageZip(source => source + '\ngame.setup = () => { throw new Error("bad setup"); };');
    expect((await upload(bad)).statusCode).toBe(422);
    expect((await db.query('SELECT count(*)::int AS count FROM game_packages')).rows[0].count).toBe(0);
    await db.query("CREATE FUNCTION fail_game_package() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated failure'; END $$");
    await db.query('CREATE TRIGGER fail_game_package AFTER INSERT ON game_packages FOR EACH ROW EXECUTE FUNCTION fail_game_package()');
    try {
      expect((await upload(zip)).statusCode).toBe(500);
      expect((await db.query("SELECT count(*)::int AS count FROM game_installations WHERE game_id='online.score-race'")).rows[0].count).toBe(0);
      expect((await db.query('SELECT count(*)::int AS count FROM game_package_receipts')).rows[0].count).toBe(0);
    } finally {
      await db.query('DROP TRIGGER fail_game_package ON game_packages'); await db.query('DROP FUNCTION fail_game_package()');
    }
  });
  it('installs concurrently once, locks versions, completes a real match and restores exact rules after restart', async () => {
    const zip = await gamePackageZip(), requestId = randomUUID();
    const results = await Promise.all([upload(zip, requestId), upload(zip, requestId)]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json().data).toEqual(results[1]!.json().data);
    expect((await db.query('SELECT count(*)::int AS count FROM game_packages')).rows[0].count).toBe(1);
    expect((await upload(await gamePackageZip(source => source.replace('5 分', '6 分')), requestId)).json().error.code).toBe('REQUEST_ID_CONFLICT');
    expect((await upload(await gamePackageZip(source => source + '\n// different content'))).json().error.code).toBe('STATE_CONFLICT');
    const desktop = await app.inject({ url: '/api/v1/game-packages/online.score-race/versions/1.0.0/desktop' });
    expect(desktop.statusCode).toBe(200);
    expect(desktop.headers['content-security-policy']).toContain("sandbox allow-scripts");
    expect(desktop.headers['content-security-policy']).toContain("connect-src 'none'");
    const replayDocument = await app.inject({ url: '/api/v1/game-packages/online.score-race/versions/1.0.0/desktop?replay=1' });
    expect(replayDocument.statusCode).toBe(200);
    expect(replayDocument.headers['content-security-policy']).toBe(desktop.headers['content-security-policy']);
    expect(replayDocument.body).toContain('<script data-platform-replay>');
    expect(replayDocument.body.replace(/<script data-platform-replay>[\s\S]*?<\/script>/, '')).toBe(desktop.body);
    expect((await db.query("SELECT client_html FROM game_packages WHERE game_id='online.score-race' AND game_version='1.0.0'")).rows[0].client_html).toBe(desktop.body);
    expect((await app.inject({ url: '/api/v1/game-packages/online.score-race/versions/1.0.0/desktop?replay=2' })).statusCode).toBe(400);
    const catalog = await app.inject({ url: '/api/v1/games' });
    expect(catalog.json().data.some((game: { id: string }) => game.id === 'online.score-race')).toBe(true);
    const created = await write('/api/v1/rooms', alice, { requestId: randomUUID(), name: '在线安装验收', gameId: 'online.score-race', version: '1.0.0', options: {}, seatCount: 2 });
    expect(created.statusCode).toBe(200);
    const { roomId, inviteCode } = created.json().data;
    const joined = await write('/api/v1/rooms/join', bob, { requestId: randomUUID(), inviteCode });
    let revision = joined.json().data.roomRevision;
    const seated = await write(`/api/v1/rooms/${roomId}/my-seat`, bob, { requestId: randomUUID(), expectedRoomRevision: revision, seatIndex: 1 }, 'PUT');
    expect(seated.statusCode).toBe(200); revision = seated.json().data.roomRevision;
    for (const player of [alice, bob]) {
      const ready = await write(`/api/v1/rooms/${roomId}/my-ready`, player, { requestId: randomUUID(), expectedRoomRevision: revision, ready: true }, 'PUT');
      expect(ready.statusCode).toBe(200); revision = ready.json().data.roomRevision;
    }
    const start = await write(`/api/v1/rooms/${roomId}/start`, alice, { requestId: randomUUID(), expectedRoomRevision: revision });
    expect(start.statusCode).toBe(200);
    const matchId: string = start.json().data.matchId;
    const read = (headers = alice) => app.inject({ url: `/api/v1/matches/${matchId}/view`, headers });
    const before = (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0];
    const forged = await write(`/api/v1/matches/${matchId}/actions`, bob, { requestId: randomUUID(), expectedRevision: 0, action: { type: 'claim' } });
    expect(forged.statusCode).toBe(422);
    expect((await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]).toEqual(before);
    // A reviewed update replaces catalog availability without changing the active match.
    const updatedZip = await gamePackageZip(source => source.replaceAll('1.0.0', '1.1.0'));
    const checked = await review(updatedZip);
    expect(checked.json().data).toMatchObject({ kind: 'update', installedVersions: ['1.0.0'], version: '1.1.0' });
    expect((await db.query("SELECT enabled FROM game_installations WHERE game_id='online.score-race'")).rows[0].enabled).toBe(true);
    expect((await upload(updatedZip)).json().error.code).toBe('STATE_CONFLICT');
    expect((await publish(updatedZip, '0'.repeat(64))).json().error.code).toBe('STATE_CONFLICT');
    // Actual concurrent admin changes invalidate a review even when the status returns to its old value.
    await db.query("UPDATE game_installations SET enabled=false WHERE game_id='online.score-race'");
    await db.query("UPDATE game_installations SET enabled=true WHERE game_id='online.score-race'");
    expect((await publish(updatedZip, checked.json().data.catalogHash)).json().error.code).toBe('STATE_CONFLICT');
    const catalogHash: string = (await review(updatedZip)).json().data.catalogHash;
    await db.query("CREATE FUNCTION fail_game_update() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN RAISE EXCEPTION 'simulated update failure'; END $body$");
    await db.query('CREATE TRIGGER fail_game_update AFTER INSERT ON game_packages FOR EACH ROW EXECUTE FUNCTION fail_game_update()');
    try {
      expect((await publish(updatedZip, catalogHash)).statusCode).toBe(500);
      expect((await db.query("SELECT game_version,enabled FROM game_installations WHERE game_id='online.score-race'")).rows).toEqual([{ game_version: '1.0.0', enabled: true }]);
    } finally {
      await db.query('DROP TRIGGER fail_game_update ON game_packages');
      await db.query('DROP FUNCTION fail_game_update()');
    }
    const updateRequestId = randomUUID();
    const published = await publish(updatedZip, catalogHash, updateRequestId);
    expect(published.statusCode).toBe(200);
    expect((await publish(updatedZip, catalogHash, updateRequestId)).json().data).toEqual(published.json().data);
    expect((await app.inject({ url: '/api/v1/games' })).json().data.filter((game: { id: string }) => game.id === 'online.score-race').map((game: { version: string }) => game.version)).toEqual(['1.1.0']);
    expect((await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]).toEqual(before);
    expect((await read()).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/game-packages/online.score-race/versions/1.0.0/desktop' })).statusCode).toBe(200);
    // Recreate the actual API and registry while preserving database state and sessions.
    await app.close(); db = createDatabase(url!); app = await createApp({ db, config, registry: createRegistry(false) });
    expect((await read()).statusCode).toBe(200);
    expect((await read()).json().data.revision).toBe(0);
    for (let turn = 0; turn < 12; turn++) {
      const a = (await read()).json().data;
      if (a.status === 'finished') break;
      const player = a.view.canClaim ? alice : bob;
      const command = { requestId: randomUUID(), expectedRevision: a.revision, action: { type: 'claim' } };
      const action = await write(`/api/v1/matches/${matchId}/actions`, player, command);
      expect(action.statusCode).toBe(200);
      expect((await write(`/api/v1/matches/${matchId}/actions`, player, command)).json().data.revision).toBe(action.json().data.revision);
    }
    expect((await read()).json().data.status).toBe('finished');
    const finalView = (await read()).json().data;
    const replay = await app.inject({ url: `/api/v1/matches/${matchId}/replay?revision=${finalView.revision}`, headers: alice });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().data.view).toEqual(finalView.view);
    const initialReplay = await app.inject({ url: `/api/v1/matches/${matchId}/replay?revision=0`, headers: bob });
    expect(initialReplay.statusCode).toBe(200);
    expect(initialReplay.json().data).toMatchObject({ gameId: 'online.score-race', firstRevision: 0 });
    expect((await db.query('SELECT status FROM rooms WHERE id=$1', [roomId])).rows[0].status).toBe('waiting');
    const status = (await app.inject({ url: '/api/v1/admin/games', headers: admin })).json().data.find((game: { id: string; version: string }) => game.id === 'online.score-race' && game.version === '1.0.0');
    expect((await write('/api/v1/admin/games/online.score-race/versions/1.0.0/status', admin, { requestId: randomUUID(), expectedRevision: status.revision, enabled: false }, 'PUT')).statusCode).toBe(200);
    expect((await read()).statusCode).toBe(200);
    expect((await upload(zip)).statusCode).toBe(200);
    expect((await db.query("SELECT enabled FROM game_installations WHERE game_id='online.score-race' AND game_version='1.0.0'")).rows[0].enabled).toBe(false);
    const saved = (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0];
    await db.query("UPDATE game_packages SET server_source=server_source || E'\\n// damaged source' WHERE game_id='online.score-race'");
    await app.close(); db = createDatabase(url!); app = await createApp({ db, config, registry: createRegistry(false) });
    const damaged = await read();
    expect(damaged.statusCode).toBe(503);
    expect(damaged.json().error.code).toBe('RECOVERY_BLOCKED');
    expect((await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0]).toEqual(saved);
  });
});
