import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

export async function exportBuiltin({
  key,
  config,
  catalog,
  commit,
  platform,
  git,
  source,
  templates,
}) {
  const tree = (prefix) =>
    git('ls-tree', '-r', '--name-only', commit, '--', prefix)
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean);
  const ownedFiles = [
    ...tree(`games/${key}/`),
    ...config.scripts.map((name) => `scripts/${name}`),
    ...config.tests.map((name) => `tests/unit/${name}`),
    ...(config.docs ?? []),
  ];
  const paths = [...ownedFiles, ...tree('packages/game-sdk/'), 'tsconfig.base.json'];
  const files = new Map(paths.map((path) => [path, source(path)]));
  const json = (path, value) => files.set(path, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
  const gamePackage = JSON.parse(source(`games/${key}/package.json`).toString());
  json('SOURCE.json', {
    repository: catalog.platform,
    commit,
    game: key,
    platformVersion: platform.version,
    sdkVersion: JSON.parse(source('packages/game-sdk/package.json').toString()).version,
    ownedFiles,
    files: Object.fromEntries(
      paths.map((path) => [path, createHash('sha256').update(source(path)).digest('hex')]),
    ),
    adaptations: [],
  });
  json('release.config.json', {
    repository: `${catalog.platform.split('/')[0]}/${config.repository}`,
    key,
    package: gamePackage.name,
    assets: config.assets,
  });
  json('package.json', {
    name: config.repository,
    version: '0.0.0',
    private: true,
    type: 'module',
    packageManager: platform.packageManager,
    engines: { node: '>=22' },
    scripts: {
      test: 'vitest run tests/unit',
      typecheck: 'pnpm -r --if-present typecheck',
      build: 'pnpm -r --if-present build',
      verify: 'node --conditions=production scripts/release-builtin.mjs',
    },
    devDependencies: {
      [gamePackage.name]: 'workspace:*',
      '@boardgame/game-sdk': 'workspace:*',
      '@types/node': platform.devDependencies['@types/node'],
      vitest: platform.devDependencies.vitest,
      typescript: platform.devDependencies.typescript,
    },
  });
  files.set(
    'pnpm-workspace.yaml',
    Buffer.from('packages:\n  - games/*\n  - packages/*\nallowBuilds:\n  esbuild: true\n'),
  );
  files.set('.gitignore', Buffer.from('node_modules/\ndist/\n.data/\n.env\n.env.*\n*.log\n'));
  files.set(
    'pnpm-lock.yaml',
    Buffer.from(
      (await readFile(new URL('builtin-pnpm-lock.yaml', templates), 'utf8')).replaceAll(
        '__GAME__',
        key,
      ),
    ),
  );
  files.set('.gitattributes', Buffer.from('* text=auto eol=lf\n'));
  // Explicit pack allowlist includes compiled exports; no platform application or secrets.
  files.set(
    `games/${key}/.npmignore`,
    Buffer.from(
      '**\n!package.json\n!src/\n!src/**\n!dist/\n!dist/**\n!build.mjs\n!tsconfig*.json\n',
    ),
  );
  for (const [target, template] of [
    ['.github/workflows/game.yml', 'builtin-game.yml'],
    ['scripts/release-builtin.mjs', 'release-builtin.mjs'],
    ['AGENTS.md', 'game-AGENTS.md'],
  ])
    files.set(target, await readFile(new URL(template, templates)));
  files.set(
    'README.md',
    Buffer.from(
      `# PlayBoard · ${config.name}\n\n游戏规则、React 棋桌、AI 策略、资源契约、测试与独立版本的维护仓库。平台：[${catalog.platform}](https://github.com/${catalog.platform})。\n\n## 开发与验证\n\nNode.js 22，${platform.packageManager}。\n\n\`\`\`sh\npnpm install --frozen-lockfile\npnpm typecheck\npnpm test\npnpm build\npnpm verify\n\`\`\`\n\n游戏位于 \`games/${key}\`，兼容 SDK ${JSON.parse(source('packages/game-sdk/package.json').toString()).version}；\`packages/game-sdk\` 是来自平台 ${platform.version} 的固定兼容性快照，只用于独立开发和测试。不要把平台账号、房间、数据库或秘密加入本仓库。初始来源提交、原始摘要见 SOURCE.json，原文件保持不变，不代表完整 Git 历史迁移。\n\n## 发布\n\n游戏版本来自 \`games/${key}/package.json\`，必须与 manifest 一致。推送 \`${key}-vMAJOR.MINOR.PATCH\` 标签，在检查通过后创建独立 GitHub Release，附件为编译后的 npm 游戏包、SHA256SUMS 与 release.json。普通推送只产生验证产物。已发布版本不可覆盖。\n\n这是可信内置扩展，发布包 **不是在线安装 ZIP**。平台通过审查 PR 更新锁定的源码集成副本并构建部署；账号、动作、恢复和隐私仍由平台原链路负责。保留旧精确版本，禁止将旧对局静默切换到新规则。本仓库的发布不表示平台已经部署。\n\n后续修改只在本游戏仓库提交；平台的集成副本由锁文件记录本仓库完整提交 SHA。相关游戏说明见 docs/games（如有）；其中原平台联机验收命令仍在平台运行。\n`,
    ),
  );
  return { config, files };
}
