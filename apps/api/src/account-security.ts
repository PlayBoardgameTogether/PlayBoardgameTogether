import { randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  accountSecuritySchema,
  bindEmailInputSchema,
  bindEmailRequestSchema,
  changePasswordInputSchema,
  currentPasswordInputSchema,
  passwordRecoveryInputSchema,
  passwordRecoveryRequestSchema,
} from '@boardgame/protocol';
import type { Database } from './db/index.js';
import { hashPassword, verifyPassword, type AuthContext } from './auth.js';
import { AppError } from './errors.js';
import type { RegistrationMailer } from './registration-email.js';

type Account = { id: string; password_hash: string; email_canonical: string | null };
type Purpose = 'bind-email' | 'reset-password';
const invalidCode = () =>
  new AppError('VALIDATION_ERROR', '验证码无效、已过期或尝试次数过多，请重新发送', 400);
const sent = (id: string) => ({ challengeId: id, expiresInSeconds: 600, retryAfterSeconds: 60 });

export class AccountSecurityService {
  constructor(
    private db: Database,
    private send: RegistrationMailer,
  ) {}

  async status(auth: AuthContext) {
    const row = (
      await this.db.query(
        `SELECT a.email_canonical AS email,
      a.email_verified_at AS verified, (SELECT count(*)::int FROM sessions s
        WHERE s.account_id=a.id AND s.revoked_at IS NULL AND s.expires_at>now()) AS count
      FROM accounts a WHERE a.id=$1`,
        [auth.account.id],
      )
    ).rows[0];
    return accountSecuritySchema.parse({
      email: row.email,
      emailVerifiedAt: row.verified?.toISOString() ?? null,
      activeSessions: row.count,
    });
  }

