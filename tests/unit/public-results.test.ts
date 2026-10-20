import { describe, expect, it } from 'vitest';
import { publicResult } from '../../apps/api/src/registry/public-results.js';

describe('explicitly public result projection', () => {
  it('keeps tied winners and negative/zero scores, discarding all other fields', () => {
    expect(
      publicResult(
        {
          status: 'finished',
          winners: ['a', 'b'],
          scores: { a: 0, b: -2 },
          privateHands: { a: ['secret'] },
          reason: 'internal detail',
        },
        ['a', 'b'],
      ),
    ).toEqual({
      players: [
        { seatId: 'a', winner: true, score: 0 },
        { seatId: 'b', winner: true, score: -2 },
      ],
    });
    expect(publicResult({ status: 'finished', winners: ['b'] }, ['a', 'b'])).toEqual({
      players: [
        { seatId: 'a', winner: false },
        { seatId: 'b', winner: true },
      ],
    });
  });

  it('rejects unfinished, foreign, duplicate or incomplete results', () => {
    for (const outcome of [
      { status: 'ongoing' },
      { status: 'finished', winners: ['other'] },
      { status: 'finished', winners: ['a', 'a'] },
      { status: 'finished', winners: ['a'], scores: { a: 1 } },
    ])
      expect(publicResult(outcome, ['a', 'b'])).toBeNull();
  });
});
