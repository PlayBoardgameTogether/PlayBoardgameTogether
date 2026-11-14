# D19：公开结果事务与兼容验收

执行日期：2026-11-14（北京时间），按每日任务顺序提前推进；原排期 11-24。

## 范围与基线

编辑前成功重新获取 main，仍为 `add094003876376b8fef83b7cfde5b9aeea87f76`。从 D18 `6023ba60a7a8accd6c470ff0a2950f18e897454b` 创建独立 `/tmp/playboard-d19` / `codex/d19-result-compatibility`；核对 main 的完整前置差异，保留 D15–D18 的祖先与原目录所有已有改动。交付前再次 fetch，main 未变化。平台 [#74](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/74)、[#75](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/75)、[#76](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/76)、[#77](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/77) 及 UNO [#5](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/5) 本轮均核实为 open、未合并。

本轮只扩展 [现有集成测试](../tests/integration/package-public-results.test.ts) 与内部记录，没有修改产品、公开契约、迁移、游戏副本、目录登记、来源锁或依赖。平台候选 **1.3.0 → 1.3.0**，README 一致；测试和内部文档不重复升版。不将 D19 隔离验收等同于 D21 降级与跨仓发布门槛完成，ADR-011 保持 Proposed。

## 本轮补齐的矩阵

| 风险 | 实际验证 |
| --- | --- |
| 不同请求同时终局 | 相同 revision 的两个不同 requestId 同时提交，仅一个成功，另一项 ACTION_NOT_ALLOWED；只一份结果、动作、回执及两帧回放；原成功请求重试返回已提交结果且不重播事件 |
| 公开结果的访问权 | 非参与者管理员仍不能读写；其他玩家不能代行动；Origin、CSRF 和严格 body 拒绝伪造；终局后管理员无本人记录、非参与者回放 404；原参与者可读回放，退出后的旧 session 对 view/replay/history/重复动作均 401 |
| 同游戏新旧版本共存 | 先安装未声明 1.0.0 并开局，再按原审核摘要安装声明结果的 1.1.0，由另一账号开新局；重建 API/registry 后两局均按精确版本完成，旧规则摘要严格相同、旧结果仍 null、新结果有胜者无分数 |
| 精确旧版缺失 | 仅移除测试库旧包运行时行后重启，旧局 view/replay 明确 GAME_VERSION_UNAVAILABLE，新版仍可读；不静默换新版，不改写历史结果；finally 恢复原行后旧局恢复读取 |
| 终局 VM 与输出失败 | 抛秘密标记异常、无限循环超时和完整分数字典中的 NaN 各重试两次；响应脱敏，State/RNG/revision/结果、房间、座位、动作、回放及回执与失败前完全相同 |
| 自动提案原子性 | 明确的冻结脚本提案夹具，错误 worker 租约被拒；非法结果或任务写 succeeded 时的数据库触发故障使终局完整回滚，任务也与失败前相同；撤除触发故障后原提案成功，只一份结果/动作/回执 |
| 原有结果和包行为 | 原单胜/共同获胜、有/无分数、显式 null、同请求并发/冲突、真人晚期回滚、安装回滚、未声明方法不调用、进行中不投影、真实脚本及重启回归保持；另跑原普通 ZIP 与内置结果套件 |

冻结提案与旧包行缺失是明确的测试库故障夹具，不当作真实模型或生产损坏演练；实际脚本调度由原用例及真实 UNO 集成/E2E 分别验证。单条 SQL 同时读取持久副作用，避免用多次查询拼成不一致的“事务快照”。没有修改或绕过生产身份、安装、沙箱和事务实现。

## 环境、输入与命令

仅派生本工作区私有 .env，开发配置仍指向 `playboard_d1_scratch`，`TEST_DATABASE_URL` 指向独立 **playboard_d19_test_20261114 / 127.0.0.1:15441**，执行前核实主机/端口和不同库名。所有会清理同库的命令串行，使用原准备、迁移、游戏同步与资源链；039 只应用于新测试库，未清理开发/生产数据。缺少本机 TTS 时原脚本安装原创回退，不冒充 TTS 验证。

真实 UNO 新包来自独立仓库既有候选 `uno-1.3.0.zip`，329100 字节，SHA-256 `6882d00805f66b60ad71e7e71af208b52f96b253d601d70ff515914d78a10a1e`，不改写或发布候选。正式旧包来自已下载 Release `uno-v1.2.0`，SHA-256 `0925f7090dd5f2ade0642d5636896e4edae86948e05bfdf7feb831ec68fa14d8`；本轮 `sha256sum --check SHA256SUMS` 通过。通过进程环境显式传入两个绝对 ZIP 路径，不把外部附件加入平台源码。

```sh
pnpm install --frozen-lockfile
pnpm --config.verify-deps-before-run=false typecheck
pnpm --config.verify-deps-before-run=false lint
pnpm --config.verify-deps-before-run=false test:integration --config .data/d19/vitest.config.mjs
pnpm --config.verify-deps-before-run=false test:integration --config .data/d19/vitest.config.mjs -t 'keeps a frozen automation proposal atomic'
pnpm --config.verify-deps-before-run=false test:integration --config .data/d19/vitest.config.mjs -t 'terminal non-finite score'

# 指向真实新候选及正式旧 ZIP；两个变量必填。
export PLAYBOARD_UNO_RESULT_ZIP=/absolute/path/to/uno-1.3.0.zip
export PLAYBOARD_UNO_LEGACY_ZIP=/absolute/path/to/uno-1.2.0.zip
pnpm --config.verify-deps-before-run=false test:integration --config vitest.uno-results.config.ts
pnpm --config.verify-deps-before-run=false test:integration --config vitest.uno-results.config.ts -t 'old active match'
pnpm --config.verify-deps-before-run=false test:e2e --config playwright.uno-results.config.ts --output=.data/d19/e2e
```

私有 `.data/d19/vitest.config.mjs` 使用 fileParallelism=false，仅包含 package-public-results、game-packages、computer-results 三份集成文件；保留原脚本，不通过追加文件参数误收集全库。

## 实际结果与修正

- 冻结安装普通沙箱无法写 pnpm store SQLite，获准环境原命令成功，无锁文件变化。完整 typecheck 通过。lint 的 ESLint 通过后，tsx IPC 被沙箱 EPERM 阻断；获准环境执行原完整 lint 通过，包含 20 根 AST 边界和原格式检查。最终测试文件定向 ESLint/Prettier 与差异检查通过。typecheck 编译范围不包含该业务测试文件，不宣称所有测试类型已经过 tsc。
- 首轮三文件 **22 通过、2 失败（24 项）**，13.31 秒。失败发生于新自动任务夹具建房：包缺少电脑席位要求的 getDecisionContext，被原 422 保护拒绝；补齐合法决策/兜底契约后仅重跑两项，**2/2 通过**，其余 22 项因名称过滤未执行，不计为新通过。没有改产品校验或延长时限。最终审查把 NaN 夹具补成完整分数字典，避免同时触发缺少参与者分数的另一种拒绝；定向复验该项通过。合计 **24 个独立用例分批通过**，不是单批全绿。
- 真实 UNO 新版双真人、免费脚本和旧活动局集成首轮 **3/3 通过**，10.04 秒；随后发现旧输入指向本地重打包的 1.2.0（摘要 `4c5e0f73…`），未把它冒充正式 Release。改用上方正式旧附件，仅重跑受输入影响的旧活动局，**1/1 通过**，另两项名称过滤未执行。三项的最终证据包含新版本权威结果、重复/冲突、权限、本人记录以及正式旧局重启/摘要锁定；两个新版用例的输入未变，不重复运行。
- 真实浏览器使用正式旧 ZIP 与新候选，桌面 **1440×900**、手机 **390×844** 各两个完整流程，最终 **4/4 通过，无 skip，2.2 分钟**。覆盖管理员原审核安装、真实脚本完整局、刷新恢复、胜者/未知结果、只读回放与回房入口；沿用 D18 的 23 条明确分页夹具验证 20+3、同时间游标、筛选迟到响应及同文档换号隔离。复制夹具不计作额外真实完成场次。
- 实际查看桌面新旧包结算及手机新包结算截图：新包显示权威胜者且不合成分数，旧包保持未记录结果，检查到的页面无整页横向溢出。没有布局/主题变更，不重复四视口/全主题矩阵。本轮没有跑全库 unit/integration/E2E 或生产 build；只改测试/内部记录，不将 D16/D17 历史构建当作本轮验证。

日志、临时配置、截图与私有环境保留 `.data/d19/` 或忽略路径，不提交生成物。真机、WebKit、屏幕阅读器、真实收费模型及生产新版本仍未验收。

## 服务器与后续门槛

**23:46:33** 只读核实：current.json、实际 API cwd 与运行 package.json 一致为 **add0940 / 1.2.6**；`boardgame-local.service` active/running、NRestarts=0，实际 API `/health/ready` 为 200、status=ready、database.ready=true。没有生产数据写入、安装、迁移、配置覆盖或重启。

D15–D18 依赖仍未合并，本轮不向生产同步候选。新结果包安装后降级旧 API 的语义仍未被阻断；D21 须完成运维兼容和平台先部署、游戏后发布的门槛，才能单独按授权处理发布与订阅安装。D3 注册闭环、其余四个头像候选和既有设备/外部服务限制继续保留。D20 为可选成长提示，未在本轮推进。

本轮提交、推送及 PR 成功后补记；保留所有尚未合并的相关分支，不清理其他任务工作区。
