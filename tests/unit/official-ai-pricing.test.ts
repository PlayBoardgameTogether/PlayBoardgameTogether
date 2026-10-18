import { describe, expect, it } from 'vitest';
import { tokenCharge } from '../../apps/api/src/official-ai/pricing.js';
import { officialAiPublishSchema } from '../../packages/protocol/src/official-ai.js';
import { randomUUID } from 'node:crypto';

const pricing = { inputPointsPerMillion: 1000, outputPointsPerMillion: 2000, markupPercent: 25 };
describe('official AI token prices', () => {
  it('sums both directions and markup before rounding once', () => {
    expect(tokenCharge(pricing, 1000, 1000, 10)).toBe(4);
    expect(tokenCharge({ ...pricing, markupPercent: 0 }, 200, 100, 10)).toBe(1);
    expect(tokenCharge(pricing, 0, 0, 10)).toBe(0);
    expect(tokenCharge({ ...pricing, inputPointsPerMillion: 0 }, 1000, 0, 10)).toBe(0);
  });
  it.each([
    [null, 10],
    [10, null],
    [-1, 1],
    [0.5, 1],
    [2147483648, 1],
  ])('rejects unbillable usage (%s, %s) instead of guessing a price', (input, output) => {
    expect(() => tokenCharge(pricing, input, output, 10)).toThrow('有效 token 用量');
  });
  it('rejects charges above the reservation with exact integer arithmetic', () => {
    expect(() => tokenCharge(pricing, 1000, 1000, 3)).toThrow('超过本次预留');
    expect(() =>
      tokenCharge(
        {
          inputPointsPerMillion: 1000000000,
          outputPointsPerMillion: 1000000000,
          markupPercent: 1000,
        },
        2147483647,
        2147483647,
        10000,
      ),
    ).toThrow('超过本次预留');
  });
  it('keeps legacy publish requests valid and rejects invalid administrator rates', () => {
    const input = {
      requestId: randomUUID(),
      profileId: randomUUID(),
      name: '测试',
      pointsPerAction: 10,
    };
    expect(officialAiPublishSchema.safeParse(input).success).toBe(true);
    for (const tokenPricing of [
      { ...pricing, markupPercent: -1 },
      { ...pricing, markupPercent: 1001 },
      { ...pricing, inputPointsPerMillion: 0.1 },
      { ...pricing, inputPointsPerMillion: 0, outputPointsPerMillion: 0 },
    ])
      expect(officialAiPublishSchema.safeParse({ ...input, tokenPricing }).success).toBe(false);
  });
});
