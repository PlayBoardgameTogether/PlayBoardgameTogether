# D5：订阅安装、版本恢复与面板修复

原排期 2026-11-10；2026-11-07 按用户“继续推进每日任务”提前执行。**隔离环境验收和面板修复完成；正式候选发布、生产主动安装与 1.2.2 上线未执行。** D3 的真实邮件已由用户确认收到，剩余生产验证→注册→登录流程单独保留，不在本轮重发邮件或创建生产账号。

## 范围与基线

开始成功获取 `origin/main@cdb349950d5976e396e5a9af69c4830843d23364`；原目录仍有多项历史未提交内容，完整保留。在 `/tmp/playboard-d5-subscription-validation`、`codex/d5-subscription-validation` 独立实施，随后承接 D4 [PR #55](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/55) 的文档提交 **889b52dc46775018801bd4d200beb22d83509bda**（含用户确认收件）。D5 PR 以 D4 分支为基线，分别交付，不将其他昵称或包大小 PR 带入。

没有修改游戏规则、平台锁定游戏副本、来源锁、官方目录、SDK/API/WS、迁移或生产订阅开关。官方目录与试点的仓库、ID `online.puerto-rico`、archive `puerto-rico` 已核对一致，**登记已核对，无需改动**。D4 中六个头像候选仍未正式发布；三个同版本摘要差异继续保留，不覆盖旧版本。

## 正式 Release 的实际安装与对局

通过已配置 GitHub CLI 下载下列两个既有正式 Release，各自实际读取 ZIP、release.json、SHA256SUMS，并核对 GitHub 附件大小/digest、发布清单及标签提交。没有使用源码 ZIP、未发布 main 或自行改号的包。

| 版本 | 正式标签提交 | ZIP 字节 | SHA-256 |
| --- | --- | --- | --- |
| [1.1.0](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.0) | `75e83f66a1fca7c7d44891b2773806957623bc8f` | 1,359,100 | `5b849d1876b6080a8c1a326b36848d940a235cbb27b39d4807ae5a2985ee2664` |
| [1.1.1](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.1) | `d206705387a92bc5942b1af5e50df180a77bc5f4` | 1,557,169 | `c90928c8081658be8cb700ffe93efd6ce93cce4a0a643e7f1d272d59c44e8853` |

两个版本通过真实订阅服务、安装事务、数据库和 QuickJS 安装：先订阅 1.1.0，用三组有效会话入座、准备、开局并完成五个行动；再订阅 1.1.1，目录仅返回新版，另一组三账号在新版完成五个行动。更新及 API 重启前后旧局快照一致，旧局继续合法行动，最终 **160 个行动正常结束**；初始及终局本人回放、非成员拒绝、行动中私密筹码投影与两个不可变包摘要均通过。

该脚本的发现/下载适配器注入了上述已校验正式附件，实际安装和对局链路不 mock；**未把这项当成测试 API 到 GitHub 公网的实时发现/下载验收**。原 GitHub 来源单测另覆盖发现、双 UNO 版本选择、摘要、跨来源/恶意重定向及大小限制。正式附件测试脚本和产物在忽略目录保存，没有将游戏专属测试加入平台锁定集成副本。

## 可持续回归与实测缺陷

扩展平台通用 `tests/integration/game-subscription.test.ts`：

- 一包摘要错误、另一包成功时，保留成功安装；修正摘要后通过管理员原同步接口重试，旧版摘要不变，相同 requestId 不重复下载或增加回执。
- 新版测试规则与旧版在首步得分上明确不同，验证新局确实运行新版、旧局重启后仍运行旧版，最终结算及本人回放保留旧版。新旧局使用不同账号，遵守平台一人一个开放房间的约束。
- 既有权限/Origin/CSRF、回执、revision、下架保护、关闭中止、并发工作者及管理员授权失效用例继续运行，未削弱断言或业务限制。

真实 E2E 原先通过，但实际截图显示订阅面板缺少配套 CSS：无尺寸的 SVG 箭头扩展到数百像素，指标与选项散排。保留复现截图，补齐 `components.admin` 内仅匹配订阅面板的布局：20px 图标、电脑双选项/三指标、手机单列、明细状态与现有亮暗 Token。原生 details、checkbox、控件名称及请求恢复逻辑保持。新增生产界面回归限制两处箭头尺寸，并核对指标排列、键盘展开、暗色与减少动态偏好。平台 **1.2.1 → 1.2.2（PATCH）**，README 同步；游戏及 workspace 包不改号。

## 实际命令与结果

使用既有 `playboard-daily-test-20261105` PostgreSQL 17 专用测试容器，回环端口 15441，新建 **playboard_d5_test_20261107**；与 scratch、D1–D3、开发和生产数据库隔离。私有配置仅在本轮忽略 `.env`，0600；没有覆盖已有配置。依赖按冻结锁离线安装。所有清理同一测试库的集成/E2E 命令串行，生产只读查询未运行任何测试准备脚本。

| 命令 | 本轮结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | 成功，未升级依赖 |
| `pnpm --config.verify-deps-before-run=false typecheck`、`lint` | 全工作区通过，20 源码根 AST 与现有格式检查通过；最终仅 CSS 选择器/浏览器断言补充后做受影响 ESLint/Prettier 检查 |
| `pnpm ... exec vitest run tests/unit/official-game-source.test.ts` | **3/3，无 skip** |
| 原 `pnpm ... test:integration --config .data/d5/vitest.config.mjs` | 首轮 **6/7**；新增版本用例修正测试账号/契约后，经原准备链定向 **1/1**，其余六项被模式筛选，未重复累加。不宣称单批 7/7 |
| 原 `pnpm ... test:integration --config .data/d5/formal-vitest.config.mjs` | 真实正式附件 **1/1，无 skip**，完成上述升级与旧局完整恢复/回放 |
| `pnpm ... build` | 全工作区生产构建通过，包含 bundle、API runtime、受限 ZIP 恢复和 AI worker；最终 CSS 选择器修正后仅重建 Web 并检查 production bundle，通过 |
| `pnpm ... exec playwright test --config .data/d5/ui.config.ts game-subscription-ui.spec.ts --output .data/d5/ui-final` | **8/8，无 skip**；1440×900、1280×800、390×844、320×740，生产预览/受控 HTTP 场景，包含未知保存回执恢复、并发草稿保护、原生 checkbox、箭头和指标布局、键盘、暗色和减少动态偏好 |
| 原 `pnpm ... test:e2e tests/e2e/game-subscription.spec.ts --output .data/d5/e2e-final` | 修复后最终桌面/手机 **2/2，无 skip**；真实会话/API/数据库/安装运行时验证订阅保存、目录可用、关闭与刷新；发布来源仍为现有内存夹具，不冒充正式 Release 公网安装 |

正式附件初轮因原集成命令固定筛选 `tests/integration` 而未发现忽略目录脚本，随后放入 `tests/integration/.data/`，继续走原准备链。新增辅助用例初期还暴露双房间账号误用、把 DTO `gameVersion` 写作 `version`，以及新版对局读取误用旧局身份，均修正测试脚本后复验；没有修改身份、配额或结果断言规避错误。使用真实 QuickJS、真实事务；未调用收费模型。媒体准备沿用项目原有原创 SVG 回退，不替换生产资源。

截图、日志、正式附件及机器可读结果留在 `.data/d5/`，不提交。实际查看最终双端截图；物理手机、WebKit/Safari 与屏幕阅读器未验证。未运行不受影响的全库单元/集成/E2E，不将固定来源或桌面模拟器当作公网供应商或真机验收。

## 生产只读复核与剩余交付

北京时间 **2026-11-07 07:05**，真实目标仍为 `/opt/boardgame` / `boardgame-local.service`。私有 current.json、实际 API cwd 与运行目录 package.json 一致：**cdb349950d5976e396e5a9af69c4830843d23364 / 1.2.1**；systemd active/running、NRestarts=0，Chromium 公网 `/health/ready` **200 / database.ready=true**。健康辅助探针初次错误假定 database 为布尔值，按实际 `{ok,data:{database:{ready:true}}}` 契约修正后验证成功，不将此前探针失败解释为服务故障。

生产数据库查询为 **REPEATABLE READ READ ONLY** 一致快照：15 个历史在线版本、7 个启用入口，自动添加/更新开关保持开启；既有定时同步最近完成于 **2026-11-07 06:03:39（北京时间）**、succeeded，七项均为 current。该记录是既有后台定时任务，**不是本轮主动安装**；current 不证明旧包与 Release 摘要相同，D4 记录的三个差异保持。

本轮不发布六个头像候选、不获取生产管理员会话、不触发生产安装、不改旧包、不合并 main。1.2.2 是本地候选，不声称上线；功能分支/PR 就绪后按授权完成合并与服务器同步，再分别验收运行版本和安装结果。D5 保持进行中：隔离验收已完成，候选发布及生产安装另待明确范围。后续 D6 可在独立环境推进恢复演练，不以本记录授权覆盖生产库。
