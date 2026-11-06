# D2：游戏详情直链与刷新

原排期 2026-11-07；用户于 11 月 6 日要求当日已完成则继续推进，故在 D1 完成后提前执行。

**状态：已完成，平台 1.2.1 已上线，监督脚本维护与公网双端验收通过。** 用户随后明确允许合并和服务器同步，结果见末尾新增记录；以下初次候选记录保留当时事实。

## 问题与修复

- 本轮 Chromium 只读生产检查：`/games/online.uno/1.2.0`、`/games/splendor.base/1.0.0` 均为 404；`/health/ready` 为 200，缺失的 `/assets/d2-missing.js` 为 404。
- 原监督脚本以 `extname(path)` 判断缺失静态文件，将版本号末尾的 `.0` 当成扩展名，阻断 SPA 详情页回退。先新增自动回归运行原脚本：5 组测试中详情请求失败（404 ≠ 200），另外 4 组边界测试通过。
- 修复仅允许 `/games/<游戏 ID>/<数字三段版本>` 及原有 new/tutorial/computer 页面回退 HTML，不按游戏 ID 分支，不放宽缺失脚本/图片、静态目录和 API 代理保护。不改变身份、规则、公开契约、数据库、游戏版本或来源锁。
- 平台 **1.2.0 → 1.2.1**，按兼容缺陷修复递增 PATCH，README 同步；依赖与游戏版本不变。

## 本轮实际验证

| 检查 | 结果与边界 |
| --- | --- |
| 依赖 | 隔离 worktree 按原锁文件 `pnpm install --offline --frozen-lockfile` 成功；未升级依赖 |
| HTTP 回归 | `node --test tests/deployment/static-routing.test.mjs`，最终 **5/5，无 skip**。真实启动监督脚本，使用临时 Git/静态文件和明确的本地 API 传输夹具，不连接业务数据库或 GitHub。覆盖两种 UNO、内置与波多黎各路径、查询参数、直达/刷新/HEAD、页面子路径、JS/SVG MIME 与缓存、缺失资源、POST 405、解码穿越/反斜杠/NUL/错误转义及 API/health 代理的原状态/JSON。此夹具不作为真实身份认证验收 |
| 更新器单测 | `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/online-update.test.ts`，**11/11，无 skip** |
| 类型 | `pnpm --config.verify-deps-before-run=false typecheck` 通过 |
| lint | 同选项 `lint` 最终通过：ESLint、20 源码根 AST 边界和既有 Prettier。首轮新增 MJS 测试缺少显式 Node 全局导入而失败；补充导入后重跑通过，未修改检查规则。最终新增测试定向格式化与 ESLint 通过 |
| 生产构建 | 同选项 `build` 通过，包含 Web bundle 开发入口排除、编译 API、隔离 ZIP 恢复与 AI worker 检查；保留既有 model-viewer 大 chunk 提示 |
| 真实浏览器流程 | 原 `pnpm --config.verify-deps-before-run=false test:e2e tests/e2e/game-catalog.spec.ts --config .data/d2/playwright.config.ts`，桌面/手机 **4/4，无 skip，20.1 秒**。定向配置将浏览器连接到候选生产监督脚本和编译 API，而非仅用 Vite 的默认 SPA 回退；新增详情刷新/直达 HTTP 200 断言，保留真实登录、站内导航、历史、建房选择、筛选和错误恢复 |

数据库使用 D1 已确认的专用 `playboard-daily-test-20261105` 容器、回环 15441 端口，D2 单独创建 **playboard_d2_test_20261106**，与 scratch 库不同。原 E2E 准备脚本检查隔离、迁移 001–038、同步游戏/资源，再执行测试；配置仅保留在新 worktree 的忽略 `.env`，没有覆盖原工作区配置，没有清理开发/生产库。数据库测试串行执行。

实际查看 1440×900 和 390×844 详情页全页截图，入口和内容均可见，既有 E2E 的整页横向溢出检查通过；既有目录测试另检查 1440/1280/390/320 的明暗主题。页脚读取构建注入的 1.2.1。本轮没有修改界面样式；Chromium 模拟视口不代表真机/Safari。

本轮未改 API/WS/数据库业务行为，不额外执行全库集成、全量游戏 E2E 或月度阶段验收；无真实供应商调用、SMTP 发信、物理手机/Safari 或屏幕阅读器验收。构建、HTTP/浏览器日志和截图保留在忽略的 `.data/d2/`，不提交生成物或秘密配置。

## 交付与上线边界

