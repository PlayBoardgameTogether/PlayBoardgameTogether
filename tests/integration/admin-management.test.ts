import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import {
  adminAccountPageSchema,
  adminGameSchema,
  adminOverviewSchema,
} from '../../packages/protocol/src/index.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  url === process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL!).pathname
)
  throw new Error('An isolated test database is required');
const origin = 'http://127.0.0.1:5173';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

describe('administrator management', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let admin: Headers, user: Headers;
  let userId: string, adminId: string;
  const gamePath = '/api/v1/admin/games/color-match/versions/1.0.0/status';
  const write = (path: string, payload: unknown, headers = admin) =>
    app.inject({ method: 'PUT', url: path, headers, payload });
  const read = (path: string, headers = admin) =>
    app.inject({ url: path, headers });
  async function startApp() {
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
  }
  afterEach(async () => {
    await db.query('UPDATE game_installations SET enabled=true');
    await app.close();
  });
  async function login(username: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'admin management password' },
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
    // Prepare fixtures before starting background workers that access these tables.
    db = createDatabase(url);
    await db.query('TRUNCATE accounts CASCADE');
    await db.query('UPDATE game_installations SET enabled=true');
    adminId = await createAccount(db, {
      username: 'manage_admin',
      displayName: '管理员',
      password: 'admin management password',
      role: 'administrator',
    });
    userId = await createAccount(db, {
      username: 'manage_user',
      displayName: '普通玩家',
      password: 'admin management password',
      role: 'user',
    });
    await startApp();
    admin = await login('manage_admin');
    user = await login('manage_user');
  });
  async function game() {
    const response = await read('/api/v1/admin/games');
    expect(response.statusCode).toBe(200);
    return adminGameSchema
      .array()
      .parse(response.json().data)
      .find((item) => item.id === 'color-match')!;
  }
  it('protects update triggers with session, role, Origin, CSRF and strict input', async () => {
    const path = '/api/v1/admin/updates/check';
    const payload = { requestId: randomUUID() };
    const trigger = (headers: Partial<Headers>, body: unknown = payload) =>
      app.inject({ method: 'POST', url: path, headers, payload: body });
    expect((await app.inject({ url: '/api/v1/admin/updates' })).statusCode).toBe(401);
    expect((await read('/api/v1/admin/updates', user)).statusCode).toBe(403);
    expect((await trigger({ origin })).statusCode).toBe(401);
    expect((await trigger(user)).statusCode).toBe(403);
    expect((await trigger({ ...admin, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await trigger({ ...admin, 'x-csrf-token': '' })).statusCode).toBe(403);
    expect((await trigger(admin, { ...payload, branch: 'evil', force: true })).statusCode).toBe(400);
    const result = await trigger(admin);
    expect(result.statusCode).toBe(202);
    expect(result.json().data.phase).toBe('unavailable');
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('enforces administrator, origin, CSRF and strict input without leaking secrets', async () => {
    for (const path of [
      '/api/v1/admin/overview',
      '/api/v1/admin/accounts',
      '/api/v1/admin/games',
    ]) {
      expect((await app.inject({ url: path })).statusCode).toBe(401);
      expect((await read(path, user)).statusCode).toBe(403);
      const response = await read(path);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toMatch(/password_hash|csrf|token|state|rng/i);
    }
    const input = {
      requestId: randomUUID(),
      expectedRevision: (await game()).revision,
      enabled: false,
    };
    expect((await write(gamePath, input, user)).statusCode).toBe(403);
    expect(
      (
        await write(gamePath, input, {
          ...admin,
          origin: 'https://evil.example',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await write(gamePath, input, { ...admin, 'x-csrf-token': '' }))
        .statusCode,
    ).toBe(403);
    expect(
      (await write(gamePath, { ...input, serverEntry: 'virus' })).statusCode,
    ).toBe(400);
  });
  it('searches and paginates accounts and reports real counts', async () => {
    const response = await read('/api/v1/admin/accounts?search=普通');
    expect(
      adminAccountPageSchema
        .parse(response.json().data)
        .items.map((item) => item.id),
    ).toEqual([userId]);
    for (let index = 0; index < 22; index++)
      await db.query(
        `INSERT INTO accounts(id,username_canonical,display_name,password_hash,role)
      VALUES($1,$2,$2,'unused','user')`,
        [randomUUID(), `page_${index}`],
      );
    const first = adminAccountPageSchema.parse(
      (await read('/api/v1/admin/accounts')).json().data,
    );
    const second = adminAccountPageSchema.parse(
      (await read(`/api/v1/admin/accounts?before=${first.nextCursor}`)).json()
        .data,
    );
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(4);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(24);
    expect(
      adminOverviewSchema.parse(
        (await read('/api/v1/admin/overview')).json().data,
      ).accounts,
    ).toBe(24);
  });
  it('disables users atomically, revokes every session, deduplicates and preserves administrators', async () => {
    const secondSession = await login('manage_user');
    const path = `/api/v1/admin/accounts/${userId}/status`;
    const input = {
      requestId: randomUUID(),
      expectedRevision: 1,
      status: 'disabled',
    };
    const replies = await Promise.all([write(path, input), write(path, input)]);
    expect(replies.map((reply) => reply.statusCode)).toEqual([200, 200]);
    expect(replies[0]!.json().data.revision).toBe(2);
    expect(replies[1]!.json().data).toEqual(replies[0]!.json().data);
    expect((await read('/api/v1/auth/me', user)).statusCode).toBe(401);
    expect((await read('/api/v1/auth/me', secondSession)).statusCode).toBe(401);
    expect(
      (await write(path, { ...input, status: 'active' })).json().error.code,
    ).toBe('REQUEST_ID_CONFLICT');
    expect(
      (
        await write(path, {
          requestId: randomUUID(),
          expectedRevision: 1,
          status: 'active',
        })
      ).json().error.code,
    ).toBe('STATE_CONFLICT');
    expect(
      (
        await write(`/api/v1/admin/accounts/${adminId}/status`, {
          ...input,
          requestId: randomUUID(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await write(path, {
          requestId: randomUUID(),
          expectedRevision: 2,
          status: 'active',
        })
      ).statusCode,
    ).toBe(200);
    expect((await read('/api/v1/auth/me', user)).statusCode).toBe(401);
    expect((await login('manage_user')).cookie).toBeTruthy();
  });
  it('notices external CLI status changes via revision and rolls back failed commands', async () => {
    await db.query("UPDATE accounts SET status='disabled' WHERE id=$1", [
      userId,
    ]);
    await db.query("UPDATE accounts SET status='active' WHERE id=$1", [userId]);
    const response = await write(`/api/v1/admin/accounts/${userId}/status`, {
      requestId: randomUUID(),
      expectedRevision: 1,
      status: 'disabled',
    });
    expect(response.json().error.code).toBe('STATE_CONFLICT');
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM admin_command_receipts',
        )
      ).rows[0].count,
    ).toBe(0);
    expect(
      (
        await db.query(
          'SELECT status,admin_revision FROM accounts WHERE id=$1',
          [userId],
        )
      ).rows[0],
    ).toEqual({ status: 'active', admin_revision: 3 });
  });
  it('rolls back account status and session revocation when receipt persistence fails', async () => {
    await db.query(`CREATE FUNCTION admin_test_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test failure'; END; $$;
      CREATE TRIGGER admin_test_receipt_failure BEFORE INSERT ON admin_command_receipts
      FOR EACH ROW EXECUTE FUNCTION admin_test_receipt_failure()`);
    const payload = {
      requestId: randomUUID(),
      expectedRevision: 1,
      status: 'disabled',
    };
    try {
      expect(
        (await write(`/api/v1/admin/accounts/${userId}/status`, payload))
          .statusCode,
      ).toBe(500);
      expect((await read('/api/v1/auth/me', user)).statusCode).toBe(200);
      expect(
        (
          await db.query(
            'SELECT status,admin_revision FROM accounts WHERE id=$1',
            [userId],
          )
        ).rows[0],
      ).toEqual({ status: 'active', admin_revision: 1 });
    } finally {
      await db.query(
        'DROP TRIGGER admin_test_receipt_failure ON admin_command_receipts; DROP FUNCTION admin_test_receipt_failure()',
      );
    }
    expect(
      (await write(`/api/v1/admin/accounts/${userId}/status`, payload))
        .statusCode,
    ).toBe(200);
  });
  it('hides downlisted games without failing readiness, blocks creation, preserves existing match views', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: user,
      payload: {
        requestId: randomUUID(),
        name: '旧对局',
        gameId: 'color-match',
        version: '1.0.0',
        options: {},
        seatCount: 2,
      },
    });
    expect(created.statusCode).toBe(200);
    const roomId = created.json().data.roomId;
    await createAccount(db, {
      username: 'manage_other',
      displayName: '另一玩家',
      password: 'admin management password',
      role: 'user',
    });
    const other = await login('manage_other');
    const joined = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms/join',
      headers: other,
      payload: {
        requestId: randomUUID(),
        inviteCode: created.json().data.inviteCode,
      },
    });
    let revision = joined.json().data.roomRevision;
    const seated = await write(
      `/api/v1/rooms/${roomId}/my-seat`,
      { requestId: randomUUID(), expectedRoomRevision: revision, seatIndex: 1 },
      other,
    );
    revision = seated.json().data.roomRevision;
    for (const headers of [user, other]) {
      const ready = await write(
        `/api/v1/rooms/${roomId}/my-ready`,
        {
          requestId: randomUUID(),
          expectedRoomRevision: revision,
          ready: true,
        },
        headers,
      );
      expect(ready.statusCode).toBe(200);
      revision = ready.json().data.roomRevision;
    }
    const waitingDown = await write(gamePath, {
      requestId: randomUUID(),
      expectedRevision: (await game()).revision,
      enabled: false,
    });
    expect(waitingDown.statusCode).toBe(200);
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/start`,
      headers: user,
      payload: { requestId: randomUUID(), expectedRoomRevision: revision },
    });
    expect(blocked.json().error.code).toBe('GAME_VERSION_UNAVAILABLE');
    expect(
      (
        await write(gamePath, {
          requestId: randomUUID(),
          expectedRevision: waitingDown.json().data.revision,
          enabled: true,
        })
      ).statusCode,
    ).toBe(200);
    const started = await app.inject({
      method: 'POST',
      url: `/api/v1/rooms/${roomId}/start`,
      headers: user,
      payload: { requestId: randomUUID(), expectedRoomRevision: revision },
    });
    expect(started.statusCode).toBe(200);
    const matchId = started.json().data.matchId;
    const previous = (
      await read(`/api/v1/matches/${matchId}/view`, user)
    ).json().data;
    const input = {
      requestId: randomUUID(),
      expectedRevision: (await game()).revision,
      enabled: false,
    };
    const down = await write(gamePath, input);
    expect(down.statusCode).toBe(200);
    expect((await write(gamePath, input)).json().data).toEqual(
      down.json().data,
    );
    expect((await app.inject({ url: '/health/ready' })).statusCode).toBe(200);
    const catalog = await app.inject({ url: '/api/v1/games' });
    expect(catalog.statusCode).toBe(200);
    expect(
      catalog
        .json()
        .data.some((item: { id: string }) => item.id === 'color-match'),
    ).toBe(false);
    const newRoom = await app.inject({
      method: 'POST',
      url: '/api/v1/rooms',
      headers: other,
      payload: {
        requestId: randomUUID(),
        name: '新房间',
        gameId: 'color-match',
        version: '1.0.0',
        options: {},
        seatCount: 2,
      },
    });
    expect(newRoom.json().error.code).toBe('GAME_VERSION_UNAVAILABLE');
    expect(
      (await read(`/api/v1/matches/${matchId}/view`, user)).json().data,
    ).toEqual(previous);
    expect(
      (
        await write(gamePath, {
          requestId: randomUUID(),
          expectedRevision: input.expectedRevision,
          enabled: true,
        })
      ).json().error.code,
    ).toBe('STATE_CONFLICT');
    expect(
      (
        await write(gamePath, {
          requestId: randomUUID(),
          expectedRevision: down.json().data.revision,
          enabled: true,
        })
      ).statusCode,
    ).toBe(200);
  });
});
