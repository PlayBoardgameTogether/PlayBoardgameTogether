import { z } from 'zod';
import { registrationEmailSchema } from './auth.js';

const smtpHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine(
    (value) =>
      value === '' ||
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value),
    '请填写 SMTP 公网域名，不含协议、路径或端口',
  );
const fields = {
  enabled: z.boolean(),
  host: smtpHostSchema,
  port: z.union([z.literal(465), z.literal(587)]),
  username: z.string().trim().max(254),
  from: z.union([z.literal(''), registrationEmailSchema]),
};
export const mailSettingsSchema = z
  .object({
    ...fields,
    revision: z.number().int().nonnegative(),
    source: z.enum(['database', 'environment', 'none']),
    hasPassword: z.boolean(),
    encryptionAvailable: z.boolean(),
    configured: z.boolean(),
  })
  .strict();
export const mailSettingsInputSchema = z
  .object({
    ...fields,
    expectedRevision: z.number().int().nonnegative(),
    requestId: z.string().uuid(),
    password: z.string().min(1).max(512).optional(),
    clearPassword: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.enabled && (!value.host || !value.username || !value.from)) {
      ctx.addIssue({ code: 'custom', message: '启用邮件需要完整填写服务器、账号与发件地址' });
    }
    if (value.clearPassword && value.password) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: '清除与替换密码不能同时选择' });
    }
  });
export const mailTestInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    email: registrationEmailSchema,
  })
  .strict();
export const mailTestResultSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum(['sending', 'sent', 'failed']),
  })
  .strict();
export type MailSettingsInput = z.infer<typeof mailSettingsInputSchema>;
export type MailTestInput = z.infer<typeof mailTestInputSchema>;