- 原 `/code/PlayBoardgameTogether` 的分支和全部已有改动保留。本轮工作区为 `/tmp/playboard-d2-detail-routing`，分支 `codex/d2-game-detail-routes`，基于 D1 `9e8c8ce`，生产代码基线是已 fetch 的 `origin/main@257821126a11c463e118b594689551b42fb7ac34`。D1 PR #51 尚未合并，D2 包含它的已审查文档祖先；没有夹带昵称、包体积或其他游戏 PR。
- 本轮只读核对 `boardgame-local.service` 为 active/running，MainPID 2263337；私有 current.json 运行 SHA **257821126a11c463e118b594689551b42fb7ac34 / 1.2.0**。启动目录 `scripts/online-update.mjs` 与候选修改前的 main 文件完全相同，未发现该文件的服务器专属差异；维护前仍须重新核对。
- 自动审批拒绝了合并 D1 PR #51，理由是当前“继续每日任务”的授权未明确包含可能触发在线更新的合并。没有通过其他方式绕过；继续完成不受影响的实现、验证及功能分支/PR 交付，合并和生产维护保留待批准。
- 修复在长驻监督脚本中，单靠代码自动切换不会替换监督进程。批准后先处理 D1/D2 PR 顺序并重新 fetch/审查 head 和 main，再按[在线更新说明](online-update.md#游戏详情直链修复121)核对空闲状态、备份旧脚本/服务配置、加载已合并版本并重启。以实际运行版本、服务、ready 和公网详情/静态错误验证验收，不删除活动锁文件，不覆盖环境或数据库，不与自动更新并发。
- 实现提交 **d9106a4** 已推送 `codex/d2-game-detail-routes`，已创建面向 main 的 [PR #52](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/52)。随后仅补充本交付记录，不重复业务检查。**未合并、未部署，线上 404 未解决**。D2 保持进行中，完成线上验收后再标记完成并推进 D3。D3 仍缺明确测试收件人及发信/收件条件，不擅自发送真实邮件。

## 获准合并与生产验收（2026-11-06）

用户回复“允许”后恢复合并与服务器同步，不再沿用上面的授权阻塞结论。每次合并前重新 fetch，核对完整差异、head、提交和 `pins` 成功，无冲突或阻塞审查；依次使用 merge commit 合入：

| PR | 固定审查 head | 实际合并提交 |
| --- | --- | --- |
| [D1 #51](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/51) | `9e8c8ce42299788be9bcbd01e0cd538417a01a6c` | `33ee1184a55063ae5672e31a295e59964c3564f7` |
| [D2 #52](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/52) | `4c540030d55e137345c877ab4c4e2762d180beda` | `98e2c3d6a5f416d36f95d4223c83d480c384b523` |
| [D3 文档 #53](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/53) | `86ccdcba2ceee7f2247448064bc2d92129478127` | `e8efa97015a412d67160255d71b0f190ea596f39` |

最终合并树与已验证的 D3 head 完全相同，新增的 D3 仅内部文档；未夹带昵称或包体积 PR，没有新增运行代码或重复业务测试。平台沿用本批 **1.2.0 → 1.2.1**，README 一致。

### 服务器维护与备份

- 再次通过 systemd、current.json、API 子进程 cwd 核实真实目标 `/opt/boardgame`，启动目录旧 HEAD 不是运行版本。原更新器正常完成 `preparing → backup started → backup verified → updated`，从 `2578211` 切到 **e8efa97015a412d67160255d71b0f190ea596f39 / 1.2.1**。
- 维护前私有 `maintenance-d2-20261106T144011Z` 保存四个启动脚本、原 current.json、服务主配置和网络 drop-in，共七个文件，摘要均核对。比对发现服务器 `update-backup.mjs` 有拆分 libpq 连接字段的运维补丁，原样保留；其他支持脚本不替换，未修改 `.env`、服务配置或数据库连接。
- 确认版本切换完成且没有在途构建后，用原 systemd 入口优雅停止；监督进程正常退出并自行释放锁，未删除活动锁或强杀。仅原子替换来自合并 SHA 的 `scripts/online-update.mjs`，语法检查通过，再启动 `boardgame-local.service`。新版脚本 SHA-256 为 `627f5a718c945c68a191481c91ba86a3fa7ea6418f047753a1b7fa1c82446c15`，支持文件与服务配置仍与维护备份相同。
- 本次更新的 `update-XRPeBs` 数据备份共 **76 个文件、6,045,048 字节**，逐文件长度/SHA-256 全通过，数据库归档签名为 PGDMP；release 元数据 previous=`2578211`、candidate=`e8efa97`。保留私有恢复配置与全部旧版本；没有恢复数据库、重写迁移或资源种子。

### 实际上线检查

- current.json、运行目录 package.json 与 API 子进程 cwd 一致：**e8efa97 / 1.2.1**。服务 active/running、MainPID 1442481、NRestarts=0；新监督进程日志确认 serving，API 是它的自有子进程。
- 匿名公网 Chromium：`/health/ready` 200 且 `database.ready=true`；`/api/v1/games` 200；`/api/v1/account/security` 401 且 no-store。缺失 JS、图片和版本路径下的缺失图片均 404。
- **1440×900、390×844** 分别验证 UNO 休闲版和璀璨宝石详情：直达、刷新均 **200**，页脚为 1.2.1；大厅站内跳转同样可用。无 pageerror 或整页横向溢出，实际查看桌面和手机截图。只读验收，未创建生产账号/房间、改密码、发邮件或调用模型，不计为真人联机对局验收；真机/Safari 仍未覆盖。
- 脚本、JSON 和截图保留在 `/tmp/playboard-d3-mail-validation/.data/production-20261106/`，不提交生成物或秘密配置。D2 已标记完成；D3 真实收件继续待明确测试邮箱和范围。

三个 PR 的源 head 均未新增提交，main 包含全部交付，无其他 open PR 使用这些分支。远程 `codex/30-day-update-plan`、`codex/d2-game-detail-routes`、`codex/d3-mail-validation` 已按期望 SHA 约束删除；本地 D2/D3 分支已用 `-d` 删除。D1 本地删除被 Git 上游合并保护拒绝，保留而不强制删除；D1/D2 worktree 已脱离源分支并保留测试证据/私有配置，原工作区与其他分支未动。
