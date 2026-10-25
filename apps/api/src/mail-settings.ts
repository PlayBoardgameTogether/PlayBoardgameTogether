import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { mailSettingsSchema, type MailSettingsInput } from '@boardgame/protocol';
import type { Database } from './db/index.js';
import type { ApiConfig } from './config.js';
import { AppError } from './errors.js';
import { smtpMailTransport, type MailTransport, type SmtpCredentials } from './mail-transport.js';
import type { RegistrationMailer } from './registration-email.js';

type MailRow = {
  enabled: boolean;
  host: string;
  port: 465 | 587;
  username: string;
  sender_address: string;
  revision: number;
  password_ciphertext: Buffer | null;
  password_nonce: Buffer | null;
  password_tag: Buffer | null;
};
const aad = Buffer.from('playboard:registration-smtp:v1');

export class MailSettingsService {
  private key: Buffer | null;
  constructor(
    private db: Database,
    private config: ApiConfig,
    readonly transport: MailTransport = smtpMailTransport,
  ) {
    const key = config.MODEL_CREDENTIALS_KEY
      ? Buffer.from(config.MODEL_CREDENTIALS_KEY, 'base64')
      : null;
    this.key = key?.length === 32 ? key : null;
  }

  private requireKey() {
    if (!this.key)
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        '平台凭据加密未配置，请先由维护者配置加密主密钥',
        503,
      );
    return this.key;
  }

  private async row(query: Database | PoolClient = this.db) {
    return (
      await query.query<MailRow>('SELECT * FROM registration_mail_settings WHERE singleton=true')
    ).rows[0];
  }

  private environment() {
    return {
      enabled: !!(
        this.config.SMTP_HOST &&
        this.config.SMTP_USER &&
        this.config.SMTP_PASSWORD &&
        this.config.SMTP_FROM
      ),
      host: this.config.SMTP_HOST ?? '',
      port: this.config.SMTP_PORT === 587 ? (587 as const) : (465 as const),
      username: this.config.SMTP_USER ?? '',
      from: this.config.SMTP_FROM ?? '',
    };
  }

  async status(query: Database | PoolClient = this.db) {
    const row = await this.row(query);
    const env = this.environment();
    return mailSettingsSchema.parse({
      ...(row
        ? {
            enabled: row.enabled,
            host: row.host,
            port: row.port,
            username: row.username,
            from: row.sender_address,
          }
        : env),
      revision: row?.revision ?? 0,
      source: row ? 'database' : env.enabled ? 'environment' : 'none',
      hasPassword: row ? row.password_ciphertext !== null : !!this.config.SMTP_PASSWORD,
      encryptionAvailable: this.key !== null,
      configured: row
        ? row.enabled &&
          !!row.host &&
          !!row.username &&
          !!row.sender_address &&
          !!row.password_ciphertext &&
          !!this.key
        : env.enabled,
    });
  }

  // Receipts must never contain the SMTP password or a reusable encrypted copy.
  fingerprint(input: MailSettingsInput) {
    const serialized = JSON.stringify(input);
    if (input.password)
      return createHmac('sha256', this.requireKey()).update(serialized).digest('hex');
    return createHash('sha256').update(serialized).digest('hex');
  }

  async save(client: PoolClient, actorId: string, input: MailSettingsInput) {
    const previous = await this.row(client);
    if ((previous?.revision ?? 0) !== input.expectedRevision) {
      throw new AppError('STATE_CONFLICT', '邮件设置已更新，请重新读取后决定', 409);
    }
    const old = previous ?? {
      host: this.config.SMTP_HOST ?? '',
      username: this.config.SMTP_USER ?? '',
      port: this.config.SMTP_PORT,
    };
    if (
      !input.password &&
      !input.clearPassword &&
      (previous?.password_ciphertext || this.config.SMTP_PASSWORD) &&
      (old.host !== input.host || old.username !== input.username || old.port !== input.port)
    ) {
      throw new AppError('VALIDATION_ERROR', '更换 SMTP 服务器、端口或账号时请重新输入授权码', 400);
    }
    let ciphertext = previous?.password_ciphertext ?? null;
    let nonce = previous?.password_nonce ?? null;
    let tag = previous?.password_tag ?? null;
    const password =
      input.password ?? (!previous && !input.clearPassword ? this.config.SMTP_PASSWORD : undefined);
    if (input.clearPassword) {
      ciphertext = null;
      nonce = null;
      tag = null;
    }
    if (password) {
      nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.requireKey(), nonce);
      cipher.setAAD(aad);
      ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
      tag = cipher.getAuthTag();
    }
    if (input.enabled && !ciphertext)
      throw new AppError('VALIDATION_ERROR', '启用邮件前请填写 SMTP 授权码', 400);
    if (input.enabled) this.requireKey();
    await client.query(
      `INSERT INTO registration_mail_settings
      (singleton,enabled,host,port,username,sender_address,password_ciphertext,password_nonce,password_tag,updated_by)
      VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(singleton) DO UPDATE SET enabled=$1,host=$2,port=$3,username=$4,sender_address=$5,
        password_ciphertext=$6,password_nonce=$7,password_tag=$8,updated_by=$9,
        revision=registration_mail_settings.revision+1,updated_at=now()`,
      [
        input.enabled,
        input.host,
        input.port,
        input.username,
        input.from,
        ciphertext,
        nonce,
        tag,
        actorId,
      ],
    );
    return this.status(client);
  }

  async credentials(query: Database | PoolClient = this.db): Promise<SmtpCredentials> {
    const row = await this.row(query);
    if (!row) {
      if (!this.environment().enabled)
        throw new AppError('SERVICE_UNAVAILABLE', '邮件服务尚未配置', 503);
      return {
        host: this.config.SMTP_HOST!,
        port: this.config.SMTP_PORT,
        secure: this.config.SMTP_SECURE,
        username: this.config.SMTP_USER!,
        password: this.config.SMTP_PASSWORD!,
        from: this.config.SMTP_FROM!,
      };
    }
    if (!row.enabled || !row.password_ciphertext || !row.password_nonce || !row.password_tag) {
      throw new AppError('SERVICE_UNAVAILABLE', '邮件服务未启用或缺少授权码', 503);
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), row.password_nonce);
      decipher.setAAD(aad);
      decipher.setAuthTag(row.password_tag);
      const password = Buffer.concat([
        decipher.update(row.password_ciphertext),
        decipher.final(),
      ]).toString('utf8');
      return {
        host: row.host,
        port: row.port,
        secure: row.port === 465,
        username: row.username,
        password,
        from: row.sender_address,
      };
    } catch {
      throw new AppError(
        'SERVICE_UNAVAILABLE',
        '已保存的邮件授权码无法解密，请检查加密主密钥或重新保存授权码',
        503,
      );
    }
  }

  registrationMailer(): RegistrationMailer {
    return async (email, code) =>
      this.transport(await this.credentials(), {
        to: email,
        subject: 'PlayBoard 注册邮箱验证码',
        text: `你的 PlayBoard 注册验证码是：${code}\n\n10 分钟内有效，最多尝试 5 次。请勿向他人透露验证码。\n如果你没有申请注册，请忽略本邮件。`,
      });
  }
}
