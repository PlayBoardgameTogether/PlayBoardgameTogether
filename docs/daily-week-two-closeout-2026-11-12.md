# D14：第二周整合与交付核验（2026-11-12）

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

UNO #4 自身仅改测试/CI，但合入游戏 main 会触发现有自动发布，可能交付 main 中既有的 **1.2.1 / 1.0.1 像素图稿候选**；波多黎各 #6 会触发 **1.1.2** 发布。不能把“测试 PR”当作没有发布副作用。后续须固定游戏 head，审查通过后按原工作流生成新标签与不可变附件，再更新游戏仓库清单；生产有明确启用的订阅时才会自动安装，未启用则由管理员审核。不得覆盖旧精确版本或把发布等同于上架。

## 服务器与待完成交付

本轮 **22:58:15（北京时间）** 只读确认：私有 current.json、实际 API cwd、运行 package.json 一致为 **1c70c2d / 1.2.6**，`boardgame-local.service` **active/running、NRestarts=0**；公网 `/health/ready` 为 200、database.ready=true。公开游戏目录当前可见 UNO **1.2.0**、毫不留情 **1.0.0**、波多黎各 **1.1.1**，不读取玩家数据；不将公开列表推断为实际安装字节与 Release 一致，D4 已记录的同版本旧摘要差异继续保留。

历史 D11 自动审批已拒绝 main 合并，理由是“推进每日任务”缺少明确合并授权。本轮先完成本地整合、必要验证、推送与 PR 准备；未重试被拒绝的 main 合并，未绕过保护、清理未合并分支、重启应用、发布 Release、主动安装游戏或改变生产订阅开关。D14 合并/发布尚待授权，不能将本轮验收写成已上线；平台本批只有测试/内部记录，不需升版或强制重启。

D3 生产注册/登录闭环、D5 游戏正式发布/生产主动安装、真机/Safari/WebKit、屏幕阅读器及浏览器原生 200% 缩放仍未验收；本轮未重复无变化的全库单元/集成或游戏所有规则用例。D15 结果契约尚未开始，应在本轮审查与跨仓交付边界处理后独立推进。D14 的最终提交、PR 与检查状态在成功后补记。
