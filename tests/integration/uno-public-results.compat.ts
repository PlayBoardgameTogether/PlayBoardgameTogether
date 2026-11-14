import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { matchViewSchema } from '../../packages/protocol/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';

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
const unoView = z
  .object({ actions: z.array(z.json()), winners: z.array(z.string()) })
  .passthrough();
function requiredPath(name: string) {
  const path = process.env[name];
  if (!path) throw new Error(`${name} must identify an actual UNO ZIP`);
  return path;
}

describe('actual UNO public-result ZIP and immutable old version', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let admin: Headers, alice: Headers, bob: Headers;
  const config = {
    NODE_ENV: 'test' as const,
    DATABASE_URL: url!,
    WEB_ORIGIN: origin,
    API_HOST: '127.0.0.1',
    API_PORT: 3001,
    ENABLE_DEV_LAB: false,
    LOG_LEVEL: 'silent' as const,
    AI_SCAN_INTERVAL_MS: 30,
  };
  const write = (
    path: string,
    headers: Headers,
    payload: unknown,
    method: 'POST' | 'PUT' = 'POST',
  ) => app.inject({ method, url: `/api/v1${path}`, headers, payload });
  async function restart() {
    await app.close();
    db = createDatabase(url!);
    app = await createApp({ db, config, registry: createRegistry(false) });
  }
  async function login(username: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'uno result password' },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.headers['set-cookie'];
    return {
      origin,
      cookie: (Array.isArray(raw) ? raw : [String(raw)]).map((v) => v.split(';')[0]).join('; '),
      'x-csrf-token': String(response.json().data.csrfToken),
    };
  }
  async function install(path: string) {
    const bytes = await readFile(path);
    const review = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/game-packages/review',
      headers: { ...admin, 'content-type': 'application/zip' },
      payload: bytes,
    });
    expect(review.statusCode, review.body).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/game-packages?requestId=${randomUUID()}&expectedCatalogHash=${review.json().data.catalogHash}`,
      headers: { ...admin, 'content-type': 'application/zip' },
      payload: bytes,
    });
    expect(response.statusCode, response.body).toBe(200);
    return { bytes, parsed: readGamePackage(bytes) };
  }
  async function start(version: string, bot = false) {
    const response = await write('/rooms', alice, {
      requestId: randomUUID(),
      name: 'UNO result validation',
      gameId: 'online.uno',
      version,
      seatCount: 2,
      options: {},
    });
    expect(response.statusCode, response.body).toBe(200);
    const { roomId, inviteCode, room } = response.json().data;
    let revision = 0;
    if (bot) {
      const added = await write(
        `/rooms/${roomId}/seats/${room.seats[1].seatId}/bot`,
        alice,
        { requestId: randomUUID(), expectedRoomRevision: 0, policyId: 'basic-v1' },
        'PUT',
      );
      expect(added.statusCode).toBe(200);
      revision = added.json().data.roomRevision;
    } else {
      const joined = await write('/rooms/join', bob, { requestId: randomUUID(), inviteCode });
      expect(joined.statusCode).toBe(200);
      const seated = await write(
        `/rooms/${roomId}/my-seat`,
        bob,
        {
          requestId: randomUUID(),
          expectedRoomRevision: joined.json().data.roomRevision,
          seatIndex: 1,
        },
        'PUT',
      );
      expect(seated.statusCode).toBe(200);
      const ready = await write(
        `/rooms/${roomId}/my-ready`,
        bob,
        {
          requestId: randomUUID(),
          expectedRoomRevision: seated.json().data.roomRevision,
          ready: true,
        },
        'PUT',
      );
      expect(ready.statusCode).toBe(200);
      revision = ready.json().data.roomRevision;
    }
    const ready = await write(
      `/rooms/${roomId}/my-ready`,
      alice,
      { requestId: randomUUID(), expectedRoomRevision: revision, ready: true },
      'PUT',
    );
    expect(ready.statusCode).toBe(200);
    const started = await write(`/rooms/${roomId}/start`, alice, {
      requestId: randomUUID(),
      expectedRoomRevision: ready.json().data.roomRevision,
    });
    expect(started.statusCode).toBe(200);
    return String(started.json().data.matchId);
  }
  async function view(matchId: string, headers = alice) {
    const response = await app.inject({ url: `/api/v1/matches/${matchId}/view`, headers });
    expect(response.statusCode, response.body).toBe(200);
    return matchViewSchema.parse(response.json().data);
  }
  async function persisted(matchId: string) {
    return (
      await db.query(
        `SELECT to_jsonb(m) AS match,
      (SELECT count(*)::int FROM match_actions WHERE match_id=m.id) AS actions,
      (SELECT count(*)::int FROM match_replay_frames WHERE match_id=m.id) AS frames,
      (SELECT count(*)::int FROM command_receipts WHERE operation='match.action:' || m.id::text) AS receipts
      FROM matches m WHERE id=$1`,
        [matchId],
      )
    ).rows[0];
  }
  beforeEach(async () => {
    db = createDatabase(url!);
    await db.query('TRUNCATE accounts CASCADE');
    await db.query(
      "DELETE FROM game_packages WHERE game_id='online.uno'; DELETE FROM game_installations WHERE game_id='online.uno'",
    );
    app = await createApp({ db, config, registry: createRegistry(false) });
    for (const [username, role] of [
      ['uno_result_admin', 'administrator'],
      ['uno_result_alice', 'user'],
      ['uno_result_bob', 'user'],
    ] as const) {
      await createAccount(db, {
        username,
        displayName: username,
        password: 'uno result password',
        role,
      });
    }
    admin = await login('uno_result_admin');
    alice = await login('uno_result_alice');
    bob = await login('uno_result_bob');
  });
  afterEach(async () => {
    await app.close();
  });

  for (const mode of ['two humans', 'script bot', 'old active match'] as const) {
    it(`finishes ${mode}, restores exact versions and preserves authoritative results`, async () => {
      const legacy = mode === 'old active match';
      const old = legacy ? await install(requiredPath('PLAYBOARD_UNO_LEGACY_ZIP')) : null;
      let matchId = legacy ? await start('1.2.0') : '';
      const original = legacy ? await persisted(matchId) : null;
      const candidate = await install(requiredPath('PLAYBOARD_UNO_RESULT_ZIP'));
      expect(candidate.parsed.publicResult).toBe('winners-scores-v1');
      const runtime = await PackageRuntime.create();
      const game = runtime.extension(legacy ? old!.parsed.server : candidate.parsed.server);
      expect(game.manifest.version).toBe(legacy ? '1.2.0' : '1.3.0');
      if (!legacy) matchId = await start('1.3.0', mode === 'script bot');
      await restart();
      if (legacy) expect(await persisted(matchId)).toEqual(original);
      const outsider = await app.inject({ url: `/api/v1/matches/${matchId}/view`, headers: admin });
      expect(outsider.statusCode).toBe(404);
      let last:
        | {
            headers: Headers;
            command: { requestId: string; expectedRevision: number; action: unknown };
            data: unknown;
          }
        | undefined;
      for (let step = 0; step < 2500; step++) {
        const a = await view(matchId);
        if (a.status === 'finished') break;
        const av = unoView.parse(a.view);
        const current = av.actions.length
          ? { snapshot: a, headers: alice }
          : mode === 'script bot'
            ? null
            : { snapshot: await view(matchId, bob), headers: bob };
        if (!current) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          continue;
        }
        expect(current.snapshot.view).not.toHaveProperty('hands');
        expect(current.snapshot.view).not.toHaveProperty('deck');
        const action = game.getFallbackAction(current.snapshot.view, {});
        expect(action).not.toBeNull();
        const command = {
          requestId: randomUUID(),
          expectedRevision: current.snapshot.revision,
          action,
        };
        const result = await write(`/matches/${matchId}/actions`, current.headers, command);
        expect(result.statusCode, result.body).toBe(200);
        last = { headers: current.headers, command, data: result.json().data };
      }
      const final = await view(matchId);
      expect(final.status).toBe('finished');
      expect(final.gameVersion).toBe(game.manifest.version);
      if (legacy) expect(final.result).toBeNull();
      else {
        const winners = unoView.parse(final.view).winners;
        expect(final.result).toEqual({
          players: final.players!.map((p) => ({
            seatId: p.seatId,
            winner: winners.includes(p.seatId),
          })),
        });
        expect(final.result!.players.some((p) => p.winner)).toBe(true);
      }
      const saved = await persisted(matchId);
      expect(saved.actions).toBe(final.revision);
      expect(saved.frames).toBe(final.revision + 1);
      expect(last).toBeDefined();
      const retry = await write(`/matches/${matchId}/actions`, last!.headers, last!.command);
      expect(retry.statusCode).toBe(200);
      expect(retry.json().data).toEqual({ ...(last!.data as object), events: [] });
      expect(
        (
          await write(`/matches/${matchId}/actions`, last!.headers, {
            ...last!.command,
            action: { type: 'invalid' },
          })
        ).statusCode,
      ).toBe(409);
      expect(await persisted(matchId)).toEqual(saved);
      await restart();
      expect((await view(matchId)).result).toEqual(final.result);
      const history = await app.inject({
        url: '/api/v1/profile/matches?gameId=online.uno',
        headers: alice,
      });
      expect(history.statusCode).toBe(200);
      expect(history.json().data.items[0].result).toEqual(
        legacy
          ? null
          : {
              winner: final.result!.players[0]!.winner,
              sharedWin: final.result!.players.filter((p) => p.winner).length > 1,
            },
      );
      const room = await app.inject({ url: `/api/v1/rooms/${final.roomId}`, headers: alice });
      expect(room.json().data.status).toBe('waiting');
    }, 90000);
  }
});
