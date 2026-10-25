import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it('rejects modified, added and missing files in a pinned game integration copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'game-pins-'));
  temporary.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'games/example'), { recursive: true });
  await cp(
    new URL('../../scripts/check-game-repositories.mjs', import.meta.url),
    join(root, 'scripts/check-game-repositories.mjs'),
  );
  const path = 'games/example/rules.txt';
  await writeFile(join(root, path), 'original\n');
  git('add', '--', path);
  await writeFile(
    join(root, 'game-repositories.lock.json'),
    JSON.stringify({
      games: {
        example: {
          repository: 'PlayBoardgameTogether/playboard-game-example',
          commit: 'a'.repeat(40),
          source: 'games/example',
          files: { [path]: git('hash-object', `--path=${path}`, '--', path) },
        },
      },
    }),
  );
  const check = () =>
    execFileSync(process.execPath, ['scripts/check-game-repositories.mjs'], {
      cwd: root,
      stdio: 'pipe',
    });
  expect(check().toString()).toContain('1 repositories');
  await writeFile(join(root, path), 'changed\n');
  expect(check).toThrow();
  await writeFile(join(root, path), 'original\n');
  await writeFile(join(root, 'games/example/unpinned.txt'), 'new rules\n');
  expect(check).toThrow();
  await rm(join(root, 'games/example/unpinned.txt'));
  await rm(join(root, path));
  expect(check).toThrow();
});

it('imports only a registered exact game commit and refuses to overwrite local changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'game-import-'));
  temporary.push(directory);
  const platform = join(directory, 'platform');
  const game = join(directory, 'game');
  for (const root of [platform, game]) {
    await mkdir(join(root, 'games/example'), { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: root });
  }
  await mkdir(join(platform, 'scripts/game-repositories'), { recursive: true });
  await cp(
    new URL('../../scripts/import-game-repository.mjs', import.meta.url),
    join(platform, 'scripts/import-game-repository.mjs'),
  );
  await writeFile(
    join(platform, 'scripts/game-repositories/catalog.json'),
    JSON.stringify({ games: { example: { scripts: [], tests: [] } } }),
  );
  const path = 'games/example/rules.txt';
  await writeFile(join(platform, path), 'old rules\n');
  const blob = execFileSync('git', ['hash-object', `--path=${path}`, '--', path], {
    cwd: platform,
    encoding: 'utf8',
  }).trim();
  const lockPath = join(platform, 'game-repositories.lock.json');
  await writeFile(
    lockPath,
    JSON.stringify({
      games: {
        example: {
          repository: 'PlayBoardgameTogether/playboard-game-example',
          commit: 'a'.repeat(40),
          source: 'games/example',
          files: { [path]: blob },
        },
      },
    }),
  );
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: game, encoding: 'utf8' }).trim();
  git(
    'remote',
    'add',
    'origin',
    'https://github.com/PlayBoardgameTogether/playboard-game-example.git',
  );
  await writeFile(join(game, path), 'reviewed rules\n');
  await writeFile(join(game, 'games/example/new.txt'), 'new resource\n');
  await writeFile(join(game, 'games/example/.npmignore'), '**\n');
  git('add', '--', 'games/example');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@invalid',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  );
  const commit = git('rev-parse', 'HEAD');
  const run = (ref = commit) =>
    execFileSync(process.execPath, ['scripts/import-game-repository.mjs', 'example', game, ref], {
      cwd: platform,
      stdio: 'pipe',
    });
  await writeFile(join(platform, path), 'local uncommitted work\n');
  expect(() => run()).toThrow();
  expect(await readFile(join(platform, path), 'utf8')).toBe('local uncommitted work\n');
  await expect(readFile(join(platform, 'games/example/new.txt'))).rejects.toThrow();
  await writeFile(join(platform, path), 'old rules\n');
  expect(() => run('main')).toThrow();
  git('remote', 'set-url', 'origin', 'https://github.com/OtherOrg/other-game.git');
  expect(() => run()).toThrow();
  git(
    'remote',
    'set-url',
    'origin',
    'https://github.com/PlayBoardgameTogether/playboard-game-example.git',
  );
  run();
  expect(await readFile(join(platform, path), 'utf8')).toBe('reviewed rules\n');
  expect(await readFile(join(platform, 'games/example/new.txt'), 'utf8')).toBe('new resource\n');
  await expect(readFile(join(platform, 'games/example/.npmignore'))).rejects.toThrow();
  const locked = JSON.parse(await readFile(lockPath, 'utf8')).games.example;
  expect(locked.commit).toBe(commit);
  expect(locked.files[path]).toBe(git('rev-parse', `${commit}:${path}`));
}, 20000);
