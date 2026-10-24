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
let db: Database, app: Awaited<ReturnType<typeof createApp>>, admin: Headers, players: Headers[];
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
    "DELETE FROM game_packages WHERE game_id='online.puerto-rico'; DELETE FROM game_installations WHERE game_id='online.puerto-rico'",
  );
  app = await createApp({ db, config, registry: createRegistry(false) });
  const identities: Headers[] = [];
  for (const [username, role] of [
    ['puerto_rico_admin', 'administrator'],
    ['puerto_rico_a', 'user'],
    ['puerto_rico_b', 'user'],
    ['puerto_rico_c', 'user'],
  ] as const) {
    await createAccount(db, {
      username,
      displayName: username,
      password: 'puerto_rico test password',
      role,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'puerto_rico test password' },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    identities.push({
      cookie: (Array.isArray(raw) ? raw : [String(raw)]).map((v) => v.split(';')[0]).join('; '),
      origin,
      'x-csrf-token': response.json().data.csrfToken,
    });
  }
  admin = identities[0]!;
  players = identities.slice(1);
});
afterAll(async () => {
  if (app) await app.close();
});

it('reviews/installs Puerto Rico, runs three-party official identity turns with atomic receipts and restores exact package state', async () => {
  const zip = await readFile('dist/game-packages/puerto-rico-1.0.0.zip'),
    upload = { ...admin, 'content-type': 'application/zip' };
  const reviewed = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/game-packages/review',
    headers: upload,
    payload: zip,
  });
  expect(reviewed.statusCode).toBe(200);
  const installed = await app.inject({
    method: 'POST',
    url: `/api/v1/admin/game-packages?requestId=${randomUUID()}&expectedCatalogHash=${reviewed.json().data.catalogHash}`,
    headers: upload,
    payload: zip,
  });
  expect(installed.statusCode).toBe(200);
  expect((await app.inject({ url: '/api/v1/games' })).json().data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'online.puerto-rico',
        version: '1.0.0',
        players: { min: 3, max: 5 },
      }),
    ]),
  );
  expect(
    (
      await app.inject({
        url: '/api/v1/game-packages/online.puerto-rico/versions/1.0.0/art/cover.png',
      })
    ).headers['content-type'],
  ).toContain('image/png');
  const created = await write('/api/v1/rooms', players[0]!, {
    requestId: randomUUID(),
    name: '波多黎各验收',
    gameId: 'online.puerto-rico',
    version: '1.0.0',
    options: {},
    seatCount: 3,
  });
  expect(created.statusCode).toBe(200);
  const { roomId, inviteCode } = created.json().data;
  let revision = created.json().data.roomRevision;
  for (let i = 1; i < 3; i++) {
    const joined = await write('/api/v1/rooms/join', players[i]!, {
      requestId: randomUUID(),
      inviteCode,
    });
    expect(joined.statusCode).toBe(200);
    revision = joined.json().data.roomRevision;
    const seated = await write(
      `/api/v1/rooms/${roomId}/my-seat`,
      players[i]!,
      { requestId: randomUUID(), expectedRoomRevision: revision, seatIndex: i },
      'PUT',
    );
    expect(seated.statusCode).toBe(200);
    revision = seated.json().data.roomRevision;
  }
  for (const player of players) {
    const ready = await write(
      `/api/v1/rooms/${roomId}/my-ready`,
      player,
      { requestId: randomUUID(), expectedRoomRevision: revision, ready: true },
      'PUT',
    );
    expect(ready.statusCode).toBe(200);
    revision = ready.json().data.roomRevision;
  }
  const started = await write(`/api/v1/rooms/${roomId}/start`, players[0]!, {
    requestId: randomUUID(),
    expectedRoomRevision: revision,
  });
  expect(started.statusCode).toBe(200);
  const matchId = started.json().data.matchId;
  const read = (headers = players[0]!) =>
    app.inject({ url: `/api/v1/matches/${matchId}/view`, headers });
  const snapshot = async () =>
    (await db.query('SELECT state,rng_state,revision FROM matches WHERE id=$1', [matchId])).rows[0];
  expect((await read(admin)).statusCode).toBe(404);
  const first = (await read()).json().data,
    player = players[first.view.current]!,
    wrong = players[(first.view.current + 1) % 3]!;
  const own = (await read(player)).json().data;
  expect(
    own.view.players
      .filter((_: unknown, i: number) => i !== own.view.you)
      .every((p: { vp: number | null; result: unknown }) => p.vp === null && p.result === null),
  ).toBe(true);
  expect(own.view).not.toHaveProperty('deck');
  const command = { requestId: randomUUID(), expectedRevision: 0, action: own.view.actions[0] };
  const before = await snapshot();
  expect((await write(`/api/v1/matches/${matchId}/actions`, wrong, command)).statusCode).toBe(422);
  expect(
    (
      await write(`/api/v1/matches/${matchId}/actions`, player, {
        ...command,
        action: { type: 'assign', island: [], city: [] },
      })
    ).statusCode,
  ).toBe(422);
  expect(await snapshot()).toEqual(before);
  await db.query(
    "CREATE FUNCTION fail_puerto_rico_action() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$",
  );
  await db.query(
    'CREATE TRIGGER fail_puerto_rico_action AFTER UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION fail_puerto_rico_action()',
  );
  try {
    expect((await write(`/api/v1/matches/${matchId}/actions`, player, command)).statusCode).toBe(
      500,
    );
    expect(await snapshot()).toEqual(before);
  } finally {
    await db.query('DROP TRIGGER fail_puerto_rico_action ON matches');
    await db.query('DROP FUNCTION fail_puerto_rico_action()');
  }
  expect((await write(`/api/v1/matches/${matchId}/actions`, player, command)).statusCode).toBe(200);
  const once = await snapshot();
  expect((await write(`/api/v1/matches/${matchId}/actions`, player, command)).statusCode).toBe(200);
  expect(await snapshot()).toEqual(once);
  expect(
    (
      await write(`/api/v1/matches/${matchId}/actions`, player, {
        ...command,
        action: { type: 'pass' },
      })
    ).json().error.code,
  ).toBe('REQUEST_ID_CONFLICT');
  // Every accepted move uses real sessions and the original match transaction.
  for (let i = 0; i < 20; i++) {
    const current = (await read()).json().data;
    const identity = players[current.view.current]!,
      next = (await read(identity)).json().data;
    expect(next.view.actions.length).toBeGreaterThan(0);
    const result = await write(`/api/v1/matches/${matchId}/actions`, identity, {
      requestId: randomUUID(),
      expectedRevision: next.revision,
      action: next.view.actions[0],
    });
    expect(result.statusCode).toBe(200);
  }
  const saved = await snapshot();
  await app.close();
  db = createDatabase(url!);
  app = await createApp({ db, config, registry: createRegistry(false) });
  expect(await snapshot()).toEqual(saved);
  for (const identity of players) {
    const restored = await read(identity);
    expect(restored.statusCode).toBe(200);
    const v = restored.json().data.view;
    expect(v).not.toHaveProperty('resources');
    expect(v).not.toHaveProperty('deck');
    expect(v).not.toHaveProperty('used');
    const p = v.you;
    expect(v.players[p].goods).toEqual(saved.state.players[p].goods);
    expect(v.players[p].vp).toBe(saved.state.players[p].vp);
  }
  let steps = 0;
  while (steps++ < 1500) {
    const current = (await read()).json().data;
    if (current.status === 'finished') break;
    const identity = players[current.view.current]!,
      next = (await read(identity)).json().data;
    const submitted = await write(`/api/v1/matches/${matchId}/actions`, identity, {
      requestId: randomUUID(),
      expectedRevision: next.revision,
      action: next.view.actions[0],
    });
    expect(submitted.statusCode).toBe(200);
  }
  const final = (await read()).json().data;
  expect(final.status).toBe('finished');
  expect(
    final.view.players.every(
      (p: { vp: unknown; result: unknown }) => typeof p.vp === 'number' && p.result !== null,
    ),
  ).toBe(true);
  expect((await db.query('SELECT status FROM rooms WHERE id=$1', [roomId])).rows[0].status).toBe(
    'waiting',
  );
  const replay = await app.inject({
    url: `/api/v1/matches/${matchId}/replay?revision=${final.revision}`,
    headers: players[0]!,
  });
  expect(replay.statusCode).toBe(200);
  expect(replay.json().data.view).toEqual(final.view);
  const firstReplay = await app.inject({
    url: `/api/v1/matches/${matchId}/replay?revision=0`,
    headers: players[1]!,
  });
  expect(firstReplay.statusCode).toBe(200);
  expect(
    firstReplay
      .json()
      .data.view.players.every((p: { vp: unknown }, i: number) => i === 1 || p.vp === null),
  ).toBe(true);
}, 120000);
