import { randomInt, randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import * as argon2 from 'argon2';
import type pg from 'pg';
import type { Database } from './db/index.js';
import type { ApiConfig } from './config.js';
import { AppError } from './errors.js';
import { registrationEmailRequestSchema, type EmailRegistrationInput } from '@boardgame/protocol';

export type RegistrationMailer = (email: string, code: string) => Promise<void>;

export function smtpRegistrationMailer(config: ApiConfig): RegistrationMailer {
  return async (email, code) => {
    if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD || !config.SMTP_FROM) {
      throw new AppError('SERVICE_UNAVAILABLE', '邮件服务尚未配置，请稍后注册', 503, true);
    }
    const transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      requireTLS: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: false,
      debug: false,
    });
    try {
      const result = await transport.sendMail({
        from: { name: 'PlayBoard 顶尖桌游联盟', address: config.SMTP_FROM },
        to: email,
        subject: 'PlayBoard 注册邮箱验证码',
        text: `你的 PlayBoard 注册验证码是：${code}\n\n10 分钟内有效，最多尝试 5 次。请勿向他人透露验证码。\n如果你没有申请注册，请忽略本邮件。`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (result.rejected.length || !result.accepted.length) throw new Error('Mail rejected');
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', '验证码发送失败，请稍后重试', 503, true);
    } finally {
      transport.close();
    }
  };
}

export class RegistrationEmailService {
  constructor(
    private db: Database,
    private send: RegistrationMailer,
  ) {}

  async request(raw: unknown) {
    const { email } = registrationEmailRequestSchema.parse(raw);
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      // Also serialize first sends; row locks alone cannot lock a missing email.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('registration-email-send', 0))",
      );
      await client.query(
        "DELETE FROM registration_email_challenges WHERE requested_at < now() - interval '1 hour'",
      );
      const existing = (
        await client.query<{ cooldown: boolean; limited: boolean }>(
          `
        SELECT requested_at > now() - interval '60 seconds' AS cooldown,
          window_started_at > now() - interval '1 hour' AND send_count >= 5 AS limited
        FROM registration_email_challenges WHERE email_canonical=$1 FOR UPDATE`,
          [email],
        )
      ).rows[0];
      if (existing?.cooldown || existing?.limited) {
        throw new AppError(
          'RATE_LIMITED',
          '发送过于频繁，请稍后重试（每小时最多 5 封）',
          429,
          true,
        );
      }
      const count = await client.query<{ count: string }>(
        'SELECT count(*) FROM registration_email_challenges',
      );
      if (!existing && Number(count.rows[0]?.count ?? 10_000) >= 10_000) {
        throw new AppError('SERVICE_UNAVAILABLE', '邮件服务繁忙，请稍后重试', 503, true);
      }
      await client.query(
        `INSERT INTO registration_email_challenges
        (email_canonical,id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')
        ON CONFLICT(email_canonical) DO UPDATE SET id=$2,code_hash=$3,
          expires_at=now()+interval '10 minutes',requested_at=now(),sent_at=NULL,attempts=0,
          send_count=CASE WHEN registration_email_challenges.window_started_at <= now()-interval '1 hour'
            THEN 1 ELSE registration_email_challenges.send_count+1 END,
          window_started_at=CASE WHEN registration_email_challenges.window_started_at <= now()-interval '1 hour'
            THEN now() ELSE registration_email_challenges.window_started_at END`,
        [email, id, codeHash],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    // No SMTP connection or external side effect inside a database transaction.
    try {
      await this.send(email, code);
    } catch {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        '验证码发送失败或邮件服务尚未配置，请稍后重试',
        503,
        true,
      );
    }
    const sent = await this.db.query(
      'UPDATE registration_email_challenges SET sent_at=now() WHERE id=$1',
      [id],
    );
    if (!sent.rowCount)
      throw new AppError('SERVICE_UNAVAILABLE', '验证码已更新，请重新发送', 503, true);
    return { challengeId: id, expiresInSeconds: 600, retryAfterSeconds: 60 };
  }

  // Caller commits failed attempts, or consumes the challenge with account creation.
  async verify(client: pg.PoolClient, input: EmailRegistrationInput): Promise<boolean> {
    const row = (
      await client.query<{ code_hash: string; usable: boolean; attempts: number }>(
        `
      SELECT code_hash, attempts,
        sent_at IS NOT NULL AND expires_at > clock_timestamp() AND attempts < 5 AS usable
      FROM registration_email_challenges WHERE id=$1 AND email_canonical=$2 FOR UPDATE`,
        [input.challengeId, input.email],
      )
    ).rows[0];
    if (!row?.usable) return false;
    const valid = await argon2.verify(row.code_hash, input.emailCode);
    if (!valid) {
      await client.query(
        'UPDATE registration_email_challenges SET attempts=attempts+1 WHERE id=$1',
        [input.challengeId],
      );
      return false;
    }
    // Consumption must preserve the mailbox's hourly send budget.
    await client.query('UPDATE registration_email_challenges SET sent_at=NULL WHERE id=$1', [
      input.challengeId,
    ]);
    return true;
  }
}
