import { z } from 'zod';
import { matchResultSchema, type MatchResult } from '@boardgame/protocol';

const publicOutcomeSchema = z.object({
  status: z.literal('finished'),
  winners: z.array(z.string()).min(1).max(20),
  scores: z.record(z.string(), z.number().finite()).optional(),
});

// Opt in only for exact versions whose outcome's winners/scores are public.
// Extra outcome fields are discarded; scoring never implies a rank or a tiebreak rule.
export function publicResult(outcome: unknown, seats: string[]): MatchResult | null {
  const parsed = publicOutcomeSchema.safeParse(outcome);
  if (!parsed.success) return null;
  const { winners, scores } = parsed.data;
  if (new Set(winners).size !== winners.length || winners.some((id) => !seats.includes(id)))
    return null;
  if (
    scores &&
    (Object.keys(scores).length !== seats.length || seats.some((id) => scores[id] === undefined))
  )
    return null;
  return matchResultSchema.parse({
    players: seats.map((seatId) => ({
      seatId,
      winner: winners.includes(seatId),
      ...(scores ? { score: scores[seatId] } : {}),
    })),
  });
}
