import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { DeterministicRng, type GameExtension } from '../../packages/game-sdk/src/index.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';

type Action = { type: string; [key: string]: unknown };
type Player = {
  money: number;
  vp: number;
  idle: number;
  goods: number[];
  island: { good: number; workers: number }[];
  city: { id: number; workers: number }[];
};
type State = {
  seats: string[];
  players: Player[];
  governor: number;
  chooser: number;
  current: number;
  selected: number;
  round: number;
  move: number;
  role: number | null;
  phase: string;
  step: number;
  privilege: boolean;
  hacienda: boolean;
  produced: number[];
  wharves: boolean[];
  captainBonus: boolean;
  ending: boolean;
  roles: { money: number; owner: number | null }[];
  market: number[];
  deck: number[];
  discard: number[];
  quarries: number;
  buildings: number[];
  bank: number[];
  workers: number;
  workerShip: number;
  vp: number;
  ships: { capacity: number; good: number | null; load: number }[];
  trade: number[];
};
type View = {
  you: number;
  current: number;
  actions: Action[];
  deckCount: number;
  players: (Omit<Player, 'vp'> & {
    vp: number | null;
    result: {
      chips: number;
      buildings: number;
      bonus: { name: string; points: number }[];
      total: number;
      tie: number;
    } | null;
  })[];
  outcome: { status: string; winners?: string[]; scores?: Record<string, number> };
};
type Event = { type: string; [key: string]: unknown };
let game: GameExtension<State, Record<string, never>, Action, View, Event, Event>;
const viewer = (s: State, p = s.current) => ({ kind: 'seat' as const, seatId: s.seats[p]! });
const actor = (s: State, p = s.current) => ({ ...viewer(s, p), controllerEpoch: 0 });
function initial(count = 3, seed = 42) {
  const rng = new DeterministicRng(seed);
  return {
    rng,
    state: game.setup({ seats: ['a', 'b', 'c', 'd', 'e'].slice(0, count), options: {}, rng }).state,
  };
}
function act(s: State, a: Action, rng = new DeterministicRng(77)) {
  return game.applyAction(s, actor(s), a, rng).state;
}
function role(s: State, id: number, privilege = true) {
  s.phase = 'role';
  s.role = null;
  s.selected = 0;
  s.governor = s.current;
  s.roles.forEach((r) => {
    r.owner = null;
  });
  return act(s, { type: 'role', role: id, privilege });
}
function building(s: State, p: number, id: number, workers = 0) {
  s.buildings[id]!--;
  s.players[p]!.city.push({ id, workers });
  s.workers -= workers;
}
function tile(s: State, p: number, good: number, workers = 0) {
  if (good === 5) s.quarries--;
  else {
    const pool = [s.deck, s.market, s.discard].find((a) => a.includes(good))!;
    pool.splice(pool.indexOf(good), 1);
  }
  s.players[p]!.island.push({ good, workers });
  s.workers -= workers;
}
function goods(s: State, p: number, g: number, n: number) {
  s.players[p]!.goods[g]! += n;
  s.bank[g]! -= n;
}
function roundtrip(s: State) {
  expect(game.deserialize(game.serialize(s))).toEqual(s);
}
function finishOptional(s: State) {
  while (!['role', 'finished'].includes(s.phase)) {
    const a =
      game.getView(s, viewer(s)).actions.find((a) => a.type === 'pass') ??
      game.getView(s, viewer(s)).actions[0]!;
    s = act(s, a);
  }
  return s;
}

