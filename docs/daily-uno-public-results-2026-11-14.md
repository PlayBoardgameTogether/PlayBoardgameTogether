# D17：UNO 休闲版公开结果试点验收

执行日期：2026-11-14；按每日任务顺序提前推进。D15/D16 的 [PR #74](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/74) / [#75](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/75) 均未合并。独立平台分支 `codex/d17-uno-results-validation` 从 D16 `8f377a1` 创建；main 仍为 `add0940`。原目录 36 项既有改动与此前工作区全部保持。

## 实际交付

UNO 独立仓库以 `main@042868c` 开发休闲版 **1.2.1 → 1.3.0（MINOR）**：显式声明可选公开结果，同步 QuickJS 投影只返回权威 winners，支持规则产生的共同胜者，不返回数值分数。内容规则仍 1.1.0、资源/桌面不变；毫不留情仍为 1.0.1，未启用结果。游戏源码、打包和规则测试均在独立仓库，不编辑平台锁定副本。

平台只新增两个专门的集成/E2E 文件和本轮内部记录；保持 D16 候选平台 **1.3.0 → 1.3.0**，README 一致，不重复升号。没有本批运行代码、协议、数据库迁移、SDK、来源锁或依赖变化。官方 catalog 与游戏 release.config/manifest 已核对，**登记已核对，无需改动**；目录不虚构最新版号，生产清单不提前写未发布版本。

## 复现入口

测试显式要求实际外部 ZIP，不静默使用平台旧副本：

```sh
export PLAYBOARD_UNO_RESULT_ZIP=/absolute/path/to/uno-1.3.0.zip
export PLAYBOARD_UNO_LEGACY_ZIP=/absolute/path/to/uno-1.2.0.zip
pnpm --config.verify-deps-before-run=false test:integration --config .data/d17/vitest.config.mjs
pnpm --config.verify-deps-before-run=false test:e2e tests/e2e/uno-public-results.spec.ts --output=.data/d17/e2e
```

本地临时 Vitest 配置仅包含 `tests/integration/uno-public-results.test.ts` 并设置 fileParallelism=false，未修改原 `test:integration` 准备链。执行前检查独立 **playboard_d17_test_20261114 / 127.0.0.1:15441** 与开发 **playboard_d1_scratch** 不同；仅新工作区派生私有 .env，未改原配置。集成与 E2E 的清理串行，039 仅迁移独立测试库。没有新数据库/容器权限或配置变更。

旧包取自此前下载的真实正式 Release `uno-v1.2.0`，本轮 `sha256sum --check SHA256SUMS` 通过；未把重新打包的旧源码当作正式旧字节。新包从本轮 UNO 仓库实际 Chromium 打包，**329100 字节**，SHA-256 `6882d00805f66b60ad71e7e71af208b52f96b253d601d70ff515914d78a10a1e`。本地 release.json.commit=null，未计为正式发布。

## 本轮命令与结果

| 实际检查 | 结果 |
| --- | --- |
| 两仓冻结离线安装 | 通过，无依赖或锁文件变化 |
| 平台 `pnpm ... typecheck` | 全工作区通过；该入口不单独编译测试文件，不声称测试 TS 亦经过 tsc |
| 平台 `pnpm ... lint` | ESLint、20 根 AST 边界及原 Prettier 全通过；最终测试辅助修改另作 ESLint/Prettier 通过 |
| 原 `test:integration --config .data/d17/vitest.config.mjs` | 首次因测试根缺少 @boardgame/protocol 直接依赖而未收集用例，改为公开源码相对导入；次轮双真人和脚本 **2/3**，旧局安装新版因未传审核 catalogHash 按保护拒绝 |
| 原链定向 `-t 'old active match'` | 测试先 review 并传实际 catalogHash，旧局 **1/1**；另外两项名称过滤跳过，不计通过。共三个独立用例分批通过，不记为单批全绿 |
| 原 `test:e2e tests/e2e/uno-public-results.spec.ts` | **2/2，无 skip**，1440×900 与 390×844；真实上传/审核、脚本 AI、iframe 操作、刷新、完整结算/回房，实际查看最终截图 |
| 平台 `pnpm ... build` | 全生产构建、开发实验台排除、编译 API、隔离 ZIP 恢复及 AI worker 检查通过；保留既有 model-viewer chunk 提示 |
| `node scripts/check-game-repositories.mjs` | 普通沙箱子进程 EPERM 后获准环境原命令通过：**10 仓库 / 154 文件**；未修改检查或游戏锁 |
| 游戏规则与 ZIP/UI | 初轮 24/25，补全新增测试中合法摸牌后的保留步骤后休闲版 11/11，毫不留情原批 14/14；实际 ZIP verify 1/1、最终精确标签 verify 1/1，四视口双玩法 UI 全通过 |

三个集成用例分别覆盖：双真人完整局、真人/真实免费脚本完整局，以及原 1.2.0 活动局在安装新 1.3.0 后重启继续完成。新局结果逐席位等于权威 winners、没有 score；旧局仍锁定 1.2.0、持久状态不因安装改变、终局结果 null 不回填。所有流程检查非参与者 404、API 重建后的精确版本、完整动作/回放帧数量、原请求重复返回同一结果且不新增持久记录、不同内容复用 ID 冲突、本人记录和房间复位。没有通过直接写游戏状态缩短完整对局。

真实 E2E 桌面 25.6 秒、手机 15.0 秒，总计 42.7 秒；包含实际大厅图稿、透明 iframe 私密视图和结算卡与权威胜者一致，不合成分数。截图与日志保留本地 `.data/d17/`；游戏四视口证据在独立仓库 `dist/uno-check/`。无需改 UI，已有结算卡能消费新结果；D18 的筛选/分页/账号切换专项仍未执行。

## 发布、运行与限制

平台分支包含 D15/D16 的四个前置提交，后续平台 PR 需明确依赖 [#75](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/75)，不能绕过审查合入。游戏 PR 与平台 PR 的提交/链接成功后补记；本轮不合并 main、不打游戏标签、不创建正式 Release、不主动生产安装或修改订阅开关。

先部署平台 1.3.0 并验证真实运行 SHA/ready、完成 D19/D21 兼容及运维降级门槛，再发布依赖它的 UNO 1.3.0。旧运行时安装时拒绝新声明已实测，但旧可执行程序读取已安装新包数据库时的启动阻断尚未实现；D17 不擅自处理后续运维架构，也不以安装拒绝冒充降级保证。平台来源锁与游戏集成副本继续原精确 SHA。

**22:29:25** 只读核验真实服务器：current.json **add094003876376b8fef83b7cfde5b9aeea87f76**，实际 API cwd 一致，运行 package.json **1.2.6**；`boardgame-local.service` active/running、NRestarts=0，实际 API 19301 的 `/health/ready` 为 200、status=ready、database.ready=true。最初使用历史 8080 探针得到 404，改从实际 API 进程确认非秘密端口后通过；没有修改配置或重启。本批候选尚未上线，生产订阅/游戏安装不作新验收声明。

未验证物理手机、WebKit、屏幕阅读器、真实付费模型、旧 1.2.1 活动局专门矩阵及 D19 更完整授权/回滚组合。D3 的生产注册闭环与其余四个头像候选维持原记录；下一项为 D18 结算和个人战绩衔接验收。
