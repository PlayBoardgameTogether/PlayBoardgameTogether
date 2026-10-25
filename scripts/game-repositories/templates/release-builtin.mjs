import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { URL, fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('release.config.json', root), 'utf8'));
const origin = JSON.parse(await readFile(new URL('SOURCE.json', root), 'utf8'));
const packageJson = JSON.parse(
  await readFile(new URL(`games/${config.key}/package.json`, root), 'utf8'),
);
const { manifest } = await import(new URL(`games/${config.key}/dist/shared/index.js`, root));
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.id, config.assets[0].id);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
const tag = `${config.key}-v${manifest.version}`;
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, tag);
const output = new URL('dist/release/', root);
await mkdir(output, { recursive: true });
assert.ok(process.env.npm_execpath, 'Run through pnpm verify');
execFileSync(
  process.execPath,
  [
    process.env.npm_execpath,
    '--filter',
    config.package,
    'pack',
    '--pack-destination',
    fileURLToPath(output),
  ],
  { cwd: fileURLToPath(root), stdio: 'inherit' },
);
const archives = (await readdir(output)).filter((path) => path.endsWith('.tgz'));
assert.equal(archives.length, 1, 'Release directory must contain one exact game version');
const filename = archives[0];
const sha256 = createHash('sha256')
  .update(await readFile(new URL(filename, output)))
  .digest('hex');
await writeFile(new URL('SHA256SUMS', output), `${sha256}  ${filename}\n`);
await writeFile(
  new URL('release.json', output),
  JSON.stringify(
    {
      repository: config.repository,
      commit: process.env.GITHUB_SHA ?? null,
      compatibilitySource: origin.commit,
      sdkVersion: origin.sdkVersion,
      format: 'builtin-npm-package',
      gameId: manifest.id,
      version: manifest.version,
      filename,
      sha256,
      tag,
    },
    null,
    2,
  ) + '\n',
);
