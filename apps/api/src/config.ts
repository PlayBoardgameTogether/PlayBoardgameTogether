import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform(v => v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'), API_HOST: z.string().default('127.0.0.1'), API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(), WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5173'), ENABLE_DEV_LAB: booleanString.default(false), LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  COOKIE_SECURE: booleanString.default(false), SESSION_TTL_MS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60_000), INVITE_TTL_MS: z.coerce.number().int().positive().default(24 * 60 * 60_000),
  MAX_OPEN_ROOMS_PER_ACCOUNT: z.coerce.number().int().positive().default(1).transform(() => 1), LOGIN_IP_FAILURES: z.coerce.number().int().positive().default(10), LOGIN_USER_FAILURES: z.coerce.number().int().positive().default(5), LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(10 * 60_000), PRESENCE_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(10_000),
  MODEL_CREDENTIALS_KEY: z.string().optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: booleanString.default(true),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().email().optional(),
  AI_GLOBAL_CONCURRENCY:z.coerce.number().int().min(1).max(16).default(4),AI_DECISION_TIMEOUT_MS:z.coerce.number().int().min(50).max(30_000).default(2000),AI_LEASE_MS:z.coerce.number().int().min(1000).max(120_000).default(15_000),AI_SCAN_INTERVAL_MS:z.coerce.number().int().min(100).max(60_000).default(5000),AI_MAX_ATTEMPTS:z.coerce.number().int().min(1).max(10).default(2),
}).strict();
type LoadedApiConfig = z.infer<typeof schema>;
export type ApiConfig = LoadedApiConfig;
type Defaults='COOKIE_SECURE'|'SESSION_TTL_MS'|'INVITE_TTL_MS'|'MAX_OPEN_ROOMS_PER_ACCOUNT'|'LOGIN_IP_FAILURES'|'LOGIN_USER_FAILURES'|'LOGIN_WINDOW_MS'|'PRESENCE_GRACE_MS'|'MODEL_CREDENTIALS_KEY'|'AI_GLOBAL_CONCURRENCY'|'AI_DECISION_TIMEOUT_MS'|'AI_LEASE_MS'|'AI_SCAN_INTERVAL_MS'|'AI_MAX_ATTEMPTS';
type MailDefaults =
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
  | 'SMTP_PASSWORD'
  | 'SMTP_FROM';
export type ApiConfigInput = Omit<LoadedApiConfig, Defaults | MailDefaults> &
  Partial<Pick<LoadedApiConfig, Defaults | MailDefaults>>;
export function normalizeConfig(value: ApiConfigInput): ApiConfig {
  return {
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    COOKIE_SECURE: false,
    SESSION_TTL_MS: 7 * 24 * 60 * 60_000,
    INVITE_TTL_MS: 24 * 60 * 60_000,
    MAX_OPEN_ROOMS_PER_ACCOUNT: 1,
    LOGIN_IP_FAILURES: 10,
    LOGIN_USER_FAILURES: 5,
    LOGIN_WINDOW_MS: 10 * 60_000,
    PRESENCE_GRACE_MS: 10_000,
    MODEL_CREDENTIALS_KEY: undefined,
    AI_GLOBAL_CONCURRENCY: 4,
    AI_DECISION_TIMEOUT_MS: 2000,
    AI_LEASE_MS: 15000,
    AI_SCAN_INTERVAL_MS: 5000,
    AI_MAX_ATTEMPTS: 2,
    ...value,
  };
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedApiConfig {
  const allowed = Object.fromEntries(Object.keys(schema.shape).filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  return schema.parse(allowed);
}
