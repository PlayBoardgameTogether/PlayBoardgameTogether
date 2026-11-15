# D20：结算后的当前成长进度

执行日期：2026-11-15（北京时间），按每日任务顺序提前推进，原排期 11-25。

## 范围与基线

开始前成功获取远程 main，基线 **95e017f22ab906ccce65c14bcf0ace7143192c1a / 1.3.0**。原目录仍在旧功能分支并有其他任务改动，本轮全部在独立 `/tmp/playboard-d20` / `codex/d20-match-progress` 开发，原目录保持。

D15–D19 平台能力已经合并并通过生产验收，因此继续 D20 可选成长提示。UNO #5 仍受 D21 发布兼容门槛约束，本批不改游戏仓库、平台锁定副本、来源锁或目录登记，不发布或安装游戏。

## 实现与交互

沿用既有结算卡，在结果列表与再开局/回放入口之间放置简洁的「我的成长」，桌面和手机同序、标题与徽章入口可换行，进度条使用原生语义和既有主题 Token；不增加路由、弹窗、Artwork 或庆祝动画。

- 只在已结束对局的房间结算与原对局结果页读取现有 `api.badges()`；与权威结算事务分离，失败不阻断结果、回放或再开局。
- 展示本人当前完成场次与下一个场次徽章进度，入口进入既有 `/profile/badges`。没有可靠局前对比，不标记「本局新解锁」，刷新仅重读当前值，不重复授予或庆祝。
- 徽章 API 将进度截断到目标；最大场次徽章达到目标后明确显示「至少 50 局」，不推算总数、胜率或该局贡献。旧局页面同样展示当前进度，不伪装为历史快照。
- 组件按 matchId 与当前账号隔离，离页/重试取消旧请求；核对集合 accountId，拒绝错账号结果，会话过期清除现有会话上下文。无新增轮询、存储、协议或数据库迁移。

平台 **1.3.0 → 1.4.0（MINOR）**：兼容新增结算成长展示，README 同步；依赖和锁文件不变，游戏/资源版本不变。

## 验证

实际命令均在隔离工作区运行，未跳过选中用例：

- `pnpm --config.verify-deps-before-run=false install --frozen-lockfile --offline`：按既有锁文件成功安装，依赖/锁文件无变更。初次沙箱因共享 pnpm SQLite 缓存只读失败；获准访问既有缓存后成功，未关闭业务检查。
- `pnpm --config.verify-deps-before-run=false typecheck`：全工作区与现有测试配置类型检查通过。
- `pnpm --config.verify-deps-before-run=false lint`：ESLint、20 源目录 AST 边界和原 Prettier 全部通过。
- `pnpm --config.verify-deps-before-run=false build`：全生产构建及 bundle/API runtime 检查通过，包含隔离 ZIP 恢复与 AI worker 检查。已有较大 chunk 提示保留，无新增依赖。
- `pnpm --config.verify-deps-before-run=false test:e2e tests/e2e/computer-results.spec.ts --grep 'plays a complete computer game' --output=.data/d20/e2e`：**2/2 通过，无 skip，40.5 秒**。桌面与手机各完成浏览器玩家/免费脚本真实完局，核对真实徽章接口进度 1、下一目标 10，读取失败/重试、刷新不增加进度、键盘跳转徽章收藏、原结果页、战绩筛选错误/恢复以及再次开局。
- 同一 E2E 后段明确使用 UI 响应夹具验证「至少 50 局」/全部场次徽章达成和错账号结果不展示；不把夹具当作 50 场真实游戏或服务端权限验证。首次失败重试及正常进度使用真实 API，不伪造累计数。
- 两端均检查亮/暗主题的 1440、1280、390、320px 宽度（截图阶段高度均为 900px），整页无横向溢出；默认真实项目为 1440×900 和 390×844。实际查看桌面亮色 1440px 与手机深色 320px 截图，新增徽章入口可键盘聚焦并以 Enter 打开。没有新增动效或庆祝；未做全站无障碍审计。
- `git diff --check` 通过。日志、实际截图与只读服务器结果保留本工作区忽略目录 `.data/d20/`。

本批只改 Web 展示，认证、数据库、动作、WS、API/SDK 及授予规则不变，不运行无关全库集成/全库 E2E；不将历史通过算作本轮验证。

独立测试库为 **playboard_d20_test_20261115**，开发库为 playboard_d1_scratch，同一既有 127.0.0.1:15441 服务/账户且库名不同。使用原 `test:e2e` 准备、迁移、游戏同步和资源链，清理串行，不改开发/生产库。缺少 TTS 本地文件时原脚本安装原创 SVG 回退，不计 TTS 验收。

