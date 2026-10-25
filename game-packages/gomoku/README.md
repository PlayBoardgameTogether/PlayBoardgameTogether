# 五子棋上传包

双人自由五子棋，游戏 ID 为 online.gomoku，版本 1.0.3。15×15 棋盘，座位 1 执黑先手；横、竖或斜线连续五枚或更多获胜，满盘无人获胜和棋。不设三三、四四、长连禁手，不含交换开局、悔棋或计时。

在项目根目录运行：

```powershell
node scripts/package-gomoku.mjs
```

生成 [gomoku-1.0.3.zip](../../dist/game-packages/gomoku-1.0.3.zip)，根目录仅 game.json、server.js 和 client.html。规则源文件使用 server.txt，打包时改名 server.js；ZIP 固定时间戳，无外部依赖或网络资源。生成 ZIP 不提交 Git。

1.0.2 修正 1.0.1 仅让窗口随内容增高、整盘仍可能超过屏幕的问题。桌面宽度同时受可用宽度与 iframe 高度约束，预留紧凑状态栏、最后落子和确认区；15×15 棋盘全部显示，不隐藏溢出、不截断格子。规则改为弹窗。包发送可选 fit:viewport 提示，新版平台根据 iframe 页面位置和视口剩余高度设置窗口，旧平台忽略提示时也能在固定 560px 窗口中完整显示。需上传审核新版包；同版本不能覆盖，已经开始的旧版本对局保持原桌面，下一局选择 1.0.2。没有迁移或替换旧局规则。

管理员从「更多 → 管理员后台 → 游戏管理 → 上传游戏 ZIP」选择包，检查并审核后上架。大厅选择五子棋，创建双人房间；另一位真人加入准备，或在空座位添加基础脚本 AI，然后开局。规则包沿用当前平台 QuickJS、身份、正式动作、请求去重、修订号和持久化恢复，无需改平台 registry 源码。不要直接上传 game-packages/gomoku 目录压缩包。

点击空交叉点选点，再点击「确认落子」。蓝色点标记最后落子，蓝色圈标记获胜连线。可用方向键移动焦点，空格/回车选点。「玩法说明」按需打开弹窗，关闭后返回棋盘；返回房间和再次开局沿用平台控件。

基础脚本 AI 按候选顺序优先直接获胜、阻挡对方一步获胜和扩展连线，棋力有限。可用平台已有个人模型配置添加模型 AI；本轮未验证真实外部供应商调用。棋盘公开，不包含他人秘密或模型凭据。存档只记录座位和落子历史，恢复时验证并重建棋盘，拒绝重复位置、越界和胜利后继续落子。

验证命令：

```powershell
pnpm test tests/unit/gomoku-package.test.ts
pnpm exec playwright test --config tests/config/gomoku.config.ts --output .data/gomoku-validation
pnpm typecheck
pnpm lint
```

浏览器专项使用真实 React PackageBoard、QuickJS 规则、身份化 View、完整平台样式与 sandbox 消息桥，验证桌面、720px 矮屏及 320px 手机的选点/确认、忙碌保护、双方完整胜利、键盘操作、序列化后刷新及横向溢出。额外检查模拟顶部区域占用后，棋盘底部和确认按钮在视口内、页面 scrollY 为 0、无内部纵向滚动、规则弹窗不增高窗口、390×600 尺寸变化、非法高度/错误来源消息，以及旧宿主固定 560px 的完整显示。截图只捕获可见区域。不访问数据库，也不替代管理员真实 HTTP 上传、完整 MatchPage、房间权限、数据库持久化或公网部署验收。没有平台音效、图包切换或交互教程。

## 1.0.3 配套展示图（2026-10-04）

新增 art/icon.svg、art/cover.svg、art/background.svg，沿用大厅其他游戏的扁平插画风格：墨绿色底、暖金棋盘、黑白棋子及细线几何装饰。封面以斜置棋盘和五子连线为焦点；背景降低对比度并留空中心，不增加页面区域或操作。原创 SVG 是可编辑源图，打包脚本用已安装 Chromium 渲染 PNG，嵌入 game.json.presentation；背景同时嵌入 client.html，兼容 sandbox 的 img-src data:。每张 PNG 不超过 320 KiB，ZIP 仍只有三个根文件，离线无外链。直接打开源码 client.html 不含最终背景，应使用打包后的桌面。

需通过管理员审核上传 1.0.3 才会更新现有平台上的展示图，并新建对局使用新背景；Git 推送不会替换数据库内已安装的包，旧局保持原版本。规则与 contentVersion 不变。

本轮 pnpm typecheck、五子棋单元测试（10 项）通过；node node_modules/@playwright/test/cli.js test --config playwright.gomoku-ui.config.ts --output .data/gomoku-art-validation（3 项）通过，实际检查桌面、矮屏、手机截图及封面预览。包解析覆盖内嵌图片格式和大小限制。pnpm lint 的 ESLint 阶段通过，边界脚本被 tsx 的 uv_os_get_passwd ENOMEM 环境错误阻塞；未验证实际管理员上传或线上展示。生成包约 143 KiB，截图与 ZIP 不提交 Git。