import { z } from 'zod';

const points = z.number().int().min(1).max(1000000);
export const officialAiTokenPricingSchema = z
  .object({
    inputPointsPerMillion: z.number().int().min(0).max(1000000000),
    outputPointsPerMillion: z.number().int().min(0).max(1000000000),
    markupPercent: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine((value) => value.inputPointsPerMillion + value.outputPointsPerMillion > 0, {
    message: '输入和输出基础点价不能同时为零',
  });
export const officialAiTokenBillingSchema = z.object({
  offerId: z.string().uuid(),
  pricing: officialAiTokenPricingSchema,
  inputTokens: z.number().int().min(0).max(2147483647),
  outputTokens: z.number().int().min(0).max(2147483647),
  chargedPoints: z.number().int().min(0).max(10000),
});
export const officialAiOfferSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pointsPerAction: z.number().int().positive(),
  tokenPricing: officialAiTokenPricingSchema.nullable().optional(),
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
    tokenPricing: officialAiTokenPricingSchema.optional(),
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
export const aiPointLedgerQuerySchema = z
  .object({
    before: z.string().uuid().optional(),
    matchId: z.string().uuid().optional(),
  })
  .strict();
export const aiPointBillsQuerySchema = z.object({ before: z.string().uuid().optional() }).strict();
const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
});
export const aiPointBillsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      kind: z.enum(['grant', 'action']),
      matchId: z.string().uuid().nullable(),
      gameName: z.string().nullable(),
      note: z.string(),
      delta: z.number().int(),
      actionCount: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      missingUsageCount: z.number().int().nonnegative(),
      createdAt: z.string().datetime(),
    }),
  ),
  nextCursor: z.string().uuid().nullable(),
});
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
      tokenBilling: officialAiTokenBillingSchema.nullable().optional(),
      usage: tokenUsageSchema.optional(),
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
export type OfficialAiTokenPricing = z.infer<typeof officialAiTokenPricingSchema>;
export type OfficialAiEnrollment = z.infer<typeof officialAiEnrollmentSchema>;
export type AiPointWallet = z.infer<typeof aiPointWalletSchema>;
export type AiPointLedger = z.infer<typeof aiPointLedgerSchema>;
export type AiPointBills = z.infer<typeof aiPointBillsSchema>;
