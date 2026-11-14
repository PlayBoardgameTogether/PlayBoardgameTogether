# D16：在线 ZIP 可选公开结果运行时

执行日期：2026-11-14（北京时间）；按每日任务顺序提前推进，原排期为 11-21。

本地实现和必要验证完成，候选平台 **1.2.6 → 1.3.0**（向后兼容新增能力，MINOR）。D15 [PR #74](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/74) 尚未合并；本分支保留其两个提交作为前置，从 `main@add094003876376b8fef83b7cfde5b9aeea87f76` 开始，不将 D15 重复设计或擅自合并。原目录落后 main 143 提交、36 项已有改动保持；使用独立 `/tmp/playboard-d15` / `codex/d16-package-public-results`。

## 实现与可观察行为

- 严格 game.json 支持可选 `publicResult: "winners-scores-v1"`；声明包必须提供同步 getPublicResult(outcome)。只有显式声明启用，不检查游戏 ID、不从未知 outcome、手牌或桌面推算胜负。
- [PackageRuntime](../apps/api/src/registry/package-runtime.ts) 在逐次创建的原 QuickJS 运行投影。显式 null 可正常结算；undefined、Promise、非 JSON/非有限数、额外字段和资源超限均失败。编码连同内部校验信封最多 16 KiB，内存/栈/执行上限仍为 16 MiB / 512 KiB / 100 ms。错误为固定脱敏文案，不返回原始投影、异常或 outcome。
- [结果适配器](../apps/api/src/registry/package-public-result.ts) 严格接受公开 winners/可选完整 scores，再与 MatchService 提供的固定参与者匹配，按 seat_index 顺序生成既有 DTO。支持单胜、共同胜出、无分数、负/零/小数；null 表示未知，空胜者及不完整/陌生席位拒绝，不补分、不重新排名。
- 新增 [039 迁移](../apps/api/src/db/migrations/039_package_public_result.sql)，可空声明随原包/目录切换/回执安装事务保存；重启按精确版本恢复回调。安装 smoke 初始状态已结束时校验投影，否则仅核对方法，不虚构终局验证。
- [GamePackageService](../apps/api/src/catalog/package-service.ts) 将回调装配到原 registry.resultSummaries，所有可能失败的可选适配准备在注册精确版本之前完成。既有 MatchService 终局事务不改，结果校验/持久失败使 State/RNG/revision、结果、回放、房间复位及动作/回执一并回滚；成功重试优先返回原回执。
- 未声明包的规则摘要构造逐字节保持，声明包单独追加 `:public-result:winners-scores-v1` 标记。旧包/旧活动局继续恢复；旧结束局不回填。SDK 核心、HTTP/WS DTO、前端交互、游戏副本、来源锁及登记没有改动。公开包规范、架构、数据模型、协议说明同步。

## 本轮验证

通过原冻结锁文件离线安装，无依赖/锁文件变化。普通沙箱首次安装无法写 pnpm store SQLite，获准执行环境安装成功；普通 lint 的 ESLint 通过但 tsx 本地管道 EPERM，获准执行环境完整 lint 成功，未关闭边界或格式检查。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false typecheck` | 全工作区与测试类型检查通过；最终实现/测试修改后再次通过 |
| `pnpm --config.verify-deps-before-run=false lint` | ESLint、20 源码根 AST 边界、既有 Prettier 检查通过 |
| `pnpm --config.verify-deps-before-run=false exec vitest run tests/unit/game-packages.test.ts tests/unit/package-enhancements.test.ts` | **2 文件、35/35，无 skip**；原包/AI 兼容及新结果结构、胜者/分数、异常/超时/内存/结果限额、脱敏 |
| 原 `pnpm ... test:integration --config .data/d16/vitest.config.mjs` | 旧包与现有结算 **2 文件、6/6 通过**；新增结果首轮 8 项中 4 项失败，原因见下文，不记整批全绿 |
| 原 `pnpm ... test:integration --config .data/d16/failed.config.mjs` | 仅重跑修正后的新结果文件，**10/10，无 skip**，不重复已通过的旧包/内置结算文件 |
| `pnpm --config.verify-deps-before-run=false build` | 全工作区生产构建、排除开发实验台、编译 API、ZIP 恢复及 AI worker 检查通过；保留既有 model-viewer 大 chunk 提示 |

隔离测试使用既有 PostgreSQL 17 **127.0.0.1:15441**，新建 **playboard_d16_test_20261114**；开发连接为 **playboard_d1_scratch**，执行前核对同服务/账户、不同库名。仅新工作区私有 .env 派生 TEST_DATABASE_URL，不覆盖原配置。prepare/migrate/sync/seed 原链完整、清理测试库命令串行；039 只应用于独立测试库。本轮未迁移开发/生产库。

最初尝试在原脚本后追加测试文件时发现它保留 `vitest run tests/integration`，会扩大范围；在资源准备阶段终止该次调用，未将其算作测试结果。改用上述仅包含三份目标文件的配置，保留原准备链。定向首轮新增 4 个失败断言都发生于 API 重建后、首次请求触发延迟装配之前，测试错误地提前检查 registry；修正为先发真实读取请求，并增加终局前重启、进行中不调用及初始终局 smoke 校验后，10 项全部通过，没有修改生产装配时机或削弱断言。

新集成覆盖：真人终局并发同 requestId 仅一次动作/回放/回执；同 ID 内容冲突；非参与者拒绝；本人战绩；有/无分数、共同胜出和 null；终局前及结束后 API/registry 重建；原活动旧包的规则摘要严格相同；进行中/读取不调用投影；非法结果回滚；match_actions 写入后故障导致晚期全回滚并使用原请求恢复；安装行故障无半包/回执/装配；真实免费脚本 bot 经原调度器提交终局。快照断言使用单条 SQL 同时读取上述持久结果。不是 mock 模型或付费供应商验收。

## 交付与后续边界

D16 为平台运行时支持；没有修改/发布 UNO 或任何独立游戏，现有正式包不自动获得公开结果。D17 仍需在 UNO 独立仓库用新版本和真实 ZIP 做试点，登记届时按原规则核对；D18 UI 实际渲染、D19 更完整的新旧包共存/授权/自动失败矩阵及 D21 发布/降级门槛尚未完成。没有交互/布局改动，本轮不重复浏览器 E2E、真机或全库无关测试，不宣称后续验收已完成。

039 为兼容可空新增列，旧程序可继续处理旧包；但旧 API 读取已经安装新声明包的同一数据库时可能忽略声明。**未实现阻止旧可执行程序启动的运维机制；依赖该能力的正式游戏发布前仍须核验部署版本及降级阻断方案**。先平台支持、实际运行验证，再按授权发布游戏；不把 descriptor 严格拒绝新 ZIP 等同于已持久包的降级保护。ADR-011 维持 Proposed。

本分支尚未合并，不向生产同步未审查代码、不安装游戏或改变订阅配置；推送/PR 和本轮服务器只读状态在成功后另记。22:14:06 只读检查确认服务器 current.json、实际 API cwd 和运行 package.json 一致为 **add0940 / 1.2.6**，systemd active/running、NRestarts=0，本机 `/health/ready` 返回 200、status=ready、database.ready=true。最初探针错误假设 API cwd 在 apps/api，查看服务进程树后按实际发布根目录核对成功；没有修改配置、读取玩家 View、迁移或重启。原 36 项改动及所有其他工作区保留。日志、私有配置、临时 Vitest 配置与构建产物留在 `.data/d16/` 或忽略路径，不提交。
