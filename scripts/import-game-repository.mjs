import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

// Import a reviewed, already-fetched game commit. Never execute game code here.
const root = fileURLToPath(new URL('../', import.meta.url));
const [key, directory, commit] = process.argv.slice(2);
if (!key || !directory || !/^[0-9a-f]{40}$/.test(commit ?? '') || process.argv.length !== 5) {
  throw new Error(
    'Usage: node scripts/import-game-repository.mjs <game> <local-repository> <full-reviewed-SHA>',
  );
}
const catalog = JSON.parse(
  await readFile(resolve(root, 'scripts/game-repositories/catalog.json'), 'utf8'),
);
const lockPath = resolve(root, 'game-repositories.lock.json');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const config = catalog.games[key];
const previous = lock.games[key];
if (!config || !previous) throw new Error('Register and review the new game before importing it');
const repository = resolve(directory);
const git = (cwd, ...args) => execFileSync('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
const remote = git(repository, 'remote', 'get-url', 'origin')
  .toString()
  .trim()
  .replace(/\.git$/, '');
if (remote !== `https://github.com/${previous.repository}`)
  throw new Error('Game repository origin does not match the registered repository');
if (git(repository, 'rev-parse', '--verify', `${commit}^{commit}`).toString().trim() !== commit)
  throw new Error('Missing exact commit');
const paths = git(
  repository,
  'ls-tree',
  '-r',
  '--name-only',
  commit,
  '--',
  previous.source,
  ...config.scripts.map((name) => `scripts/${name}`),
  ...config.tests.map((name) => `tests/unit/${name}`),
  ...(config.docs ?? []),
)
  .toString()
  .trim()
  .split('\n')
  .filter((path) => path && path !== `${previous.source}/.npmignore`);
if (!paths.some((path) => path.startsWith(previous.source + '/')))
  throw new Error('Game source is missing');
// Preflight the complete batch, protecting local edits and path boundaries.
for (const [path, blob] of Object.entries(previous.files)) {
  if (git(root, 'hash-object', `--path=${path}`, '--', path).toString().trim() !== blob)
    throw new Error(`Local changes in ${path}; preserve them before importing`);
}
const incoming = new Map();
const files = {};
for (const path of paths) {
  if (
    path.split('/').some((part) => part === '..' || part.startsWith('.')) ||
    !/\.(?:[cm]?[jt]sx?|json|yaml|txt|html|md|css|svg|png)$/.test(path)
  )
    throw new Error(`Review unexpected game file: ${path}`);
  if (!Object.hasOwn(previous.files, path)) {
    try {
      await readFile(resolve(root, path));
      throw new Error(`New game file would overwrite ${path}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const metadata = git(repository, 'ls-tree', commit, '--', path).toString();
  if (!metadata.startsWith('100644 blob ') && !metadata.startsWith('100755 blob '))
    throw new Error(`Not a regular game source: ${path}`);
  incoming.set(path, git(repository, 'show', `${commit}:${path}`));
  files[path] = git(repository, 'rev-parse', `${commit}:${path}`).toString().trim();
}
for (const [path, bytes] of incoming) {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), bytes);
}
for (const path of Object.keys(previous.files))
  if (!incoming.has(path)) await rm(resolve(root, path));
lock.games[key] = { ...previous, commit, files };
await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
console.log(
  `Imported ${previous.repository}@${commit}; review the diff and run affected platform checks before committing.`,
);
