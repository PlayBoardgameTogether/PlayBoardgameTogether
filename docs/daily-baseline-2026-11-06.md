# D1：执行基线与缺口清单

原排期：2026-11-06。用户于 2026-11-05 确认提前启动，核验与记录于 11 月 6 日完成；本轮只完成 D1，不提前实施 D2–D30。

**状态：已完成。** 执行基线、30 日任务状态、仓库归属、处理人、访问条件及后续依赖均已记录。外部业务验收尚未完成的项目保持待办，不把条件摸底计为业务通过。

## 平台与服务器基线

| 项目 | 本轮证据与结论 |
| --- | --- |
| 远程主仓库 | 旧 origin 地址 `Rst307/PlayBoardgameTogether` 可正常 fetch，GitHub API 确认规范名称为 `PlayBoardgameTogether/PlayBoardgameTogether`，默认分支 main；没有修改原工作区远程 |
| 最新 main | `257821126a11c463e118b594689551b42fb7ac34`；根 package.json 与 README 均为 **1.2.0** |
| 已合并 | [账户安全 PR #49](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/49) 已合并为 `1fc73fe8a04bfb205740b2d12b577901206e9a1b`；[发布记录 PR #50](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/50) 已合并为上述 main。D3 应验收现有注册、绑定和找回，不重复实现 |
| 未合并 | [包体积限制 PR #43](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/43)，head `bd41e5f0b7062386585ef99dcd40d43d8dfc2746`，open；[玩家昵称 PR #46](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/46)，head `47b778498538f3ef8f9d1f76782215ddfc6f6a67`，draft。两者均不纳入本轮交付，旧标题版本不代表当前可直接发布版本 |
| 原工作区 | `/code/PlayBoardgameTogether` 仍在旧 `codex/computer-games-match-results@529695f`，有既有修改与未跟踪文件，完整保留；本轮在干净的 `/tmp/playboard-30day-plan-20261105` 计划工作区执行，并已合入最新 main |
| 真实部署目标 | `boardgame-local.service` 的 WorkingDirectory 为 `/opt/boardgame`；MainPID 为 2263337。通过系统服务、私有 current.json 与 API 子进程 cwd 交叉确认，未凭同名目录认定目标 |
| 实际运行 | 初查为 `1fc73fe`；既有更新器随后切换到 `257821126a11c463e118b594689551b42fb7ac34`，current.json 与实际 API cwd 一致，运行目录 package.json 为 **1.2.0**。本轮没有触发更新、重启、迁移或修改生产配置 |
| 服务状态 | 最终只读核验 ActiveState=active、SubState=running、NRestarts=0；公网 Chromium 请求 `/health/ready` 为 200，`database.ready=true` |
| 公开访问 | `/forgot-password` 为 200，页脚 `PlayBoard v1.2.0`；匿名 `/api/v1/account/security` 为 401、`Cache-Control: no-store`。只读核验，不创建账户、不改密码、不发邮件 |

## 游戏：已发布、已安装与未合并分别记录

通过十仓库 GitHub API 读取 main、正式 Release 和附件名称，通过生产 `/api/v1/games` 读取当前公开版本。下表“已安装”仅指公开目录中可用的版本，不证明管理员订阅开关、最近同步记录或某个旧对局的锁定版本。本轮未下载附件校验摘要，完整发布校验仍属于 D4。

| 游戏 / 独立仓库 | 仓库 main | 正式 Release | 生产公开版本 | 待合并 PR |
| --- | --- | --- | --- | --- |
| UNO / [playboard-game-uno](https://github.com/PlayBoardgameTogether/playboard-game-uno) | [`9ed4deb`](https://github.com/PlayBoardgameTogether/playboard-game-uno/tree/9ed4deba6ca230e26f9a70f4d6b8a1d07366e147) | [uno-v1.2.0](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-v1.2.0) | 1.2.0 | [#2](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/2) |
| UNO · 毫不留情 / [playboard-game-uno](https://github.com/PlayBoardgameTogether/playboard-game-uno) | [`9ed4deb`](https://github.com/PlayBoardgameTogether/playboard-game-uno/tree/9ed4deba6ca230e26f9a70f4d6b8a1d07366e147) | [uno-no-mercy-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-no-mercy-v1.0.0) | 1.0.0 | [#2](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/2) |
| 五子棋 / [playboard-game-gomoku](https://github.com/PlayBoardgameTogether/playboard-game-gomoku) | [`6060d13`](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/tree/6060d1391b986c3082754764b82f26c2c7750d43) | [gomoku-v1.0.3](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/releases/tag/gomoku-v1.0.3) | 1.0.3 | [#3](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/pull/3) |
| 拉密 / [playboard-game-rummikub](https://github.com/PlayBoardgameTogether/playboard-game-rummikub) | [`021157c`](https://github.com/PlayBoardgameTogether/playboard-game-rummikub/tree/021157c8b297417c9ddc856dd4509b3245d22659) | [rummikub-v1.0.3](https://github.com/PlayBoardgameTogether/playboard-game-rummikub/releases/tag/rummikub-v1.0.3) | 1.0.3 | [#3](https://github.com/PlayBoardgameTogether/playboard-game-rummikub/pull/3) |
| 卡坦岛 / [playboard-game-catan](https://github.com/PlayBoardgameTogether/playboard-game-catan) | [`9905435`](https://github.com/PlayBoardgameTogether/playboard-game-catan/tree/99054358d0e27c4e1b299b8544018ce6643ce1db) | [catan-v1.0.1](https://github.com/PlayBoardgameTogether/playboard-game-catan/releases/tag/catan-v1.0.1) | 1.0.1 | [#3](https://github.com/PlayBoardgameTogether/playboard-game-catan/pull/3) |
| 波多黎各 / [playboard-game-puerto-rico](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico) | [`d206705`](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/tree/d206705387a92bc5942b1af5e50df180a77bc5f4) | [puerto-rico-v1.1.1](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.1) | 1.1.1 | [#4](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/pull/4) |
| 阿瓦里 / [playboard-game-awari](https://github.com/PlayBoardgameTogether/playboard-game-awari) | [`2e4e126`](https://github.com/PlayBoardgameTogether/playboard-game-awari/tree/2e4e126c8995ab8514742e3116c43b3ed7ab5e4e) | [awari-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-awari/releases/tag/awari-v1.0.0) | 1.0.0 | [#3](https://github.com/PlayBoardgameTogether/playboard-game-awari/pull/3) |
| Color Match / [playboard-game-color-match](https://github.com/PlayBoardgameTogether/playboard-game-color-match) | [`bef3d82`](https://github.com/PlayBoardgameTogether/playboard-game-color-match/tree/bef3d820f01ea869e6c4f7ef7f7542dff6f6fd5f) | [color-match-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-color-match/releases/tag/color-match-v1.0.0) | 1.0.0 | [#2](https://github.com/PlayBoardgameTogether/playboard-game-color-match/pull/2) |
| Grid Garden / [playboard-game-grid-garden](https://github.com/PlayBoardgameTogether/playboard-game-grid-garden) | [`93d3037`](https://github.com/PlayBoardgameTogether/playboard-game-grid-garden/tree/93d303779cb40001c6867edd217d5e58252c9c05) | [grid-garden-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-grid-garden/releases/tag/grid-garden-v1.0.0) | 1.0.0 | [#2](https://github.com/PlayBoardgameTogether/playboard-game-grid-garden/pull/2) |
| 璀璨宝石 / [playboard-game-splendor](https://github.com/PlayBoardgameTogether/playboard-game-splendor) | [`1eb528d`](https://github.com/PlayBoardgameTogether/playboard-game-splendor/tree/1eb528dc87449833f5e4b1c01efa53b82c75a8b2) | [splendor-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-splendor/releases/tag/splendor-v1.0.0) | 1.0.0 | 无 |
| 花砖物语 / [playboard-game-azul](https://github.com/PlayBoardgameTogether/playboard-game-azul) | [`8fbfbde`](https://github.com/PlayBoardgameTogether/playboard-game-azul/tree/8fbfbdebcd9f27f8ef406600ae10eeafff5a965e) | [azul-v1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-azul/releases/tag/azul-v1.0.0) | 1.0.0 | 无 |

七个在线条目的正式 Release 均非 draft/prerelease，均列出精确 ZIP、release.json 与 SHA256SUMS；四个内置游戏的 Release 为 tgz，不走 ZIP 订阅。**波多黎各 1.1.1 已进入生产公开目录，11 月 1 日“仍为 1.1.0”的历史缺口已解除。** 其他在线游戏头像已合并到各仓库 main，但尚无对应新正式版本，不能将旧 Release 说成包含新头像。

平台锁定副本继续以 [来源锁](../game-repositories.lock.json) 中的完整 SHA 为准，不随仓库 main 或 Release 自动漂移。官方目录的十仓库/七个在线 ID 与现有登记一致，**登记已核对，无需改动**。本轮没有修改或发布游戏，没有安装候选包。八个昵称 PR 均保留待办，依赖平台 #46 的桥接与兼容验证，不能随 D1 一并合入。

## 独立测试环境与外部条件

| 条件 | 实测状态 | 后续使用边界 |
| --- | --- | --- |
| GitHub | 已配置的私有 CLI 身份可读取平台与十个游戏仓库；平台 permissions.push=true | 凭据不进入仓库；推送/PR 以实际调用结果记录，不将权限字段当成已推送 |
| 默认 PostgreSQL | 127.0.0.1:5434 无响应；原配置两个 URL 不同，但不足以证明库可用；生产/其他任务容器均未动 | 不沿用旧端口、不猜凭据、不关闭隔离保护 |
| 本轮专用 PostgreSQL | 新建 `playboard-daily-test-20261105`，使用本机已有 postgres:17、127.0.0.1:15441，限制 256 MiB/1 CPU；与现有服务分离 | 仅用于本轮及后续明确核对的隔离验证，不能据此宣称生产容量 |
| 测试库隔离 | 通过原 `scripts/prepare-test-db.ts` 创建 `playboard_daily_test_20261105`；只读连接确认它与 scratch 库 `playboard_d1_scratch` 名称不同，均位于专用容器 | 准备脚本没有清理现有库；**尚未迁移、同步游戏/资源或运行集成/E2E**。后续须使用原 test:integration/test:e2e 准备链并串行执行 |
| 私有测试配置 | 当前保留在独立 worktree 的 `.data/d1/database.env` / `postgres.env`，权限 0600；未覆盖已有 .env，未提交 | 使用前重新核对容器与两个 URL；后续环境若变化，重新准备，不能复用历史“可用”结论 |
| 浏览器与媒体 | Chromium 已安装，本轮成功只读访问生产；Docker 可用，尚未启动/验证媒体处理镜像 | 后续 UI、媒体准备按原隔离流程执行；没有 Safari、物理手机或屏幕阅读器实测证据 |
| SMTP | 本轮没有生产管理员会话，没有获得明确测试收件人及真实邮箱收件条件；未读取 SMTP 密钥或发信 | D3 可先做本地受控回归；真实投递仍依赖维护者确认测试邮箱及发信范围 |
| 官方模型 | 未确认本轮真实调用的模型凭据、费用上限与授权范围；没有发起调用 | D23 真实供应商验收保持待办，不将平台现有模型能力当成本轮费用授权 |
| 备份与恢复 | 已确认服务器访问入口；未进行恢复演练，未检查恢复空间/备份内容完整性 | D6 在独立环境核验权限、空间和备份，再演练；不覆盖生产数据库 |
| 管理员订阅 | 可读当前公开安装版本；未读取管理员私有订阅设置或执行同步 | D4–D5 需要真实管理员同步记录与测试环境安装回归；不以本轮目录快照代替 |

## 缺口、责任人与后续依赖

本月 30 日任务与状态见[每日计划](30-day-update-plan-2026-11-06.md)；D2–D30 均保持未开始。以下“编码代理”负责相应仓库实施与回归，“维护者”负责明确的访问、收件或费用条件，不推定其他 PR 作者本轮已授权其任务。

| 后续任务 / 缺口 | 证据与当前状态 | 所属仓库 | 处理人 | 依赖 / 下一步 |
| --- | --- | --- | --- | --- |
| D2 详情直链 | [11 月 1 日记录](progress.md#像素头像批次合并与公网跟进2026-11-01平台仍为-112) 有 404；本轮未重复复现 | 平台 | 编码代理 | 基于当前监督脚本复现，补静态路由回归；按维护方式加载监督脚本 |
| D3 邮件闭环 | 账户安全已上线，真实 SMTP 收件仍无证据 | 平台 | 编码代理；维护者提供测试收件条件 | 测试邮箱与发信范围明确后才发信；覆盖现有注册/找回而非重复开发 |
| D4 发布清点 | 七个正式在线版本与公开安装版本已摸底；未校验附件摘要/标签源提交 | 平台及六个在线游戏仓库 | 编码代理 | 下载校验清单与 ZIP；波多黎各旧差异已解除，不重复修复 |
| D5 订阅验收 | 公开版本可读，私有策略/同步记录未知 | 平台及试点游戏 | 编码代理；维护者提供管理员访问条件 | D4 可信附件、隔离库迁移/同步、旧局与新局验证 |
| D6 恢复 | 服务器可访问，尚未演练 | 平台 | 编码代理；维护者确认备份与隔离空间 | 备份权限/空间校验，保留生产数据 |
| D8–D10 开局 | 已有邀请、电脑陪玩及官方 AI 回退；本轮未实测路径 | 平台 | 编码代理 | 独立环境业务准备、真实双账号，先选实际问题再改 |
| D11 UNO | 两玩法正式版 1.2.0 / 1.0.0；昵称 PR 未合并 | UNO 独立仓库 | 编码代理 | 核对最新 main 与未合并工作归属，320/390px 实测；不直接改平台副本 |
| D12 波多黎各 | 正式版与公开目录均为 1.1.1 | 波多黎各独立仓库 | 编码代理 | 先实测角色/工人/仓储，保持规则与版本锁定 |
| D13–D14 双端与缓冲 | 本轮仅做可访问性摸底，无真机/Safari 验收 | 平台及受影响游戏 | 编码代理；维护者提供真机条件 | 对本周实际修改验收，缺设备明确记录 |
| D15–D21 ZIP 公开结果 | [当前架构](architecture.md#电脑开局与公开结果2026-10-20) 仍为已登记内置投影，未登记 ZIP 保留 null | 平台＋UNO 试点 | 编码代理 | 通用兼容契约、同事务回滚及旧包恢复；先平台兼容再游戏发布，D20 有余量才做 |
| D22–D23 恢复/AI | 新链路尚未实施，真实模型与费用条件待确认 | 平台 | 编码代理；维护者明确模型/费用范围 | 先完成试点；没有费用授权不调用 |
| D24–D30 性能/运维/验收 | 当前不是容量、恢复或月度验收完成证据 | 平台及受影响游戏 | 编码代理；维护者配合发布条件 | 隔离环境准备、实测证据、完整适用检查及发布授权 |
| 跨仓昵称工作 | 平台 #46 为 draft，八个游戏 PR open | 平台及对应八仓库 | 原任务维护者；编码代理后续核对 | 单独完成桥接/验证/版本维护，不借本轮合并 |
| 包体积 PR #43 | open，旧 head 保留 | 平台 | 原任务维护者；编码代理后续核对 | 先重查 main 差异和必要验证，不按旧标题版本直接发版 |

## 本轮验证与交付边界

实际执行：`git fetch origin main`；GitHub API 读取仓库/PR/Release；`systemctl show boardgame-local.service`；只读 current.json、运行 package.json 与子进程 cwd；Chromium 只读四个公开路径；`GH_CONFIG_DIR=<已配置私有目录> node scripts/check-game-repositories.mjs --remote` 通过（10 仓库、154 个集成文件）；专用容器 `pg_isready`；通过 `node --env-file=.data/d1/database.env node_modules/tsx/dist/cli.mjs scripts/prepare-test-db.ts` 调用原准备脚本；分别连接 scratch/test 库执行 `SELECT current_database(), current_user`。未输出凭据值，未读取邮件验证码、玩家私密数据或完整 State。

最初沙箱拒绝 Git 写入、Docker、systemd 与网络；在获准执行环境使用原操作后完成，不削弱检查。普通 Python HTTP 客户端获得公网入口 403，Chromium 最终四项分别为 200/200/200/401；没有把 403 记为业务 API 故障。本机 3301 端口探测未成功，不作为服务失败结论，生产证据来自实际进程目录及公网请求。

本批仅内部文档与环境准备，**平台保持 1.2.0**，README/root package.json/游戏版本均不改；无需业务 typecheck/lint/build/集成/E2E，也未把历史验收计作本轮通过。计划与清单不是服务器部署所需文档，不触发生产更新或重启。本轮提交、PR 与文档校验的最终状态见每日交付记录；未获得本轮合并指令，保留 PR 供审查。

后续仍按原日期从 **D2 · 11-07** 继续；D1 提前执行不自动压缩后续排期。没有创建定时任务，也未启动 D2。