## 交付与限制

只读服务器检查 **08:59:14（北京时间）**：current.json、实际 API cwd 和运行 package.json 一致 **95e017f / 1.3.0**，boardgame-local.service active/running、NRestarts=0，ready 200、database.ready=true。本轮尚未合并或同步候选，不将旧生产版本当作新版上线；没有生产玩家、发信、付费模型或游戏安装操作。

真机、Safari/WebKit、屏幕阅读器、真实供应商调用未验证；D3 生产注册/登录闭环、D5 其余四个头像候选以及 D21 降级阻断与游戏发布门槛继续保留。下一项为 D21，本轮不提前扩展。

## 已提交与待审 PR

主提交 **5dfc535d0ee173d1bde28a21aeab5fc845e1ea2a** 已推送到 `codex/d20-match-progress`，创建面向 main 的 [PR #80](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/80)，open、未合并。完整差异仅本批 10 个文件，无其他任务祖先；功能分支及工作区保留待审查，原主目录保持。

GitHub 应用创建接口返回 403（Resource not accessible by integration），随后复用既有命令行认证先查重再创建成功，无凭据输出/落盘。首次提交缺少本机默认作者配置，仅为该命令使用本仓库既有 Codex 身份，没有修改全局 Git 配置。当前未获本批 main 合并授权，按项目规则交付待审 PR，未同步候选或宣称上线；适用服务器同步随获准合并后的实际发布流程验收。后续仅补交付链接，不重复已通过且无变化的代码检查。

## 已批准合并、生产验收与分支清理（2026-11-15）

用户明确批准后，重新获取 main，核对 PR #80 的完整 10 文件/2 提交、固定 head **4f9c443767628a1f37e08927e3817180aaf01d8a**、pins success 及空 review/review thread；没有新提交、冲突或阻塞审查。通过 merge commit **2d00ebfdf52410dcb7323e6e50865015b39bd97f** 合入 main，GitHub 已确认 merged，合并树与已验证候选完全一致。GitHub 应用合并接口仍返回 403，随后复用既有命令行认证重验 main/head 并以 sha 约束成功合并，无凭据输出或落盘，不绕过分支保护。

原生产更新器完成构建、排空、备份和切换，没有人工重启、配置覆盖、生产恢复或新增迁移。本次备份 **update-A1f3yP / 76 文件 / 8,152,043 字节**，创建于北京时间 **09:47:40**；以原 `verifyUpdateBackup` 只读复验文件集合、长度、SHA-256、PGDMP 签名及 previous **95e017f** / candidate **2d00ebf** 全部通过。

**09:50:03（北京时间）**，current.json、实际 API cwd 与运行 package.json 一致 **2d00ebf / 1.4.0**，boardgame-local.service active/running、NRestarts=0，ready 200、database.ready=true。匿名公网 Chromium 四视口 **1440×900、1280×800、390×844、320×740** 首页/详情/电脑刷新均 200，页脚 1.4.0、无 pageerror 或检查到的整页横向溢出；实际全局 CSS、电脑页 JS、成长组件 JS 和结果 CSS 与运行文件逐字节一致。

四视口均确认匿名对局页显示会话已失效、没有成长数据，本人徽章 API 为 401 且 no-store。公开结果指南仍能读取；离页导致图片和 Cloudflare rum 的 ERR_ABORTED 仅记为探针日志，不当作产品错误或已加载证据。本次仅匿名 GET，没有生产登录、建房、行动、发信、付费模型或游戏安装；生产身份下成长交互未额外操作，真实完整局证据仍使用本批隔离测试的 2/2，不将静态资源校验当作生产真人完局。

GitHub merged、源分支 head/祖先、无其他开放 PR 和干净工作区全部核对后，删除本地/远程 **codex/d20-match-progress**；本地使用 `-d`，远程删除以期望完整 SHA 约束，随后 prune。原 worktree 与所有 `.data/d20/`、`.data/d20-delivery/` 证据保留，主目录 36 项已有改动及 D21 等其他任务分支不动。合并/备份/公网/清理结果分别保存在 merge.json、backup-verified.json、production-health.json、cleanup.json。

本轮只补内部交付记录，平台保持 **1.4.0**，不重复已通过且无变化的本地业务检查。D21 兼容发布门槛、UNO #5 未发布/安装、D3/D5 外部条件和真机/WebKit 等限制继续保留。此后文档按既有同步机制验收，不因记录再次增加版本。
