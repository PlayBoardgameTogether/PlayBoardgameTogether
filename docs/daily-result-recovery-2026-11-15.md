# D22：断线、未知结果与会话撤销

执行日期：2026-11-15（北京时间），按每日顺序提前推进，原排期 11-27。

## 范围与基线

开始时重新获取 main，基线 **a3dbfac30148d69beb7640cb32ac5dc7fc5e4503 / 1.4.0**。独立 `/tmp/playboard-d22`、`codex/d22-result-recovery`；原目录 36 项已有改动、D21 工作区及游戏待审分支保留。本轮先将 D21 与已合并 D20 整合、修正版本为 1.4.1 并复验，分别提交在 [D21 PR #81](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/81)，没有混入本分支。D21 仍未合并，生产监督保护及 UNO 发布门槛保持。

本批只新增恢复回归和内部记录，没有复现需要修改产品的缺陷；平台 **1.4.0 → 1.4.0**，README 一致。没有修改运行代码、公开 DTO、数据库迁移、游戏锁定副本、来源锁、游戏目录或依赖，也没有新游戏开发/发布。

## 新增自动回归

`tests/e2e/result-recovery.spec.ts` 使用平台自带夺分赛 ZIP 样例构建明确命名的 `online.recovery-fixture` 测试夹具，经真实管理员身份审核安装，两个真实测试账户入座、准备和开局。公开结果通过原 QuickJS 和对局事务处理；终局夹具缩短为一次合法抢分，不是 UNO 规则验收或正式游戏版本。网络故障只控制传输，不伪造服务端结果、回执或会话。

- **终局回复丢失：** 真实终局提交后丢弃 HTTP 回复，暂扣 WS 更新并阻断回执/快照读取，确认待核对请求保存；刷新后读取真实终局，恢复回执后清除原请求。显式重试同一个 requestId，仍为同一结果；单 SQL 比较状态/RNG 摘要、结果、动作、回放、回执与房间，保持 revision=1、动作/回执各 1、回放帧 2，房间已复位。本人历史只有一条记录。
- **真实离线与延迟旧 WS：** 浏览器 context 断网并关闭当前测试传输，操作暂停、页面保持 revision=1；另一位玩家合法行动后重新建立连接，恢复 revision=2 与真实分数。重送原服务端 revision=0 消息，先等待渲染再检查局面不回退，随后真实 HTTP 再同步；座位、房主、房间 revision、控制类型/epoch 保持，没有自动退出或托管。
- **待核对期间撤销会话：** 合法动作成功但回复丢失，使用原 logout 撤销该真实 session；客户端显示会话失效、清除 iframe 与本地待确认命令。推进浏览器时钟 60 秒及触发 focus/online，不再建立对局连接、读回执/视图或补交动作。原身份 API 返回 401，另一参与者仍能读到 revision=1；只读审计确认动作及房间/座位未被改变。

每个场景均覆盖桌面 **1440×900** 和手机 **390×844（Chromium / Pixel 5 模拟）**。SQL 审计限独立测试库，单查询保持一致性，仅输出 State/RNG 摘要，连接在 finally 关闭；其他浏览器上下文和离线设置均清理。

## 实际验证与修正

依赖使用既有冻结锁文件离线安装。初次沙箱内 pnpm SQLite store 不可写，在获准环境同一冻结离线安装通过，没有升级依赖。新建独立 **playboard_d22_test_20261115 / 127.0.0.1:15441**，与开发库 playboard_d1_scratch 名称不同；所有 E2E 使用原 `test:e2e` 准备、迁移、游戏与资源同步链，串行清理，没有重置开发或生产库。TTS 本地文件缺失时沿用原原创资源回退。

命令统一使用 `pnpm --config.verify-deps-before-run=false`，没有关闭业务断言、身份或隔离保护：

- 全 `typecheck`、`lint` 通过，含 20 源目录 AST 边界和原格式检查。新测试文件另以严格 tsconfig（忽略目录 `.data/d22/tsconfig.json`）编译并执行定向 ESLint/Prettier，通过；修复了 Playwright 全部 project.use 不能直接作为精确可选类型 BrowserContextOptions，以及 Uint8Array/Buffer 的测试类型问题，没有类型忽略或扩大 any。
- 新增三场景 **6 个独立 E2E 用例最终分批通过、无 skip**。首次共用准备在建房导航完成前读取 URL，造成两项超时；定位后停止该批（2 failed / 1 interrupted / 3 did not run），补 URL 等待。第二批 **5/6、53.2 秒**，桌面终局在按钮因核对暂时隐藏时过早读取 sessionStorage；改为等待明确“操作已保存，已同步最新局面。”并增加结果等于数据库摘要的断言。仅重跑受影响终局双端 **2/2、22.6 秒**。随后为离线用例补充明确关闭传输、离线保持 revision=1、实际建立新连接的断言，仅复验该场景双端 **2/2、18.9 秒**。未更改原超时或降低业务断言，不将分批结果写为一次 6/6。
- 实际查看了桌面恢复棋桌、手机终局结算及手机会话失效截图。终局检查整页无横向溢出；未变更页面布局，不将样例截图当作正式 UNO 联机或真机验收。截图/trace/日志保存在忽略的 `.data/d22/`，不提交生成物。

- 既有不同风险定向回归：`test:e2e tests/e2e/computer-results.spec.ts tests/e2e/match-feedback.spec.ts --grep 'recovers lost create and start|a request lost before commit|receipt recovery waits'` **6/6、51.9 秒、无 skip**。覆盖建房与开局回复丢失后的刷新/原请求恢复、提交前丢失时只重试原请求，以及 accepted 回执与旧在途 HTTP 快照交错时必须等到足够新的局面。与新测试合计 **12 个独立 E2E 用例分批通过**。
- `git diff --check` 通过。没有运行全库单测/集成、完整生产构建或无关 E2E；本批只有测试及内部记录，真实事务和联机由上述原 E2E 准备链覆盖，不将 E2E 写成单独 `test:integration` 的执行结果。D21 本轮的构建/集成另记在其 PR，不冒充 D22 重跑。

## 生产与交付边界

**10:01:36（北京时间）**，本轮只读确认生产 current.json、真实 API cwd/package.json 一致 **a3dbfac / 1.4.0**，systemd active/running、NRestarts=0，API 与真实监督入口 ready 均 200、database.ready=true。D21 保护仍未加载；没有重启、生产玩家操作、游戏安装或数据库写入。本批只有测试和内部记录，不要求生产应用重建或重启，计划/验收记录不是服务器部署文档。

没有重新验证正式 UNO 结果包、真实收费模型、物理手机、WebKit、屏幕阅读器、网络设备切换或生产会话撤销。D21 的实机保护加载、UNO #5 发布/安装，以及 D3/D5 原外部条件保持。本批不推进 D23；该项须先核对真实供应商凭据和明确费用上限。

提交与 PR 交付结果见下节；本批不以测试通过代表已合并或已上线。
