# D14：第二周整合与交付核验（2026-11-12）

交付更新：用户已明确批准，三个 PR 均已合并，三种游戏正式版本已由生产订阅安装并核验。平台保持 1.2.6；最新事实见[交付结果](#已批准合并正式发布与生产安装2026-11-12)，下文先保留批准前的验收记录。

从重新获取的 `main@1c70c2def3ace12156140970a22a57dac0619d09` / **1.2.6** 建立 `/tmp/playboard-d14-closeout`、`codex/d14-week-two-closeout`。原工作区的已有改动、独立游戏及 D11–D13 工作区全部保留。

## 整合与审查

在 D14 功能分支通过 merge commit 保留以下三个平台 head 的祖先关系；只解决计划、进度的记录冲突，保留各批历史结果。三个原 PR 继续保留，尚未进入 main；D14 是统一交付候选，不要求重复合并相同改动。

| 仓库 / PR | 已核对 head | 范围与本轮远程状态 |
| --- | --- | --- |
| 平台 [#69](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/69) | `a1e9d4727a913b9261b539f057eb203a662ef1d7` | 4 文件 / 3 提交；UNO 两玩法手机图像校验和记录；pins success |
| 平台 [#70](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/70) | `450ca0a45857887d394803a9dff07db3279176eb` | 4 文件 / 2 提交；波多黎各三账号市长阶段及旧包兼容；pins success |
| 平台 [#71](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/71) | `0696d59af01edd00b936cddaa4c73e4b6fa87363` | 8 文件 / 2 提交；四视口、键盘、错误恢复、可达性；pins success |
| UNO [#4](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/4) | `7155114fef6b70afdf8be12414572a838a4688c7` | 4 文件 / 2 提交；测试、CI、记录；check success，release skipped |
| 波多黎各 [#6](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/pull/6) | `fd4d6e781ca06811e3537b0c07403ea4f53c8702` | 10 文件 / 1 提交；工人分配提示及未提交产能；check success，release skipped |

五个 PR 均 open、非 draft、API 返回可合并，review 列表为空；这不代表已获批准或可以绕过保护。已审查精确 head 的完整差异和提交范围，波多黎各规则文件只改 manifest 版本，产能解释仍来自本人 View，不新增权威规则或传输路径。平台整合只包含测试、配置和内部文档，**1.2.6 → 1.2.6**，README 一致；运行代码、公开契约、依赖、游戏集成副本和来源锁不变。

GitHub CLI 直接使用配置目录时，批量读取曾在 files 请求失败，随后单次请求也返回 `invalid character 'S' looking for beginning of value`。未将失败算作检查通过；改用本仓库已验证 Git 认证入口，仅在子进程环境传递凭据，成功逐项读取上述固定 head 的检查。PR 状态和 review 另由连接器核对；凭据不落盘、不输出。

## 本轮实际验证

pnpm 命令均带 `--config.verify-deps-before-run=false`。先冻结离线安装，未升级依赖。

| 命令 / 范围 | 实际结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | 通过 |
| `pnpm typecheck` | 全工作区及原测试配置类型检查通过 |
| `pnpm lint` | 首次 tsx IPC pipe 被沙箱 EPERM 阻止；外层原命令最终通过，含 ESLint、20 根 AST 与原格式检查 |
| `pnpm build` | 通过，包含生产 bundle、API runtime、ZIP 恢复与 AI worker；保留已有 model-viewer 大 chunk 提示 |
| `pnpm exec playwright test -c tests/config/responsive-start.config.ts --output .data/d14/computer-ui` | **16/16，无 skip**；1440×900、1280×800、390×844、320×740，双主题、根字体 200%、减少动态效果、预算校验、焦点/命中与失败恢复 |
| 原 `pnpm test:e2e tests/e2e/color-match.spec.ts tests/e2e/computer-results.spec.ts --grep 'two browsers play\|plays a complete computer game' --output .data/d14/e2e` | **4/4，无 skip，2.0 分钟**；桌面/手机各一条双真人完整局和一条真人对免费脚本完整局 |
| `node scripts/check-game-repositories.mjs` 及带 `--remote` | 均通过：10 仓库、154 集成文件与 GitHub 精确提交一致 |
| 本轮附件脚本 `.data/d14/check-packages.ts` | **6 包通过**，详见下表；不是新增业务单测或生产安装 |
| `git diff --check` | 通过；仅文档补记不重复运行已通过业务检查 |

E2E 在既有 PostgreSQL 17 专用容器 **127.0.0.1:15441** 新建 **playboard_d14_test_20261112**，执行前核对开发连接为 **playboard_d1_scratch**，库名不同；原 prepare/migrate/sync/seed/run-e2e 链完整，清理测试库的命令串行。只在新工作区写私有 .env，未覆盖原配置或触及开发/生产库。缺少本地 TTS 原图包时使用原流程的原创 SVG 回退，不宣称验证外部图包。

双真人用例覆盖邀请/入座/准备、丢动作回复后刷新、断网、旧快照拒绝、双标签 revision 冲突、完整结算、会话撤销/重新登录、心跳恢复、单连接和再开局。脚本用例覆盖真实平台棋桌操作、完整结算、持久结果、历史筛选失败/重试及再开局；两条均走真实 session/API/WS/数据库，不以 UI 夹具代替。免费脚本无真实模型调用。

实际查看本轮电脑页 1280px 亮色、320px 暗色字体放大，以及真实脚本结算 1440px 亮色、320px 暗色截图。完整流程实际视口为 1440×900 / 390×844，结算另检查 1440/1280/390/320px 双主题无整页溢出。根字体 200% 不等于浏览器原生缩放；整页截图中的固定导航位置不作为遮挡证据。截图、日志、下载附件及私有审计脚本只保留 `.data/d14/`，不提交。

## 游戏登记与正式附件

本轮下载以下三个正式版本的 **ZIP、release.json、SHA256SUMS**，重新计算 ZIP SHA-256，以平台原 ZIP 解析器和受限 QuickJS 读取真实 manifest；另对 D11/D12 既有本地产物执行同样核验，共六包。核对目录、release.config.json、仓库、名称、gameId、archive、精确版本/文件名/标签及摘要；均一致，**登记已核对，无需改动**。正式清单不预写候选版本，来源锁不随候选漂移。

| 游戏 | 正式发布 / ZIP 字节数 | 本地候选 / ZIP 字节数 | SDK / 规则内容版本 |
| --- | --- | --- | --- |
| UNO · 休闲版 | [1.2.0](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-v1.2.0) / 208,106 | 1.2.1 / 329,033 | ^0.1.0 / 1.1.0 |
| UNO · 毫不留情 | [1.0.0](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-no-mercy-v1.0.0) / 127,018 | 1.0.1 / 257,168 | ^0.1.0 / 1.0.0 |
| 波多黎各 | [1.1.1](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.1) / 1,557,169 | 1.1.2 / 1,557,813 | ^0.1.0 / 1.0.0 |

三个候选 release.json 的 commit 为 null，属于本地构建，**不能作为正式 Release 交付**。本轮未重建或修改游戏产物；当前平台 1.2.6 的 D11/D12 真实安装兼容证据见各自历史记录，不将先前规则/UI/候选联机写成本轮重新运行。

**发布流程更正（交付时复核）：** UNO #4 自身仅改测试/CI，现有工作流只在推送版本标签时发布；合入 main 仅检查，不能据此判断已发布。获准后另推送精确合并提交的标签，交付 main 中既有的 **1.2.1 / 1.0.1 像素图稿候选**；波多黎各 #6 在 main 合并后自动发布 **1.1.2**。不能把“测试 PR”当作没有发布副作用。后续须固定游戏 head，审查通过后按原工作流生成新标签与不可变附件，再更新游戏仓库清单；生产有明确启用的订阅时才会自动安装，未启用则由管理员审核。不得覆盖旧精确版本或把发布等同于上架。

## 服务器与待完成交付

本轮 **22:58:15（北京时间）** 只读确认：私有 current.json、实际 API cwd、运行 package.json 一致为 **1c70c2d / 1.2.6**，`boardgame-local.service` **active/running、NRestarts=0**；公网 `/health/ready` 为 200、database.ready=true。公开游戏目录当前可见 UNO **1.2.0**、毫不留情 **1.0.0**、波多黎各 **1.1.1**，不读取玩家数据；不将公开列表推断为实际安装字节与 Release 一致，D4 已记录的同版本旧摘要差异继续保留。

历史 D11 自动审批已拒绝 main 合并，理由是“推进每日任务”缺少明确合并授权。本轮先完成本地整合、必要验证、推送与 PR 准备；未重试被拒绝的 main 合并，未绕过保护、清理未合并分支、重启应用、发布 Release、主动安装游戏或改变生产订阅开关。D14 合并/发布尚待授权，不能将本轮验收写成已上线；平台本批只有测试/内部记录，不需升版或强制重启。

D3 生产注册/登录闭环、D5 游戏正式发布/生产主动安装、真机/Safari/WebKit、屏幕阅读器及浏览器原生 200% 缩放仍未验收；本轮未重复无变化的全库单元/集成或游戏所有规则用例。D15 结果契约尚未开始，应在本轮审查与跨仓交付边界处理后独立推进。D14 的最终提交、PR 与检查状态在成功后补记。

## 已推送与统一 PR

D14 主提交 **06d3ee90738f8f97988dfc54787fc4e6c8946fcd** 已推送，创建 [PR #72](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/72)，面向 main，统一交付上述平台候选与 D14 记录。GitHub 应用创建接口返回 403 `Resource not accessible by integration` 后，复用已授权 Git 认证创建成功，先查询避免重复，未记录凭据。三个原平台 head 已逐个通过祖先检查；整合与文档冲突处理未修改已验证产品树。

平台 PR #69/#70/#71 和两个游戏 PR 均保留，尚未合并或删除分支；D14 PR 合入后才可按 GitHub 实际 merged 状态与精确 head 安全清理。后续仅补本节交付事实，不重复升版、构建或业务验证。最终 head 与远程 CI 以 PR 为准，不把原候选 CI 当作新整合提交的 CI。

## 已批准合并、正式发布与生产安装（2026-11-12）

用户明确回答“是”，批准合并平台 #72、UNO #4、波多黎各 #6，并完成游戏发布和服务器同步核验。重新 fetch 三仓 main、核对固定 head、完整差异及最新 CI/review 后，使用带 `sha` 约束的原生合并接口完成以下 merge commit；平台和两游戏的合并树分别等于已验证候选，没有加入其他提交或绕过保护。

| 仓库 / PR | 合并提交 | 实际结果 |
| --- | --- | --- |
| 平台 [#72](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/72) | `21d12fdb3109d946ae2e3ed67b1965a05388d189` | merged；#69/#70/#71 的全部提交已包含，GitHub 均标记 merged |
| UNO [#4](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/4) | `042868ce8d09fe5c4f7675f2003dc40f3b423207` | merged；现有 main 检查 success，随后推送两个未存在的新版本标签 |
| 波多黎各 [#6](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/pull/6) | `0a59124d8bf463604cb1ae2f2ac72d1f4f9c28f0` | merged；原 main 自动发布流程完成 |

首次合并脚本在额外 GET 预读遇到 HTTP 503，尚未执行合并；改以刚 fetch 的 main 和已核对的 PR 元数据执行固定 SHA 合并成功。UNO 首次标签推送因独立仓库缺少 HTTPS helper 未执行；仅该命令复用平台既有 helper 后推送成功，未持久修改认证配置或记录凭据。旧授权限制已由本次明确批准解除，不再保留为交付阻塞。

### 正式 Release 与校验

| 游戏 / 正式版本 | 标签所指提交 | 实际 ZIP 字节数 | 实际 ZIP SHA-256 |
| --- | --- | --- | --- |
| [UNO 1.2.1](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-v1.2.1) | `042868c` | 332,770 | `be42542e527792ccead2f17b0c16d7f285bac3418e77ef29e241b1ad7963849c` |
| [毫不留情 1.0.1](https://github.com/PlayBoardgameTogether/playboard-game-uno/releases/tag/uno-no-mercy-v1.0.1) | `042868c` | 251,591 | `fe52b98b64462683e4ef3f81cf26b73d5e77ce20009496a9fa8da18324cc46c6` |
| [波多黎各 1.1.2](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/releases/tag/puerto-rico-v1.1.2) | `0a59124` | 1,557,813 | `7065472879d1b8769eea6c6075a3ee65e19bad4ec71be532c69a5e987d286533` |

本次实际下载三个新 Release 的 ZIP、release.json、SHA256SUMS；逐个核对正式发布状态、标签完整 SHA、manifest.commit、SDK、gameId/版本/文件名和 ZIP 摘要，三者均齐全且一致。三个标签保留旧发布，不移动任何已发布标签或替换旧附件。**登记已核对，无需改动**；[游戏仓库清单](game-repositories.md)更新为上述正式版本，平台集成副本和来源锁保持。

UNO 正式产物与此前本地产物的大小/摘要不同。比较确认两玩法 server.js 完全相同、client.html 除内嵌 PNG 数据外完全相同、公开规则相同；以本次真实正式附件为交付和安装依据，不复用候选摘要。SDK 均为 ^0.1.0，UNO 规则内容 1.1.0、毫不留情/波多黎各规则内容 1.0.0，平台兼容版本为本轮实际运行的 1.2.6。

远程实际 [UNO 休闲版](https://github.com/PlayBoardgameTogether/playboard-game-uno/actions/runs/43245536699)、[毫不留情](https://github.com/PlayBoardgameTogether/playboard-game-uno/actions/runs/43245537922)、[波多黎各](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/actions/runs/43245228569)工作流均 completed/success，三个 run 的 **check 和 release 两个 job 均 success**。这些是本次正式发布检查，不是先前 PR 中 skipped 的 release。

### 平台与订阅实机核验

原监督进程自行完成平台构建、排空、备份、迁移/游戏同步及切换；未手工重启、修改监督脚本或覆盖服务器运维补丁/.env。新备份 **update-jpwwRw / 76 文件 / 6,045,032 字节**，通过原 `verify-update-backup.mjs` 复验文件集合、大小、SHA-256、PGDMP 归档签名；previous=`1c70c2d`、candidate=`21d12fd`。本轮无新增迁移，没有生产恢复或数据库回滚。

**23:15:37（北京时间）**，current.json、真实 API cwd、运行 package.json 一致为 **21d12fd / 1.2.6**；服务 active/running、NRestarts=0。匿名 Chromium 在 **1440×900、1280×800、390×844、320×740** 完成首页/详情/电脑页直达及刷新，ready/数据库就绪、页脚 1.2.6、pageerror 0、无检查到的整页横向溢出；实际响应的生产 CSS/电脑页 JS 与运行目录文件 SHA 相同。实际查看双端截图。页面切换取消的图片和 Cloudflare rum 请求未当作 API 失败或完整图像解码证据。

只读确认生产原订阅 **auto_add=true、auto_update=true、revision=1**、持久授权管理员仍有效。实际正式附件验收后，仅调用当前生产原 `GameSubscriptionService.requestCheck` 排入一次检查；未伪造会话、提高权限、改开关或直接写安装数据。运行中原调度器在 **23:19:42 → 23:20:04** 完成官方发现、下载、摘要/manifest 复核及安装，批次 **succeeded**，三个新版本的 item 均为 **updated**。

**23:20:26** 用只读 REPEATABLE READ 快照确认三新版本 enabled=true、安装摘要与上表正式 Release 完全一致；原 6 个包版本仍在、每个旧 package_hash 不变。新开桌目录切换到新版，旧版本取消大厅可用但不删除规则或桌面；没有在生产读取玩家私密 View、创建验收账号/对局，不能将保留旧包摘要等同于本轮实测玩家旧局恢复。其恢复/联机历史证据保留在 D11/D12 记录。

### 新旧游戏资源与双端实际画面

三个新版本的公开目录均只列出对应新版本；九张 icon/cover/background PNG 的响应 SHA 与正式包一致。三个源站桌面 HTML 与包内 client.html 严格逐字节一致，公网 HTML 仅额外插入可明确识别的 Cloudflare challenge 脚本，去除该唯一片段后严格全文一致；保留 sandbox CSP，波多黎各新帮助文字实际包含于响应。

初轮将公网 HTML 直接按完整字节比较而失败；只读诊断确认没有游戏内容漂移。诊断探针还遇到回环地址拒连，按真实监督进程监听地址核对后源站比对成功，没有修改服务器监听配置。后续新包三组资源检查全部通过，但最后旧波多黎各 1.1.1 公网请求超出 30 秒；只对该失败请求用新的 curl 连接诊断，最终 **200 / 1,017,369 字节 / 14.75 秒**，除同一 CDN 挑战片段外与旧正式包 HTML 完全一致。旧 UNO 两玩法桌面均为 200。没有把首轮写成完整全绿，也没有重复已通过的新包检查。

另行完成三个新版本详情页在 **1440×900 / 390×844** 的六次匿名实际渲染，**23:27:39** 全部 200、头像解码成功、pageerror 0、无检查到的整页横向溢出；实际查看 UNO 桌面、波多黎各手机截图。此检查不创建生产账号/对局，不能替代登录后的联机；原四视口平台检查及 D11/D12 的真实隔离联机证据各自保留。新增命令、日志、截图及实际附件保存在 `.data/d14-delivery/`，不提交。

### 分支清理与剩余范围

已逐个确认 GitHub merged、精确 source head 未变化、无其他开放 PR、工作区干净、main 包含全部提交后，以期望 SHA 约束删除远程并用本地 `git branch -d` 清理：平台 `codex/d11-uno-mobile`、`codex/d12-puerto-rico-help`、`codex/d13-responsive-accessibility`、`codex/d14-week-two-closeout`，游戏 `codex/d11-mobile-actions`、`codex/d12-decision-help`。全部工作区和 .data 验收证据保留，main 与正式发布标签保留；原主目录 36 项已有改动保持，其他任务分支不处理。

本次仅补内部发布/运行记录，平台 **1.2.6 → 1.2.6**，README 一致，不重复已通过的本地业务验证或为文档手工重启应用。D3 生产收件→注册→登录闭环、其余四个未发布头像候选、物理手机/WebKit/屏幕阅读器/原生缩放仍未验收，不将本批三个生产更新扩大为全部候选已发布；D15 尚未开始。内部记录后续提交、同步与最终运行 SHA 以最终交付为准。
