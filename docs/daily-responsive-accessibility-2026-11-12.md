# D13 双端与无障碍验收（2026-11-12，平台保持 1.2.6）

从重新获取的 `main@1c70c2def3ace12156140970a22a57dac0619d09` 建立独立 `codex/d13-responsive-accessibility` 工作区。原目录 36 项已有改动、D11/D12 工作区及未合并 PR 保持。原 origin 仍指向迁移前地址，另外通过组织规范 URL fetch，结果一致；没有修改原工作区远程。

## 范围和结论

本轮补齐 D9 建房流程与 D10 电脑开局的四视口回归：**1440×900、1280×800、390×844、320×740**。新增检查覆盖亮/暗主题、根字体 200%、减少动态效果、焦点轮廓、预算原生校验、操作命中与失败恢复。未发现需要修改产品代码的问题；只提交测试、配置与内部记录，平台 **1.2.6 → 1.2.6**，README 一致。

- `computer-help-ui.spec.ts` 保留原价格、共享余额、脚本选择和目录失败断言；补预算非法时焦点、说明关联、键盘开始、失败提示和继续按钮。新增 `tests/config/responsive-start.config.ts` 为不访问数据库的生产预览入口；原双端入口继续检查 1280/320px，相关高度改为计划中的 800/740px。
- `new-player-start.spec.ts` 在真实注册后的建房表单检查放大字体、两主题和核心控件；继续双账号加入、入座、准备、首个行动和刷新恢复。保留取消意图、错误登录及精确版本失效回归。
- 共用 `ui-reachability.ts` 将控件居中滚动，严格要求完整进入视口，再以 `elementFromPoint` 检查中心未被外壳遮挡。不以 DOM 存在代替可操作，也不取消原权限、版本或恢复断言。

根字体 200% 是文字重排场景，**不等于浏览器页面缩放或所有固定 px 字体均放大**。本轮不宣称完成全部 WCAG、屏幕阅读器或所有设备认证。

## 实际执行

以下 pnpm 命令均带 `--config.verify-deps-before-run=false`；独立工作区先 `pnpm install --frozen-lockfile`，未升级依赖。

| 范围 | 命令与结果 |
| --- | --- |
| 生产基线 | `pnpm build` 通过，含 Web bundle 与 API runtime/ZIP 恢复检查；Vite 保留已有大 chunk 提示 |
| 类型与分层 | `pnpm typecheck`、`pnpm lint` 通过，20 根 AST 与原格式检查通过；最终账号/等待调整后定向 ESLint 通过 |
| 电脑四视口 | `pnpm exec playwright test -c tests/config/responsive-start.config.ts --output .data/d13/computer-ui` 首轮 12/16；四个新增用例在严格可见范围断言失败 |
| 可见范围诊断 | 320px 诊断记录输入框 top=-0.5px、无 overflow 祖先；浏览器原生校验滚动留下分数像素，非产品容器裁切。改为居中滚动，保留 ratio=1 及命中断言，四个新增用例 4/4；抽出共用函数后用 `--grep 'keyboard validation' --output .data/d13/computer-shared-final` 最终 4/4，无 skip |
| 真实开局四视口 | `pnpm test:e2e tests/e2e/new-player-start.spec.ts --config .data/d13/e2e.config.ts --output .data/d13/real-start` 首轮 10/12；下面两项测试问题修正后，原准备链加 `--grep 'new registration' --output .data/d13/real-start-final` 四条完整流程 4/4，无 skip |
| 差异检查 | `git diff --check` 通过；只核对根版本/README 一致，不修改版本、游戏副本或来源锁 |

真实联机首轮的两个失败分别为：`small-mobile` 被直接拼入用户 ID，而原协议不允许连字符；另一手机用例在棋桌懒加载完成前判断行动者，停在尚未轮到的玩家处。现规范测试 ID 的连字符，并等待两端 `.color-board` 就绪再判断；四视口完整流程均重新通过。没有延长超时、改规则或降低断言。总计十二个独立 E2E 场景通过，**不声称首轮或某一最终批次 12/12**；电脑场景同样不把首轮写为全绿。

