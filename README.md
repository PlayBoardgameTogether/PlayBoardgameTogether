# PlayBoard · 一起玩桌游

顶尖桌游联盟的桌游平台，支持多人实时对局、脚本与模型 AI、在线游戏扩展。先选游戏，再开一桌，让朋友在浏览器里一起玩。

**平台版本 `0.6.0`** · TypeScript · React / Vite · Fastify · PostgreSQL

[快速开始](#快速开始) · [游戏列表](#游戏列表) · [部署与更新](#部署与更新) · [开发者文档](#开发者文档) · [开发进度](docs/progress.md)

## 平台特色

- **从大厅到棋桌**：浏览游戏、查看公开房间，或通过邀请码加入私人房间；支持密码、座位、准备与再次开局。
- **和朋友一起玩**：账号注册、个人资料、好友 ID、好友申请、私聊、公共聊天、表情及房间邀请。
- **真人与 AI 同桌**：空座位可添加脚本 AI；个人模型配置支持 OpenAI-compatible 服务，模型只能读取自身视角并通过统一规则校验行动。
- **恢复与回放**：刷新和重连后恢复权威局面；原参与者可按本人历史视角逐步回放，隐藏信息继续保密。
- **可扩展的游戏与资源**：管理员可审核安装游戏 ZIP，管理图包与短音效；旧对局锁定精确版本。
- **暖阳大厅与沉浸棋桌**：象牙米白、琥珀暖金与圆润控件构成 PlayBoard 视觉体系，支持亮暗主题和手机布局。

> 当前能力、验收结果和未验证项以 [开发进度](docs/progress.md) 为准；历史更新与阶段记录不再在首页逐条展开。

## 游戏列表

### 内置游戏

执行 `pnpm games:sync` 同步游戏清单，执行 `pnpm assets:seed` 准备内置资源。

| 游戏        | 玩法概览                                                     | 指南                                  |
| ----------- | ------------------------------------------------------------ | ------------------------------------- |
| Color Match | 颜色与数字配对、特殊牌与目标选择，支持交互上手教程           | [游戏 SDK 与教程](docs/game-sdk.md)   |
| Grid Garden | 2–4 人同时秘密选择，在各自花园放置骨牌并计分                 | [游戏指南](docs/games/grid-garden.md) |
| 璀璨宝石    | 2–4 人拿取宝石、购买发展卡、私密预留与贵族结算，支持交互教程 | [游戏指南](docs/games/splendor.md)    |
| 花砖物语    | 2–4 人选砖、铺墙与连线计分，支持交互教程和计分音效           | [游戏指南](docs/games/azul.md)        |

### 在线 ZIP 游戏

这些游戏需先打包，再由管理员在「游戏管理」上传、检查并审核上架；新环境不会自动出现大厅入口。安装和更新无需重启，已开始的对局继续使用原版本。

| 游戏         | 人数 | 打包命令                            | 规则与说明                                   |
| ------------ | ---- | ----------------------------------- | -------------------------------------------- |
| UNO · 休闲版 | 2–4  | `node scripts/package-uno.mjs`      | [上传包说明](game-packages/uno/README.md)    |
| 五子棋       | 2    | `node scripts/package-gomoku.mjs`   | [上传包说明](game-packages/gomoku/README.md) |
| 拉密         | 2–4  | `node scripts/package-rummikub.mjs` | [游戏指南](docs/games/rummikub.md)           |
| 卡坦岛       | 3–4  | `node scripts/package-catan.mjs`    | [游戏指南](docs/games/catan.md)              |

输出位于 `dist/game-packages/`。包格式、运行限制及 AI 接口见 [在线游戏 ZIP 规范](apps/web/public/developer-docs/game-packages.md)；普通源码仓库 ZIP 不能直接安装。

## 快速开始

### 1. 准备环境

| 依赖       | 要求                                                           |
| ---------- | -------------------------------------------------------------- |
| Node.js    | 22（已有实测版本：22.17.0）                                    |
| pnpm       | 11.15.1，与根目录 `packageManager` 一致                        |
| PostgreSQL | 17；可通过 Docker Desktop 启动开发数据库                       |
| Docker     | 构建和运行媒体校验容器时需要，即使使用外部 PostgreSQL 也需准备 |

在仓库根目录使用 PowerShell。首次创建 `.env`；已有文件时保留原配置，不要覆盖。

```powershell
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm games:sync
docker build -t boardgame-media:1 scripts/media
pnpm assets:seed
pnpm dev
```

使用已有 PostgreSQL 时，先在 `.env` 中配置 `DATABASE_URL`，并跳过 `pnpm db:up`。

### 2. 注册并开桌

打开 [本地大厅](http://127.0.0.1:5173)，点击「注册账号」，完成注册后登录。

1. 在大厅选择游戏，进入详情页并创建房间。
2. 复制创建后一次性显示的邀请码，邀请朋友在独立浏览器配置文件中登录并加入；也可在等待房间邀请已有好友。
3. 玩家入座、准备后，由房主开始对局。空座位可添加脚本 AI。
4. 对局正常结束后返回房间，重新准备即可再开一局；上一局结果保留在原对局地址。

私人房间通过邀请码加入；有密码的房间仍需校验密码。断线不会自动退出、释放座位或开启 AI 托管。

### 3. 创建管理员（可选）

普通玩家可自行注册。需要使用后台时，通过维护命令创建首位管理员；密码从标准输入传入，避免明文出现在命令历史中。

```powershell
$secret = Read-Host 'Administrator password (12–128 characters)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | pnpm account -- admin:init admin 管理员
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
```

管理员登录后，从「更多 → 管理员后台」进入账户、游戏、资源、接入申请和服务更新管理。操作边界见 [管理员后台](docs/admin.md)。

## 部署与更新

### Linux 一键部署

准备域名、Node.js 22、pnpm 11.15.1、Docker Compose v2 和 systemd 用户服务，并按部署指南配置 DNS、权限和端口后，在仓库根目录运行：

```bash
bash deploy.sh
bash deploy.sh admin
```

脚本负责独立生产配置、构建、迁移、资源准备和 HTTPS 服务；后续可用同一命令更新，也提供 `status`、`logs`、`backup`、`stop`。前提、备份与恢复边界见 [部署指南](docs/deployment.md)。

### 生产启动与在线更新

手动运行 API 前先构建；Web 静态文件需另行托管，并配置同源反向代理：

```powershell
pnpm build
pnpm --filter @boardgame/api start
```

需要托管生产 Web/API 并定期检测发布分支时，在完成数据库、游戏和资源准备后运行：

```powershell
pnpm start:online
```

在线更新默认跟踪 GitHub `origin/main`，每五分钟检测一次，默认监听 `8080`。管理员也可在后台触发检测；每次切换先自动备份数据库、资源与恢复配置，备份校验通过后自动执行新增迁移，无需逐次确认。服务器需安装匹配数据库版本的 `pg_dump` / `pg_restore`；旧配置若显式设置 `UPDATE_ALLOW_MIGRATIONS=false`，需一次性删除或改为 `true`。`deploy.sh` 不会自动启用该托管入口，配合使用需要额外配置，详见 [在线更新](docs/online-update.md)。

生产 HTTPS 必须设置 `COOKIE_SECURE=true`，反向代理需保留同源 Origin 和 WebSocket Upgrade。升级时执行当前版本所需迁移；备份应同时覆盖数据库、资源目录及锁定游戏源码。

## 开发者文档

运行平台后，访问 `/developers` 即可无需登录阅读公开指南。项目提供游戏 SDK、客户端 SDK、HTTP / WebSocket 协议与游戏扩展规范；SDK 当前通过 workspace 使用，不声明已发布 npm 包。

| 想做什么                 | 文档入口                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 了解项目状态与模块职责   | [开发进度](docs/progress.md) · [当前架构](docs/architecture.md)                                                                             |
| 开发一个游戏             | [公开指南](apps/web/public/developer-docs/index.md) · [游戏 SDK](docs/game-sdk.md) · [添加游戏](apps/web/public/developer-docs/add-game.md) |
| 制作在线游戏 ZIP         | [包格式](apps/web/public/developer-docs/game-packages.md) · [运行时设计 ADR](docs/adr/005-runtime-game-packages.md)                         |
| 对接认证、房间与实时通信 | [认证](docs/auth.md) · [房间](docs/rooms.md) · [协议](docs/protocol.md) · [数据模型](docs/data-model.md)                                    |
| 配置 AI、图包与声音      | [AI 契约](docs/ai-contract.md) · [资源管理](docs/assets.md) · [音频](docs/audio.md)                                                         |
| 维护社交、回放和后台     | [社交](docs/social.md) · [回放](docs/replays.md) · [管理员后台](docs/admin.md)                                                              |
| 修改页面与游戏桌面       | [UI/UX 规范](docs/ui-ux-guidelines.md) · [界面系统](docs/ui-system.md) · [UI 开发与回归](docs/ui-development.md)                            |
| 排查恢复或部署问题       | [可靠性](docs/reliability.md) · [故障恢复](docs/recovery.md) · [部署](docs/deployment.md)                                                   |

构建会生成 `/llms-full.txt` 和白名单 SDK 源码 `/developer-sdk/sdk-sources.json`，并提供 `/llms.txt`。生产托管需保留这些静态路径及页面回退。

### 仓库结构

```text
apps/
  web/                 平台页面、会话交互与游戏容器
  api/                 认证、业务事务、持久化与实时通信
packages/
  protocol/            网络 DTO、消息与 schema
  client-sdk/          类型化请求与客户端传输
  game-sdk/            游戏扩展契约与确定性 RNG
  ui/                  可复用视觉组件
games/                 内置游戏，分离 shared / server / client 入口
game-packages/         在线 ZIP 游戏源码与打包入口
docs/                  设计、协议、运维与验收记录
scripts/               开发、打包与维护工具
```

## 检查与验证

按改动范围选择检查，在项目根目录运行：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
```

集成与 E2E 会准备并清理测试数据：必须使用独立 `TEST_DATABASE_URL`，不能指向开发或生产库；不要同时运行共享测试库的两套测试命令。跳过用例不等于验证通过。

构建后还可执行 `pnpm test:developers` 或 `pnpm test:ui`，检查生产静态页面与公开文档；这两项不清理数据库。历史验收与本轮实际结果见 [开发进度](docs/progress.md)。

## 运行边界

- **身份与隐私**：正式身份来自 session；客户端和 AI 只获得本人 View，房主权限不包含读取他人秘密。session、CSRF、邀请码和模型密钥不得写入 URL 或日志。
- **游戏隔离**：在线包规则在有界 QuickJS WASM 中运行，桌面使用隔离 iframe；不把上传 JavaScript 直接载入 Node.js。同版本不可覆盖，旧局绑定精确版本。
- **模型服务**：凭证加密保存；缺少 `MODEL_CREDENTIALS_KEY` 时模型功能不可用，脚本 AI 不受影响。mock 明确标识为模拟，真实供应商验收及剩余限制见开发进度。
- **资源与备份**：资源默认位于 `.data/assets`；生产使用绝对路径 `ASSET_STORAGE_DIR` 指向独立持久目录。本机提取的 TTS 图包不随仓库分发，新环境需自行安装或恢复。
- **部署规模**：presence 与广播仍是单 API 进程内状态，不宣称多副本生产高可用或更新零中断；当前不提供自动断线托管和观战。
- **开发实验台**：`/dev/lab` 保持双开发开关限制，与正式身份和对局链路分离。