describe('Puerto Rico classic base game in isolated QuickJS', () => {
  beforeAll(async () => {
    const base = new URL('../../game-packages/puerto-rico/', import.meta.url);
    const shared = await readFile(new URL('shared.txt', base), 'utf8');
    const parsed = readGamePackage(
      Buffer.from(
        zipSync({
          'game.json': await readFile(new URL('game.json', base)),
          'server.js': Buffer.from(
            shared + '\n' + (await readFile(new URL('server.txt', base), 'utf8')),
          ),
          'client.html': Buffer.from(
            (await readFile(new URL('client.html', base), 'utf8')).replace(
              '/* PUERTO_RICO_SHARED */',
              shared,
            ),
          ),
        }),
      ),
    );
    game = (await PackageRuntime.create()).extension(parsed.server) as unknown as typeof game;
  });
  it('sets up exact 3–5 player supplies, starting tiles and deterministic RNG', () => {
    for (const n of [3, 4, 5]) {
      const { state: s, rng } = initial(n);
      expect(s).toEqual(initial(n).state);
      expect(rng.snapshot()).toEqual(initial(n).rng.snapshot());
      expect(s.roles.length).toBe(n + 3);
      expect(s.vp).toBe([75, 100, 122][n - 3]);
      expect(s.workers).toBe([55, 75, 95][n - 3]);
      expect(s.workerShip).toBe(n);
      expect(s.market).toHaveLength(n + 1);
      expect(s.ships.map((b) => b.capacity)).toEqual([n + 1, n + 2, n + 3]);
      expect(s.buildings.reduce((a, b) => a + b, 0)).toBe(49);
      expect(s.players.map((p) => p.money)).toEqual(Array(n).fill(n - 1));
      expect(s.players[(s.governor + n - 1) % n]!.island[0]!.good).toBe(0);
      expect(s.players[s.governor]!.island[0]!.good).toBe(1);
      roundtrip(s);
    }
    expect(() => initial(2)).toThrow();
    expect(() => game.validateOptions({ expansion: true })).toThrow();
  });
  it('enforces actor, strict payloads and all-worker placement without consuming state or RNG on failure', () => {
    const setup = initial();
    let s = setup.state;
    const rng = setup.rng;
    const before = structuredClone(s),
      saved = rng.snapshot();
    expect(() =>
      game.applyAction(
        s,
        actor(s, (s.current + 1) % 3),
        { type: 'role', role: 1, privilege: true },
        rng,
      ),
    ).toThrow();
    expect(() =>
      game.parseAction({ type: 'role', role: 1, privilege: true, seatId: s.seats[s.current] }),
    ).toThrow();
    expect(() => game.parseAction({ type: 'assign', island: [-1], city: [] })).toThrow();
    expect(s).toEqual(before);
    expect(rng.snapshot()).toEqual(saved);
    s = role(s, 1);
    const p = s.players[s.current]!;
    expect(p.idle).toBe(2);
    expect(() => act(s, { type: 'assign', island: [0], city: [] })).toThrow();
    // JSON object key order is irrelevant, including after PostgreSQL JSONB recovery.
    s = act(s, { city: [], island: [1], type: 'assign' });
    roundtrip(s);
  });
  it('rotates roles and governor, accumulates unused coins and excludes already chosen roles', () => {
    let s = initial().state;
    const governor = s.governor;
    for (const id of [0, 1, 2]) {
      s = roleForTurn(s, id);
      const chosen = s.roles.map((r, i) => (r.owner !== null ? i : -1)).filter((i) => i >= 0);
      if (s.round === 1)
        expect(
          game
            .getView(s, viewer(s))
            .actions.filter((a) => a.type === 'role')
            .every((a) => !chosen.includes(a.role as number)),
        ).toBe(true);
    }
    expect(s.round).toBe(2);
    expect(s.governor).toBe((governor + 1) % 3);
    expect(s.roles.map((r) => r.money)).toEqual([0, 0, 0, 1, 1, 1]);
    roundtrip(s);
  });
  it('handles hacienda before face-up choice, quarry privilege, hospice and tile reshuffling', () => {
    let s = initial().state;
    const p = s.current;
    building(s, p, 3, 1);
    building(s, p, 8, 1);
    s = role(s, 0);
    const count = s.players[p]!.island.length,
      top = s.deck.at(-1);
    s = act(s, { type: 'hacienda' });
    expect(s.current).toBe(p);
    expect(s.players[p]!.island.at(-1)).toEqual({ good: top, workers: 0 });
    expect(() => act(s, { type: 'hacienda' })).toThrow();
    s = act(s, { type: 'settle', good: 5, worker: true });
    expect(s.players[p]!.island.length).toBe(count + 2);
    expect(s.players[p]!.island.at(-1)).toEqual({ good: 5, workers: 1 });
    expect(() => act(s, { type: 'settle', good: 5, worker: true })).toThrow();
    roundtrip(s);
    s.discard.push(...s.deck);
    s.deck = [];
    s = finishOptional(s);
    expect(s.market).toHaveLength(4);
    roundtrip(s);
  });
  it('distributes mayor workers clockwise, allows arbitrary rearrangement and refills by empty city posts', () => {
    let s = initial(4).state;
    const p = s.current;
    building(s, p, 6);
    s.workerShip += 5;
    s.workers -= 5;
    s = role(s, 1);
    expect(s.players[p]!.idle).toBe(4);
    expect(s.players[(p + 1) % 4]!.idle).toBe(2);
    s = act(s, { type: 'assign', island: [1], city: [3] });
    s = finishOptional(s);
    expect(s.workerShip).toBe(4);
    roundtrip(s);
    let limited = initial().state;
    const q = limited.current;
    building(limited, q, 6);
    // All unused workers are held idle elsewhere, leaving one to refill the ship.
    limited.players[(q + 1) % 3]!.idle = limited.workers - 1;
    limited.workers = 1;
    limited = role(limited, 1, false);
    limited = finishOptional(limited);
    expect(limited.workerShip).toBe(1);
    expect(limited.ending).toBe(true);
    expect(limited.phase).toBe('role');
    roundtrip(limited);
  });
  it('applies quarry caps, unique buildings, city space limits and university supply/ship fallback', () => {
    let s = initial().state;
    const p = s.current;
    s.players[p]!.money = 30;
    tile(s, p, 5, 1);
    tile(s, p, 5, 1);
    tile(s, p, 5, 1);
    building(s, p, 15, 1);
    s = role(s, 2);
    let view = game.getView(s, viewer(s));
    expect((view as unknown as { costs: number[] }).costs[4]).toBe(0);
    expect((view as unknown as { costs: number[] }).costs[9]).toBe(2);
    const workers = s.workers;
    s = act(s, { type: 'build', building: 9, worker: true });
    expect(s.players[p]!.money).toBe(28);
    expect(s.players[p]!.city.at(-1)).toEqual({ id: 9, workers: 1 });
    expect(s.workers).toBe(workers - 1);
    roundtrip(s);
    s = role(s, 2);
    view = game.getView(s, viewer(s));
    expect(view.actions.some((a) => a.building === 9)).toBe(false);
    let university = initial().state;
    university.players[university.current]!.money = 20;
    university = role(university, 2);
    const u = university.current;
    university = act(university, { type: 'build', building: 15, worker: true });
    expect(university.players[u]!.city[0]!.workers).toBe(0);
    let fallback = initial().state;
    const f = fallback.current;
    building(fallback, f, 15, 1);
    fallback.players[f]!.money = 20;
    fallback.players[(f + 1) % 3]!.idle = fallback.workers;
    fallback.workers = 0;
    fallback = role(fallback, 2);
    fallback = act(fallback, { type: 'build', building: 2, worker: true });
    expect(fallback.workerShip).toBe(2);
    expect(fallback.players[f]!.city.at(-1)!.workers).toBe(1);
    roundtrip(fallback);
  });
  it('produces with matching staffed chains, factory actual types, ordered shortages and delayed craftsman bonus', () => {
    let s = initial().state;
    const p = s.current;
    tile(s, p, 0, 1);
    tile(s, p, 2, 1);
    building(s, p, 1, 1);
    building(s, p, 14, 1);
    s = role(s, 3);
    s = act(s, { type: 'produce' });
    expect(s.players[p]!.goods[0]).toBe(1);
    expect(s.players[p]!.goods[2]).toBe(1);
    expect(s.players[p]!.money).toBe(3);
    expect(s.phase).toBe('produce');
    s = act(s, { type: 'pass' });
    s = act(s, { type: 'pass' });
    expect(s.phase).toBe('bonus');
    expect(s.current).toBe(p);
    expect(() => act(s, { type: 'bonus', good: 4 })).toThrow();
    s = act(s, { type: 'bonus', good: 2 });
    expect(s.players[p]!.goods[2]).toBe(2);
    roundtrip(s);
    let shortage = initial().state;
    const q = shortage.current;
    tile(shortage, q, 0, 1);
    goods(shortage, (q + 1) % 3, 0, 10);
    shortage = role(shortage, 3);
    expect(game.getView(shortage, viewer(shortage)).actions.some((a) => a.type === 'produce')).toBe(
      false,
    );
  });
  it('respects trade duplicates, office, additive markets, privilege and phase-end-only clearing', () => {
    let s = initial().state;
    const p = s.current;
    building(s, p, 2, 1);
    building(s, p, 10, 1);
    goods(s, p, 4, 2);
    s = role(s, 4);
    s = act(s, { type: 'sell', good: 4 });
    expect(s.players[p]!.money).toBe(10);
    expect(s.trade).toEqual([4]);
    s = finishOptional(s);
    s.current = p;
    s = role(s, 4);
    expect(() => act(s, { type: 'sell', good: 4 })).toThrow();
    building(s, p, 9, 1);
    s = act(s, { type: 'sell', good: 4 });
    expect(s.trade).toEqual([4, 4]);
    roundtrip(s);
    let full = initial().state;
    for (const g of [0, 1, 2]) {
      full.trade.push(g);
      full.bank[g]!--;
    }
    goods(full, full.current, 3, 1);
    full = role(full, 4);
    full = act(full, { type: 'sell', good: 3 });
    expect(full.trade).toHaveLength(4);
    expect(game.getView(full, viewer(full)).actions).toEqual([{ type: 'pass' }]);
    full = finishOptional(full);
    expect(full.trade).toEqual([]);
    roundtrip(full);
  });
  it('forces maximum shipping, restricts ship kinds, awards one captain bonus and unloads only full ships', () => {
    let s = initial().state;
    const p = s.current;
    goods(s, p, 0, 6);
    goods(s, (p + 1) % 3, 1, 2);
    s = role(s, 5);
    expect(() => act(s, { type: 'pass' })).toThrow();
    expect(() => act(s, { type: 'ship', good: 0, ship: 0 })).toThrow();
    s = act(s, { type: 'ship', good: 0, ship: 2 });
    expect(s.players[p]!.vp).toBe(7);
    expect(s.ships[2]!.load).toBe(6);
    s = act(s, { type: 'ship', good: 1, ship: 0 });
    expect(s.phase).toBe('role');
    expect(s.ships[2]!.load).toBe(0);
    expect(s.ships[0]!.load).toBe(2);
    roundtrip(s);
  });
  it('supports optional private wharves, per-shipment harbor points and one loose barrel plus warehouse types', () => {
    let s = initial().state;
    const p = s.current;
    building(s, p, 16, 1);
    building(s, p, 17, 1);
    goods(s, p, 0, 7);
    goods(s, p, 4, 2);
    s = role(s, 5);
    s = act(s, { type: 'ship', good: 0, ship: 3 });
    expect(s.players[p]!.vp).toBe(9);
    expect(s.wharves[p]).toBe(true);
    s = act(s, { type: 'ship', good: 4, ship: 0 });
    expect(s.players[p]!.vp).toBe(12);
    roundtrip(s);
    let stored = initial().state;
    const q = stored.current;
    building(stored, q, 5, 1);
    goods(stored, q, 3, 5);
    goods(stored, q, 4, 3);
    // Fill public ships with other kinds to force storage.
    [0, 1, 2].forEach((g, i) => {
      stored.ships[i]!.good = g;
      stored.ships[i]!.load = 1;
      stored.bank[g]!--;
    });
    stored = role(stored, 5);
    expect(stored.phase).toBe('store');
    expect(() => act(stored, { type: 'store', keep: [0, 0, 0, 5, 2] })).toThrow();
    stored = act(stored, { type: 'store', keep: [0, 0, 0, 5, 1] });
    expect(stored.players[q]!.goods).toEqual([0, 0, 0, 5, 1]);
    roundtrip(stored);
  });
  it('hides VP chips, final bonuses and deck order from opponents, spectators, events and AI', () => {
    let s = initial().state;
    const p = s.current;
    goods(s, p, 0, 1);
    s = role(s, 5);
    const transition = game.applyAction(
      s,
      actor(s),
      { type: 'ship', good: 0, ship: 0 },
      new DeterministicRng(7),
    );
    s = transition.state;
    const own = game.getView(s, viewer(s, p)),
      other = game.getView(s, viewer(s, (p + 1) % 3)),
      spectator = game.getView(s, { kind: 'spectator' });
    expect(own.players[p]!.vp).toBe(2);
    expect(other.players[p]!.vp).toBeNull();
    expect(other.players[p]!.result).toBeNull();
    expect(spectator.players.every((x) => x.vp === null)).toBe(true);
    expect('deck' in own).toBe(false);
    expect(spectator.actions).toEqual([]);
    expect(
      game
        .projectEvents(transition.events, viewer(s, (p + 1) % 3))
        .some((e) => 'points' in e || 'vp' in e),
    ).toBe(false);
    expect(game.getDecisionContext!(s, viewer(s, (s.current + 1) % 3))).toBeNull();
  });
  it('finishes at round end, includes all five large bonuses and uses money plus goods as tie-break', () => {
    let s = initial().state;
    const p = s.current;
    s.players[p]!.money = 30;
    // Reach exactly 12 city spaces via an authorized building action, without ending the role or round early.
    for (const id of [18, 19, 20, 21, 22, 0]) building(s, p, id, 1);
    tile(s, p, 0, 1);
    s = role(s, 2);
    s = act(s, { type: 'build', building: 1, worker: false });
    expect(s.ending).toBe(true);
    expect(s.phase).toBe('build');
    s = finishOptional(s);
    expect(s.phase).toBe('role');
    s = roleForTurn(s, 0);
    s = roleForTurn(s, 3);
    expect(s.phase).toBe('finished');
    roundtrip(s);
    const result = game.getView(s, viewer(s, p)).players[p]!.result!;
    expect(result.bonus.map((b) => b.name)).toEqual(['公会大厅', '官邸', '要塞', '海关', '市政厅']);
    expect(result.buildings).toBe(22);
    expect(result.bonus.find((b) => b.name === '公会大厅')!.points).toBe(2);
    expect(result.bonus.find((b) => b.name === '市政厅')!.points).toBe(5);
    expect(game.getOutcome(s)).toMatchObject({ status: 'finished', winners: [s.seats[p]] });
    s.players.forEach((p) => {
      p.vp = 0;
      p.city = [];
      p.money = 3;
      p.goods.fill(0);
    });
    s.players[1]!.goods[0] = 1;
    expect(game.getOutcome(s)).toMatchObject({ winners: [s.seats[1]] });
    s.players[2]!.money = 4;
    expect(game.getOutcome(s)).toMatchObject({ winners: [s.seats[1], s.seats[2]] });
  });
  it('rejects corrupt conserved supplies and phase ownership, while tolerating JSON key reordering', () => {
    const s = initial().state;
    for (const mutate of [
      (s: State) => s.bank[0]!--,
      (s: State) => s.deck.pop(),
      (s: State) => s.players[0]!.idle++,
      (s: State) => s.buildings[0]!--,
      (s: State) => {
        s.current = (s.current + 1) % 3;
      },
    ]) {
      const broken = structuredClone(s);
      mutate(broken);
      expect(() => game.deserialize(broken)).toThrow();
    }
    expect(game.deserialize(Object.fromEntries(Object.entries(s).reverse()))).toEqual(s);
  });
  it.each([3, 4, 5])(
    'completes a %i-player script game, restoring every move and accepting every proposed action',
    (n) => {
      const setup = initial(n, 131);
      let s = setup.state;
      const rng = setup.rng;
      let steps = 0;
      while (s.phase !== 'finished' && steps < 2500) {
        const v = game.getView(s, viewer(s)),
          context = game.getDecisionContext!(s, viewer(s))!;
        expect(context.legalActions.length).toBeGreaterThan(0);
        const action = game.getFallbackAction(v, game.getActionSpec(s, viewer(s)))!;
        game.validateAction(s, actor(s), action);
        s = game.applyAction(s, actor(s), action, rng).state;
        roundtrip(s);
        steps++;
      }
      expect(s.phase).toBe('finished');
      expect(steps).toBeLessThan(2500);
      expect(game.getOutcome(s)).toMatchObject({ status: 'finished' });
    },
    120000,
  );
});
function roleForTurn(s: State, id: number) {
  s = act(s, { type: 'role', role: id, privilege: true });
  return finishOptional(s);
}
