import nodemailer from 'nodemailer';
import { AppError } from './errors.js';
import { resolvePublicHttpsTarget } from './model-ai.js';

export type SmtpCredentials = {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from: string;
};
export type MailMessage = { to: string; subject: string; text: string };
export type MailTransport = (settings: SmtpCredentials, message: MailMessage) => Promise<void>;

export const smtpMailTransport: MailTransport = async (settings, message) => {
  // Reuse the platform's public-address policy and pin the resolved IP to avoid
  // DNS rebinding. The original hostname still verifies the TLS certificate.
  const target = await resolvePublicHttpsTarget(`https://${settings.host}`);
  const transport = nodemailer.createTransport({
    host: target.address,
    port: settings.port,
    secure: settings.secure,
    tls: { servername: target.url.hostname },
    requireTLS: true,
    auth: { user: settings.username, pass: settings.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    logger: false,
    debug: false,
  });
  try {
    const result = await transport.sendMail({
      from: { name: 'PlayBoard 顶尖桌游联盟', address: settings.from },
      to: message.to,
      subject: message.subject,
      text: message.text,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (result.rejected.length || !result.accepted.length) throw new Error('Mail rejected');
  } catch {
    throw new AppError('SERVICE_UNAVAILABLE', '邮件发送失败，请检查配置或稍后重试', 503, true);
  } finally {
    transport.close();
  }
};
