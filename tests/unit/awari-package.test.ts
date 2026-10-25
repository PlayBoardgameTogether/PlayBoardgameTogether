import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { DeterministicRng, type GameExtension } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';

type Action = { type: 'sow'; pit: number };
type Last = {
  player: number;
  pit: number;
  sown: number;
  lastPit: number;
  captured: number;
  grandSlam: boolean;
};
type State = {
  seats: string[];
  pits: number[];
  scores: number[];
  turn: number;
  moveCount: number;
  history: string[];
  last: Last | null;
  endReason: string | null;
};
type View = {
  pits: number[];
  players: { seatId: string; score: number }[];
  you: string | null;
  yourIndex: number | null;
  currentSeat: string | null;
  moveCount: number;
  mustFeed: boolean;
  actions: Action[];
  previews: {
    pit: number;
    path: number[];
    captured: number;
    lastPit: number;
    capturedPits: number[];
    grandSlam: boolean;
  }[];
};
let game: GameExtension<State, Record<string, never>, Action, View, unknown, unknown>;
const actor = (seatId: string) => ({ kind: 'seat' as const, seatId, controllerEpoch: 0 });
const viewer = (seatId: string) => ({ kind: 'seat' as const, seatId });
const action = (pit: number): Action => ({ type: 'sow', pit });
const rng = () => new DeterministicRng(37);
const key = (s: State) => [s.turn, ...s.scores, ...s.pits].join(',');
const initial = () => game.setup({ seats: ['a', 'b'], options: {}, rng: rng() }).state;
function position(pits: number[], scores = [0, 0], turn = 0): State {
  const state: State = {
    seats: ['a', 'b'],
    pits,
    scores,
    turn,
    moveCount: turn === 0 ? 2 : 3,
    history: [],
    last: {
      player: 1 - turn,
      pit: (1 - turn) * 6,
      sown: 1,
      lastPit: (1 - turn) * 6 + 1,
      captured: 0,
      grandSlam: false,
    },
    endReason: null,
  };
  state.history = [key(state)];
  return game.deserialize(state);
}
const play = (s: State, pit: number) =>
  game.applyAction(s, actor(s.seats[s.turn]!), action(pit), rng());
const total = (s: State) => [...s.pits, ...s.scores].reduce((a, b) => a + b, 0);

