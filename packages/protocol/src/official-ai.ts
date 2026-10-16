import { z } from 'zod';

const points = z.number().int().min(1).max(1000000);
export const officialAiOfferSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pointsPerAction: z.number().int().positive(),
  enabled: z.boolean(),
  revision: z.number().int().positive(),
});
export const officialAiOffersSchema = officialAiOfferSchema.array();
export const officialAiPublishSchema = z
  .object({
    requestId: z.string().uuid(),
    name: z.string().trim().min(1).max(60),
    profileId: z.string().uuid(),
    pointsPerAction: z.number().int().min(1).max(10000),
  })
  .strict();
export const officialAiStatusSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    enabled: z.boolean(),
  })
  .strict();
export const officialAiEnrollSchema = z
  .object({
    requestId: z.string().uuid(),
    offerId: z.string().uuid(),
    matchBudget: points,
  })
  .strict();
export const officialAiEnrollmentSchema = z.object({
  profileId: z.string().uuid(),
  offerId: z.string().uuid(),
  matchBudget: points,
});
export const aiPointGrantSchema = z
  .object({
    requestId: z.string().uuid(),
    accountId: z.string().uuid(),
    points,
    note: z.string().trim().min(1).max(200),
  })
  .strict();
export const aiPointWalletSchema = z.object({
  balance: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
});
export const aiPointLedgerQuerySchema = z.object({ before: z.string().uuid().optional() }).strict();
export const aiPointLedgerSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      delta: z.number().int(),
      balanceAfter: z.number().int().nonnegative(),
      kind: z.enum(['grant', 'action']),
      note: z.string(),
      matchId: z.string().uuid().nullable(),
      createdAt: z.string().datetime(),
    }),
  ),
  nextCursor: z.string().uuid().nullable(),
});
export const officialAiStatsSchema = z.object({
  grantedPoints: z.number().nonnegative(),
  chargedPoints: z.number().nonnegative(),
  reservedPoints: z.number().nonnegative(),
  calls: z.number().int().nonnegative(),
  failedCalls: z.number().int().nonnegative(),
  unknownCalls: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  missingUsageCalls: z.number().int().nonnegative(),
});
export type OfficialAiOffer = z.infer<typeof officialAiOfferSchema>;
export type OfficialAiEnrollment = z.infer<typeof officialAiEnrollmentSchema>;
export type AiPointWallet = z.infer<typeof aiPointWalletSchema>;
export type AiPointLedger = z.infer<typeof aiPointLedgerSchema>;
