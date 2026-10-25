import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';

// Build-time integration copies are immutable inputs, maintained in the game repos.
const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(
  await readFile(new URL('../game-repositories.lock.json', import.meta.url), 'utf8'),
);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const owned = new Map();
const sources = new Set();
for (const [game, entry] of Object.entries(lock.games)) {
  if (
    !/^PlayBoardgameTogether\/playboard-game-[a-z-]+$/.test(entry.repository) ||
    !/^[0-9a-f]{40}$/.test(entry.commit)
  )
    throw new Error(`Invalid pin: ${game}`);
  if (entry.source !== `games/${game}` && entry.source !== `game-packages/${game}`)
    throw new Error(`Invalid source directory: ${game}`);
  sources.add(entry.source);
  const remoteFiles = process.argv.includes('--remote')
    ? new Map(
        JSON.parse(
          execFileSync(
            'gh',
            ['api', `repos/${entry.repository}/git/trees/${entry.commit}?recursive=1`],
            { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
          ),
        ).tree.map((file) => [file.path, file]),
      )
    : null;
  if (remoteFiles) {
    for (const file of remoteFiles.values()) {
      if (
        file.type === 'blob' &&
        file.path.startsWith(entry.source + '/') &&
        file.path !== `${entry.source}/.npmignore` &&
        !Object.hasOwn(entry.files, file.path)
      )
        throw new Error(
          `Game source omitted from the integration pin: ${entry.repository}:${file.path}`,
        );
    }
  }
  for (const [path, blob] of Object.entries(entry.files)) {
    if (owned.has(path)) throw new Error(`Shared game-owned path: ${path}`);
    owned.set(path, game);
    if (
      remoteFiles &&
      (remoteFiles.get(path)?.type !== 'blob' || remoteFiles.get(path)?.sha !== blob)
    )
      throw new Error(`Pin does not match the published game commit: ${entry.repository}:${path}`);
    if (git('hash-object', `--path=${path}`, '--', path) !== blob) {
      throw new Error(
        `${path} differs from ${entry.repository}@${entry.commit}. Update the game repository first, then import and pin its reviewed commit.`,
      );
    }
  }
  const paths = git('ls-files', '--cached', '--others', '--exclude-standard', '--', entry.source)
    .split('\n')
    .filter(Boolean);
  for (const path of paths)
    if (!Object.hasOwn(entry.files, path)) throw new Error(`Unpinned game file: ${path}`);
}
for (const path of git(
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '--',
  'games',
  'game-packages',
)
  .split('\n')
  .filter(Boolean)) {
  const source = path.split('/').slice(0, 2).join('/');
  if (source !== 'games/test-counter' && !sources.has(source))
    throw new Error(`Game must have its own registered repository: ${source}`);
}
console.log(
  `Game repository pins verified: ${Object.keys(lock.games).length} repositories, ${owned.size} integration files.`,
);
