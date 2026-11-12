# 平台与独立游戏仓库

2026-10-25 用户确认：游戏统一放在 [PlayBoardgameTogether 组织](https://github.com/orgs/PlayBoardgameTogether)，**每个游戏单独一个仓库，以后也沿用此规则**。平台主仓库继续维护网站、认证、房间、对局事务、数据库、通用 SDK、游戏运行时、管理员安装及部署。

2026-11-01 头像批次的十个游戏 PR 已合并；波多黎各正式发布至 1.1.1，其他在线头像候选尚未打标发布，表内保留其原正式版本。合并、附件校验及订阅/生产边界见 [本批交付记录](game-avatar-art-2026-11-01.md)。

2026-11-06 [D4 实测清点](daily-release-audit-2026-11-06.md)：七套正式 ZIP/release.json/SHA256SUMS 和 QuickJS 包冒烟通过，生产启用版本均与下表一致；其中五子棋、拉密、卡坦岛的生产包摘要与同版本正式附件不同，具体组件差异已记录，保留原安装字节。其余六个头像玩法仍待正式发布，不能据 main 合并推断已上线。登记已核对，无需改动；平台来源锁保持不变。

## 已创建的游戏仓库

| 游戏           | 仓库                                                                                              | 正式发布版本  | 发布格式         |
| -------------- | ------------------------------------------------------------------------------------------------- | ------------- | ---------------- |
| UNO 及毫不留情 | [playboard-game-uno](https://github.com/PlayBoardgameTogether/playboard-game-uno)                 | 1.2.1 / 1.0.1 | 分别发布安装 ZIP |
| 五子棋         | [playboard-game-gomoku](https://github.com/PlayBoardgameTogether/playboard-game-gomoku)           | 1.0.3         | 安装 ZIP         |
| 拉密           | [playboard-game-rummikub](https://github.com/PlayBoardgameTogether/playboard-game-rummikub)       | 1.0.3         | 安装 ZIP         |
| 卡坦岛         | [playboard-game-catan](https://github.com/PlayBoardgameTogether/playboard-game-catan)             | 1.0.1         | 安装 ZIP         |
| 波多黎各       | [playboard-game-puerto-rico](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico) | 1.1.2         | 安装 ZIP         |
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

3. 在线 ZIP 可由管理员下载、核对摘要、检查并审核安装；在已部署订阅功能且管理员明确启用对应开关的平台，也可自动安装已登记的官方正式发布包。平台副本更新、游戏仓库推送或 Release 本身均不代表已经安装或上架；每次开发/更新的登记检查见下节。

新游戏采用 `PlayBoardgameTogether/playboard-game-<英文游戏名>` 的独立仓库，不把无关游戏放在一起。平台只接收通用能力及经过审查的集成变更。添加玩家游戏集成时，同时登记 catalog、来源锁、装配和测试，不在平台开设第二处开发来源。

## 官方游戏目录登记与每次发布检查

**每次开发新游戏或更新已有游戏都要执行本节。** 官方订阅读取平台主仓库 main 的 [`scripts/game-repositories/catalog.json`](../scripts/game-repositories/catalog.json)，不会仅凭组织中新建仓库自动收录；游戏接入申请的资料审阅也不代替目录登记。订阅操作与限制见 [官方游戏订阅](game-subscription.md)。

### 新游戏登记

1. 在 `PlayBoardgameTogether` 组织建立 `playboard-game-<英文游戏名>` 独立仓库，完成游戏开发、兼容验证及发布配置。
2. 在平台目录的 `games` 下新增唯一键，例如以下 `my-game`（示例，不是已登记游戏）：

   ```json
   "my-game": {
     "repository": "playboard-game-my-game",
     "name": "我的游戏",
     "assets": [
       { "id": "online.my-game", "archive": "my-game" }
     ]
   }
   ```

   `repository` 是官方组织内的仓库短名；`assets[].id` 必须与安装包内规则 manifest.id、独立仓库 release.config.json 的 assets[].id 完全一致；`archive` 与发布配置一致，用作标签和 ZIP 名前缀。同一仓库的扩展玩法在 assets 中逐项登记，UNO 沿用一个仓库多个条目。内置游戏继续设置 `kind: "builtin"`，不进入在线 ZIP 订阅。scripts/tests/docs 仅列实际需要纳入平台集成的文件；新增集成副本还须按既有导入流程维护来源锁及装配，不能只添加目录绕过审查。
3. 单独提交平台目录 PR，并补充本文仓库清单。目录必须合入平台 main 才会被订阅读取；游戏实现提交留在独立游戏仓库。
4. 按独立仓库发布流程生成并校验正式 Release。例如 `my-game-v1.0.0` 的附件应包含 `my-game-1.0.0.zip`、release.json 和 SHA256SUMS；清单中的 repository、gameId、version、filename、tag、sha256 必须与仓库、包和附件一致。已有工作流生成这些清单，不手填摘要或使用 GitHub 自动提供的 Source code.zip。

### 已有游戏更新

- 每次核对目录项的仓库、名称、游戏 ID、包名前缀和扩展玩法；有变化时更新目录及相关发布配置。正常版本升级保留原游戏 ID、archive 和目录键，目录不保存“最新版号”，不能靠换 ID 伪装成新游戏。元数据未变化时无需改 JSON，但交付中须写明“登记已核对，无需改动”。
- 修改规则、桌面或资源后提升游戏自身版本，并按 `<archive>-v<版本>` 发布新标签和正式 Release；不能覆盖同版本规则或旧附件。新增玩法在同仓库 assets 中补登记并使用独立 ID/archive，逐玩法核对发布标签。
- 实际发布成功后更新本文清单的游戏版本及游戏仓库文档。`game-repositories.lock.json` 是平台精确集成来源，不是订阅最新版本表；仅在平台正式导入经过审查的完整 SHA 时更新，保留原有对局版本，不随游戏发布自动改锁。
- 验证目录 main 已包含登记、正式 Release 及附件可读取；在已具备订阅功能的平台启用相应开关后，可用「游戏管理 → 官方游戏订阅 → 立即同步」核对实际结果。已下架游戏保持下架，内置游戏仍需平台构建部署。未执行安装验证时明确记录原因，不能将发布当成上架。

每次交付至少说明：**目录新增/调整或已核对无需改动；目录 PR/提交；游戏版本和 Release/附件实际状态；订阅同步结果或未验证原因**。本文是后续开发的交付检查，不授权覆盖旧版本、自动合并或绕过安装权限。

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

除下述波多黎各自动发布流程外，普通 main 推送、PR 和手动工作流只验证并提供短期 Actions artifact；推送 `<archive>-v<精确版本>` 标签，在检查通过后创建 GitHub Release，附件包含游戏 ZIP 或内置 tgz、`SHA256SUMS` 和 `release.json`。例如 `gomoku-v1.0.3`、`azul-v1.0.0`，UNO 分别使用 `uno-v1.2.0`、`uno-no-mercy-v1.0.0`。已存在的 Release 不覆盖；不同系统的 PNG 字体渲染可能产生不同 ZIP 摘要，核对该次实际附件。

**波多黎各自 2026-11-01 起采用 main 自动发布**（[游戏 PR #3](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/pull/3)）：合入 main 或在 main 手动运行工作流，完整检查通过后读取包内精确版本，自动创建缺失标签和正式 Release；标签推送入口保留，PR 仅验证。完整的正式旧版本跳过，不移动旧标签或覆盖附件；冲突标签、草稿/预发布、缺失附件及授权/网络错误报错。当前 [1.1.0 Release](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.0) 由 main 提交 `75e83f66a1fca7c7d44891b2773806957623bc8f` 自动发布，三个附件实际可下载且摘要一致。其他仓库的触发方式保持原样。

**GitHub 自动提供的 Source code.zip 和内置 tgz 不能在在线 ZIP 管理中安装。** 内置 tgz 是可信构建集成产物，不是公开 npm SDK，不授予上传代码进入 Node.js 的权限。

## 来源与导出工具

首次源码来自平台提交 `a7e36d32e2febeb5bd7013752f099d01d0502316`（平台 0.17.0、SDK 0.1.0），未包含当时工作区的未提交改动。每个 SOURCE.json 记录原文件摘要、兼容快照及必要类型导入适配。这是精确初始源码归档，不是全部 Git 历史迁移；平台历史继续保留。

`scripts/export-game-repositories.mjs` 为首次拆仓/复现保留：

```powershell
node scripts/export-game-repositories.mjs --ref <已审查平台提交> --output <尚不存在的目录>
```

默认导出全部 10 个仓库，也可指定游戏键。工具读取 Git 提交对象，不读取未提交游戏修改，不复制 .env、会话、数据库、第三方本机资源或生成物。后续维护使用已建立的游戏仓库，不反复导出覆盖独立仓库。本批只改变开发/发布工具与内部文档，不改变平台运行行为，平台版本保持 0.17.0。