  private async transaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        throw new AppError('STATE_CONFLICT', '此邮箱已被绑定，请使用其他邮箱', 409);
      throw error;
    } finally {
      client.release();
    }
  }

  // Account first, then session, then challenge. Recheck authentication under lock.
  private async account(client: pg.PoolClient, auth: AuthContext, password: string) {
    const row = (
      await client.query<Account>(
        `SELECT id,password_hash,email_canonical FROM accounts
      WHERE id=$1 AND status='active' FOR UPDATE`,
        [auth.account.id],
      )
    ).rows[0];
    const session = await client.query(
      `SELECT id FROM sessions WHERE id=$1 AND account_id=$2
      AND token_hash=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`,
      [auth.sessionId, auth.account.id, auth.tokenHash],
    );
    if (!row || !session.rowCount)
      throw new AppError('UNAUTHENTICATED', '会话已失效，请重新登录', 401);
    if (!(await verifyPassword(row.password_hash, password)))
      throw new AppError('AUTH_INVALID_CREDENTIALS', '当前密码不正确', 401);
    return row;
  }

  private async revoke(client: pg.PoolClient, accountId: string, except?: string) {
    const result = await client.query(
      `UPDATE sessions SET revoked_at=now() WHERE account_id=$1
      AND revoked_at IS NULL AND expires_at>now() AND ($2::uuid IS NULL OR id<>$2)`,
      [accountId, except ?? null],
    );
    // PostgreSQL only delivers the notification after the transaction commits.
    await client.query("SELECT pg_notify('boardgame_session_revoked',$1)", [accountId]);
    return result.rowCount ?? 0;
  }

  async changePassword(auth: AuthContext, raw: unknown) {
    const input = changePasswordInputSchema.parse(raw);
    if (input.newPassword === input.currentPassword)
      throw new AppError('VALIDATION_ERROR', '新密码不能与当前密码相同', 400);
    const hash = await hashPassword(input.newPassword);
    await this.transaction(async (client) => {
      const account = await this.account(client, auth, input.currentPassword);
      await client.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [account.id, hash]);
      await client.query('DELETE FROM account_security_challenges WHERE account_id=$1', [
        account.id,
      ]);
      await this.revoke(client, account.id);
    });
    return { loggedOut: true as const };
  }

  async revokeOthers(auth: AuthContext, raw: unknown) {
    const input = currentPasswordInputSchema.parse(raw);
    const revoked = await this.transaction(async (client) => {
      await this.account(client, auth, input.currentPassword);
      return this.revoke(client, auth.account.id, auth.sessionId);
    });
    return { revoked };
  }

  async requestBinding(auth: AuthContext, raw: unknown) {
    const input = bindEmailRequestSchema.parse(raw);
    const account = await this.transaction((client) =>
      this.account(client, auth, input.currentPassword),
    );
    if (account.email_canonical === input.email)
      throw new AppError('STATE_CONFLICT', '此邮箱已是当前绑定邮箱', 409);
    return this.issue(account, input.email, 'bind-email');
  }

  async requestRecovery(raw: unknown) {
    const input = passwordRecoveryRequestSchema.parse(raw);
    const account = (
      await this.db.query<Account>(
        `SELECT id,password_hash,email_canonical FROM accounts
      WHERE username_canonical=$1 AND email_canonical=$2 AND email_verified_at IS NOT NULL AND status='active'`,
        [input.username, input.email],
      )
    ).rows[0];
    // No existence flag or account/email details in the public response.
    if (!account) return sent(randomUUID());
    try {
      return await this.issue(account, input.email, 'reset-password');
    } catch (error) {
      // Public acceptance is deliberately conditional, including delivery failure
      // and mailbox cooldown, so it cannot disclose whether this pair exists.
      if (
        error instanceof AppError &&
        (error.code === 'RATE_LIMITED' ||
          error.code === 'SERVICE_UNAVAILABLE' ||
          error.code === 'STATE_CONFLICT')
      )
        return sent(randomUUID());
      throw error;
    }
  }

  private async issue(account: Account, email: string, purpose: Purpose) {
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const hash = await hashPassword(code);
    await this.transaction(async (client) => {
      // Keep the same account -> challenge order as consumption, including the
      // foreign-key check on first insertion. A delayed issuance cannot recreate
      // a usable challenge after a concurrent password/email change.
      const current = await client.query(
        `SELECT id FROM accounts WHERE id=$1 AND password_hash=$2 AND status='active'
          AND ($3::text<>'reset-password' OR email_canonical=$4) FOR UPDATE`,
        [account.id, account.password_hash, purpose, email],
      );
      if (!current.rowCount)
        throw new AppError('STATE_CONFLICT', '账户信息已更新，请重新操作', 409);
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('account-security-mail',0))",
      );
      await client.query(
        "DELETE FROM account_security_mail_limits WHERE requested_at<now()-interval '1 hour'",
      );
      await client.query(
        "DELETE FROM account_security_challenges WHERE requested_at<now()-interval '1 hour'",
      );
      const limited = (
        await client.query(
          `SELECT 1 FROM account_security_mail_limits WHERE email_canonical=$1
        AND (requested_at>now()-interval '60 seconds' OR (window_started_at>now()-interval '1 hour' AND send_count>=5))
        UNION ALL SELECT 1 FROM account_security_challenges WHERE account_id=$2 AND requested_at>now()-interval '60 seconds'`,
          [email, account.id],
        )
      ).rowCount;
      if (limited)
        throw new AppError(
          'RATE_LIMITED',
          '发送过于频繁，请稍后重试（每小时最多 5 封）',
          429,
          true,
        );
      const count = (
        await client.query('SELECT count(*)::int AS count FROM account_security_mail_limits')
      ).rows[0].count;
      if (count >= 10000)
        throw new AppError('SERVICE_UNAVAILABLE', '邮件服务繁忙，请稍后重试', 503, true);
      await client.query(
        `INSERT INTO account_security_mail_limits(email_canonical) VALUES($1)
        ON CONFLICT(email_canonical) DO UPDATE SET requested_at=now(),
        send_count=CASE WHEN account_security_mail_limits.window_started_at<=now()-interval '1 hour' THEN 1 ELSE account_security_mail_limits.send_count+1 END,
        window_started_at=CASE WHEN account_security_mail_limits.window_started_at<=now()-interval '1 hour' THEN now() ELSE account_security_mail_limits.window_started_at END`,
        [email],
      );
      await client.query(
        `INSERT INTO account_security_challenges(account_id,purpose,id,email_canonical,password_hash_at_issue,code_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')
        ON CONFLICT(account_id,purpose) DO UPDATE SET id=$3,email_canonical=$4,password_hash_at_issue=$5,
        code_hash=$6,expires_at=now()+interval '10 minutes',requested_at=now(),sent_at=NULL,attempts=0`,
        [account.id, purpose, id, email, account.password_hash, hash],
      );
    });
    try {
      await this.send(email, code, purpose);
    } catch {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        '验证码发送失败或邮件服务尚未配置，请稍后重试',
        503,
        true,
      );
    }
    const updated = await this.db.query(
      'UPDATE account_security_challenges SET sent_at=now() WHERE id=$1',
      [id],
    );
    if (!updated.rowCount)
      throw new AppError('STATE_CONFLICT', '账户信息或验证码已更新，请重新发送', 409);
    return sent(id);
  }

  private async verify(
    client: pg.PoolClient,
    account: Account,
    purpose: Purpose,
    input: { challengeId: string; email: string; emailCode: string },
  ) {
    const row = (
      await client.query(
        `SELECT code_hash,password_hash_at_issue,
      sent_at IS NOT NULL AND expires_at>clock_timestamp() AND attempts<5 AS usable
      FROM account_security_challenges WHERE id=$1 AND account_id=$2 AND purpose=$3 AND email_canonical=$4 FOR UPDATE`,
        [input.challengeId, account.id, purpose, input.email],
      )
    ).rows[0];
    if (!row?.usable || row.password_hash_at_issue !== account.password_hash) return false;
    if (!(await verifyPassword(row.code_hash, input.emailCode))) {
      await client.query('UPDATE account_security_challenges SET attempts=attempts+1 WHERE id=$1', [
        input.challengeId,
      ]);
      return false;
    }
    return true;
  }

  async bindEmail(auth: AuthContext, raw: unknown) {
    const input = bindEmailInputSchema.parse(raw);
    const valid = await this.transaction(async (client) => {
      const account = await this.account(client, auth, input.currentPassword);
      if (!(await this.verify(client, account, 'bind-email', input))) return false;
      await client.query(
        'UPDATE accounts SET email_canonical=$2,email_verified_at=now() WHERE id=$1',
        [account.id, input.email],
      );
      await client.query('DELETE FROM account_security_challenges WHERE account_id=$1', [
        account.id,
      ]);
      await this.revoke(client, account.id);
      return true;
    });
    if (!valid) throw invalidCode();
    return { loggedOut: true as const };
  }

  async recoverPassword(raw: unknown) {
    const input = passwordRecoveryInputSchema.parse(raw);
    const hash = await hashPassword(input.newPassword);
    const valid = await this.transaction(async (client) => {
      const account = (
        await client.query<Account>(
          `SELECT id,password_hash,email_canonical FROM accounts
        WHERE username_canonical=$1 AND email_canonical=$2 AND email_verified_at IS NOT NULL AND status='active' FOR UPDATE`,
          [input.username, input.email],
        )
      ).rows[0];
      if (!account || !(await this.verify(client, account, 'reset-password', input))) return false;
      await client.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [account.id, hash]);
      await client.query('DELETE FROM account_security_challenges WHERE account_id=$1', [
        account.id,
      ]);
      await this.revoke(client, account.id);
      return true;
    });
    if (!valid) throw invalidCode();
    return { loggedOut: true as const };
  }
}
