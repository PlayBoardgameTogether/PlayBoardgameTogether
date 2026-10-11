import { z } from 'zod';

export const adminUpdateCommandSchema = z.object({ requestId: z.string().uuid() }).strict();
export const adminUpdateFailureSchema = z.object({
  stage: z.enum(['fetch', 'history', 'checkout', 'install', 'build', 'drain', 'stop', 'migrate', 'sync', 'start', 'persist', 'restart']),
  reason: z.enum(['disk_full', 'permission', 'authentication', 'network', 'lockfile', 'branch_missing',
    'command_failed', 'command_missing', 'pnpm_unavailable', 'timeout', 'history_diverged',
    'drain_timeout', 'readiness', 'recovery_failed', 'migration_changed', 'build_tool_missing', 'compilation', 'unknown']),
  exitCode: z.number().int().nullable(),
  occurredAt: z.string().datetime(),
}).strict();
export const adminUpdateStatusSchema = z.object({
  enabled: z.boolean(),
  branch: z.string().min(1).max(255).nullable(),
  currentSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/).nullable(),
  lastCheckedAt: z.string().datetime().nullable(),
  failure: adminUpdateFailureSchema.nullable().optional(),
  phase: z.enum(['unavailable', 'disabled', 'idle', 'checking', 'building', 'current',
    'waiting', 'maintenance', 'applying', 'updated', 'failed']),
}).strict();
export type AdminUpdateStatus = z.infer<typeof adminUpdateStatusSchema>;

export const adminAccountSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    role: z.enum(['user', 'administrator']),
    status: z.enum(['active', 'disabled']),
    revision: z.number().int().positive(),
    createdAt: z.string().datetime(),
  })
  .strict();
export const adminAccountPageSchema = z
  .object({
    items: adminAccountSchema.array().max(20),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();
export const adminAccountQuerySchema = z
  .object({
    before: z.string().uuid().optional(),
    search: z.string().trim().max(32).default(''),
  })
  .strict();
const command = {
  requestId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
};
export const adminAccountCommandSchema = z
  .object({ ...command, status: z.enum(['active', 'disabled']) })
  .strict();
export const adminGameCommandSchema = z
  .object({ ...command, enabled: z.boolean() })
  .strict();
export const adminGameSchema = z
  .object({
    id: z.string(),
    version: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    revision: z.number().int().positive(),
    available: z.boolean(),
    developmentOnly: z.boolean(),
  })
  .strict();
export const adminOverviewSchema = z
  .object({
    accounts: z.number().int().nonnegative(),
    disabledAccounts: z.number().int().nonnegative(),
    openRooms: z.number().int().nonnegative(),
    activeMatches: z.number().int().nonnegative(),
    installedGames: z.number().int().nonnegative(),
    enabledGames: z.number().int().nonnegative(),
    pendingSubmissions: z.number().int().nonnegative(),
  })
  .strict();
export type AdminAccount = z.infer<typeof adminAccountSchema>;
export type AdminGame = z.infer<typeof adminGameSchema>;
export type AdminAccountCommand = z.infer<typeof adminAccountCommandSchema>;
export type AdminGameCommand = z.infer<typeof adminGameCommandSchema>;
