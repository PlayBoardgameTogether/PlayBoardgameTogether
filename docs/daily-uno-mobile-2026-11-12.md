# D11 UNO 手机行动（2026-11-12，平台保持 1.2.6）

从最新平台 `main@1c70c2def3ace12156140970a22a57dac0619d09` 建立独立 `codex/d11-uno-mobile` 工作区，保留原目录全部既有改动。UNO 在对应独立仓库 `main@9ed4deba6ca230e26f9a70f4d6b8a1d07366e147` 检查并修改测试；两处编辑前均成功 fetch。

## 结论与交付

按每日计划“已有问题已修复则验收现版”执行：现版内联选色、长手牌局部滚动、相同快照保留草稿及失败解锁已经存在，本轮未复现需要修改产品的问题。不改变游戏规则、棋桌、资源、平台 API/WS/事务或数据库迁移。

- UNO 独立仓库新增手机触摸仿真；两玩法分别覆盖 24 张手牌末端万能牌、长页选色、相同快照保留滚动/焦点、Escape 取消和失败后重复明确选择。毫不留情使用六人场景，24 张低于淘汰门槛；原累计罚牌、换手、轮盘、UNO、刷新和父 cookie 隔离检查保留。四视口为 1440×900、1280×800、390×844、320×740，实际查看 320px 六人桌长手牌选色画面。
- 平台旧 UNO E2E 将隐藏头像端点写死为 PNG；11 月 7 日平台展示已使用 WebP 覆盖。首轮 390px 在该断言失败，桌面/320px 均完成真实整局。测试现按实际来源严格核对 MIME，并确认隐藏头像与已经成功解码的可见头像同源，保留 HTTP、尺寸及隐藏状态检查，不修改产品去迎合旧假设。
- 游戏改动主提交 **e631edaa7a52369455adcef7c69832490e167c76** 已推送，创建 [UNO PR #4](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/4)，当前 open、待审查；仅三文件测试/内部文档，未合并。GitHub 应用创建连接中断，GraphQL 读取超时后改 REST，确认无重复再创建。

## 实际验证

以下运行脚本的 pnpm 命令带 `--config.verify-deps-before-run=false`；两仓库均按各自冻结锁文件安装依赖，未升级依赖。

| 范围与命令 | 实际结果 |
| --- | --- |
| UNO `pnpm test:ui` | 原基线四视口通过；新增检查后四视口通过，新增两玩法 × 四视口共八组长手牌检查，无 pageerror/整页横向溢出 |
| UNO `pnpm test` | 两文件，23/23，无 skip；真实 QuickJS 规则、确定性、非法动作、私密投影及完整脚本局逐步恢复 |
| UNO `pnpm build` / `pnpm verify` | 实际三文件 ZIP 两份：候选 1.2.1 为 329033 字节、1.0.1 为 257168 字节；verify 1/1，最小/最大人数与序列化通过 |
| 平台 `node scripts/package-uno.mjs` | 锁定正式版本 1.2.0 / 1.0.0 打包成功，供本轮真实安装/对局 |
| 平台 `pnpm test:e2e tests/e2e/uno-package.spec.ts --config .data/d11/e2e.config.ts` | 首轮 4/6：1440px、320px 两玩法通过；390px 两项在旧 PNG 断言失败，未计为通过 |
| 同入口追加 `--project mobile --output .data/d11/e2e-mobile-final` | 修正断言后仅重跑失败两项，2/2，无 skip；总计六个独立完整用例通过，不声称单批 6/6 |
| 平台 `pnpm typecheck` / `pnpm lint` | 全工作区通过，含 20 源目录 AST 分层与原格式检查 |
| UNO 修改脚本的定向 ESLint / 两仓库 `git diff --check` | 通过；脚本经平台配置 stdin 检查，首次外部路径被忽略不算通过 |

真实 E2E 串行使用 PostgreSQL 17 专用测试容器回环 **15441** 的新库 **playboard_d11_test_20261112**，与开发/生产库隔离；资源目录为本工作区 `.data/test-assets`。原 prepare/migrate/sync/seed/run-e2e 链完整执行，没有共享其他每日测试库或清理开发库。缺本机 TTS 时原流程安装原创 SVG 资源，不伪造外部图包验证。

两玩法各在 1440×900、390×844、320×740 用真实 session/API/WS/QuickJS 完成上传审核、建房、脚本 AI、iframe 按钮行动、刷新恢复、完整结算及返回房间，逐步检查本人 View 无完整 hands/deck。真实规则/身份/事务与固定父窗口场景分别验收；没有调用真实模型。实际查看 320px 联机棋桌截图；全页截图中的固定导航处于采集视口位置，不代表导航在页面流中。证据留在独立工作区 `.data/d11/` 及游戏 `dist/uno-check/`，不提交秘密配置或生成物。

## 版本、登记与剩余边界

仅测试和内部文档，平台保持 **1.2.6**，README 一致；游戏及规则内容版本不变。UNO 棋桌 blob `c7a4d9f99d61fe83e468148c55cf7c1599b4bf1b` 与平台锁定副本相同。未导入游戏提交，来源锁和集成副本保持；平台 E2E 不属于锁定的游戏专属单元测试副本。

**登记已核对，无需改动**：平台 catalog 与 UNO release.config.json 的仓库、两个 ID、包名前缀和玩法一致。GitHub 实时正式 Release 仍是 `uno-v1.2.0`、`uno-no-mercy-v1.0.0`，各有精确 ZIP、release.json、SHA256SUMS；main 已有的 1.2.1/1.0.1 头像候选未发布。本轮没有标签、Release、生产主动订阅或安装，不能把本地 ZIP 当已上架。

北京时间 **11:43:33** 只读核对，生产 current.json、实际 API cwd、运行 package.json 一致为 **1c70c2d / 1.2.6**，服务 active/running、NRestarts=0；未重启或修改生产数据。平台 PR、文档同步及最终状态另据实补入。

未验收物理手机、Safari/WebKit、完整屏幕阅读器或真实模型；未跑无变化全库集成/E2E、平台生产 build，不以本轮专项外推。D3 生产注册闭环、D5 新候选发布/生产主动安装继续保留原条件；D12 波多黎各帮助尚未推进。
