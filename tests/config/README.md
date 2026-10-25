# 浏览器测试配置

所有命令在仓库根目录运行。根目录只保留 `playwright.config.ts` 作为真实联机测试默认入口；本目录集中维护不准备、不清理数据库的界面检查。

| 场景 | 命令 | 前置条件 |
| --- | --- | --- |
| 真实登录、房间、对局、HTTP/WS | `pnpm test:e2e` | 独立 `TEST_DATABASE_URL`，走现有准备/迁移/同步脚本 |
| 平台生产页面界面回归 | `pnpm test:ui` | 先 `pnpm build` |
| 公开开发文档 | `pnpm test:developers` | 先 `pnpm build` |
| 管理员后台 | `pnpm test:admin-ui` | 先 `pnpm build` |
| 单个页面，例如公共聊天 | `pnpm test:ui public-chat.spec.ts` | 先 `pnpm build` |
| 游戏包管理 | `pnpm test:ui game-package-upload-ui.spec.ts admin-games-ui.spec.ts` | 先 `pnpm build` |
| 花砖计分动画 | `pnpm exec playwright test -c tests/config/azul.config.ts` | 自动启动 Vite 开发服务 |
| 玩家名称显示 | `pnpm exec playwright test -c tests/config/player-names.config.ts` | 自动启动 Vite 开发服务 |
| 在线 ZIP 棋桌 | `pnpm exec playwright test -c tests/config/awari.config.ts` | 先打包相应游戏；拉密另自动启动 Vite 以覆盖平台回放，其他入口为 `gomoku`、`catan`、`rummikub` |

可追加 `--project mobile`、`--list` 或 `--output .data/任务名`。生产预览统一使用 5374 端口，花砖、玩家名称和拉密回放开发服务分别使用 5378/5379/5380，均拒绝复用已有服务，避免误测其他进程。

`pnpm typecheck` 同时检查默认入口和本目录配置，避免共享配置只在运行浏览器时才暴露类型错误。`shared.ts` 复用测试目录、产物目录、单 worker、失败 trace、设备与服务启动设置。路径以配置文件位置解析，产物仍写入根目录 `test-results/`。游戏专项配置保留原项目名称、视口尺寸及触屏参数，不能仅为缩短配置而删掉窄屏覆盖。

2026-10-25 整理后，原根目录的 `developers`、`ui`、`admin-ui`、`packages-ui`、`updates-ui`、`social-ui`、`public-chat`、`shell-social` 配置合并为 `ui.config.ts`，使用文件参数选取范围，同一文件在全量 UI 入口只运行一次；其余游戏配置迁入本目录。历史进度中的旧命令保留当时事实，当前执行方式以本文为准。

界面夹具、公开 View 和隔离棋桌检查不代表真实登录或联机验收。真实流程仍使用 `pnpm test:e2e`，不要直接运行带数据库初始化的默认配置绕过隔离准备。
