import { officialAiTokenPricingSchema, type OfficialAiTokenPricing } from '@boardgame/protocol';
import { AppError } from '../errors.js';

// Keep integer arithmetic through the final rounding, including very large usage reports.
export function tokenCharge(
  rawPricing: OfficialAiTokenPricing,
  inputTokens: number | null,
  outputTokens: number | null,
  limit: number,
) {
  const pricing = officialAiTokenPricingSchema.parse(rawPricing);
  if (
    ![inputTokens, outputTokens].every(
      (value) => value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647,
    )
  )
    throw new AppError('AI_PROVIDER_FAILED', '模型缺少有效 token 用量，使用免费兜底', 503);
  const numerator =
    (BigInt(inputTokens!) * BigInt(pricing.inputPointsPerMillion) +
      BigInt(outputTokens!) * BigInt(pricing.outputPointsPerMillion)) *
    BigInt(100 + pricing.markupPercent);
  const denominator = 100000000n;
  const charge = (numerator + denominator - 1n) / denominator;
  if (charge > BigInt(limit))
    throw new AppError('AI_PROVIDER_FAILED', 'token 费用超过本次预留，使用免费兜底', 503);
  return Number(charge);
}
