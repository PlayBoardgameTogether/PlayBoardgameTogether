import { z } from 'zod';

export const coinAmountSchema = z.number().int().min(0).max(1_000_000_000);
const revisionSchema = z.number().int().min(0).max(2_147_483_647);
export const coinAdjustmentSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: revisionSchema,
    delta: z
      .number()
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((value) => value !== 0),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export const coinHistoryQuerySchema = z
  .object({
    before: z.coerce.number().int().positive().max(2_147_483_647).optional(),
  })
  .strict();
export const coinWalletSchema = z
  .object({
    accountId: z.string().uuid(),
    displayName: z.string(),
    balance: coinAmountSchema,
    revision: revisionSchema,
  })
  .strict();
export const coinLedgerEntrySchema = z
  .object({
    id: z.string().uuid(),
    revision: revisionSchema,
    delta: z.number().int(),
    balanceAfter: coinAmountSchema,
    reason: z.string(),
    createdAt: z.string().datetime(),
  })
  .strict();
export const coinWalletPageSchema = coinWalletSchema
  .extend({
    entries: z.array(coinLedgerEntrySchema).max(20),
    nextCursor: revisionSchema.nullable(),
  })
  .strict();
export type CoinAdjustment = z.infer<typeof coinAdjustmentSchema>;
export type CoinWallet = z.infer<typeof coinWalletSchema>;
export type CoinWalletPage = z.infer<typeof coinWalletPageSchema>;
