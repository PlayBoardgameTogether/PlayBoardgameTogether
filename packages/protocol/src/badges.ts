import { z } from 'zod';

export const builtInBadgeIdSchema = z.enum([
  'welcome',
  'first-match',
  'ten-matches',
  'fifty-matches',
  'explorer',
  'beta-player',
  'contributor',
  'event-honor',
]);
export const customBadgeIdSchema = z.string().regex(/^custom-[a-z0-9][a-z0-9-]{0,63}$/);
export const badgeIdSchema = z.union([builtInBadgeIdSchema, customBadgeIdSchema]);
export const manualBadgeIdSchema = z.union([
  z.enum(['beta-player', 'contributor', 'event-honor']),
  customBadgeIdSchema,
]);
export const badgeConditionSchema = z.discriminatedUnion('metric', [
  z
    .object({ metric: z.literal('finished'), target: z.number().int().min(1).max(1000000) })
    .strict(),
  z.object({ metric: z.literal('games'), target: z.number().int().min(1).max(1000000) }).strict(),
  z
    .object({
      metric: z.literal('gameFinished'),
      target: z.number().int().min(1).max(1000000),
      gameId: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9._-]+$/),
    })
    .strict(),
]);
export const badgeRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('manual') }).strict(),
  z
    .object({
      type: z.literal('automatic'),
      mode: z.enum(['all', 'any']),
      conditions: z.array(badgeConditionSchema).min(1).max(8),
    })
    .strict(),
]);
export const badgeDefinitionSchema = z
  .object({
    id: customBadgeIdSchema,
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(500),
    symbol: z.string().trim().min(1).max(16),
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    rule: badgeRuleSchema,
  })
  .strict();
export const badgeDefinitionInputSchema = badgeDefinitionSchema
  .omit({ revision: true })
  .extend({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export const badgeDefinitionsSchema = z.object({ items: z.array(badgeDefinitionSchema) }).strict();
export type BadgeDefinition = z.infer<typeof badgeDefinitionSchema>;
export type BadgeDefinitionInput = z.infer<typeof badgeDefinitionInputSchema>;
export type BadgeRule = z.infer<typeof badgeRuleSchema>;
export type BadgeCondition = z.infer<typeof badgeConditionSchema>;
export const badgeSchema = z
  .object({
    id: badgeIdSchema,
    name: z.string(),
    description: z.string(),
    kind: z.enum(['achievement', 'honor']),
    symbol: z.string(),
    target: z.number().int().positive(),
    progress: z.number().int().nonnegative(),
    earned: z.boolean(),
    awardedAt: z.string().datetime().nullable(),
    rule: badgeRuleSchema.optional(),
  })
  .strict();
export const badgeCollectionSchema = z
  .object({
    accountId: z.string().uuid(),
    displayName: z.string(),
    revision: z.number().int().nonnegative(),
    displayed: z.array(badgeIdSchema).max(3),
    items: z.array(badgeSchema),
  })
  .strict();
export const badgeDisplayInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    displayed: z
      .array(badgeIdSchema)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export const badgeGrantInputSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    badgeId: manualBadgeIdSchema,
    granted: z.boolean(),
  })
  .strict();
export const displayedBadgesSchema = z.object({ items: z.array(badgeSchema).max(3) }).strict();
export type Badge = z.infer<typeof badgeSchema>;
export type BadgeCollection = z.infer<typeof badgeCollectionSchema>;
export type BadgeDisplayInput = z.infer<typeof badgeDisplayInputSchema>;
export type BadgeGrantInput = z.infer<typeof badgeGrantInputSchema>;
