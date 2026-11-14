import { beforeAll, describe, expect, it } from 'vitest';
import { DeterministicRng } from '../../packages/game-sdk/src/index.js';
import { readGamePackage } from '../../apps/api/src/catalog/game-package.js';
import { packagePublicResult } from '../../apps/api/src/registry/package-public-result.js';
import { PackageRuntime } from '../../apps/api/src/registry/package-runtime.js';
import { gamePackageFiles, gamePackageZip, zipSync, strToU8 } from '../fixtures/game-package.js';

describe('bounded online game packages', () => {
  let runtime: PackageRuntime;
  beforeAll(async () => { runtime = await PackageRuntime.create(); });
  it('accepts the playable fixed-file package and rejects malformed and unsafe archives', async () => {
    const bytes = await gamePackageZip();
    expect(readGamePackage(bytes).format).toBe('boardgame-package-v1');
    const files = await gamePackageFiles();
    for (const bad of [Buffer.from('not a zip'), bytes.subarray(0, bytes.length - 1),
      Buffer.from(zipSync({ ...files, '../escape.js': strToU8('x') })),
      Buffer.from(zipSync({ ...files, 'client.html': strToU8('x'.repeat(2 * 1024 * 1024)) })),
      Buffer.from(zipSync({ ...files, 'game.json': strToU8('{"format":"wrong"}') })),
      Buffer.alloc(5 * 1024 * 1024 + 1)]) expect(() => readGamePackage(bad)).toThrow();
  });
  it('runs deterministic transitions and does not advance RNG for failed rules', async () => {
    const { server } = readGamePackage(await gamePackageZip());
    const extension = runtime.extension(server);
    const rng = new DeterministicRng(123), clone = rng.clone();
    const initial = extension.setup({ seats: ['a', 'b'], options: {}, rng });
    const actor = { kind: 'seat' as const, seatId: 'a', controllerEpoch: 0 };
    const action = extension.parseAction({ type: 'claim' });
    const first = extension.applyAction(initial.state, actor, action, rng);
    expect(first).toEqual(extension.applyAction(initial.state, actor, action, clone));
    expect(rng.snapshot()).toEqual(clone.snapshot());
    expect(extension.deserialize(extension.serialize(first.state))).toEqual(first.state);
    expect(extension.getView(first.state, { kind: 'seat', seatId: 'b' })).toMatchObject({ canClaim: true });
    const broken = runtime.extension(server + '\ngame.applyAction = (s,a,c,rng) => { rng.nextInt(1,3); throw new Error("fail"); };');
    const before = rng.snapshot();
    expect(() => broken.applyAction(initial.state, actor, action, rng)).toThrow();
    expect(rng.snapshot()).toEqual(before);
  });
  it('blocks host APIs and non-deterministic globals and terminates infinite loops', async () => {
    const { server } = readGamePackage(await gamePackageZip());
    for (const access of ['process.env', 'require("node:fs")', 'fetch("https://example.com")', 'new Date()', 'Math.random()', 'Function("return process")()']) {
      const extension = runtime.extension(server + `\ngame.validateOptions = () => ${access};`);
      expect(() => extension.validateOptions({})).toThrow();
    }
    const started = Date.now();
    expect(() => runtime.extension('while(true) {}')).toThrow();
    expect(Date.now() - started).toBeLessThan(2000);
    const memory = runtime.extension(server + '\ngame.validateOptions = () => "x".repeat(32 * 1024 * 1024);');
    expect(() => memory.validateOptions({})).toThrow();
  });
  it('projects private events inside the rule VM before returning data', async () => {
    const { server } = readGamePackage(await gamePackageZip());
    const extension = runtime.extension(server + '\ngame.projectEvents = (events, viewer) => events.filter(event => event.seat === viewer.seatId).map(event => ({type:event.type,secret:event.secret}));');
    expect(extension.projectEvents([{ type: 'private', seat: 'a', secret: 'alice' }, { type: 'private', seat: 'b', secret: 'bob' }], { kind: 'seat', seatId: 'a' })).toEqual([{ type: 'private', secret: 'alice' }]);
  });
});

