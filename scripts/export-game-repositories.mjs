import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { exportBuiltin } from './game-repositories/export-builtin.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const templates = new URL('./game-repositories/templates/', import.meta.url);
const catalog = JSON.parse(
  await readFile(new URL('./game-repositories/catalog.json', import.meta.url), 'utf8'),
);
const args = process.argv.slice(2);
let ref = 'HEAD';
let output = resolve(root, '.data/game-repository-exports');
const selected = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref' || args[i] === '--output') {
    const key = args[i++];
    if (!args[i] || args[i].startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--ref') ref = args[i];
    else output = resolve(args[i]);
  } else {
    if (!Object.hasOwn(catalog.games, args[i])) throw new Error(`Unknown game: ${args[i]}`);
    if (selected.includes(args[i])) throw new Error(`Duplicate game: ${args[i]}`);
    selected.push(args[i]);
  }
}
if (!selected.length) selected.push(...Object.keys(catalog.games));
const git = (...values) => execFileSync('git', values, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const commit = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`)
  .toString()
  .trim();
const source = (path) => git('show', `${commit}:${path}`);
const platform = JSON.parse(source('package.json').toString());
const api = JSON.parse(source('apps/api/package.json').toString());
const runtimeFiles = [
  'packages/game-sdk/src/index.ts',
  'apps/api/src/registry/package-runtime.ts',
  'apps/api/src/catalog/game-package.ts',
  'apps/api/src/catalog/package-art.ts',
  'apps/api/src/errors.ts',
];
// Resolve every input before touching the destination. Never export the dirty worktree.
const exports = [];
for (const key of selected) {
  const config = catalog.games[key];
  if (config.kind === 'builtin') {
    exports.push(
      await exportBuiltin({ key, config, catalog, commit, platform, git, source, templates }),
    );
    continue;
  }
  const paths = git('ls-tree', '-r', '--name-only', commit, '--', `game-packages/${key}/`)
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  if (
    paths.some(
      (path) =>
        !/\.(?:txt|html|json|md|svg|png)$/.test(path) ||
        path.split('/').some((part) => part.startsWith('.')),
    )
  ) {
    throw new Error(`Unexpected file in ${key}; review the export allowlist`);
  }
  if (!paths.length) throw new Error(`${key} has no committed source at ${commit}`);
  paths.push(...config.scripts.map((name) => `scripts/${name}`));
  paths.push(...config.tests.map((name) => `tests/unit/${name}`));
  paths.push(...(config.docs ?? []));
  const ownedFiles = [...paths];
  paths.push(...runtimeFiles);
  const files = new Map(paths.map((path) => [path, source(path)]));
  const protocol = source('packages/protocol/src/index.ts').toString();
  const errorTypes = protocol.match(
    /export const errorCodes = \[[\s\S]*?export type ErrorCode = \(typeof errorCodes\)\[number\];/,
  );
  if (!errorTypes) throw new Error('Cannot extract platform error types');
  files.set('apps/api/src/error-codes.ts', Buffer.from(errorTypes[0] + '\n'));
  files.set(
    'apps/api/src/errors.ts',
    Buffer.from(
      files
        .get('apps/api/src/errors.ts')
        .toString()
        .replace("'@boardgame/protocol'", "'./error-codes.js'"),
    ),
  );
  const provenance = {
    repository: catalog.platform,
    commit,
    game: key,
    platformVersion: platform.version,
    sdkVersion: JSON.parse(source('packages/game-sdk/package.json').toString()).version,
    ownedFiles,
    files: Object.fromEntries(
      paths.map((path) => [path, createHash('sha256').update(source(path)).digest('hex')]),
    ),
    adaptations: [
      'apps/api/src/errors.ts: type-only ErrorCode import points to an extracted platform error-code snapshot',
    ],
  };
  const packageJson = {
    name: config.repository,
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: platform.packageManager,
    engines: { node: '>=22' },
    scripts: {
      test: 'vitest run tests/unit',
      build: `node scripts/package-${key}.mjs`,
      verify: 'vitest run tests/release.test.ts',
      ...(key === 'uno' ? { 'test:ui': 'node scripts/check-uno-package.mjs' } : {}),
    },
    devDependencies: {
      '@playwright/test': platform.devDependencies['@playwright/test'],
      fflate: platform.devDependencies.fflate,
      'quickjs-emscripten': api.dependencies['quickjs-emscripten'],
      vitest: platform.devDependencies.vitest,
      zod: platform.devDependencies.zod,
    },
  };
  files.set('package.json', Buffer.from(JSON.stringify(packageJson, null, 2) + '\n'));
  files.set('AGENTS.md', await readFile(new URL('game-AGENTS.md', templates)));
  files.set('.gitattributes', Buffer.from('* text=auto eol=lf\n'));
  files.set('SOURCE.json', Buffer.from(JSON.stringify(provenance, null, 2) + '\n'));
  files.set(
    'release.config.json',
    Buffer.from(
      JSON.stringify(
        {
          repository: `${catalog.platform.split('/')[0]}/${config.repository}`,
          assets: config.assets,
        },
        null,
        2,
      ) + '\n',
    ),
  );
  files.set(
    '.gitignore',
    Buffer.from(
      'node_modules/\ndist/\n.data/\n.env\n.env.*\n*.log\nplaywright-report/\ntest-results/\n',
    ),
  );
  files.set('pnpm-lock.yaml', await readFile(new URL('pnpm-lock.yaml', templates)));
  files.set('pnpm-workspace.yaml', Buffer.from('packages: []\nallowBuilds:\n  esbuild: true\n'));
  files.set('vitest.config.mjs', await readFile(new URL('vitest.config.mjs', templates)));
  files.set('tests/release.test.ts', await readFile(new URL('release.test.ts', templates)));
  files.set('.github/workflows/game.yml', await readFile(new URL('game.yml', templates)));
  files.set(
    'README.md',
    Buffer.from(
      `# PlayBoard · ${config.name}\n\n独立游戏源码、测试和安装 ZIP 发布项目。平台主仓库：[${catalog.platform}](https://github.com/${catalog.platform})。\n\n## 本地构建\n\n使用 Node.js 22 和 ${platform.packageManager}。项目包含独立锁文件，使用冻结安装：\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm exec playwright install chromium\npnpm test\npnpm build\npnpm verify\n\`\`\`\n\n安装 ZIP 在 \`dist/game-packages/\`；验证后的发布附件、\`SHA256SUMS\` 与 \`release.json\` 在 \`dist/release/\`。ZIP 不提交 Git。\n\n## 独立发布\n\n普通推送、PR 和手动触发只测试和打包。按下面的标签格式推送会在检查通过后创建 GitHub Release：\n\n${config.assets.map((asset) => `- \`${asset.archive}-vMAJOR.MINOR.PATCH\` 对应 \`${asset.id}\`。`).join('\n')}\n\n标签必须与包内 manifest 的精确版本一致；版本来源为规则代码，根 package.json 的 0.0.0 仅为私有工具包占位号。同一游戏版本不得修改规则、桌面或美术后重新发布；已存在的 Release 不覆盖。UNO 的各玩法分别打标签、分别发布。\n\n管理员下载 Release 附件中的游戏 ZIP，核对 SHA256SUMS，再在平台游戏管理中检查和审核安装。GitHub 自动提供的 Source code.zip 不能直接安装。发布不会自动修改生产数据库或已开始的对局。\n\n## 来源与兼容性\n\n初始游戏和规则测试来自平台提交 \`${commit}\`，路径及原始摘要记录在 SOURCE.json。\`apps/api/src\` 和 \`packages/game-sdk/src\` 仅包含测试所需的固定兼容性快照，不启动平台 API，也不依赖主仓库工作区。可在明确的平台版本升级时更新该快照；生产安装仍以平台自身审核为准。\n\n玩法、素材和历史说明见 [游戏说明](game-packages/${key}/README.md)。其中平台集成/E2E 命令需在平台主仓库运行；本仓库的独立验证命令以上文为准。\n`,
    ),
  );
  exports.push({ config, files });
}
await mkdir(output, { recursive: false });
for (const { config, files } of exports) {
  const directory = resolve(output, config.repository);
  for (const [path, bytes] of files) {
    const target = resolve(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  console.log(`${config.repository}: ${files.size} files from ${commit}`);
}
console.log('Export complete. Each project includes its independent frozen lockfile.');
