# D21：公开结果包的运行兼容与发布门槛

执行日期：2026-11-15（北京时间），按每日顺序提前推进，原排期 11-26。

## 本轮续作：整合 D20（2026-11-15）

重新 fetch `origin/main` 成功，最新 main **a3dbfac** 已含 D20 / 1.4.0；GitHub 只读确认 D21 [PR #81](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/81) 仍 open，旧 head **6f997a6** 与 main 冲突。复用干净的 D21 独立工作区，以 merge commit 整合 main，保留 D20 成长组件、双端回归和生产交付记录，并保留 D21 的启动兼容保护。没有修改原目录或其他任务。

候选平台版本随新基线由 **1.4.0 → 1.4.1（PATCH）**，替代本批原候选 1.3.1，仍是同一批兼容修复，不是第二次功能升版。README 与当前运维说明同步；下文 1.3.1、D20 待审和 09:26 生产状态均为初验时的历史事实，本轮结果另记。新结果包在生产保护验收前继续暂停发布。

本轮实际复验（均为 `pnpm --config.verify-deps-before-run=false`）：

- 全工作区 `typecheck`、`lint` 与 `build` 通过；含 20 源目录 AST 边界、格式、生产 bundle、实际编译公开结果投影、隔离 ZIP 和 AI worker。初次 lint 再次被沙箱 tsx IPC 的 EPERM 阻断，获准环境同命令通过，没有关闭检查。
- `exec vitest run tests/unit/runtime-compatibility.test.ts tests/unit/online-update.test.ts` **22/22**；显式传入既有 `npm_execpath` 的 `exec vitest run tests/unit/update-command.test.ts` **10/10**，共 **32 个独立单测**，无 skip。直接 `node tests/deployment/update-backup.test.mjs` **13/13**，核对实际子用例计数，不把最初 `node --test` 只有一项文件级汇总当作十三项。
- 原 `test:integration --config .data/d21/vitest.config.mjs` 在既有独立 **playboard_d21_test_20261115 / 15441** 串行准备、迁移、同步后 **3 文件、30/30、17.15 秒、无 skip**，含旧 API 启动前阻断、迁移前结构、新旧包和原订阅事务。开发库名称与测试库不同，没有清理开发或生产库。
- `bash -n deploy.sh`、差异/版本一致性检查通过。逐项核对 D20 的三个 Web 文件、原 E2E、徽章说明和交付记录均与 main 完全一致；D21 运行脚本及兼容测试与已审候选完全一致。没有 UI 变更，不重复 D20 的 E2E 或渲染验收，也没有新增测试/依赖/游戏版本。
- **10:01:36（北京时间）**，生产 current.json、真实 API cwd/package.json 一致 **a3dbfac / 1.4.0**；systemd active/running、NRestarts=0，API 与实际 UPDATE_HOST 入口 `/health/ready` 都为 **200 / database.ready=true**。初次误用默认 8080 返回 HTML、再按端口读回环被拒；只读监听及配置定位到服务器实际绑定地址后通过，未改服务。监督脚本仍无本批保护，本轮没有重启、安装、迁移或生产写入。

本轮日志保留在忽略的 `.data/d21/refresh-*`。整合提交 **4b2355a21c4d7050f8d88fde8e013f57cdc445c4** 已推送，[PR #81](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/81) 已改为 1.4.1，并确认 open / mergeable、精确 head 一致，pins [run 43665902067](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/actions/runs/43665902067) success。应用编辑接口 403、gh 旧版 GraphQL 字段失败后，使用仓库既有认证的 REST API 更新成功，没有输出或落盘凭据。D21 仍未合并/上线，生产保护加载及 UNO 发布门槛保持；下一项 D22 在独立 main 工作区验证，不夹入本 PR。

## 范围与实现

开始及交付前成功获取 main，基线 **95e017f22ab906ccce65c14bcf0ace7143192c1a / 1.3.0**。独立 `/tmp/playboard-d21`、`codex/d21-runtime-compatibility`；原目录已有改动及 D20 工作区保持。D20 [PR #80](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/80) 成长提示仍待审，本批从 main 独立交付，不夹带该功能。

旧平台严格拒绝含 publicResult 的新 ZIP，但连接已安装新声明的数据库时会忽略该列，上传校验不足以保护降级。本批新增：

- `runtime-capabilities.json` 声明支持 winners-scores-v1；生产构建用实际编译 schema 及真实 QuickJS 投影核验，不按版本号推断能力。
- `scripts/runtime-compatibility.mjs` 在有界、只读 REPEATABLE READ 事务读取已安装声明，包括下架版本。兼容迁移前缺表/缺列的结构，不读取玩家 State 或包源码。缺失元数据视为无可选能力；未知/损坏元数据、数据库不可达和能力不足都阻断，错误脱敏并关闭连接。
- 更新器排空前预检候选；每次真正启动（saved current、切换、重启及失败恢复）再次检查，防止构建期间新增安装。候选预检失败不停止当前 API；恢复也不启动不兼容旧 API，不回退数据库或改写 current.json。
- `deploy.sh` 在构建后、迁移和游戏同步前调用同一工具。

平台 **1.3.0 → 1.3.1（PATCH）**：兼容性缺陷修复，README 同步。没有游戏/资源版本、API/WS、SDK、迁移、依赖、安装事务或规则摘要变化。D20 后续合并须保留本批保护并整合版本/记录冲突。

## 保护边界与发布顺序

保护属于**加载新版监督程序的部署入口**；网页更新不会自动替换父进程。持有数据库/进程权限的维护者可绕过入口直接执行旧程序，本方案不声称能阻止这种手动绕过。禁止换回旧监督程序、手改 current.json、复制能力文件到旧 API 或直接启动旧程序规避检查。

1. 审查合并平台后，按既有维护流程核对服务器补丁、备份原启动模块/服务配置，加载新 online-update.mjs 及 runtime-compatibility.mjs。保留生产配置、数据库、资源和旧发布目录，维护不与自动更新并发。
2. 选择经 build 验证且有能力声明的发布；确认监督进程已重启加载新模块，预检真实数据库，核对 current.json、实际 API cwd/版本、active、ready、新备份和适用迁移。旧 1.3.0 有投影代码但缺本批声明，不作为安装新包后的受支持恢复目标。
3. **保护实机验收前不发布 UNO 1.3.0。** 隔离验证旧平台拒绝、订阅失败保持旧安装及结果事务后，再按授权审查游戏 PR、打精确标签、核验正式 ZIP/release.json/SHA256SUMS，最后走既有管理员授权的订阅安装。
4. 安装后只恢复到满足能力的已审查发布；下架不解除要求。更早版本需另行设计并授权数据恢复/迁移，不删除声明或清理活动局。不兼容或数据库不可达时保留数据、排查连通性和发布能力，不自动恢复数据库。

从已加载本批工具的维护目录执行，生产配置沿用私有方式：

```sh
node --env-file=.env scripts/runtime-compatibility.mjs /absolute/path/to/reviewed-release
```

零退出码仅表示该次预检通过，不等于已部署/发布/安装，不授权手改版本选择。

## 实际验证

冻结离线安装成功，锁文件未变。独立 **playboard_d21_test_20261115 / 127.0.0.1:15441** 与开发库 playboard_d1_scratch 同主机/账户、不同库名；原准备、迁移、同步、资源链完整，清理串行，没有操作开发/生产库。

- 全 typecheck、lint 通过，含 20 源目录 AST 边界和原格式检查。首次 lint 的 tsx IPC 被沙箱 EPERM 阻断，获准环境原命令通过；最终定向 ESLint/Prettier、bash 语法和差异检查通过。业务测试文件不在 tsc include 内，不将运行通过写成全部测试类型已编译。
- Vitest：能力/脱敏 **10/10**、更新流程 **12/12**、命令边界 **10/10**，共 32 个独立用例通过；Node 备份部署回归 **13/13**。命令边界首轮沙箱 9 项失败，获准后 3 项缺 npm_execpath，显式传入现有 pnpm.mjs 后全通过；未改原断言或时限。
- `test:integration --config .data/d21/vitest.config.mjs` 三文件首轮 **29/29，16.96 秒**，含新旧声明安装、下架仍阻断、旧 API 在 fork 前拒绝/锁清理、原订阅/普通 ZIP 事务。连接异常脱敏调整后两项 **2/2**；查询收敛为仅读声明列并补迁移前结构后，最终三项 **3/3，3.37 秒**，其余 27 项名称过滤未执行。合计 30 个独立用例分批通过，非单批 30/30。
- 全 build/bundle/API runtime 通过，含实际公开结果投影、隔离规则与 AI worker；既有 model-viewer chunk 提示保持。版本补齐后仅重建受注入影响的 Web/bundle，模块调整后仅复验 runtime，没有重复全构建。
- 真实候选 UNO 1.3.0：**329100 字节，SHA-256 6882d00805f66b60ad71e7e71af208b52f96b253d601d70ff515914d78a10a1e**；正式旧 1.2.0：**208106 字节，SHA-256 0925f7090dd5f2ade0642d5636896e4edae86948e05bfdf7feb831ec68fa14d8**，与原 SHA256SUMS 一致。新旧解析器均接受旧包；旧严格 schema 明确拒绝新声明，外部返回原 VALIDATION_ERROR。首次探针误在脱敏消息里找字段，改为分别验证严格 schema 与外部错误后通过，未改解析器/游戏。

命令均以 `pnpm --config.verify-deps-before-run=false` 运行，未关闭业务检查。日志/临时配置在忽略目录 `.data/d21/`。没有 UI 改动，不重复无变化 E2E 或截图；D19/D20 历史双端证据不算本轮新验证。没有全库回归、真机/WebKit、收费模型或生产降级演练。

## 跨仓及生产事实

UNO [PR #5](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/5) head **2165c0f19b1c9df41146291f562093fe154fa024** 仍 open，check [run 43606238931](https://github.com/PlayBoardgameTogether/playboard-game-uno/actions/runs/43606238931) completed/success。已 fetch 游戏 main 并读取远程 game.yml：main/PR 只验证，精确标签 push 才发布。只读 Release API 确认 **uno-v1.2.1** 正式三附件存在、**uno-v1.3.0 为 404**；本轮没有新 Release 或安装。**登记已核对，无需改动**，两玩法 ID/包名前缀、release.config 与目录一致，来源锁保持。

**09:26:22（北京时间）**，生产 current.json、实际 API cwd、运行 package.json 一致 **95e017f / 1.3.0**，服务 active/running、NRestarts=0、ready 200、database.ready=true。**09:27:44** 启动文件核对确认尚无本批保护/能力元数据。没有读取玩家私密 View、写生产安装、触发订阅、迁移、重启或覆盖服务器补丁。

平台提交/PR 仍待审查和获准合并；保护加载、UNO 发布与订阅安装是尚未完成的实机门槛。ADR-011 保持 Proposed，待门槛通过再记录 Accepted。D3 生产注册闭环、D5 其余头像候选及既有设备/外部服务条件保持，本批不推进 D22。

## 提交与待审 PR

主提交 **b7b705e62836be4379b6493d432df80af2826fae** 已推送至 `codex/d21-runtime-compatibility`，创建面向 main 的 [PR #81](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/81)，open、未合并。完整差异仅本批 18 文件，无 D20 或其他任务祖先；分支/工作区保留待审。GitHub 应用创建接口 403 后，复用已成功推送的 Git helper 内存认证，经 gh 先查重再创建，无凭据输出或落盘。新增文档链接、README/版本及实际 Web 版本注入检查通过；未重复无变化业务验证。

主提交远程来源锁检查 [run 43663794915](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/actions/runs/43663794915) completed/success，仅代表 pins CI，不冒充远程业务全测；原目录仍有 36 项已有改动，全部保留。后续只补本文与 progress 交付链接，不再升版或重复代码检查。
