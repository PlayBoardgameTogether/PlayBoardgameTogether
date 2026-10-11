import { z } from 'zod';

export const badgeIdSchema = z.enum([
  'welcome',
  'first-match',
  'ten-matches',
  'fifty-matches',
  'explorer',
  'beta-player',
  'contributor',
  'event-honor',
]);
export const manualBadgeIdSchema = z.enum(['beta-player', 'contributor', 'event-honor']);
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
