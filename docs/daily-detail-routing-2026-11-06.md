# D2：游戏详情直链与刷新

原排期 2026-11-07；用户于 11 月 6 日要求当日已完成则继续推进，故在 D1 完成后提前执行。

**状态：修复与本地验证完成，待合并及监督进程上线验收。** D2 尚未标记全部完成，D3–D30 保留原排期。

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
