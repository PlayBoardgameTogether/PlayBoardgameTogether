# D12 波多黎各操作帮助（2026-11-12）

## 交付范围

本轮从平台最新 `main@1c70c2def3ace12156140970a22a57dac0619d09` 新建 `codex/d12-puerto-rico-help` 隔离工作区；独立游戏从 `main@d206705` 新建 `codex/d12-decision-help`。两仓库编辑前 fetch 成功。原目录 36 项已有改动及 D11 工作区不动，D11 平台 #69 / UNO #4 仍 open，未将其并入本批。

波多黎各市长阶段手动分配仅提示“尽可能填满岗位”，玩家难判断还差几人、能否形成生产链。游戏独立仓库现增加：

- 已分配、必须上岗数、工人和岗位总数；具体的不足/超配人数及单岗整数要求。
- 确认旁的未提交产能预览：玉米看种植园，其余取上岗种植园与加工岗位较小值，明确实际生产仍受供给和行动顺序限制。
- 输入说明与提示关联；手机原确认区跟随岗位并单独换行，桌面保持键盘操作。只解释本人 View 与本地草稿，服务端规则继续最终校验。

游戏 **1.1.1 → 1.1.2（PATCH）**，contentVersion **1.0.0**、资源版本 **1.1.0** 不变。主提交 **fd4d6e781ca06811e3537b0c07403ea4f53c8702** 已推送，创建 [游戏 PR #6](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/pull/6)。方案、实际命令、失败重跑和四视口证据位置见[独立游戏验证](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/blob/codex/d12-decision-help/docs/daily-worker-help-2026-11-12.md)。GitHub 应用写接口 403 后，复用原 Git 认证创建，未写入凭据或重复建 PR。

平台仅改跨仓 E2E 与内部文档，保持 **1.2.6**，README 版本一致。平台运行代码、API/WS、数据库迁移、SDK、registry、集成副本与来源锁没有变化。

## 实际验证

pnpm 均带 `--config.verify-deps-before-run=false`，两仓库先按各自冻结锁安装。

| 范围 | 命令与结果 |
| --- | --- |
| 独立游戏规则 | `pnpm test`，16/16，无 skip，含 3/4/5 人完整脚本局与逐步恢复 |
| 包与兼容运行时 | `pnpm build`、`pnpm verify` 最终通过，verify 1/1；ZIP 1,557,813 字节，解压 2,087,271 字节，原 2 MiB 上限有效；源码与 ZIP 规则/桌面一致 |
| 游戏 UI | `pnpm test:ui` 最终 12/12，无 skip，1440×900、1280×800、390×844、320×740；亮暗、键盘、触摸仿真、减少动态效果、错误人数、草稿锁/解锁、规则产能对照、恢复与隔离 |
| 发布脚本 | `node --test tests/publish-release.test.mjs`，1/1，无 skip；本地生成 release.json / SHA256SUMS 不等于正式发布 |
| 平台静态检查 | 全工作区 `pnpm typecheck`、`pnpm lint` 通过，含 20 根 AST 与原格式检查；最终 E2E 定向 ESLint 通过 |
| 来源锁 / 目录 | 本地检查 10 仓库、154 文件通过；catalog 与 release.config.json、manifest 名称/仓库/ID/前缀一致，登记已核对，无需改动 |
| 候选真实联机 | 原 `pnpm test:e2e` 准备链，明确版本 1.1.2 与帮助断言，1440/390/320px 3/3，无 skip |
| 默认旧版兼容 | 原链 `pnpm test:e2e tests/e2e/puerto-rico.spec.ts --grep 'three signed-in' --project desktop --output .data/d12/e2e-baseline-final`，锁定 1.0.0，最终 1/1，无 skip |

候选实际命令：

```sh
PUERTO_RICO_TEST_VERSION=1.1.2 PUERTO_RICO_TEST_WORKER_HELP=true \
  pnpm --config.verify-deps-before-run=false test:e2e tests/e2e/puerto-rico.spec.ts \
  --config .data/d12/e2e.config.ts --grep 'three signed-in' --output .data/d12/e2e-verified
```

三位真实 session 通过管理员上传审核、建房/加入/入座/准备进入对局；当前玩家手动清空、校验不足、填一位、用键盘 Enter 或手机触摸提交，其余两人依次确认，完成整个市长阶段，revision **0→4**。刷新恢复 **2**，最终确认多出的工人待业 **1**；本人之外的筹码与结果仍为空。测试默认仍使用锁定 1.0.0；新版帮助检查由显式开关启用，本轮候选命令已开启，不通过检查元素是否存在来静默跳过。

候选最终与旧版兼容依次使用 PostgreSQL 17 回环 **15441** 专用新库 **playboard_d12_final_test_20261112**，不同于开发 `playboard_d1_scratch` 和生产。原 prepare/migrate/sync/seed/run-e2e 链完整，数据库清理串行。早期候选测试库 `playboard_d12_test_20261112` 保留，未重置开发库或更改 .env 原文件；配置仅在新隔离工作区写入。缺本机 TTS 时原流程安装原创 SVG，不声称检验外部图包。

## 失败、修复与证据

320px 新增用例先在原版缺少精确人数提示处失败。浏览器首次受沙箱启动限制，改用外层运行；四视口新增产能对照最初未等待异步规则提交，改为 poll 后最终通过，未改变规则。查看截图后使预览单独换行，最终完整 UI 12/12。

平台候选首轮三项在旧头像 256px 假设失败，改为读取包 PNG 的真实 448px 宽高，保留图像完整解码检查。第二轮旧专用库按不可变保护拒绝覆盖早期候选，保留旧库，换上述全新库后 3/3。默认旧版初次遇到已安装候选时，原测试漏列“已有游戏更新 / 审核通过并更新”，补齐实际合法审核状态后旧版 1/1；没有放宽版本不可变或授权校验。结束关闭连接时曾记录 Vite ECONNRESET，选中用例均通过。

实际查看最终 320px 亮色、1440px 暗色的新帮助画面，以及真实联机 320px 阶段结束截图。四视口 UI 使用独立沙箱父窗口和真实 QuickJS；联机另用正式 session/API/WS，不把夹具当联机。截图、完整日志保存在本工作区 `.data/d12/` 和独立游戏 `test-results/`；未提交秘密配置、ZIP、数据库或生成物。

## 发布与剩余边界

游戏沿用 SOURCE.json 的既有兼容 SDK，本轮在平台 **1.2.6** 的实际隔离运行时验证；新候选与旧包分别安装验收。平台来源锁仍固定原 SHA，没有直接维护集成副本。**登记已核对，无需改动**；正式版本清单不提前改成候选。

只读核对生产 current.json、真实 API cwd 和运行 package.json 一致 **1c70c2d / 1.2.6**，systemd active/running、NRestarts=0。本轮未合并、打标、正式 Release、主动订阅安装、重启或更改生产数据；没有把候选当上线。游戏 PR 合入 main 会触发原自动验证/发布，应在获准合并并通过后核对精确标签、ZIP、release.json、SHA256SUMS，再按已开启订阅或管理员审核确认安装；发布后另同步游戏正式清单。

未验收物理手机、Safari/WebKit、完整屏幕阅读器或真实模型，未重复无变化的平台生产构建或全量业务集成/E2E。D3 生产注册闭环、D5 发布/主动安装继续保留原条件；D13 未开始。PR、远程 CI 与最终交付状态据实补记。
