import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { createAccount } from '../../apps/api/src/auth.js';
import type { ApiConfigInput } from '../../apps/api/src/config.js';
import type { MailMessage, SmtpCredentials } from '../../apps/api/src/mail-transport.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (
  !url ||
  !process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL).pathname
) {
  throw new Error('An isolated test database is required');
}
const origin = 'http://127.0.0.1:5173';
const secret = 'smtp-test-secret-never-return-this';
type Headers = { cookie: string; origin: string; 'x-csrf-token': string };

describe('administrator mail settings', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let admin: Headers;
  let user: Headers;
  let key: string;
  let fail: boolean;
  let ip = 0;
  const deliveries: { settings: SmtpCredentials; message: MailMessage }[] = [];
  const base = {
    enabled: true,
    host: 'smtp.example.com',
    port: 465,
    username: 'sender@example.com',
    from: 'sender@example.com',
  };
  const input = (overrides: Record<string, unknown> = {}) => ({
    ...base,
    expectedRevision: 0,
    requestId: randomUUID(),
    password: secret,
    ...overrides,
  });
  const put = (payload: unknown, headers = admin) =>
    app.inject({ method: 'PUT', url: '/api/v1/admin/mail-settings', headers, payload });
  const get = (headers = admin) => app.inject({ url: '/api/v1/admin/mail-settings', headers });
  const testMail = (payload: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/admin/mail-settings/test',
      headers: admin,
      payload,
    });
  const code = (email = `player${++ip}@example.test`) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/register/email-code',
      headers: { origin },
      payload: { email },
      remoteAddress: `192.0.2.${++ip}`,
    });

  async function start(extra: Partial<ApiConfigInput> = {}) {
    app = await createApp({
      db,
      registry: createRegistry(false),
      config: {
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        DATABASE_URL: url!,
        WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent',
        MODEL_CREDENTIALS_KEY: key,
        ...extra,
      },
      mailTransport: async (settings, message) => {
        deliveries.push({ settings, message });
        if (fail) throw new Error(`private-provider-error:${secret}`);
      },
    });
  }
  async function login(username: string): Promise<Headers> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password: 'mail management password' },
    });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers['set-cookie'];
    return {
      origin,
      cookie: (Array.isArray(cookies) ? cookies : [String(cookies)])
        .map((value) => value.split(';')[0])
        .join('; '),
      'x-csrf-token': response.json().data.csrfToken,
    };
  }
  async function restart(extra: Partial<ApiConfigInput> = {}) {
    await app.close();
    db = createDatabase(url!);
    await start(extra);
    admin = await login('mail_admin');
  }
  beforeEach(async () => {
    db = createDatabase(url!);
    await db.query('TRUNCATE accounts CASCADE');
    await db.query('TRUNCATE registration_mail_settings,registration_email_challenges');
    await db.query('UPDATE registration_mail_test_limit SET requested_at=NULL');
    key = randomBytes(32).toString('base64');
    fail = false;
    deliveries.length = 0;
    await createAccount(db, {
      username: 'mail_admin',
      displayName: '邮件管理员',
      password: 'mail management password',
      role: 'administrator',
    });
    await createAccount(db, {
      username: 'mail_user',
      displayName: '玩家',
      password: 'mail management password',
      role: 'user',
    });
    await start();
    admin = await login('mail_admin');
    user = await login('mail_user');
  });
  afterEach(async () => {
    await app.close();
  });

  it('requires administrator session, Origin, CSRF and strict input', async () => {
    expect((await app.inject({ url: '/api/v1/admin/mail-settings' })).statusCode).toBe(401);
    expect((await get(user)).statusCode).toBe(403);
    expect((await put(input(), user)).statusCode).toBe(403);
    expect((await put(input(), { ...admin, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await put(input(), { ...admin, 'x-csrf-token': '' })).statusCode).toBe(403);
    for (const invalid of [
      { port: 25 },
      { host: 'http://localhost/path' },
      { role: 'administrator' },
      { password: '', clearPassword: true },
    ]) {
      expect((await put(input(invalid))).statusCode).toBe(400);
    }
    expect((await db.query('SELECT * FROM registration_mail_settings')).rowCount).toBe(0);
  });
  it('encrypts the credential, redacts reads and receipts, and survives a restart', async () => {
    const saved = await put(input());
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({
      revision: 1,
      configured: true,
      source: 'database',
      hasPassword: true,
    });
    expect(saved.headers['cache-control']).toBe('no-store');
    const read = await get();
    expect(read.body).not.toContain(secret);
    expect(read.body).not.toMatch(/ciphertext|nonce|password_tag|"password"/);
    const stored = (await db.query('SELECT * FROM registration_mail_settings')).rows[0];
    expect(Buffer.isBuffer(stored.password_ciphertext)).toBe(true);
    expect(stored.password_ciphertext.toString('utf8')).not.toContain(secret);
    const receipts = await db.query('SELECT input,result FROM admin_command_receipts');
    expect(JSON.stringify(receipts.rows)).not.toContain(secret);
    expect(JSON.stringify(receipts.rows)).not.toMatch(/ciphertext|nonce|password_tag/);
    await restart();
    expect((await code()).statusCode).toBe(200);
    expect(deliveries[0]?.settings.password).toBe(secret);
  });
  it('deduplicates saves, rejects conflicting retries and stale revisions, and retains blank passwords', async () => {
    const original = input();
    expect((await put(original)).statusCode).toBe(200);
    expect((await put(original)).json().data.revision).toBe(1);
    expect((await put({ ...original, password: 'different-secret' })).statusCode).toBe(409);
    expect((await put(input())).statusCode).toBe(409);
    expect(
      (await put(input({ expectedRevision: 1, password: undefined }))).json().data.revision,
    ).toBe(2);
    expect((await code()).statusCode).toBe(200);
    expect(deliveries[0]?.settings.password).toBe(secret);
    expect(
      (await put(input({ expectedRevision: 2, password: undefined, host: 'changed.example.com' })))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await put(
          input({
            expectedRevision: 2,
            host: 'changed.example.com',
            password: 'replacement-secret',
          }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await code()).statusCode).toBe(200);
    expect(deliveries[1]?.settings).toMatchObject({
      host: 'changed.example.com',
      password: 'replacement-secret',
    });
  });
  it('applies settings immediately and fails closed after disabling or clearing a saved credential', async () => {
    expect((await code()).statusCode).toBe(503);
    expect((await put(input())).statusCode).toBe(200);
    expect((await code()).statusCode).toBe(200);
    expect(
      (
        await put(
          input({ expectedRevision: 1, enabled: false, password: undefined, clearPassword: true }),
        )
      ).statusCode,
    ).toBe(200);
    expect((await get()).json().data).toMatchObject({
      hasPassword: false,
      configured: false,
      enabled: false,
    });
    expect((await code()).statusCode).toBe(503);
    expect((await put(input({ expectedRevision: 2, password: undefined }))).statusCode).toBe(400);
    expect(deliveries).toHaveLength(1);
  });
  it('sends each test request once, persists its result and rate limits new requests', async () => {
    await put(input());
    const test = { requestId: randomUUID(), expectedRevision: 1, email: 'test@example.com' };
    const results = await Promise.all([testMail(test), testMail(test)]);
    expect(results.every((result) => result.statusCode === 200)).toBe(true);
    expect((await testMail(test)).json().data.status).toBe('sent');
    expect(deliveries).toHaveLength(1);
    expect((await testMail({ ...test, email: 'other@example.com' })).statusCode).toBe(409);
    expect((await testMail({ ...test, requestId: randomUUID() })).statusCode).toBe(429);
    await db.query(
      "UPDATE registration_mail_test_limit SET requested_at=now()-interval '61 seconds'",
    );
    expect(
      (await testMail({ ...test, requestId: randomUUID(), expectedRevision: 0 })).statusCode,
    ).toBe(409);
    expect((await testMail({ ...test, requestId: randomUUID() })).json().data.status).toBe('sent');
    expect(deliveries).toHaveLength(2);
  });
  it('records test failures without retrying delivery or leaking provider errors', async () => {
    await put(input());
    fail = true;
    const test = { requestId: randomUUID(), expectedRevision: 1, email: 'test@example.com' };
    const response = await testMail(test);
    expect(response.json().data.status).toBe('failed');
    expect(response.body).not.toContain(secret);
    expect(response.body).not.toContain('private-provider');
    expect((await testMail(test)).json().data.status).toBe('failed');
    expect(deliveries).toHaveLength(1);
  });
  it('supports environment fallback but never resurrects it after a database override', async () => {
    await restart({
      SMTP_HOST: base.host,
      SMTP_PORT: 465,
      SMTP_SECURE: true,
      SMTP_USER: base.username,
      SMTP_PASSWORD: secret,
      SMTP_FROM: base.from,
    });
    expect((await get()).json().data).toMatchObject({
      source: 'environment',
      configured: true,
      revision: 0,
    });
    expect((await code()).statusCode).toBe(200);
    expect(
      (await put(input({ enabled: false, password: undefined, clearPassword: true }))).statusCode,
    ).toBe(200);
    expect((await code()).statusCode).toBe(503);
    expect(deliveries).toHaveLength(1);
  });
  it('rejects missing or incorrect encryption keys without exposing the saved credential', async () => {
    await restart({ MODEL_CREDENTIALS_KEY: undefined });
    expect((await get()).json().data.encryptionAvailable).toBe(false);
    expect((await put(input())).statusCode).toBe(503);
    expect((await db.query('SELECT * FROM registration_mail_settings')).rowCount).toBe(0);
    await restart();
    expect((await put(input())).statusCode).toBe(200);
    await restart({ MODEL_CREDENTIALS_KEY: randomBytes(32).toString('base64') });
    const response = await code();
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain(secret);
    expect(deliveries).toHaveLength(0);
  });
});
