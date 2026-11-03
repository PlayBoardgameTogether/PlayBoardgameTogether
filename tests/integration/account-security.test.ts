import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase, type Database } from '../../apps/api/src/db/index.js';
import { normalizeConfig } from '../../apps/api/src/config.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { AuthService, createAccount, verifyPassword } from '../../apps/api/src/auth.js';

process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL!;
if (
  !url ||
  !process.env.DATABASE_URL ||
  new URL(url).pathname === new URL(process.env.DATABASE_URL).pathname
)
  throw new Error('An isolated test database is required');
const origin = 'http://127.0.0.1:5173';
const oldPassword = 'OldPassword307!';
const newPassword = 'NewPassword308!';
type Identity = { cookie: string; 'x-csrf-token': string; origin: string };

describe('private account security', () => {
  let db: Database;
  let app: Awaited<ReturnType<typeof createApp>>;
  let id: string;
  let user: Identity;
  const mails = new Map<string, string>();
  let failMail = false;
  async function login(username = 'security_user', password = oldPassword) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin },
      payload: { username, password },
    });
  }
  function identity(response: Awaited<ReturnType<typeof login>>): Identity {
    const raw = response.headers['set-cookie'];
    return {
      origin,
      cookie: (Array.isArray(raw) ? raw : [String(raw)]).map((v) => v.split(';')[0]).join('; '),
      'x-csrf-token': response.json().data.csrfToken,
    };
  }
  const write = (path: string, payload: unknown, headers = user, method: 'POST' | 'PUT' = 'POST') =>
    app.inject({ method, url: `/api/v1/${path}`, headers, payload });
  const me = (headers = user) => app.inject({ url: '/api/v1/auth/me', headers });
  async function binding(email = 'new@example.test', headers = user) {
    const result = await write(
      'account/security/email-code',
      { email, currentPassword: oldPassword },
      headers,
    );
    expect(result.statusCode).toBe(200);
    expect(result.body).not.toContain(mails.get(email));
    return {
      email,
      currentPassword: oldPassword,
      emailCode: mails.get(email)!,
      challengeId: result.json().data.challengeId,
    };
  }
  beforeEach(async () => {
    db = createDatabase(url);
    await db.query('TRUNCATE accounts CASCADE');
    await db.query('TRUNCATE account_security_mail_limits');
    mails.clear();
    failMail = false;
    id = await createAccount(db, {
      username: 'security_user',
      displayName: '安全玩家',
      password: oldPassword,
      role: 'user',
    });
    app = await createApp({
      db,
      registry: createRegistry(false),
      registrationMailer: async (email, code) => {
        if (failMail) throw new Error('private provider secret');
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
    user = identity(await login());
  });
  afterEach(async () => {
    await app.close();
  });

  it('protects private status and writes with session, Origin, CSRF and strict input', async () => {
    expect((await app.inject({ url: '/api/v1/account/security' })).statusCode).toBe(401);
    const response = await app.inject({ url: '/api/v1/account/security', headers: user });
    expect(response.json().data).toEqual({ email: null, emailVerifiedAt: null, activeSessions: 1 });
    expect(response.headers['cache-control']).toBe('no-store');
    const payload = { currentPassword: oldPassword, newPassword };
    expect(
      (
        await write(
          'account/security/password',
          payload,
          { ...user, origin: 'https://evil.test' },
          'PUT',
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await write('account/security/password', payload, { ...user, 'x-csrf-token': '' }, 'PUT'))
        .statusCode,
    ).toBe(403);
    expect(
      (await write('account/security/password', { ...payload, accountId: id }, user, 'PUT'))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await write(
          'account/security/password',
          { ...payload, currentPassword: 'wrong' },
          user,
          'PUT',
        )
      ).statusCode,
    ).toBe(401);
    expect(
      (await write('account/security/password', { ...payload, newPassword: 'Abc123' }, user, 'PUT'))
        .statusCode,
    ).toBe(400);
    expect((await me()).statusCode).toBe(200);
  });

  it('changes user and administrator passwords and revokes every session atomically', async () => {
    for (const role of ['user', 'administrator'] as const) {
      await db.query('UPDATE accounts SET role=$2 WHERE id=$1', [id, role]);
      user = identity(await login());
      const other = identity(await login());
      const response = await write(
        'account/security/password',
        { currentPassword: oldPassword, newPassword },
        user,
        'PUT',
      );
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toMatch(/password|hash|token/);
      expect(response.headers['set-cookie']).toBeDefined();
      expect((await me()).statusCode).toBe(401);
      expect((await me(other)).statusCode).toBe(401);
      expect((await login()).statusCode).toBe(401);
      expect((await login('security_user', newPassword)).statusCode).toBe(200);
      // Restore only this fixture through the real authenticated path.
      const current = identity(await login('security_user', newPassword));
      expect(
        (
          await write(
            'account/security/password',
            { currentPassword: newPassword, newPassword: oldPassword },
            current,
            'PUT',
          )
        ).statusCode,
      ).toBe(200);
    }
  });

  it('revokes other devices while preserving the current authenticated session', async () => {
    const other = identity(await login());
    const response = await write('account/security/revoke-others', {
      currentPassword: oldPassword,
    });
    expect(response.json().data).toEqual({ revoked: 1 });
    expect((await me()).statusCode).toBe(200);
    expect((await me(other)).statusCode).toBe(401);
    expect(
      (await write('account/security/revoke-others', { currentPassword: oldPassword })).json().data
        .revoked,
    ).toBe(0);
  });

  it('binds and replaces verified email privately, consuming codes and revoking sessions', async () => {
    const first = await binding();
    expect((await write('account/security/email', first, user, 'PUT')).statusCode).toBe(200);
    expect((await me()).statusCode).toBe(401);
    user = identity(await login());
    const status = await app.inject({ url: '/api/v1/account/security', headers: user });
    expect(status.json().data.email).toBe(first.email);
    expect(status.json().data.emailVerifiedAt).toBeTruthy();
    expect((await me()).body).not.toContain(first.email);
    expect((await write('account/security/email', first, user, 'PUT')).statusCode).toBe(400);
    await db.query(
      "UPDATE account_security_mail_limits SET requested_at=now()-interval '61 seconds'",
    );
    const second = await binding('replacement@example.test');
    expect((await write('account/security/email', second, user, 'PUT')).statusCode).toBe(200);
    expect(
      (await db.query('SELECT email_canonical FROM accounts WHERE id=$1', [id])).rows[0]
        .email_canonical,
    ).toBe(second.email);
  });

  it('persists wrong-code attempts, rejects expired/wrong-purpose codes and enforces cooldown', async () => {
    const input = await binding();
    expect(
      (
        await write('account/security/email-code', {
          email: input.email,
          currentPassword: oldPassword,
        })
      ).statusCode,
    ).toBe(429);
    const wrong = input.emailCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      expect(
        (await write('account/security/email', { ...input, emailCode: wrong }, user, 'PUT'))
          .statusCode,
      ).toBe(400);
    expect(
      (await db.query('SELECT attempts FROM account_security_challenges')).rows[0].attempts,
    ).toBe(5);
    expect((await write('account/security/email', input, user, 'PUT')).statusCode).toBe(400);
    await db.query(
      "UPDATE account_security_challenges SET attempts=0,expires_at=now()-interval '1 second'",
    );
    expect((await write('account/security/email', input, user, 'PUT')).statusCode).toBe(400);
    const recovery = {
      username: 'security_user',
      email: input.email,
      challengeId: input.challengeId,
      emailCode: input.emailCode,
      newPassword,
    };
    expect((await write('auth/recovery', recovery)).statusCode).toBe(400);
    expect((await me()).statusCode).toBe(200);
  });

  it('rolls back email, code consumption and revocation on database failure or uniqueness conflict', async () => {
    const input = await binding();
    const otherId = await createAccount(db, {
      username: 'security_other',
      displayName: '其他人',
      password: oldPassword,
      role: 'user',
    });
    await db.query('UPDATE accounts SET email_canonical=$2,email_verified_at=now() WHERE id=$1', [
      otherId,
      input.email,
    ]);
    expect((await write('account/security/email', input, user, 'PUT')).statusCode).toBe(409);
    expect((await me()).statusCode).toBe(200);
    expect(
      (await db.query('SELECT sent_at FROM account_security_challenges')).rows[0].sent_at,
    ).toBeTruthy();
    await db.query('UPDATE accounts SET email_canonical=NULL,email_verified_at=NULL WHERE id=$1', [
      otherId,
    ]);
    await db.query(
      "CREATE FUNCTION security_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$",
    );
    await db.query(
      'CREATE TRIGGER security_test_fail BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION security_test_fail()',
    );
    try {
      expect((await write('account/security/email', input, user, 'PUT')).statusCode).toBe(500);
      expect(
        (await db.query('SELECT email_canonical FROM accounts WHERE id=$1', [id])).rows[0]
          .email_canonical,
      ).toBeNull();
      expect((await me()).statusCode).toBe(200);
      expect(
        (
          await write(
            'account/security/password',
            { currentPassword: oldPassword, newPassword },
            user,
            'PUT',
          )
        ).statusCode,
      ).toBe(500);
      expect(
        await verifyPassword(
          (await db.query('SELECT password_hash FROM accounts WHERE id=$1', [id])).rows[0]
            .password_hash,
          oldPassword,
        ),
      ).toBe(true);
      expect(
        (await db.query('SELECT sent_at FROM account_security_challenges')).rows[0].sent_at,
      ).toBeTruthy();
    } finally {
      await db.query('DROP TRIGGER security_test_fail ON sessions');
      await db.query('DROP FUNCTION security_test_fail()');
    }
    expect((await write('account/security/email', input, user, 'PUT')).statusCode).toBe(200);
  });

  it('recovers with the exact verified email only and invalidates all old sessions and challenges', async () => {
    await db.query('UPDATE accounts SET email_canonical=$2,email_verified_at=now() WHERE id=$1', [
      id,
      'verified@example.test',
    ]);
    const payload = { username: '@SECURITY_USER', email: 'verified@example.test' };
    const unknown = await write('auth/recovery/email-code', {
      ...payload,
      email: 'unknown@example.test',
    });
    expect(unknown.statusCode).toBe(200);
    expect(mails.size).toBe(0);
    const issued = await write('auth/recovery/email-code', payload);
    expect(issued.statusCode).toBe(200);
    const input = {
      ...payload,
      challengeId: issued.json().data.challengeId,
      emailCode: mails.get(payload.email)!,
      newPassword,
    };
    expect(
      (
        await write(
          'account/security/email',
          {
            email: payload.email,
            currentPassword: oldPassword,
            challengeId: input.challengeId,
            emailCode: input.emailCode,
          },
          user,
          'PUT',
        )
      ).statusCode,
    ).toBe(400);
    const cooldown = await write('auth/recovery/email-code', payload);
    expect(cooldown.statusCode).toBe(200);
    expect(cooldown.json().data).toEqual(
      expect.objectContaining({ expiresInSeconds: 600, retryAfterSeconds: 60 }),
    );
    expect((await write('auth/recovery', input)).statusCode).toBe(200);
    expect((await me()).statusCode).toBe(401);
    expect((await login('security_user', newPassword)).statusCode).toBe(200);
    expect((await write('auth/recovery', input)).statusCode).toBe(400);
    const row = (await db.query('SELECT password_hash FROM accounts WHERE id=$1', [id])).rows[0];
    expect(await verifyPassword(row.password_hash, newPassword)).toBe(true);
  });

  it('rejects login verified against a password changed before session issuance', async () => {
    let release!: () => void;
    let observed!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = new Promise<void>((resolve) => {
      observed = resolve;
    });
    let paused = false;
    // Interpose only the query result timing; all SQL and password checks are real.
    const racingDb = new Proxy(db, {
      get(target, key) {
        if (key === 'query')
          return async (...args: unknown[]) => {
            const result: unknown = await Reflect.apply(target.query, target, args);
            if (
              !paused &&
              typeof args[0] === 'string' &&
              args[0].includes('password_hash,role,status FROM accounts WHERE username_canonical')
            ) {
              paused = true;
              observed();
              await gate;
            }
            return result;
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const auth = new AuthService(
      racingDb,
      normalizeConfig({
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: 3001,
        DATABASE_URL: url,
        WEB_ORIGIN: origin,
        ENABLE_DEV_LAB: false,
        LOG_LEVEL: 'silent',
      }),
      async () => undefined,
    );
    const pending = auth.login('security_user', oldPassword, '192.0.2.1');
    try {
      await read;
      expect(
        (
          await write(
            'account/security/password',
            { currentPassword: oldPassword, newPassword },
            user,
            'PUT',
          )
        ).statusCode,
      ).toBe(200);
      release();
      await expect(pending).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
      expect((await db.query('SELECT id FROM sessions WHERE revoked_at IS NULL')).rowCount).toBe(0);
    } finally {
      release();
      auth.close();
    }
  });

  it('never enables failed mail and rejects concurrent stale-password changes', async () => {
    failMail = true;
    const response = await write('account/security/email-code', {
      email: 'failed@example.test',
      currentPassword: oldPassword,
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private provider secret');
    expect(
      (await db.query('SELECT sent_at FROM account_security_challenges')).rows[0].sent_at,
    ).toBeNull();
    const other = identity(await login());
    const result = await Promise.all(
      [user, other].map((headers) =>
        write(
          'account/security/password',
          { currentPassword: oldPassword, newPassword },
          headers,
          'PUT',
        ),
      ),
    );
    expect(result.map((response) => response.statusCode).sort()).toEqual([200, 401]);
  });
});
