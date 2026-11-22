# D28 发布候选冻结记录（2026-11-22）

## 1.4.2 候选范围

GitHub `main` 基线为 [`37bd6d59f89ffa1f8c01d7b5be83bd4a38fd9dce`](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/commit/37bd6d59f89ffa1f8c01d7b5be83bd4a38fd9dce)。`codex/d28-release-candidate` 承接 D26 的代码，以下两个 SHA 固定了候选的运行代码和回归测试。随后的提交补充冻结记录。

| 纳入候选 | 精确提交 | 内容 |
| --- | --- | --- |
| [D26 备份失败诊断 #89](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/89) | `18eae1f56a23c65208d08545e006622fce66add8` | 告警和复制诊断说明此轮迁移、游戏同步以及旧服务恢复结果 |
| D28 后台短屏导航 | `5079e759412358e5e6fb2704fde58dcfc37a9924` | 让 `1366×768` 下的「服务更新」完整可见，补齐鼠标、键盘和手机进入方式的回归 |

平台随这一批修复从 `1.4.1` 递增到 `1.4.2`，版本号与 README 一致。候选的产品改动限于后台更新页面和后台短屏样式。完整差异核对确认没有更新器、数据库迁移、API、游戏仓库来源锁、目录登记或依赖变化。

## 独立审查事项

| PR | 核对时的 head | 交付安排 |
| --- | --- | --- |
| [首页改版 #85](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/85) | `1fc22af687a17a4e41cea86199462a12cae2e785` | 待独立测试库中的真实登录和建房回归。此草稿也使用 `1.4.2`，后续交付时按届时 `main` 重新核定版本 |
| [D24 性能基线 #88](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/88) | `dd0589ae40368442a9164339d5d0a2ef22959d30` | 独立审查性能记录。D25 继续以复测能否确认瓶颈为准 |
| [D27 恢复演练 #90](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/90) | `c7c57bf09567aff75da2a88e11797ffccaa93676` | 独立审查隔离演练证据，包括候选就绪检查失败、旧服务恢复和原对局继续 |

## 短屏复现与本轮验证

- 在 D26 的生产构建上定向运行原导航用例。`1366×768` 下链接底边为 `783.14px`，侧栏底边为 `772px`，截图确认了首屏裁切。修复收紧分组与标签留白，限制侧栏高度，保留短屏链接的原有最小高度和侧栏滚动。
- `pnpm test:admin-ui --output=.data/d28/verified` 首轮 18/20。桌面用例匹配到侧栏和总览快捷入口两个同名链接，手机用例的交集比例为 `0.9971`，受横向偏移取整影响。将定位限定到实际侧栏，手机断言允许不足 1% 的取整误差，保留后续点击和路由断言。
- `node node_modules/@playwright/test/cli.js test --config tests/config/ui.config.ts admin-updates-ui.spec.ts --grep 'navigation and progress bar' --output=.data/d28/navigation` 定向复验 2/2。共 20 个独立用例分批通过，无跳过。查看了 `1366×768` 桌面和 `390×844` 手机截图。桌面验证链接完整可见、鼠标点击、Tab 和 Enter。手机验证导航横向滚动后触控进入，并核对更新页操作区域无遮挡。
- 全工作区 `pnpm typecheck`、`pnpm lint` 和 `pnpm build` 通过，包含 20 个源码根目录的 AST 边界检查、生产 Web bundle 和编译 API runtime。最后仅调整浏览器用例定位，再次通过测试配置 TypeScript、定向 ESLint 和 Prettier。Git 差异、版本映射和文档链接已核对。

## D29 验收入口

对已冻结候选执行月度阶段验收，集成与真实 E2E 按项目准备脚本在独立测试库串行执行。本轮浏览器回归使用受控接口响应覆盖后台渲染和导航，真实账号、生产部署及阶段全量验收仍待执行。发布进度见 [30 天更新计划](30-day-update-plan-2026-11-06.md)。
