import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { BadgeService } from '../../apps/api/src/badges/service.js';
import { sessionPublicSchema } from '../../packages/protocol/src/index.js';
import {
  badgeCollectionSchema,
  type BadgeDisplayInput,
  type BadgeGrantInput,
} from '../../packages/protocol/src/index.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL).pathname
)
  throw new Error('An isolated test database is required');
const origin = 'http://127.0.0.1:5173';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

describe('player achievement and honor badges', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let admin: Headers, a: Headers, b: Headers;
  let aid: string, bid: string;
  const read = (path: string, headers = a) => app.inject({ url: path, headers });
  const put = (path: string, payload: unknown, headers = a) =>
    app.inject({ method: 'PUT', url: path, payload, headers });
  const post = (path: string, payload: unknown, headers = a) =>
    app.inject({ method: 'POST', url: path, payload, headers });
  const own = async () => {
    const response = await read('/api/v1/profile/badges');
    expect(response.statusCode).toBe(200);
    return badgeCollectionSchema.parse(response.json().data);
  };
  const selection = (
    displayed: BadgeDisplayInput['displayed'],
    expectedRevision = 0,
  ): BadgeDisplayInput => ({ requestId: randomUUID(), expectedRevision, displayed });
  const grant = (
    badgeId: BadgeGrantInput['badgeId'],
    expectedRevision = 0,
    granted = true,
  ): BadgeGrantInput => ({ requestId: randomUUID(), expectedRevision, badgeId, granted });
  beforeAll(async () => {
    db = createDatabase(url);
    app = await createApp({
      db,
      registry: createRegistry(false),
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        DATABASE_URL: url,
        WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent',
      },
    });
  });
  afterAll(async () => {
    await app.close();
  });
  async function login(username: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'badge test password' },
    });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    return {
      cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
        .map((v) => v.split(';')[0])
        .join('; '),
      origin,
      'x-csrf-token': String(response.json().data.csrfToken),
    };
  }
  beforeEach(async () => {
    await db.query('TRUNCATE accounts CASCADE');
    await createAccount(db, {
      username: 'badge_admin',
      displayName: '徽章管理员',
      password: 'badge test password',
      role: 'administrator',
    });
    aid = await createAccount(db, {
      username: 'badge_a',
      displayName: '玩家 A',
      password: 'badge test password',
      role: 'user',
    });
    bid = await createAccount(db, {
      username: 'badge_b',
      displayName: '玩家 B',
      password: 'badge test password',
      role: 'user',
    });
    admin = await login('badge_admin');
    a = await login('badge_a');
    b = await login('badge_b');
  });

  async function start() {
    const created = await post('/api/v1/rooms', {
      requestId: randomUUID(),
      name: '徽章验收桌',
      gameId: 'demo.counter-room',
      version: '1.0.0',
      seatCount: 2,
      options: { targetScore: 2 },
    });
    expect(created.statusCode).toBe(200);
    const { roomId, inviteCode } = created.json().data;
    expect(
      (await post('/api/v1/rooms/join', { requestId: randomUUID(), inviteCode }, b)).statusCode,
    ).toBe(200);
    expect(
      (
        await put(
          `/api/v1/rooms/${roomId}/my-seat`,
          { requestId: randomUUID(), expectedRoomRevision: 1, seatIndex: 1 },
          b,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put(`/api/v1/rooms/${roomId}/my-ready`, {
          requestId: randomUUID(),
          expectedRoomRevision: 2,
          ready: true,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put(
          `/api/v1/rooms/${roomId}/my-ready`,
          { requestId: randomUUID(), expectedRoomRevision: 3, ready: true },
          b,
        )
      ).statusCode,
    ).toBe(200);
    const started = await post(`/api/v1/rooms/${roomId}/start`, {
      requestId: randomUUID(),
      expectedRoomRevision: 4,
    });
    expect(started.statusCode).toBe(200);
    return started.json().data.matchId as string;
  }

  it('checks session, administrator role, Origin, CSRF and strict inputs', async () => {
    const path = `/api/v1/admin/accounts/${aid}/badges`;
    expect((await app.inject({ url: '/api/v1/profile/badges' })).statusCode).toBe(401);
    expect((await app.inject({ url: `/api/v1/profile/badges/${aid}` })).statusCode).toBe(401);
    expect((await read(path)).statusCode).toBe(403);
    expect((await put(path, grant('beta-player'))).statusCode).toBe(403);
    expect(
      (await put(path, grant('beta-player'), { ...admin, origin: 'https://evil.example' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await put(path, grant('beta-player'), { ...admin, 'x-csrf-token': '' })).statusCode,
    ).toBe(403);
    expect(
      (await put(path, { ...grant('beta-player'), badgeId: 'first-match' }, admin)).statusCode,
    ).toBe(400);
    expect(
      (await put('/api/v1/profile/badges', { ...selection(['welcome']), accountId: bid }))
        .statusCode,
    ).toBe(400);
    const result = await read('/api/v1/profile/badges');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).not.toMatch(/password|token|session|state|rng|awardedBy/);
    await db.query('UPDATE sessions SET revoked_at=now() WHERE account_id=$1', [aid]);
    expect((await put('/api/v1/profile/badges', selection(['welcome']))).statusCode).toBe(401);
  });

  it('unlocks from a real settled action and retains progress after leaving the room', async () => {
    const matchId = await start();
    expect((await own()).items.find((item) => item.id === 'first-match')?.progress).toBe(0);
    const result = await post(`/api/v1/matches/${matchId}/actions`, {
      requestId: randomUUID(),
      expectedRevision: 0,
      action: { type: 'add', payload: { value: 2 } },
    });
    expect(result.statusCode).toBe(200);
    expect((await own()).items.find((item) => item.id === 'first-match')?.earned).toBe(true);
    const room = await db.query<{ room_id: string }>('SELECT room_id FROM matches WHERE id=$1', [
      matchId,
    ]);
    await db.query('UPDATE seats SET owner_account_id=NULL,ready=false WHERE room_id=$1', [
      room.rows[0]!.room_id,
    ]);
    await db.query('DELETE FROM room_members WHERE room_id=$1', [room.rows[0]!.room_id]);
    expect((await own()).items.find((item) => item.id === 'first-match')?.earned).toBe(true);
    const other = await read('/api/v1/profile/badges', b);
    expect(
      other.json().data.items.find((item: { id: string }) => item.id === 'first-match').earned,
    ).toBe(true);
  });

  it('counts retained rounds and distinct game IDs while excluding active, aborted and development games', async () => {
    const matchId = await start();
    // Historical database fixtures exercise aggregate thresholds without playing 50 identical rounds.
    const copy = async (status: string, count: number, gameId = 'demo.counter-room') =>
      db.query(
        `WITH copies AS (
      INSERT INTO matches(id,room_id,game_id,game_version,content_version,resource_pack_id,resource_pack_version,state,rng_state,status)
      SELECT gen_random_uuid(),room_id,$3,CASE WHEN $3='demo.test-counter' THEN '0.1.0' ELSE game_version END,content_version,resource_pack_id,resource_pack_version,state,rng_state,$2
      FROM matches CROSS JOIN generate_series(1,$4::integer) WHERE id=$1 RETURNING id)
      INSERT INTO match_participants(match_id,seat_id,account_id,seat_index)
      SELECT copies.id,p.seat_id,p.account_id,p.seat_index FROM copies CROSS JOIN match_participants p WHERE p.match_id=$1`,
        [matchId, status, gameId, count],
      );
    await copy('aborted', 4);
    await copy('finished', 8);
    await copy('finished', 5, 'demo.test-counter');
    let collection = await own();
    expect(collection.items.find((item) => item.id === 'ten-matches')).toMatchObject({
      progress: 8,
      earned: false,
    });
    expect(collection.items.find((item) => item.id === 'explorer')?.progress).toBe(1);
    await copy('finished', 1, 'color-match');
    await copy('finished', 1, 'grid-garden');
    collection = await own();
    expect(collection.items.find((item) => item.id === 'ten-matches')?.earned).toBe(true);
    expect(collection.items.find((item) => item.id === 'explorer')?.earned).toBe(true);
    await copy('finished', 40);
    expect((await own()).items.find((item) => item.id === 'fifty-matches')).toMatchObject({
      progress: 50,
      earned: true,
    });
    const unrelated = await read('/api/v1/profile/badges', admin);
    expect(
      unrelated.json().data.items.find((item: { id: string }) => item.id === 'first-match').earned,
    ).toBe(false);
  });

  it('persists selection, rejects locked/duplicate badges and replays before revision checking', async () => {
    expect((await put('/api/v1/profile/badges', selection(['first-match']))).statusCode).toBe(422);
    expect(
      (await put('/api/v1/profile/badges', selection(['welcome', 'welcome']))).statusCode,
    ).toBe(400);
    const command = selection(['welcome']);
    const saved = await put('/api/v1/profile/badges', command);
    expect(saved.statusCode).toBe(200);
    expect((await own()).displayed).toEqual(['welcome']);
    expect((await put('/api/v1/profile/badges', command)).json().data).toEqual(saved.json().data);
    expect(
      (await put('/api/v1/profile/badges', { ...command, displayed: [] })).json().error.code,
    ).toBe('REQUEST_ID_CONFLICT');
    expect((await put('/api/v1/profile/badges', selection([]))).json().error.code).toBe(
      'STATE_CONFLICT',
    );
    const visible = await read(`/api/v1/profile/badges/${aid}`, b);
    expect(visible.json().data.items.map((item: { id: string }) => item.id)).toEqual(['welcome']);
    expect(Object.keys(visible.json().data)).toEqual(['items']);
    expect((await read(`/api/v1/profile/badges/${bid}`)).json().data.items).toEqual([]);
  });

  it('revalidates a previously authenticated session inside the display transaction', async () => {
    const me = sessionPublicSchema.parse((await read('/api/v1/auth/me')).json().data);
    const session = (
      await db.query<{ id: string; token_hash: string; csrf_token_hash: string; expires_at: Date }>(
        'SELECT id,token_hash,csrf_token_hash,expires_at FROM sessions WHERE account_id=$1 AND revoked_at IS NULL',
        [aid],
      )
    ).rows[0]!;
    await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [session.id]);
    await expect(
      new BadgeService(db).display(
        {
          account: me.account,
          sessionId: session.id,
          tokenHash: session.token_hash,
          csrfHash: session.csrf_token_hash,
          expiresAt: session.expires_at,
        },
        selection(['welcome']),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(
      (await db.query('SELECT 1 FROM player_badge_settings WHERE account_id=$1', [aid])).rowCount,
    ).toBe(0);
  });

  it('serializes competing first selections and preserves one revision increment', async () => {
    const results = await Promise.all(
      [selection(['welcome']), selection([])].map((input) => put('/api/v1/profile/badges', input)),
    );
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect((await own()).revision).toBe(1);
  });

  it('grants and revokes honors atomically with administrator receipts and removes revoked pins', async () => {
    const path = `/api/v1/admin/accounts/${aid}/badges`;
    const command = grant('beta-player');
    const first = await put(path, command, admin);
    expect(first.statusCode).toBe(200);
    expect((await put(path, command, admin)).json().data).toEqual(first.json().data);
    expect((await put(path, { ...command, granted: false }, admin)).json().error.code).toBe(
      'REQUEST_ID_CONFLICT',
    );
    expect(
      (await put('/api/v1/profile/badges', selection(['welcome', 'beta-player'], 1))).statusCode,
    ).toBe(200);
    expect((await put(path, grant('beta-player', 1, false), admin)).statusCode).toBe(409);
    expect((await put(path, grant('beta-player', 2, false), admin)).statusCode).toBe(200);
    const current = await own();
    expect(current.revision).toBe(3);
    expect(current.displayed).toEqual(['welcome']);
    expect(current.items.find((item) => item.id === 'beta-player')?.earned).toBe(false);
    expect((await read(`/api/v1/profile/badges/${aid}`, b)).json().data.items).toHaveLength(1);
    // Old success receipts never re-grant a badge after a later revocation.
    expect((await put(path, command, admin)).statusCode).toBe(200);
    expect((await own()).items.find((item) => item.id === 'beta-player')?.earned).toBe(false);
  });

  it('rolls back selection and grant changes if receipt persistence fails', async () => {
    await db.query(`CREATE FUNCTION reject_badge_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test receipt fault'; END; $$;
      CREATE TRIGGER reject_badge_receipt BEFORE INSERT ON player_badge_receipts FOR EACH ROW EXECUTE FUNCTION reject_badge_receipt_test();
      CREATE TRIGGER reject_badge_admin_receipt BEFORE INSERT ON admin_command_receipts FOR EACH ROW EXECUTE FUNCTION reject_badge_receipt_test();`);
    try {
      expect((await put('/api/v1/profile/badges', selection(['welcome']))).statusCode).toBe(500);
      expect(
        (await put(`/api/v1/admin/accounts/${aid}/badges`, grant('contributor'), admin)).statusCode,
      ).toBe(500);
      const state = await own();
      expect(state.revision).toBe(0);
      expect(state.displayed).toEqual([]);
      expect(state.items.find((item) => item.id === 'contributor')?.earned).toBe(false);
    } finally {
      await db.query(
        'DROP TRIGGER reject_badge_receipt ON player_badge_receipts; DROP TRIGGER reject_badge_admin_receipt ON admin_command_receipts; DROP FUNCTION reject_badge_receipt_test()',
      );
    }
  });
  const definition = (
    overrides: Partial<import('../../packages/protocol/src/index.js').BadgeDefinitionInput> = {},
  ) => ({
    requestId: randomUUID(),
    expectedRevision: 0,
    id: `custom-${randomUUID()}`,
    name: '同行者',
    description: '收藏一起玩的时光',
    symbol: '🎖️',
    enabled: true,
    rule: { type: 'manual' as const },
    ...overrides,
  });

  it('restricts badge design to administrators, validates rules and replays writes before revision checks', async () => {
    const path = '/api/v1/admin/badges';
    const input = definition();
    expect((await read(path)).statusCode).toBe(403);
    expect((await put(path, input)).statusCode).toBe(403);
    expect((await put(path, input, { ...admin, origin: 'https://evil.example' })).statusCode).toBe(
      403,
    );
    expect((await put(path, input, { ...admin, 'x-csrf-token': '' })).statusCode).toBe(403);
    expect((await put(path, { ...input, id: 'welcome' }, admin)).statusCode).toBe(400);
    for (const rule of [
      { type: 'automatic', mode: 'all', conditions: [] },
      { type: 'automatic', mode: 'any', conditions: [{ metric: 'finished', target: 0 }] },
      { type: 'automatic', mode: 'all', conditions: [{ metric: 'wins', target: 1 }] },
      { type: 'manual', script: 'return true' },
    ])
      expect((await put(path, { ...input, rule }, admin)).statusCode).toBe(400);
    for (const gameId of ['missing-game', 'demo.test-counter']) {
      expect(
        (
          await put(
            path,
            {
              ...input,
              rule: {
                type: 'automatic',
                mode: 'all',
                conditions: [{ metric: 'gameFinished', target: 1, gameId }],
              },
            },
            admin,
          )
        ).statusCode,
      ).toBe(422);
    }
    const first = await put(path, input, admin);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.revision).toBe(1);
    expect((await put(path, input, admin)).json().data).toEqual(first.json().data);
    expect((await put(path, { ...input, name: '另一枚' }, admin)).json().error.code).toBe(
      'REQUEST_ID_CONFLICT',
    );
    expect((await put(path, { ...input, requestId: randomUUID() }, admin)).json().error.code).toBe(
      'STATE_CONFLICT',
    );
    const outcomes = await Promise.all(
      ['甲', '乙'].map((name) =>
        put(path, { ...input, name, requestId: randomUUID(), expectedRevision: 1 }, admin),
      ),
    );
    expect(outcomes.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect((await read(path, admin)).json().data.items).toHaveLength(1);
  });

  it('grants custom honors, preserves award time, hides disabled pins and rejects automatic grants', async () => {
    const input = definition();
    expect((await put('/api/v1/admin/badges', input, admin)).statusCode).toBe(200);
    const path = `/api/v1/admin/accounts/${aid}/badges`;
    expect((await put(path, grant(input.id), admin)).statusCode).toBe(200);
    const awarded = (await own()).items.find((item) => item.id === input.id)?.awardedAt;
    expect(awarded).toBeTruthy();
    expect((await put(path, grant(input.id, 1), admin)).statusCode).toBe(200);
    expect((await own()).items.find((item) => item.id === input.id)?.awardedAt).toBe(awarded);
    expect((await put('/api/v1/profile/badges', selection([input.id], 2))).statusCode).toBe(200);
    expect((await read(`/api/v1/profile/badges/${aid}`, b)).json().data.items[0].id).toBe(input.id);
    const updated = { ...input, expectedRevision: 1, requestId: randomUUID(), enabled: false };
    expect((await put('/api/v1/admin/badges', updated, admin)).statusCode).toBe(200);
    expect((await own()).displayed).toEqual([]);
    expect((await read(`/api/v1/profile/badges/${aid}`, b)).json().data.items).toEqual([]);
    expect((await put('/api/v1/profile/badges', selection([input.id], 3))).statusCode).toBe(422);
    expect((await put(path, grant(input.id, 3), admin)).statusCode).toBe(422);
    expect(
      (
        await put(
          '/api/v1/admin/badges',
          { ...input, requestId: randomUUID(), expectedRevision: 2 },
          admin,
        )
      ).statusCode,
    ).toBe(200);
    expect((await own()).displayed).toEqual([input.id]);
    expect((await put(path, grant(input.id, 3, false), admin)).statusCode).toBe(200);
    expect((await own()).displayed).toEqual([]);
    const auto = definition({
      rule: { type: 'automatic', mode: 'all', conditions: [{ metric: 'finished', target: 1 }] },
    });
    expect((await put('/api/v1/admin/badges', auto, admin)).statusCode).toBe(200);
    expect((await put(path, grant(auto.id, 4), admin)).statusCode).toBe(422);
    expect(
      (
        await put(
          '/api/v1/admin/badges',
          { ...auto, requestId: randomUUID(), expectedRevision: 1, rule: { type: 'manual' } },
          admin,
        )
      ).statusCode,
    ).toBe(422);
  });

  it('evaluates all/any conditions and specific games against historical formal matches and hides newly locked pins', async () => {
    const matchId = await start();
    const input = definition({
      rule: {
        type: 'automatic',
        mode: 'all',
        conditions: [
          { metric: 'finished', target: 1 },
          { metric: 'games', target: 2 },
          { metric: 'gameFinished', gameId: 'demo.counter-room', target: 1 },
        ],
      },
    });
    expect((await put('/api/v1/admin/badges', input, admin)).statusCode).toBe(200);
    expect((await own()).items.find((item) => item.id === input.id)?.earned).toBe(false);
    expect(
      (
        await post(`/api/v1/matches/${matchId}/actions`, {
          requestId: randomUUID(),
          expectedRevision: 0,
          action: { type: 'add', payload: { value: 2 } },
        })
      ).statusCode,
    ).toBe(200);
    expect((await own()).items.find((item) => item.id === input.id)).toMatchObject({
      earned: false,
      progress: 50,
    });
    const onlyColor = definition({
      rule: {
        type: 'automatic',
        mode: 'all',
        conditions: [{ metric: 'gameFinished', gameId: 'color-match', target: 1 }],
      },
    });
    expect((await put('/api/v1/admin/badges', onlyColor, admin)).statusCode).toBe(200);
    expect((await own()).items.find((item) => item.id === onlyColor.id)).toMatchObject({
      earned: false,
      progress: 0,
    });
    const any = {
      ...input,
      requestId: randomUUID(),
      expectedRevision: 1,
      rule: { ...input.rule, type: 'automatic' as const, mode: 'any' as const },
    };
    expect((await put('/api/v1/admin/badges', any, admin)).statusCode).toBe(200);
    expect((await own()).items.find((item) => item.id === input.id)?.earned).toBe(true);
    expect((await put('/api/v1/profile/badges', selection([input.id]))).statusCode).toBe(200);
    // A nonexistent/foreign account has no progress, even when reading the same definition.
    expect(
      (await read('/api/v1/profile/badges', admin))
        .json()
        .data.items.find((item: { id: string }) => item.id === input.id).earned,
    ).toBe(false);
    expect(
      (
        await put(
          '/api/v1/admin/badges',
          { ...input, requestId: randomUUID(), expectedRevision: 2 },
          admin,
        )
      ).statusCode,
    ).toBe(200);
    expect((await own()).displayed).toEqual([]);
    expect((await read(`/api/v1/profile/badges/${aid}`, b)).json().data.items).toEqual([]);
  });

  it('rolls back a custom definition when its administrator receipt fails', async () => {
    await db.query(`CREATE FUNCTION reject_custom_badge_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test receipt fault'; END; $$;
      CREATE TRIGGER reject_custom_badge_receipt BEFORE INSERT ON admin_command_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_custom_badge_receipt();`);
    try {
      expect((await put('/api/v1/admin/badges', definition(), admin)).statusCode).toBe(500);
      expect((await read('/api/v1/admin/badges', admin)).json().data.items).toEqual([]);
    } finally {
      await db.query(
        'DROP TRIGGER reject_custom_badge_receipt ON admin_command_receipts; DROP FUNCTION reject_custom_badge_receipt()',
      );
    }
  });
});