describe('Awari Abapa ZIP in the real bounded QuickJS runtime', () => {
  beforeAll(async () => {
    const base = new URL('../../game-packages/awari/', import.meta.url);
    const files = {
      'game.json': await readFile(new URL('game.json', base)),
      'server.js': await readFile(new URL('server.txt', base)),
      'client.html': await readFile(new URL('client.html', base)),
    };
    const parsed = readGamePackage(Buffer.from(zipSync(files)));
    game = (await PackageRuntime.create()).extension(parsed.server) as unknown as typeof game;
  });
  it('installs, restores and exposes only the current participant’s legal actions without RNG consumption', () => {
    const random = rng(),
      before = random.snapshot();
    const { state } = game.setup({ seats: ['a', 'b'], options: {}, rng: random });
    expect(game.manifest.players).toEqual({ min: 2, max: 2 });
    expect(state.pits).toEqual(Array(12).fill(4));
    expect(game.deserialize(game.serialize(state))).toEqual(state);
    const view = game.getView(state, viewer('a'));
    expect(view.actions).toHaveLength(6);
    expect(view).not.toHaveProperty('history');
    expect(game.getDecisionContext!(state, viewer('a'))?.legalActions).toEqual(view.actions);
    for (const identity of [viewer('b'), viewer('intruder'), { kind: 'spectator' as const }]) {
      expect(game.getView(state, identity).actions).toEqual([]);
      expect(game.getDecisionContext!(state, identity)).toBeNull();
    }
    expect(game.getView(state, viewer('intruder')).you).toBeNull();
    const result = game.applyAction(state, actor('a'), action(0), random);
    expect(result.state.pits).toEqual([0, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4]);
    expect(state).toEqual(initial());
    expect(random.snapshot()).toEqual(before);
    expect(game.projectEvents(result.events, viewer('b'))).toEqual(result.events);
  });
  it('rejects forged actions, wrong turns, empty pits and corrupt saves without changing state or RNG', () => {
    for (const value of [
      action(-1),
      action(12),
      action(0.5),
      { ...action(0), seatId: 'a' },
      { type: 'pass' },
    ]) {
      expect(() => game.parseAction(value)).toThrow();
    }
    expect(() => game.validateOptions({ seed: 4 })).toThrow();
    expect(() => game.setup({ seats: ['a', 'a'], options: {}, rng: rng() })).toThrow();
    const state = initial(),
      saved = structuredClone(state),
      random = rng();
    for (const bad of [
      actor('b'),
      actor('intruder'),
      { kind: 'system' as const, purpose: 'test' },
    ]) {
      expect(() => game.applyAction(state, bad, action(0), random)).toThrow();
    }
    expect(() => play(state, 6)).toThrow();
    const empty = position([0, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4]);
    expect(() => play(empty, 0)).toThrow();
    for (const bad of [
      { ...state, scores: [1, 0] },
      { ...state, pits: Array(12).fill(3) },
      { ...state, turn: 1 },
      { ...state, extra: true },
      { ...state, history: ['bad'] },
      { ...state, seats: ['a'] },
      { ...state, endReason: 'majority' },
    ]) {
      expect(() => game.deserialize(bad)).toThrow();
    }
    expect(state).toEqual(saved);
    expect(random.snapshot()).toEqual(rng().snapshot());
  });
  it('skips the original pit on every lap, including a sow longer than two laps', () => {
    const state = position([24, 0, 0, 0, 0, 0, 4, 4, 4, 4, 4, 4]);
    const result = play(state, 0).state;
    expect(result.pits).toEqual([0, 3, 3, 2, 2, 2, 6, 6, 6, 6, 6, 6]);
    const preview = game.getView(state, viewer('a')).previews.find((p) => p.pit === 0)!;
    expect(preview.path).toHaveLength(24);
    expect(preview.path).not.toContain(0);
    expect(preview.lastPit).toBe(2);
    expect(total(result)).toBe(48);
  });
  it('captures backwards only from the last landing pit and stops at the first non-two/three pit', () => {
    const state = position([0, 0, 0, 0, 0, 3, 1, 2, 1, 4, 10, 10], [9, 8]);
    const result = play(state, 5).state;
    expect(result.scores).toEqual([16, 8]);
    expect(result.pits.slice(6)).toEqual([0, 0, 0, 4, 10, 10]);
    expect(result.last?.captured).toBe(7);
    expect(game.getView(state, viewer('a')).previews[0]?.capturedPits).toEqual([8, 7, 6]);
    const noCapture = position([0, 0, 0, 0, 0, 3, 1, 1, 4, 4, 10, 10], [8, 7]);
    expect(play(noCapture, 5).state.scores).toEqual([8, 7]);
    // Landing at index zero must capture without wrapping backwards into the actor's own row.
    const north = position([1, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 1], [13, 13], 1);
    expect(play(north, 11).state.scores).toEqual([13, 15]);
  });
  it('cancels the entire capture when it would take all opposing seeds', () => {
    const state = position([1, 0, 0, 0, 0, 2, 1, 2, 0, 0, 0, 0], [20, 22]);
    const preview = game.getView(state, viewer('a')).previews.find((p) => p.pit === 5)!;
    expect(preview.grandSlam).toBe(true);
    expect(preview.captured).toBe(0);
    expect(preview.capturedPits).toEqual([]);
    const result = play(state, 5).state;
    expect(result.pits.slice(6, 8)).toEqual([2, 3]);
    expect(result.scores).toEqual([20, 22]);
    expect(result.endReason).toBeNull();
  });
  it('forces feeding, and collects remaining seeds if the next player cannot feed', () => {
    const feed = position([1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0], [22, 22]);
    expect(game.getView(feed, viewer('a')).mustFeed).toBe(true);
    expect(game.getView(feed, viewer('a')).actions).toEqual([action(5)]);
    expect(() => play(feed, 0)).toThrow();
    expect(play(feed, 5).state.pits.slice(6, 9)).toEqual([1, 1, 1]);
    const ending = position([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], [23, 23]);
    // Grand slam is cancelled; opponent then has two seeds too far from the empty side to feed.
    const result = play(ending, 5).state;
    expect(result.endReason).toBe('no-feed');
    expect(result.pits).toEqual(Array(12).fill(0));
    expect(result.scores).toEqual([23, 25]);
    expect(game.getOutcome(result)).toMatchObject({ status: 'finished', winners: ['b'] });
  });
  it('ends immediately at a majority and supports a collected 24–24 draw', () => {
    const state = position([0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2], [23, 13]);
    const result = play(state, 5).state;
    expect(result.endReason).toBe('majority');
    expect(result.scores[0]).toBe(25);
    expect(total(result)).toBe(48);
    expect(game.getView(result, viewer('a')).actions).toEqual([]);
    expect(() => play(result, 0)).toThrow();
    const draw = position([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], [24, 22]);
    expect(game.getOutcome(play(draw, 5).state)).toMatchObject({
      status: 'finished',
      winners: [],
      scores: { a: 24, b: 24 },
    });
  });
  it('settles threefold repetition and the documented quiet cap, and persists the counter', () => {
    const state = position([1, 0, 0, 0, 0, 1, 3, 0, 0, 0, 0, 0], [21, 22]);
    const next = play(state, 5).state;
    state.moveCount = 10;
    state.history = [key(next), key(next), key(state)];
    const repeated = play(game.deserialize(state), 5).state;
    expect(repeated.endReason).toBe('repetition');
    expect(repeated.scores).toEqual([22, 26]);
    expect(total(repeated)).toBe(48);
    const quiet = initial();
    quiet.moveCount = 200;
    quiet.last = { player: 1, pit: 6, sown: 1, lastPit: 7, captured: 0, grandSlam: false };
    // Distinct, conserved public positions model 199 prior non-capturing moves.
    quiet.history = Array.from({ length: 199 }, (_, i) => {
      const pits = Array(12).fill(0);
      pits[i % 12] = 24;
      pits[Math.floor(i / 12) % 12] += 24;
      return [i % 2, 0, 0, ...pits].join(',');
    });
    quiet.history.push(key(quiet));
    const capped = play(game.deserialize(quiet), 0).state;
    expect(capped.endReason).toBe('quiet-limit');
    expect(capped.pits).toEqual(Array(12).fill(0));
    expect(total(capped)).toBe(48);
    expect(game.deserialize(game.serialize(capped))).toEqual(capped);
  });
  it('completes two deterministic scripts with legal actions, exact previews and recoverable saves', () => {
    let state = initial();
    const random = rng();
    for (let count = 0; count < 5000 && game.getOutcome(state).status === 'ongoing'; count++) {
      const identity = viewer(state.seats[state.turn]!);
      const view = game.getView(state, identity);
      const chosen = game.getFallbackAction(view, game.getActionSpec(state, identity))!;
      expect(chosen).toEqual(game.getDecisionContext!(state, identity)!.legalActions[0]);
      const predicted = view.previews.find((p) => p.pit === chosen.pit)!;
      const result = game.applyAction(state, actor(identity.seatId), chosen, random);
      expect(result.state.last).toMatchObject({
        captured: predicted.captured,
        lastPit: predicted.lastPit,
      });
      state = game.deserialize(game.serialize(result.state));
      expect(total(state)).toBe(48);
      if (count === 4999) throw new Error('Scripts failed to finish');
    }
    expect(game.getOutcome(state).status).toBe('finished');
    expect(random.snapshot()).toEqual(rng().snapshot());
    expect(game.getDecisionContext!(state, viewer('a'))).toBeNull();
  }, 30_000);
});
