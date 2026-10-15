import { describe, expect, it, vi } from 'vitest';
import { resolve, join, dirname, basename } from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { githubRemote, safeStaticPath, applyPrepared, ensureReleaseEnvironment } from '../../scripts/online-update.mjs';

describe('production online updates', () => {
  it('supplies the maintenance env-file without copying secrets or overwriting local settings', async () => {
    const path = await mkdtemp(join(tmpdir(), 'boardgame-update-env-'));
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith('boardgame-update-env-')) throw new Error('Unexpected cleanup target');
    try {
      await ensureReleaseEnvironment(path);
      expect(await readFile(join(path, '.env'), 'utf8')).toBe('# Configuration inherited from update supervisor.\n');
      await writeFile(join(path, '.env'), 'CUSTOM_SETTING=keep\n');
      await ensureReleaseEnvironment(path);
      expect(await readFile(join(path, '.env'), 'utf8')).toBe('CUSTOM_SETTING=keep\n');
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
  it('accepts the configured GitHub repository, rejects credentials and foreign hosts', () => {
    expect(githubRemote('https://github.com/Rst307/PlayBoardgameTogether.git')).toBe('https://github.com/Rst307/PlayBoardgameTogether.git');
    expect(githubRemote('git@github.com:Rst307/PlayBoardgameTogether.git')).toBe('https://github.com/Rst307/PlayBoardgameTogether.git');
    for (const url of ['https://token@github.com/a/b.git', 'https://github.com.evil/a/b', 'https://example.com/a/b', 'https://github.com/a/b?token=x']) {
      expect(() => githubRemote(url)).toThrow();
    }
  });
  it('serves the homepage and confines decoded paths to static files', () => {
    const root = resolve('fixture/web');
    expect(safeStaticPath(root, '/')).toBe(resolve(root, 'index.html'));
    expect(safeStaticPath(root, '/assets/app.js')).toBe(resolve(root, 'assets/app.js'));
    for (const url of ['/%2e%2e%2fsecret', '/%5csecret', '/%00secret', '/%zz']) expect(safeStaticPath(root, url)).toBeNull();
  });
  function fixture(idle = true) {
    const old = { sha: 'old', path: 'old' };
    const next = { sha: 'new', path: 'new' };
    const deps = {
      current: () => old, drain: vi.fn(async () => idle), stop: vi.fn(async () => undefined),
      start: vi.fn(async (release: typeof old) => { void release; }), backup: vi.fn(async () => undefined), prepareDatabase: vi.fn(async () => undefined),
      persist: vi.fn(async () => undefined), activate: vi.fn(), resume: vi.fn(),
    };
    return { old, next, deps };
  }
  it('does not stop or migrate the live service while busy', async () => {
    const { deps, next } = fixture(false);
    expect(await applyPrepared(deps, next)).toBe(false);
    expect(deps.stop).not.toHaveBeenCalled(); expect(deps.prepareDatabase).not.toHaveBeenCalled();
    expect(deps.backup).not.toHaveBeenCalled();
  });
  it('publishes only after readiness and persisted release selection', async () => {
    const { deps, next } = fixture();
    expect(await applyPrepared(deps, next)).toBe(true);
    expect(deps.start).toHaveBeenCalledWith(next);
    expect(deps.stop.mock.invocationCallOrder[0]).toBeLessThan(deps.backup.mock.invocationCallOrder[0]!);
    expect(deps.backup.mock.invocationCallOrder[0]).toBeLessThan(deps.prepareDatabase.mock.invocationCallOrder[0]!);
    expect(deps.start.mock.invocationCallOrder[0]).toBeLessThan(deps.persist.mock.invocationCallOrder[0]!);
    expect(deps.persist.mock.invocationCallOrder[0]).toBeLessThan(deps.activate.mock.invocationCallOrder[0]!);
    expect(deps.resume).toHaveBeenCalledOnce();
  });
  it.each(['backup', 'prepareDatabase', 'start', 'persist'] as const)('restores the old process on %s failure without activating new files', async stage => {
    const { deps, old, next } = fixture();
    deps[stage].mockRejectedValueOnce(new Error('failure'));
    await expect(applyPrepared(deps, next)).rejects.toThrow('failure');
    expect(deps.start).toHaveBeenLastCalledWith(old);
    expect(deps.activate).not.toHaveBeenCalled(); expect(deps.resume).toHaveBeenCalledOnce();
  });
  it('reports recovery failure explicitly when both candidate and previous API fail', async () => {
    const { deps, next } = fixture();
    deps.start.mockRejectedValue(new Error('private startup details'));
    await expect(applyPrepared(deps, next)).rejects.toMatchObject({ reason: 'recovery_failed' });
    expect(deps.activate).not.toHaveBeenCalled();
    expect(deps.resume).toHaveBeenCalledOnce();
  });
});