测试使用原 PostgreSQL 17 专用容器 **127.0.0.1:15441** 的全新 **playboard_d13_test_20261112**；连接前确认开发库为 **playboard_d1_scratch**，库名不同。原 prepare/migrate/sync/seed/run-e2e 链完整，所有清理该库的命令串行；未修改原目录 .env，未触及开发/生产数据。缺少本地 TTS 时按既有流程安装原创 SVG 资源，不把它说成外部图包验证。注册收件使用隔离测试邮箱捕获，不向外部收件人发信，不代表 D3 生产收件→注册闭环完成。

真实流程的四视口临时配置保存在 `.data/d13/e2e.config.ts`，基于根配置，仅设置绝对 globalSetup、四个 viewport/触屏参数和失败截图；通过 `pnpm test:e2e` 调用，未直接绕过准备入口。复现时可用 `defineConfig(config, { globalSetup: fileURLToPath(new URL('../../tests/e2e/setup.ts', import.meta.url)), projects: [desktop('desktop',1440,900), desktop('laptop',1280,800), mobile('mobile',390,844), mobile('small-mobile',320,740)] })` 建立同等本地配置；`config` 来自根 playwright 配置，视口函数来自 `tests/config/shared.ts`。

## 游戏候选与画面复核

本轮重新 fetch 两游戏 main，并只读核对 GitHub PR：

| 候选 | 固定 head / 状态 | 本轮检查 |
| --- | --- | --- |
| UNO [PR #4](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/4) | `7155114fef6b70afdf8be12414572a838a4688c7`，open；平台 [#69](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/69) 为 `a1e9d47`、open | 查看 D11 既有四视口长手牌选色截图；保留游戏自身布局，未重新执行无变化的规则/完整对局测试 |
| 波多黎各 [PR #6](https://github.com/PlayBoardgameTogether/playboard-game-puerto-rico/pull/6) | `fd4d6e781ca06811e3537b0c07403ea4f53c8702`，open；平台 [#70](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/70) 为 `450ca0a`、open | 查看 D12 既有四视口工人分配截图，含亮暗、未提交产能及确认区；未重新执行无变化的游戏测试或生产安装 |

游戏交互/联机证据沿用各自 [D11 记录](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/blob/codex/d11-uno-mobile/docs/daily-uno-mobile-2026-11-12.md) 与 [D12 记录](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/blob/codex/d12-puerto-rico-help/docs/daily-puerto-rico-help-2026-11-12.md)，明确属于先前执行。本轮实际新增运行的是上述平台检查；没有将候选游戏的旧证据说成本轮重新通过。未改游戏源码、测试、版本、catalog 或来源锁，也没有把待审候选写成 main 已有能力。

实际查看本轮 1440px 亮色和 320px 暗色电脑页、1440px/390px 真实建房放大画面，以及上述八张游戏截图。证据和日志留在独立工作区 `.data/d13/` 与原游戏产物目录，不提交 .env、ZIP、数据库或生成截图。整页截图中的固定导航显示于采集时视口位置，不是页面流内的导航错位。

## 服务器与剩余边界

本轮只读核对私有 current.json、运行目录 package.json 及实际 API cwd，一致为 **1c70c2d / 1.2.6**；`boardgame-local.service` **active/running、NRestarts=0**。没有发布产品变更，因此无需应用更新或重启；本轮测试/内部记录也不覆盖服务器启动仓库的运维改动。未合并候选、打标签、发布 Release、主动订阅或安装游戏，未调用真实模型。

物理手机、Safari/WebKit、系统屏幕阅读器、浏览器原生 200% 缩放未验证；本轮新增运行不包含游戏候选的所有无障碍状态，不用截图评阅替代联机。D3 生产注册闭环、D5 发布/安装和 D11/D12 待审状态继续保留。D14 尚未开始，后续应先处理候选审查与跨仓发布边界，不直接推进结果契约或混合其他待审 PR。
