import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary: string[] = [];
const run = (...args: string[]) =>
  execFileSync(process.execPath, ['scripts/export-game-repositories.mjs', ...args], {
    cwd: root,
    stdio: 'pipe',
  });

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('independent game repository export', () => {
  it('exports a builtin with its complete SDK fixture, original tests and independent build workflow', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boardgame-builtin-export-'));
    temporary.push(directory);
    const output = join(directory, 'games');
    run('--output', output, 'azul');
    const game = join(output, 'playboard-game-azul');
    const origin = JSON.parse(await readFile(join(game, 'SOURCE.json'), 'utf8'));
    for (const path of origin.ownedFiles) {
      expect(await readFile(join(game, path))).toEqual(
        execFileSync('git', ['show', `${origin.commit}:${path}`], { cwd: root }),
      );
    }
    expect(origin.ownedFiles).toContain('scripts/azul-audio.ts');
    expect(origin.ownedFiles).not.toContain('packages/game-sdk/src/index.ts');
    expect(await readFile(join(game, 'packages/game-sdk/package.json'), 'utf8')).toContain(
      '@boardgame/game-sdk',
    );
    expect(await readFile(join(game, '.github/workflows/game.yml'), 'utf8')).toContain(
      'pnpm typecheck',
    );
    await expect(readFile(join(game, 'apps/api/src/main.ts'))).rejects.toThrow();
    await expect(readFile(join(game, 'games/splendor/package.json'))).rejects.toThrow();
  }, 20000);

  it('exports committed game bytes, original rule regressions and pinned compatibility sources without workspace dependencies', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boardgame-export-'));
    temporary.push(directory);
    const output = join(directory, 'games');
    run('--output', output, 'gomoku');
    const game = join(output, 'playboard-game-gomoku');
    const origin = JSON.parse(await readFile(join(game, 'SOURCE.json'), 'utf8'));
    expect(origin.repository).toBe('PlayBoardgameTogether/PlayBoardgameTogether');
    const release = JSON.parse(await readFile(join(game, 'release.config.json'), 'utf8'));
    expect(release.repository).toBe('PlayBoardgameTogether/playboard-game-gomoku');
    for (const [path, hash] of Object.entries(origin.files)) {
      const source = execFileSync('git', ['show', `${origin.commit}:${path}`], { cwd: root });
      expect(createHash('sha256').update(source).digest('hex')).toBe(hash);
      if (path !== 'apps/api/src/errors.ts')
        expect(await readFile(join(game, path))).toEqual(source);
    }
    const manifest = JSON.parse(await readFile(join(game, 'package.json'), 'utf8'));
    expect(await readFile(join(game, 'pnpm-lock.yaml'), 'utf8')).toContain('lockfileVersion:');
    expect(
      Object.values(manifest.devDependencies).some((version) =>
        String(version).includes('workspace:'),
      ),
    ).toBe(false);
    expect(manifest.scripts.build).toBe('node scripts/package-gomoku.mjs');
    await expect(readFile(join(game, '.env'))).rejects.toThrow();
    await expect(readFile(join(game, 'apps/api/src/main.ts'))).rejects.toThrow();
    await expect(readFile(join(game, 'game-packages/uno/server.txt'))).rejects.toThrow();
    expect(await readFile(join(game, '.github/workflows/game.yml'), 'utf8')).toContain(
      'pnpm install --frozen-lockfile',
    );
  });

  it('does not publish dirty rules or untracked secrets from the source workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'boardgame-export-dirty-'));
    temporary.push(directory);
    const fixture = join(directory, 'source');
    execFileSync('git', ['clone', '--shared', '--quiet', root, fixture]);
    await cp(
      join(root, 'scripts/export-game-repositories.mjs'),
      join(fixture, 'scripts/export-game-repositories.mjs'),
    );
    await cp(join(root, 'scripts/game-repositories'), join(fixture, 'scripts/game-repositories'), {
      recursive: true,
    });
    const expected = execFileSync('git', ['show', 'HEAD:game-packages/gomoku/server.txt'], {
      cwd: fixture,
    });
    await writeFile(join(fixture, 'game-packages/gomoku/server.txt'), 'uncommitted rules');
    await writeFile(join(fixture, 'game-packages/gomoku/.env'), 'EXPORT_TEST_SECRET=fixture-only');
    const output = join(directory, 'export');
    execFileSync(
      process.execPath,
      ['scripts/export-game-repositories.mjs', '--output', output, 'gomoku'],
      { cwd: fixture },
    );
    const game = join(output, 'playboard-game-gomoku');
    expect(await readFile(join(game, 'game-packages/gomoku/server.txt'))).toEqual(expected);
    await expect(readFile(join(game, 'game-packages/gomoku/.env'))).rejects.toThrow();
  }, 20000);

  it('refuses existing destinations and invalid selections before overwriting files', async () => {
    const output = await mkdtemp(join(tmpdir(), 'boardgame-export-existing-'));
    temporary.push(output);
    await writeFile(join(output, 'keep.txt'), 'keep');
    expect(() => run('--output', output, 'gomoku')).toThrow();
    expect(await readFile(join(output, 'keep.txt'), 'utf8')).toBe('keep');
    expect(() => run('--output', join(output, 'unknown'), '../uno')).toThrow();
    expect(() =>
      run('--output', join(output, 'bad-ref'), '--ref', 'missing-game-export-ref', 'gomoku'),
    ).toThrow();
    await expect(readFile(join(output, 'unknown'))).rejects.toThrow();
    await expect(readFile(join(output, 'bad-ref'))).rejects.toThrow();
  });
});
