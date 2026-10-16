import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import { AdminService } from '../../apps/api/src/admin/service.js';
import { coinWalletPageSchema } from '../../packages/protocol/src/index.js';

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

describe('independent boardgame coin wallet', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let admin: Headers, player: Headers, other: Headers;
  let aid: string, pid: string, oid: string;
  const command = (delta = 100, expectedRevision = 0) => ({
    requestId: randomUUID(),
    expectedRevision,
    delta,
    reason: '活动发放',
  });
  const path = () => `/api/v1/admin/accounts/${pid}/coins`;
  const read = (headers = player, query = '') =>
    app.inject({ url: `/api/v1/profile/coins${query}`, headers });
  const post = (payload: unknown, headers = admin, target = path()) =>
    app.inject({ method: 'POST', url: target, headers, payload });
  const wallet = async () => coinWalletPageSchema.parse((await read()).json().data);
  beforeAll(async () => {
    db = createDatabase(url);
    app = await createApp({
      db,
      registry: createRegistry(false),
      config: {
        NODE_ENV: 'test',
        DATABASE_URL: url,
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent',
      },
    });
  });
  afterAll(async () => {
    await app.close();
  });
  async function login(username: string): Promise<Headers> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'coin test password' },
    });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    return {
      cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
        .map((v) => v.split(';')[0])
        .join('; '),
      origin,
      'x-csrf-token': response.json().data.csrfToken,
    };
  }
  beforeEach(async () => {
    await db.query('TRUNCATE accounts CASCADE');
    aid = await createAccount(db, {
      username: 'coin_admin',
      displayName: '管理员',
      password: 'coin test password',
      role: 'administrator',
    });
    pid = await createAccount(db, {
      username: 'coin_player',
      displayName: '玩家',
      password: 'coin test password',
      role: 'user',
    });
    oid = await createAccount(db, {
      username: 'coin_other',
      displayName: '其他玩家',
      password: 'coin test password',
      role: 'user',
    });
    admin = await login('coin_admin');
    player = await login('coin_player');
    other = await login('coin_other');
  });

  it('starts at zero and protects privacy, role, Origin, CSRF and strict inputs', async () => {
    expect((await app.inject({ url: '/api/v1/profile/coins' })).statusCode).toBe(401);
    expect(await wallet()).toMatchObject({
      accountId: pid,
      balance: 0,
      revision: 0,
      entries: [],
      nextCursor: null,
    });
    expect((await read()).headers['cache-control']).toBe('no-store');
    expect((await read(player, `?accountId=${oid}`)).statusCode).toBe(400);
    expect((await app.inject({ url: path(), headers: player })).statusCode).toBe(403);
    expect((await post(command(), player)).statusCode).toBe(403);
    expect((await post(command(), { ...admin, origin: 'https://evil.example' })).statusCode).toBe(
      403,
    );
    expect((await post(command(), { ...admin, 'x-csrf-token': '' })).statusCode).toBe(403);
    for (const invalid of [0, 0.5, 1_000_000_001])
      expect((await post(command(invalid))).statusCode).toBe(400);
    expect((await post({ ...command(), reason: ' ' })).statusCode).toBe(400);
    expect((await post({ ...command(), accountId: oid })).statusCode).toBe(400);
    expect((await read(player, '?before=0')).statusCode).toBe(400);
    expect(
      (await post(command(), admin, `/api/v1/admin/accounts/${randomUUID()}/coins`)).statusCode,
    ).toBe(404);
    expect((await wallet()).entries).toHaveLength(0);
  });

  it('persists grants and deductions and replays the original success before revision checks', async () => {
    const first = command();
    const saved = await post(first);
    expect(saved.statusCode).toBe(200);
    expect((await post(command(-40, 1))).statusCode).toBe(200);
    expect((await post(first)).json().data).toEqual(saved.json().data);
    expect((await post({ ...first, delta: 101 })).json().error.code).toBe('REQUEST_ID_CONFLICT');
    expect(
      (await post(first, admin, `/api/v1/admin/accounts/${oid}/coins`)).json().error.code,
    ).toBe('REQUEST_ID_CONFLICT');
    const current = await wallet();
    expect(current).toMatchObject({ balance: 60, revision: 2 });
    expect(current.entries.map((e) => [e.delta, e.balanceAfter])).toEqual([
      [-40, 60],
      [100, 100],
    ]);
    expect((await read(other)).json().data).toMatchObject({ balance: 0, entries: [] });
    expect(JSON.stringify(current)).not.toMatch(/actor|requestId|token|session|password/);
  });

  it('rejects overdrafts, overflow and stale writes without changes', async () => {
    expect((await post(command(-1))).statusCode).toBe(422);
    expect((await post(command(1_000_000_000))).statusCode).toBe(200);
    expect((await post(command(1, 1))).statusCode).toBe(422);
    expect((await post(command(-1, 0))).json().error.code).toBe('STATE_CONFLICT');
    expect(await wallet()).toMatchObject({ balance: 1_000_000_000, revision: 1 });
    expect((await wallet()).entries).toHaveLength(1);
  });

  it('serializes competing first writes and concurrent identical retries', async () => {
    const first = command();
    const retries = await Promise.all([post(first), post(first)]);
    expect(retries.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(retries[0]!.json().data).toEqual(retries[1]!.json().data);
    const writes = await Promise.all([post(command(20, 1)), post(command(-30, 1))]);
    expect(writes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await wallet()).entries).toHaveLength(2);
    const concurrent = await Promise.all([
      post(command(20), admin, `/api/v1/admin/accounts/${oid}/coins`),
      post(command(30), admin, `/api/v1/admin/accounts/${oid}/coins`),
    ]);
    expect(concurrent.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('paginates stable ledger revisions without another account cursor leaking data', async () => {
    for (let i = 0; i < 22; i++) expect((await post(command(1, i))).statusCode).toBe(200);
    const first = await wallet();
    expect(first.entries).toHaveLength(20);
    expect(first.nextCursor).toBe(3);
    expect((await post(command(1, 22))).statusCode).toBe(200);
    const older = coinWalletPageSchema.parse((await read(player, '?before=3')).json().data);
    expect(older).toMatchObject({ balance: 23, revision: 23, nextCursor: null });
    expect(older.entries.map((e) => e.revision)).toEqual([2, 1]);
    expect((await read(other, '?before=3')).json().data.entries).toEqual([]);
  });

  it('rolls back balance, ledger and revision when receipt persistence fails', async () => {
    await db.query(`CREATE FUNCTION reject_coin_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test receipt fault'; END; $$;
      CREATE TRIGGER reject_coin_receipt BEFORE INSERT ON admin_command_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_coin_receipt_test();`);
    const input = command();
    try {
      expect((await post(input)).statusCode).toBe(500);
      expect(await wallet()).toMatchObject({ balance: 0, revision: 0, entries: [] });
    } finally {
      await db.query(
        'DROP TRIGGER reject_coin_receipt ON admin_command_receipts; DROP FUNCTION reject_coin_receipt_test()',
      );
    }
    expect((await post(input)).statusCode).toBe(200);
    expect((await wallet()).entries).toHaveLength(1);
  });

  it('revalidates a revoked administrator session inside the transaction', async () => {
    const session = (
      await db.query<{ id: string; token_hash: string; csrf_token_hash: string; expires_at: Date }>(
        'SELECT id,token_hash,csrf_token_hash,expires_at FROM sessions WHERE account_id=$1',
        [aid],
      )
    ).rows[0]!;
    await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [session.id]);
    const service = new AdminService(db, createRegistry(false), false);
    await expect(
      service.adjustCoins(
        {
          account: {
            id: aid,
            username: 'coin_admin',
            displayName: '管理员',
            role: 'administrator',
            status: 'active',
          },
          sessionId: session.id,
          tokenHash: session.token_hash,
          csrfHash: session.csrf_token_hash,
          expiresAt: session.expires_at,
        },
        pid,
        command(),
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(await wallet()).toMatchObject({ balance: 0, revision: 0, entries: [] });
  });
});
