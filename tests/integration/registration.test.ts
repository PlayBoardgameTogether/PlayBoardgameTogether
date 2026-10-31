import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount, verifyPassword } from '../../apps/api/src/auth.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL).pathname
)
  throw new Error('An isolated test database is required');
const origin = 'http://127.0.0.1:5173';
const input = {
  displayName: '注册玩家',
  userId: '@RST307',
  password: 'Abc307',
  email: 'rst307@example.test',
  emailCode: '',
  challengeId: '',
};

describe('public account registration', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let ip = 0;
  const mails = new Map<string, string>();
  let mailFailure = false;
  const issue = async (email = input.email) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email-code',
      headers: { origin },
      payload: { email },
      remoteAddress: `198.51.100.${++ip}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).not.toContain(mails.get(email));
    return { email, emailCode: mails.get(email)!, challengeId: response.json().data.challengeId };
  };
  const register = (payload: unknown = input, remoteAddress = `192.0.2.${++ip}`) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin },
      payload,
      remoteAddress,
    });
  beforeEach(async () => {
    db = createDatabase(url);
    // Clear fixtures before starting the scheduler so its recovery queries
    // cannot race TRUNCATE's locks on accounts and dependent tables.
    await db.query('TRUNCATE accounts CASCADE');
    await db.query('TRUNCATE registration_email_challenges');
    mails.clear();
    mailFailure = false;
    app = await createApp({
      db,
      registry: createRegistry(false),
      registrationMailer: async (email, code) => {
        if (mailFailure) throw new Error('private mail provider failure');
        mails.set(email, code);
      },
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
    Object.assign(input, await issue());
  });
  afterEach(async () => {
    await app.close();
  });

  it('persists a normal account with exact ID and Argon2id password, then logs in with @', async () => {
    const response = await register();
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.json().data).toEqual({
      username: 'rst307',
      displayName: '注册玩家',
      friendId: 'rst307',
    });
    expect(response.body).not.toMatch(/password|hash|token/);
    const row = (await db.query('SELECT * FROM accounts')).rows[0];
    expect(row).toMatchObject({
      username_canonical: 'rst307',
      friend_id: 'rst307',
      role: 'user',
      status: 'active',
    });
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.email_canonical).toBe(input.email);
    expect(row.email_verified_at).toBeInstanceOf(Date);
    expect(
      (await db.query('SELECT sent_at FROM registration_email_challenges')).rows[0].sent_at,
    ).toBeNull();
    expect(await verifyPassword(row.password_hash, input.password)).toBe(true);
    expect((await db.query('SELECT * FROM sessions')).rowCount).toBe(0);
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username: '@RST307', password: input.password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.account.role).toBe('user');
    const raw = login.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [String(raw)])
      .map((value) => value.split(';')[0])
      .join('; ');
    expect((await app.inject({ url: '/api/v1/auth/me', headers: { cookie } })).statusCode).toBe(
      200,
    );
    expect(
      (await app.inject({ url: '/api/v1/social', headers: { cookie } })).json().data.identity
        .friendId,
    ).toBe('rst307');
  });
  it('rejects concurrent case-insensitive duplicates without creating a second account', async () => {
    const other = await issue('other@example.test');
    const results = await Promise.all([
      register(),
      register({ ...input, ...other, userId: 'rst307' }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.statusCode === 409)!.json().error.code).toBe(
      'STATE_CONFLICT',
    );
    expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(1);
  });
  it('does not silently rename an ID already used as another account friend ID', async () => {
    const id = await createAccount(db, {
      username: 'other_user',
      displayName: '已有账户',
      password: 'LongPassword307!',
      role: 'user',
    });
    await db.query('UPDATE accounts SET friend_id=$2 WHERE id=$1', [id, 'rst307']);
    expect((await register()).statusCode).toBe(409);
    expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(1);
  });
  it('rejects foreign origins, weak passwords and privilege injection before writing', async () => {
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: input }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          headers: { origin: 'https://invalid.example' },
          payload: input,
        })
      ).statusCode,
    ).toBe(403);
    for (const payload of [
      { ...input, password: 'OnlyLettersHere' },
      { ...input, password: '123456789012' },
      { ...input, password: 'Ab307' },
      { ...input, password: 'A1' + 'x'.repeat(127) },
      { ...input, role: 'administrator' },
      { ...input, userId: '@@rst307' },
      { ...input, displayName: '  ' },
    ]) {
      const response = await register(payload);
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(input.password);
    }
    expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(0);
  });
  it('rate limits registration attempts including successful registrations', async () => {
    for (let index = 0; index < 5; index++) {
      const code = await issue(`rate${index}@example.test`);
      expect(
        (await register({ ...input, ...code, userId: `rate_${index}` }, '203.0.113.1')).statusCode,
      ).toBe(201);
    }
    const response = await register({ ...input, userId: 'rate_extra' }, '203.0.113.1');
    expect(response.statusCode).toBe(429);
    expect(response.headers['retry-after']).toBe('60');
    expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(5);
  });
  it('rolls back a failing database insert and permits a clean retry', async () => {
    await db.query(`CREATE FUNCTION registration_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'registration test failure'; END; $$`);
    await db.query(
      'CREATE TRIGGER registration_test_failure BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION registration_test_failure()',
    );
    try {
      const response = await register();
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('registration test failure');
      expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(0);
    } finally {
      await db.query('DROP TRIGGER registration_test_failure ON accounts');
      await db.query('DROP FUNCTION registration_test_failure()');
    }
    expect((await register()).statusCode).toBe(201);
  });
  it('supports the maximum 32-character ID with an @ login prefix', async () => {
    const userId = 'a'.repeat(32);
    expect((await register({ ...input, userId: `@${userId}` })).statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin },
          payload: { username: `@${userId}`, password: input.password },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('requires a delivered, matching code and never creates an unverified account', async () => {
    expect(
      (
        await register({
          displayName: input.displayName,
          userId: input.userId,
          password: input.password,
        })
      ).statusCode,
    ).toBe(400);
    expect((await register({ ...input, email: 'wrong@example.test' })).statusCode).toBe(400);
    const row = (
      await db.query('SELECT code_hash FROM registration_email_challenges WHERE id=$1', [
        input.challengeId,
      ])
    ).rows[0];
    expect(row.code_hash).not.toContain(input.emailCode);
    expect(row.code_hash).toMatch(/^\$argon2id\$/);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { origin },
          payload: { username: input.userId, password: input.password },
        })
      ).statusCode,
    ).toBe(401);
    expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(0);
  });
  it('persists failed attempts and rejects expired or exhausted codes', async () => {
    const wrong = input.emailCode === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await register({ ...input, emailCode: wrong })).statusCode).toBe(400);
    }
    expect((await register()).statusCode).toBe(400);
    expect(
      (
        await db.query('SELECT attempts FROM registration_email_challenges WHERE id=$1', [
          input.challengeId,
        ])
      ).rows[0].attempts,
    ).toBe(5);
    await db.query(
      "UPDATE registration_email_challenges SET attempts=0,expires_at=now()-interval '1 second'",
    );
    expect((await register()).statusCode).toBe(400);
  });
  it('serializes replay and enforces unique verified email addresses', async () => {
    const results = await Promise.all([register(), register({ ...input, userId: 'replay_other' })]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 400]);
    await db.query(
      "UPDATE registration_email_challenges SET requested_at=now()-interval '61 seconds'",
    );
    const next = await issue();
    expect((await register({ ...input, ...next, userId: 'email_other' })).statusCode).toBe(409);
    expect((await db.query('SELECT * FROM accounts')).rowCount).toBe(1);
  });
  it('limits resends, invalidates old codes and retains the hourly budget', async () => {
    const resend = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/register/email-code',
        headers: { origin },
        payload: { email: input.email },
        remoteAddress: `198.51.100.${++ip}`,
      });
    expect((await resend()).statusCode).toBe(429);
    for (let index = 0; index < 4; index++) {
      await db.query(
        "UPDATE registration_email_challenges SET requested_at=now()-interval '61 seconds'",
      );
      expect((await resend()).statusCode).toBe(200);
    }
    expect((await register()).statusCode).toBe(400);
    await db.query(
      "UPDATE registration_email_challenges SET requested_at=now()-interval '61 seconds'",
    );
    expect((await resend()).statusCode).toBe(429);
    const challenge = (await db.query('SELECT id FROM registration_email_challenges')).rows[0];
    expect(
      (await register({ ...input, challengeId: challenge.id, emailCode: mails.get(input.email)! }))
        .statusCode,
    ).toBe(201);
    await db.query(
      "UPDATE registration_email_challenges SET requested_at=now()-interval '61 seconds'",
    );
    expect((await resend()).statusCode).toBe(429);
  });
  it('does not accept a code after delivery failure or leak mail provider errors', async () => {
    mailFailure = true;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email-code',
      headers: { origin },
      payload: { email: 'failed@example.test' },
      remoteAddress: `198.51.100.${++ip}`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private mail provider');
    const row = (
      await db.query(
        "SELECT * FROM registration_email_challenges WHERE email_canonical='failed@example.test'",
      )
    ).rows[0];
    expect(row.sent_at).toBeNull();
    expect(
      (await register({ ...input, email: 'failed@example.test', challengeId: row.id })).statusCode,
    ).toBe(400);
  });
});
