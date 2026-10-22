import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { gameSubmissionPageSchema, gameSubmissionSchema } from '../../packages/protocol/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount, type AuthContext } from '../../apps/api/src/auth.js';
import { GameSubmissionService } from '../../apps/api/src/catalog/submissions.js';

process.loadEnvFile('.env');
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || testUrl === process.env.DATABASE_URL || new URL(testUrl).pathname === new URL(process.env.DATABASE_URL!).pathname) {
  throw new Error('An isolated test database is required');
}
const origin = 'http://127.0.0.1:5173';
const endpoint = '/api/v1/game-submissions';
const adminEndpoint = '/api/v1/admin/game-submissions';
const input = () => ({ requestId: randomUUID(), gameId: 'new-game', version: '1.0.0', name: '新游戏', description: '两人轮流行动', repositoryUrl: 'https://github.com/example/new-game' });
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

describe('inert game application security', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let user: Headers, other: Headers, admin: Headers;
  let userId: string;
  afterEach(async () => { await app.close(); });
  async function login(username: string): Promise<Headers> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password: 'submission test password' } });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    return { cookie: (Array.isArray(cookies) ? cookies : [String(cookies)]).map(value => value.split(';')[0]).join('; '), origin, 'x-csrf-token': String(response.json().data.csrfToken) };
  }
  beforeEach(async () => {
    db = createDatabase(testUrl);
    await db.query('TRUNCATE accounts CASCADE');
    userId = await createAccount(db, { username: 'submission_user', displayName: '申请人', password: 'submission test password', role: 'user' });
    await createAccount(db, { username: 'submission_other', displayName: '其他用户', password: 'submission test password', role: 'user' });
    await createAccount(db, { username: 'submission_admin', displayName: '管理员', password: 'submission test password', role: 'administrator' });
    app = await createApp({
      db,
      registry: createRegistry(false),
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        DATABASE_URL: testUrl,
        WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent',
      },
    });
    user = await login('submission_user'); other = await login('submission_other'); admin = await login('submission_admin');
  });
  const submit = (payload = input(), headers = user) => app.inject({ method: 'POST', url: endpoint, headers, payload });

  it('persists metadata without installing games, fetching repositories or exposing identity data', async () => {
    const before = (await db.query('SELECT * FROM game_installations ORDER BY game_id,game_version')).rows;
    const reply = await submit();
    expect(reply.statusCode).toBe(200);
    const saved = gameSubmissionSchema.parse(reply.json().data);
    expect(saved).toMatchObject({ status: 'pending', revision: 1, reviewNote: null });
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.body).not.toMatch(/account_id|accountId|reviewed_by|session|token|requestId/);
    const restored = await new GameSubmissionService(db).get(userId, saved.id);
    expect(restored).toEqual(saved);
    const read = await app.inject({ url: `${endpoint}/${saved.id}`, headers: user });
    expect(read.statusCode).toBe(200);
    expect((await db.query('SELECT * FROM game_installations ORDER BY game_id,game_version')).rows).toEqual(before);
    expect((await app.inject({ url: '/api/v1/games' })).body).not.toContain('new-game');
  });

  it('requires authentication, origin and CSRF and rejects revoked sessions', async () => {
    expect((await submit(input(), { origin } as Headers)).statusCode).toBe(401);
    expect((await submit(input(), { ...user, 'x-csrf-token': '' })).statusCode).toBe(403);
    expect((await submit(input(), { ...user, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await app.inject({ url: endpoint })).statusCode).toBe(401);
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: user });
    expect((await submit()).statusCode).toBe(401);
    expect((await db.query('SELECT count(*)::int AS count FROM game_submissions')).rows[0]?.count).toBe(0);
  });

  it('isolates owner reads and cursor lookups and requires administrator for reviews', async () => {
    const id = (await submit()).json().data.id;
    expect((await app.inject({ url: `${endpoint}/${id}`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ url: `${endpoint}/${randomUUID()}`, headers: other })).statusCode).toBe(404);
    expect(gameSubmissionPageSchema.parse((await app.inject({ url: endpoint, headers: other })).json().data).items).toEqual([]);
    expect((await app.inject({ url: `${endpoint}?before=${id}`, headers: other })).json().data.items).toEqual([]);
    expect((await app.inject({ url: adminEndpoint, headers: user })).statusCode).toBe(403);
    expect((await app.inject({ url: `${adminEndpoint}/${id}`, headers: admin })).statusCode).toBe(200);
    const review = { requestId: randomUUID(), expectedRevision: 1, status: 'reviewed', reviewNote: '资料审核完成，尚未安装。' };
    expect((await app.inject({ method: 'POST', url: `${adminEndpoint}/${id}/review`, headers: user, payload: review })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${adminEndpoint}/${id}/review`, headers: { ...admin, 'x-csrf-token': '' }, payload: review })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `${adminEndpoint}/${id}/review`, headers: { ...admin, origin: 'https://evil.example' }, payload: review })).statusCode).toBe(403);
  });

  it('rejects payloads that could introduce executable code or unsafe addresses', async () => {
    for (const extra of [{ code: 'process.exit()' }, { serverEntry: '../../virus.js' }, { archive: 'UEsDBA==' }, { accountId: userId }, { status: 'reviewed' }]) {
      expect((await submit({ ...input(), ...extra })).statusCode).toBe(400);
    }
    for (const repositoryUrl of ['https://127.0.0.1/virus', 'https://github.com.evil.test/a/b', 'https://github.com/a/b?token=private', 'file:///virus']) {
      expect((await submit({ ...input(), repositoryUrl })).statusCode).toBe(400);
    }
    expect((await submit({ ...input(), description: '<script>alert(1)</script>' })).statusCode).toBe(400);
    const oversized = await app.inject({ method: 'POST', url: endpoint, headers: { ...user, 'content-type': 'application/json' }, payload: JSON.stringify({ ...input(), description: 'x'.repeat(9000) }) });
    expect(oversized.statusCode).toBe(413);
    const binary = await app.inject({ method: 'POST', url: endpoint, headers: { ...user, 'content-type': 'application/octet-stream' }, payload: Buffer.from('MZvirus') });
    expect(binary.statusCode).toBe(415);
    const malformed = await app.inject({ method: 'POST', url: endpoint, headers: { ...user, 'content-type': 'application/json' }, payload: '{broken' });
    expect(malformed.statusCode).toBe(400);
    expect((await db.query('SELECT count(*)::int AS count FROM game_submissions')).rows[0]?.count).toBe(0);
  });

  it('deduplicates concurrent retries before quota checks and detects request ID conflicts', async () => {
    const payload = input();
    const results = await Promise.all([submit(payload), submit(payload)]);
    expect(results.map(result => result.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json().data).toEqual(results[1]!.json().data);
    expect((await submit({ ...payload, name: '另一申请' })).json().error.code).toBe('REQUEST_ID_CONFLICT');
    await submit(); await submit();
    expect((await submit()).statusCode).toBe(429);
    expect((await submit(payload)).statusCode).toBe(200);
    expect((await db.query('SELECT count(*)::int AS count FROM game_submissions')).rows[0]?.count).toBe(3);
  });

  it('enforces concurrent pending and durable daily limits', async () => {
    const replies = await Promise.all(Array.from({ length: 5 }, () => submit()));
    expect(replies.filter(reply => reply.statusCode === 200)).toHaveLength(3);
    expect(replies.filter(reply => reply.statusCode === 429)).toHaveLength(2);
    for (const reply of replies.filter(item => item.statusCode === 200)) {
      expect((await app.inject({ method: 'POST', url: `${adminEndpoint}/${reply.json().data.id}/review`, headers: admin, payload: { requestId: randomUUID(), expectedRevision: 1, status: 'rejected', reviewNote: '需补充资料' } })).statusCode).toBe(200);
    }
    await submit(); await submit();
    expect((await submit()).statusCode).toBe(429);
  });

  it('serializes reviews, deduplicates the winning review and never activates executable code', async () => {
    const id = (await submit()).json().data.id;
    const payload = { requestId: randomUUID(), expectedRevision: 1, status: 'reviewed', reviewNote: '资料审阅完成，需另行安全审核源码。' };
    const review = (body: typeof payload) => app.inject({ method: 'POST', url: `${adminEndpoint}/${id}/review`, headers: admin, payload: body });
    const results = await Promise.all([review(payload), review({ ...payload, requestId: randomUUID(), status: 'rejected' })]);
    expect(results.map(result => result.statusCode).sort()).toEqual([200, 409]);
    // A separate application exercises same-ID retries independent of which competing review won.
    const secondId = (await submit()).json().data.id;
    const first = await app.inject({ method: 'POST', url: `${adminEndpoint}/${secondId}/review`, headers: admin, payload });
    const retry = await app.inject({ method: 'POST', url: `${adminEndpoint}/${secondId}/review`, headers: admin, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data).toEqual(first.json().data);
    const conflict = await app.inject({ method: 'POST', url: `${adminEndpoint}/${secondId}/review`, headers: admin, payload: { ...payload, reviewNote: '不同内容' } });
    expect(conflict.json().error.code).toBe('REQUEST_ID_CONFLICT');
    expect(gameSubmissionSchema.parse(first.json().data)).toMatchObject({ revision: 2, status: 'reviewed' });
    expect((await app.inject({ url: '/api/v1/games' })).body).not.toContain('new-game');
  });

  it('rechecks session and administrator role inside the write transaction', async () => {
    const row = (await db.query<{ id: string; token_hash: string; csrf_token_hash: string; expires_at: Date }>('SELECT * FROM sessions WHERE account_id=$1', [userId])).rows[0]!;
    const context: AuthContext = { sessionId: row.id, tokenHash: row.token_hash, csrfHash: row.csrf_token_hash, expiresAt: row.expires_at, account: { id: userId, username: 'submission_user', displayName: '申请人', role: 'administrator', status: 'active' } };
    const service = new GameSubmissionService(db);
    const created = await service.submit(context, input());
    await expect(service.review(context, created.id, { requestId: randomUUID(), expectedRevision: 1, status: 'reviewed', reviewNote: '越权' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await db.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [row.id]);
    await expect(service.submit(context, input())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await db.query('SELECT count(*)::int AS count FROM game_submissions')).rows[0]?.count).toBe(1);
  });

  it('rolls back failed persistence and allows retry with the same ID', async () => {
    const payload = input();
    await db.query(`CREATE FUNCTION fail_submission_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated persistence failure'; END $$`);
    await db.query('CREATE TRIGGER fail_submission_insert AFTER INSERT ON game_submissions FOR EACH ROW EXECUTE FUNCTION fail_submission_insert()');
    try {
      expect((await submit(payload)).statusCode).toBe(500);
      expect((await db.query('SELECT count(*)::int AS count FROM game_submissions')).rows[0]?.count).toBe(0);
    } finally {
      await db.query('DROP TRIGGER fail_submission_insert ON game_submissions');
      await db.query('DROP FUNCTION fail_submission_insert()');
    }
    expect((await submit(payload)).statusCode).toBe(200);
  });

  it('paginates tied timestamps without duplicates and enforces lifetime/global storage ceilings', async () => {
    const seed = async (accountId: string, count: number) => db.query(`
      INSERT INTO game_submissions(id,account_id,request_id,input,created_at)
      SELECT gen_random_uuid(),$1,gen_random_uuid(),$2::jsonb,now()-interval '2 days'
      FROM generate_series(1,$3::int)`, [accountId, JSON.stringify(input()), count]);
    await seed(userId, 25);
    const first = gameSubmissionPageSchema.parse((await app.inject({ url: endpoint, headers: user })).json().data);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = gameSubmissionPageSchema.parse((await app.inject({ url: `${endpoint}?before=${first.nextCursor}`, headers: user })).json().data);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(25);
    await seed(userId, 75);
    // Review fixture rows to isolate the lifetime ceiling from pending/day limits.
    const reviewInput = { requestId: randomUUID(), expectedRevision: 1, status: 'rejected', reviewNote: '已归档资料' };
    await db.query(`UPDATE game_submissions SET status='rejected',revision=2,review_note=$2,reviewed_by=$1,
      review_input=$3,reviewed_at=now()`, [userId, reviewInput.reviewNote, JSON.stringify(reviewInput)]);
    expect((await submit()).statusCode).toBe(429);
    await seed(userId, 9900);
    expect((await submit(input(), other)).statusCode).toBe(429);
  });

  it('bounds unauthenticated request attempts and does not trust forwarded IP headers', async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await app.inject({ url: endpoint, remoteAddress: '203.0.113.8', headers: { 'x-forwarded-for': `198.51.100.${attempt % 255}` } });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({ url: endpoint, remoteAddress: '203.0.113.8' });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.headers['cache-control']).toBe('no-store');
  });
});