describe('explicit package public results', () => {
  let runtime: PackageRuntime;
  let server: string;
  beforeAll(async () => {
    runtime = await PackageRuntime.create();
    server = readGamePackage(await gamePackageZip()).server;
  });
  it('keeps old descriptors valid and rejects unknown contracts', async () => {
    const files = await gamePackageFiles();
    const descriptor = JSON.parse(files['game.json'].toString());
    expect(readGamePackage(await gamePackageZip()).publicResult).toBeUndefined();
    for (const contract of ['winners-scores-v1', 'unknown', null, {}]) {
      const bytes = Buffer.from(
        zipSync({
          ...files,
          'game.json': strToU8(
            JSON.stringify({
              ...descriptor,
              publicResult: contract,
            }),
          ),
        }),
      );
      if (contract === 'winners-scores-v1')
        expect(readGamePackage(bytes).publicResult).toBe(contract);
      else expect(() => readGamePackage(bytes)).toThrow();
    }
    expect(() => runtime.publicResult(server)).toThrow('缺少公开结果方法');
  });
  it('preserves explicit null, shared wins and optional full scores in participant order', () => {
    const project = runtime.publicResult(server + '\ngame.getPublicResult = outcome => outcome;');
    expect(project(null, ['a', 'b'])).toBeNull();
    expect(project({ winners: ['b'] }, ['a', 'b'])).toEqual({
      players: [
        { seatId: 'a', winner: false },
        { seatId: 'b', winner: true },
      ],
    });
    expect(project({ winners: ['b', 'a'], scores: { b: 0, a: -1.5 } }, ['a', 'b'])).toEqual({
      players: [
        { seatId: 'a', winner: true, score: -1.5 },
        { seatId: 'b', winner: true, score: 0 },
      ],
    });
  });
  it.each([
    ['empty winners', { winners: [] }],
    ['duplicate winners', { winners: ['a', 'a'] }],
    ['unknown winner', { winners: ['outsider'] }],
    ['partial scores', { winners: ['a'], scores: { a: 1 } }],
    ['extra scores', { winners: ['a'], scores: { a: 1, b: 0, outsider: 2 } }],
    ['unknown score keys', { winners: ['a'], scores: { a: 1, outsider: 0 } }],
    ['extra secret fields', { winners: ['a'], hands: 'SECRET_RESULT_MARKER' }],
    ['missing winners', {}],
    ['wrong type', false],
  ])('rejects %s without exposing the rejected value', (_name, value) => {
    try {
      packagePublicResult(value, ['a', 'b']);
      expect.fail('should reject');
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', message: '游戏包公开结果无效' });
      expect(JSON.stringify(error)).not.toContain('SECRET_RESULT_MARKER');
    }
  });
  it.each([
    'undefined',
    'Promise.resolve(null)',
    'NaN',
    '({ winners: ["a"], scores: { a: NaN, b: 0 } })',
    '({ winners: ["a"], scores: { a: Infinity, b: 0 } })',
    '({ winners: ["a"], scores: undefined })',
    '({ winners: [undefined] })',
    '({ winners: ["a"], toJSON() { return {winners:["a"]}; } })',
    '({ winners: ["a"], secret: undefined })',
    '({ winners: ["a".repeat(20000)] })',
  ])('rejects non-JSON or oversized VM output: %s', (expression) => {
    const project = runtime.publicResult(server + `\ngame.getPublicResult = () => ${expression};`);
    expect(() => project({}, ['a', 'b'])).toThrow('游戏包公开结果无效');
  });
  it.each([
    'throw new Error("SECRET_RESULT_MARKER")',
    'while (true) {}',
    'return "x".repeat(32 * 1024 * 1024)',
    'return process.env',
  ])('contains VM exceptions and limits: %s', (body) => {
    const project = runtime.publicResult(server + `\ngame.getPublicResult = () => { ${body}; };`);
    try {
      project({}, ['a', 'b']);
      expect.fail('should reject');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ACTION_NOT_ALLOWED' });
      expect(JSON.stringify(error)).not.toContain('SECRET_RESULT_MARKER');
    }
  });
});
