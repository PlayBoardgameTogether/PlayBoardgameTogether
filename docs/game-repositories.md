# 平台与独立游戏仓库

2026-10-25 用户确认：游戏统一放在 [PlayBoardgameTogether 组织](https://github.com/orgs/PlayBoardgameTogether)，**每个游戏单独一个仓库，以后也沿用此规则**。平台主仓库继续维护网站、认证、房间、对局事务、数据库、通用 SDK、游戏运行时、管理员安装及部署。

## 已创建的游戏仓库

| 游戏           | 仓库                                                                                              | 现有游戏版本  | 发布格式         |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------- | ---------------- |
| UNO 及毫不留情 | [playboard-game-uno](https://github.com/PlayBoardgameTogether/playboard-game-uno)                 | 1.2.0 / 1.0.0 | 分别发布安装 ZIP |
| 五子棋         | [playboard-game-gomoku](https://github.com/PlayBoardgameTogether/playboard-game-gomoku)           | 1.0.3         | 安装 ZIP         |
| 拉密           | [playboard-game-rummikub](https://github.com/PlayBoardgameTogether/playboard-game-rummikub)       | 1.0.3         | 安装 ZIP         |
| 卡坦岛         | [playboard-game-catan](https://github.com/PlayBoardgameTogether/playboard-game-catan)             | 1.0.1         | 安装 ZIP         |
| 波多黎各       | [playboard-game-puerto-rico](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico) | 1.0.0         | 安装 ZIP         |
| 阿瓦里         | [playboard-game-awari](https://github.com/PlayBoardgameTogether/playboard-game-awari)             | 1.0.0         | 安装 ZIP         |
| Color Match    | [playboard-game-color-match](https://github.com/PlayBoardgameTogether/playboard-game-color-match) | 1.0.0         | 可信内置集成 tgz |
| Grid Garden    | [playboard-game-grid-garden](https://github.com/PlayBoardgameTogether/playboard-game-grid-garden) | 1.0.0         | 可信内置集成 tgz |
| 璀璨宝石       | [playboard-game-splendor](https://github.com/PlayBoardgameTogether/playboard-game-splendor)       | 1.0.0         | 可信内置集成 tgz |
| 花砖物语       | [playboard-game-azul](https://github.com/PlayBoardgameTogether/playboard-game-azul)               | 1.0.0         | 可信内置集成 tgz |

源码已分别提交并推送。各仓库完整提交、兼容平台/SDK 版本及集成文件的 Git blob SHA 记录在 [来源锁](../game-repositories.lock.json)，实际验证与发布结果记录在 [开发进度](progress.md)。开发实验台和身份验收用 Test Counter 留在平台。UNO 相关玩法共用一个仓库，分别维护游戏 ID、版本和 Release 标签。

## 唯一维护来源与平台副本

游戏仓库拥有游戏源码、棋桌、AI 策略、资源契约、规则测试、打包脚本和游戏说明。主仓库现有 `games/*`、`game-packages/*` 以及锁文件列出的脚本、测试和游戏说明保留为**锁定集成副本**，供既有 registry、workspace、测试准备及生产构建使用，不再在平台直接开发游戏。

这是源码所有权与发布分离，平台 Git 中仍保留集成快照，并非已物理清空游戏目录。游戏原始字节、ID、版本、registry 路径和旧对局恢复能力保持；平台检出后不需要在启动时联网拉取游戏仓库。内置游戏继续构建装配，未转换成在线包，不支持独立热更新。取舍见 [ADR-009](adr/009-independent-game-repositories.md)。

```powershell
# 本地比较 Git blob，兼容 Windows 行尾。
node scripts/check-game-repositories.mjs

# 再与 GitHub 精确提交的 tree 核对，需可用的 gh 登录。
node scripts/check-game-repositories.mjs --remote
```

主仓库 CI 自动执行远程核对，拒绝副本漂移、未锁定文件和未登记的玩家游戏。通用 SDK 与解析器只在平台维护；游戏仓库中的固定快照仅用于独立构建/兼容性测试，不启动平台服务、不读取数据库，也不代表 SDK 已发布到 npm。

## 后续开发与平台引入

新游戏及棋桌、美术、交互更新先读平台的[桌游体验开发指南](game-experience-guidelines.md)，将本次采用的参考版本、双端布局图、核心物件美术与动画验收落实到对应游戏仓库的任务说明；独立仓库维护自己的图稿、素材许可和运行截图。平台指南是统一要求的入口，不把平台集成副本作为美术开发来源。

1. 在对应游戏仓库获取 main，创建功能分支，修改游戏、验证、提交、推送并通过 PR 交付。游戏变化维护自身版本，不因此提升平台版本；已发布精确版本不能覆盖。
2. 如需更新平台的内置集成或 ZIP 回归夹具，在平台获取 main 并审查变更，再引入已经审查的游戏完整提交 SHA：

   ```powershell
   git -C <独立游戏目录> fetch origin main
   node scripts/import-game-repository.mjs <游戏键> <独立游戏目录> <40位已审查提交SHA>
   node scripts/check-game-repositories.mjs --remote
   ```

   导入器核对已登记 origin、精确提交和文件范围，拒绝覆盖本地修改，不执行外部游戏代码。审查差异、运行受影响的平台验证，再提交包含副本及来源锁的平台 PR。导入器不会自动迁移已有对局，也不会保留被替换版本的全部装配；规则版本升级时，必须额外审查精确版本 registry 和旧局恢复方案，不能静默替换旧版本。

3. 在线 ZIP 的生产安装仍由管理员下载、核对摘要、检查并审核；平台副本更新、游戏仓库推送或 Release 均不代表已经安装或上架。

新游戏采用 `PlayBoardgameTogether/playboard-game-<英文游戏名>` 的独立仓库，不把无关游戏放在一起。平台只接收通用能力及经过审查的集成变更。添加玩家游戏集成时，同时登记 catalog、来源锁、装配和测试，不在平台开设第二处开发来源。

## 独立构建与发布

每个游戏仓库自带 README、AGENTS.md、冻结锁文件和 GitHub Actions。使用 Node.js 22、pnpm 11.15.1；在线包仓库运行：

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
pnpm build
pnpm verify
```

内置仓库不需要 Playwright，额外执行 `pnpm typecheck`。内置 `pnpm verify` 校验 manifest 与包版本一致，生成 tgz 和摘要；在线包把最终 ZIP 交给平台固定版本解析器和真实 QuickJS，验证最小/最大人数、恢复、本人视图和合法初始动作。原游戏规则测试一并运行。这些是独立兼容性检查，不冒充全平台 HTTP、权限、数据库、手机或真实联机验收。

普通 main 推送、PR 和手动工作流只验证并提供短期 Actions artifact；推送 `<archive>-v<精确版本>` 标签，在检查通过后创建 GitHub Release，附件包含游戏 ZIP 或内置 tgz、`SHA256SUMS` 和 `release.json`。例如 `gomoku-v1.0.3`、`azul-v1.0.0`，UNO 分别使用 `uno-v1.2.0`、`uno-no-mercy-v1.0.0`。已存在的 Release 不覆盖；不同系统的 PNG 字体渲染可能产生不同 ZIP 摘要，核对该次实际附件。

**GitHub 自动提供的 Source code.zip 和内置 tgz 不能在在线 ZIP 管理中安装。** 内置 tgz 是可信构建集成产物，不是公开 npm SDK，不授予上传代码进入 Node.js 的权限。

## 来源与导出工具

首次源码来自平台提交 `a7e36d32e2febeb5bd7013752f099d01d0502316`（平台 0.17.0、SDK 0.1.0），未包含当时工作区的未提交改动。每个 SOURCE.json 记录原文件摘要、兼容快照及必要类型导入适配。这是精确初始源码归档，不是全部 Git 历史迁移；平台历史继续保留。

`scripts/export-game-repositories.mjs` 为首次拆仓/复现保留：

```powershell
node scripts/export-game-repositories.mjs --ref <已审查平台提交> --output <尚不存在的目录>
```

默认导出全部 10 个仓库，也可指定游戏键。工具读取 Git 提交对象，不读取未提交游戏修改，不复制 .env、会话、数据库、第三方本机资源或生成物。后续维护使用已建立的游戏仓库，不反复导出覆盖独立仓库。本批只改变开发/发布工具与内部文档，不改变平台运行行为，平台版本保持 0.17.0。
