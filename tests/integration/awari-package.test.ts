import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL!).pathname
)
  throw new Error('Isolated test database required');
const origin = 'http://127.0.0.1:5173';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };
let db: Database,
  app: Awaited<ReturnType<typeof createApp>>,
  admin: Headers,
  alice: Headers,
  bob: Headers;
const config = {
  NODE_ENV: 'test' as const,
  API_HOST: '127.0.0.1',
  API_PORT: 3001,
  DATABASE_URL: url!,
  WEB_ORIGIN: origin,
  ENABLE_DEV_LAB: false,
  LOG_LEVEL: 'silent' as const,
};
const write = (path: string, headers: Headers, payload: unknown, method: 'POST' | 'PUT' = 'POST') =>
  app.inject({ method, url: path, headers, payload });
beforeAll(async () => {
  db = createDatabase(url!);
  await db.query('TRUNCATE accounts CASCADE');
  await db.query(
    "DELETE FROM game_packages WHERE game_id='online.awari'; DELETE FROM game_installations WHERE game_id='online.awari'",
  );
  app = await createApp({ db, config, registry: createRegistry(false) });
  const identities: Headers[] = [];
  for (const [username, role] of [
    ['awari_admin', 'administrator'],
    ['awari_a', 'user'],
    ['awari_b', 'user'],
  ] as const) {
    await createAccount(db, {
      username,
      displayName: username,
      password: 'awari test password',
      role,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'awari test password' },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    identities.push({
      cookie: (Array.isArray(raw) ? raw : [String(raw)]).map((v) => v.split(';')[0]).join('; '),
      origin,
      'x-csrf-token': response.json().data.csrfToken,
    });
  }
  [admin, alice, bob] = identities as [Headers, Headers, Headers];
});
afterAll(async () => {
  if (app) await app.close();
});
it('installs Awari, rejects unauthorized turns, rolls back, deduplicates, restores and replays a complete match', async () => {
  const zip = await readFile('dist/game-packages/awari-1.0.0.zip');
  const uploadHeaders = { ...admin, 'content-type': 'application/zip' };
  const reviewed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/game-packages/review',
    headers: uploadHeaders,
    payload: zip,
  });
  expect(reviewed.statusCode).toBe(200);
  const installed = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/game-packages?requestId=${randomUUID()}&expectedCatalogHash=${reviewed.json().data.catalogHash}`,
    headers: uploadHeaders,
    payload: zip,
  });
  expect(installed.statusCode).toBe(200);
  const cover = await app.inject({
    url: '/api/v1/game-packages/online.awari/versions/1.0.0/art/cover.png',
  });
  expect(cover.statusCode).toBe(200);
  expect(cover.headers['content-type']).toContain('image/png');
  const created = await write('/api/v1/rooms', alice, {
    requestId: randomUUID(),
    name: '阿瓦里验收',
    gameId: 'online.awari',
    version: '1.0.0',
    options: {},
    seatCount: 2,
  });
  expect(created.statusCode).toBe(200);
  const { roomId, inviteCode } = created.json().data;
  const joined = await write('/api/v1/rooms/join', bob, { requestId: randomUUID(), inviteCode });
  let revision = joined.json().data.roomRevision;
  const seated = await write(
    `/api/v1/rooms/${roomId}/my-seat`,
    bob,
    { requestId: randomUUID(), expectedRoomRevision: revision, seatIndex: 1 },
    'PUT',
  );
  expect(seated.statusCode).toBe(200);
  revision = seated.json().data.roomRevision;
  for (const player of [alice, bob]) {
    const ready = await write(
      `/api/v1/rooms/${roomId}/my-ready`,
      player,
      { requestId: randomUUID(), expectedRoomRevision: revision, ready: true },
      'PUT',
    );
    expect(ready.statusCode).toBe(200);
    revision = ready.json().data.roomRevision;
  }
  const started = await write(`/api/v1/rooms/${roomId}/start`, alice, {
    requestId: randomUUID(),
    expectedRoomRevision: revision,
  });
  expect(started.statusCode).toBe(200);
  const matchId = started.json().data.matchId;
  const read = (headers = alice) => app.inject({ url: `/api/v1/matches/${matchId}/view`, headers });
  const snapshot = async () =>
    (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0];
  const a = (await read()).json().data,
    b = (await read(bob)).json().data;
  expect(a.view.pits).toEqual(Array(12).fill(4));
  expect(a.view.actions).toHaveLength(6);
  expect(b.view.actions).toEqual([]);
  expect((await read(admin)).statusCode).toBe(404);
  const before = await snapshot();
  expect(
    (
      await write(`/api/v1/matches/${matchId}/actions`, bob, {
        requestId: randomUUID(),
        expectedRevision: 0,
        action: { type: 'sow', pit: 0 },
      })
    ).statusCode,
  ).toBe(422);
  expect(
    (
      await write(`/api/v1/matches/${matchId}/actions`, alice, {
        requestId: randomUUID(),
        expectedRevision: 0,
        action: { type: 'sow', pit: 6 },
      })
    ).statusCode,
  ).toBe(422);
  expect(await snapshot()).toEqual(before);
  await db.query(
    "CREATE FUNCTION fail_awari_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$",
  );
  await db.query(
    'CREATE TRIGGER fail_awari_action AFTER UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION fail_awari_action()',
  );
  const command = { requestId: randomUUID(), expectedRevision: 0, action: { type: 'sow', pit: 0 } };
  try {
    expect((await write(`/api/v1/matches/${matchId}/actions`, alice, command)).statusCode).toBe(
      500,
    );
    expect(await snapshot()).toEqual(before);
  } finally {
    await db.query('DROP TRIGGER fail_awari_action ON matches');
    await db.query('DROP FUNCTION fail_awari_action()');
  }
  expect((await write(`/api/v1/matches/${matchId}/actions`, alice, command)).statusCode).toBe(200);
  const committed = await snapshot();
  expect(
    (await write(`/api/v1/matches/${matchId}/actions`, alice, command)).json().data.revision,
  ).toBe(1);
  expect(await snapshot()).toEqual(committed);
  expect(
    (
      await write(`/api/v1/matches/${matchId}/actions`, alice, {
        ...command,
        action: { type: 'sow', pit: 1 },
      })
    ).json().error.code,
  ).toBe('REQUEST_ID_CONFLICT');
  await app.close();
  db = createDatabase(url!);
  app = await createApp({ db, config, registry: createRegistry(false) });
  expect((await read()).json().data.view.pits).toEqual([0, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4]);
  expect(await snapshot()).toEqual(committed);
  for (let step = 0; step < 5000; step++) {
    const first = (await read()).json().data;
    if (first.status === 'finished') break;
    const active = first.view.actions.length ? alice : bob;
    const current = active === alice ? first : (await read(bob)).json().data;
    const response = await write(`/api/v1/matches/${matchId}/actions`, active, {
      requestId: randomUUID(),
      expectedRevision: current.revision,
      action: current.view.actions[0],
    });
    expect(response.statusCode).toBe(200);
  }
  const final = (await read()).json().data;
  expect(final.status).toBe('finished');
  expect(final.view.outcome.status).toBe('finished');
  const replay = await app.inject({
    url: `/api/v1/matches/${matchId}/replay?revision=1`,
    headers: bob,
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().data.view.pits).toEqual([0, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4]);
  expect(replay.json().data.events).toEqual([
    expect.objectContaining({ type: 'seeds.sown', pit: 0, captured: 0 }),
  ]);
  expect(
    (await app.inject({ url: `/api/v1/rooms/${roomId}`, headers: alice })).json().data.status,
  ).toBe('waiting');
}, 30_000);
