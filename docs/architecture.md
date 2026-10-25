# 架构

## 游戏仓库所有权分离（2026-10-25）

10 个游戏仓库在 PlayBoardgameTogether 组织分别维护规则、棋桌、策略、资源和发布；平台主仓库保留其锁定集成副本，用于既有 registry、workspace、资源准备与回归，不再直接开发游戏。`game-repositories.lock.json` 记录远程完整提交和 Git blob SHA，`check-game-repositories.mjs --remote` 同时核对副本和远程 tree；`import-game-repository.mjs` 引入经过审查的精确版本并保护本地修改。独立仓库中的 SDK/包解析器只是固定兼容性测试快照，平台仍是通用 SDK 和运行时的维护来源。

没有改变进程、公开契约、数据所有权、事务、旧对局恢复或安装权限；内置游戏继续构建装配，在线 ZIP 继续管理员审核安装。仓库清单见 [独立游戏仓库](game-repositories.md)，取舍见 [ADR-009](adr/009-independent-game-repositories.md)。

## 对局连接与游戏样式整理（2026-10-22，0.14.2）

`matches/connection.ts` 管理单个页面世代的认证初始化、WS 订阅、权威同步、退避重连、心跳与浏览器监听，返回停止入口。通过类型化回调与 `useMatchSession` 协作；Hook 继续拥有本人 View 合并、账户绑定的待确认动作、原请求回执恢复与音效授权。连接状态读取同一个 ref，停止、取消或页面世代失效后不再投递迟到回调，不创建新的传输、动作或身份路径。

Color Match 的棋桌、卡牌、资源布局与手机规则由 `games/color-match/src/client/style.css` 拥有，通过客户端入口按需加载，生产构建复制 CSS。主要布局进入 `games.color-match`，卡牌外观暂保留既有 `theme` 层以兼容平台通用控件优先级；删除重复声明和普通外观 `!important`，减少动态效果的无障碍例外保留。平台样式只保留通用控件对卡牌的排除与容器适配，不解释游戏规则。

## 电脑开局与公开结果（2026-10-20，0.12.0）

电脑开局由 Web 的 ComputerGamePage 协调原建房/准备/开局接口；RoomService 只在原建房事务填充脚本 bot 席位，不拥有新的规则动作入口。会话进度固定三条命令的请求身份，完成或登出后清除，离页停止后续写入。

registry.resultSummaries 按精确版本显式装配公开结果投影，MatchService 在原真人/自动动作事务写入可空终局摘要，ProfileService 同一 SQL 投影本人结果及游戏筛选游标。未改游戏规则、GameExtension、规则摘要或在线 VM；未登记的游戏及历史记录不猜测结果。共享 result schema 由 protocol 拥有；Web MatchResultPanel 只消费公开 DTO，继续保留游戏桌面的原终局表现和本人回放。

## 官方 AI token 计价（2026-10-18，0.11.0）

`official-ai/pricing.ts` 使用 BigInt 按输入/输出用量与管理员加价合计结算，`OfficialAiService` 拥有原预留和 ready 价格快照；正式扣费仍由 matches 原事务调用。protocol 增加可选价格/账单字段以兼容历史固定档位。Web 在原后台/玩家入口使用共用 `OfficialAiPrice` 展示售价，房间/控制选择器区分 token 和固定档位。没有增加支付服务、平行动作链路或新的运行单元。详见 [官方 AI](official-ai.md)。

## 桌游币（2026-10-16）

`apps/api/src/coins/service.ts` 拥有独立钱包与审计流水，管理员调整复用 AdminService 原有授权、请求去重和事务，不创建平行认证或管理员命令链。AccountRoutes 只按会话读取本人钱包；Web 的 CoinWallet 共用本人/后台展示和未知结果恢复。协议与存储见 [桌游币](coins.md)。

## 管理员徽章设计（0.5.0）

031 迁移新增自定义徽章定义，BadgeService 在同一条收藏 SQL 快照读取定义、正式完成进度、逐游戏计数及手动授予，投影时过滤失效精选。定义写入复用 AdminService 的授权、事务、管理员锁与回执，不进入对局动作事务。protocol/badges 与 client-sdk 提供共享规则和设计接口；Web 独立 `/admin/badges` 编辑器支持创建、修改、启停及未知结果重试。详见 [玩家徽章](badges.md)。

## 回放表现通道（2026-10-11）

ReplayPage 连续前进保留桌面，将本人历史 View/事件和 busy=false 交给原 GameBoard；平台通过 replay-motion 观察有限 CSS/Web Animations/DOM 变化，拦截输入、禁用控件并丢弃动作。在线包 desktop?replay=1 在原 opaque sandbox/CSP 内加入 catalog/replay-desktop 包装，自动观察动画并报告当前呈现 id 的时长；不改数据库中的源码/hash/规则版本，普通 desktop 响应不变。旧拉密 1.0.3、花砖等原桌面直接兼容，不要求新游戏包。可选 ReplayPresentation.hold 补充不可自动推断的自定义时长，观察上限60秒，过期回调忽略，跳转/卸载清理。未执行规则、未新增数据库或 WS 契约、未授予实时音效权限。

## 玩家徽章（2026-10-11）

API `badges/BadgeService` 拥有收藏进度、精选展示与身份授予的持久操作；本人路由由 AccountRoutes 装配，管理员授予复用 AdminService 原有授权/回执事务。成长成就由固定参与者与已完成对局查询派生，不进入游戏规则或 matches 动作事务。protocol/badges 定义共享 DTO，client-sdk 提供校验后的五个方法；Web 的 badges 组件供独立徽章墙、本人资料和公共聊天名片复用。030 迁移保存精选、身份授予与本人回执。公开展示接口仅返回玩家主动选择的有效徽章，完整进度只供本人和管理员读取。详见 [玩家徽章](badges.md)。

## 网络开销第二批（2026-10-11）

social overview 将邀请列表和公开投影合并为一条有界 SQL；条件同步根据当前授权快照计算账户绑定摘要，保持 REPEATABLE READ、no-store 与旧完整读取兼容，不维护服务器概要缓存。SocialProvider 只保留当前会话概要及版本。

realtime 统一 5 秒心跳调度且鉴权批次不重叠，仍逐连接认证、控制帧 ping/pong 及 45 秒失活清理；健康订阅通过 RoomService.recordSubscriptionActivity 一条 SQL 批量续期，每房最多更新一次，SQL 再核对活跃会话/账户及成员身份，保留 30 秒写入间隔，跳过被锁房间待下一轮。关闭服务清理计时器并等待在途心跳。广播通过 RoomService.assertAccess 单查询检查成员，单次广播内按账户复用房间/对局投影，不跨广播缓存；每个连接仍单独重新认证和检查成员，禁止跨账户共享私密 View。对局广播不再为授权构建完整房间快照。

## 网络恢复第一批（2026-10-11）

realtime/index 将明确身份/访问权失效与临时服务故障分开：4001/订阅撤销保留原权限语义，暂时不可用使用 1013，握手失败相应区分 401/503。Web 网络调度辅助提供在途请求合并与带抖动退避，useMatchSession 按页面世代共享本人快照读取并取消卸载读取；房间和对局订阅成功后才重置退避。client-sdk 统一 HTTP/正文期限与调用者取消，保留已有更短的动作期限及未知结果回执流程。未引入运行单元、缓存、额外通信协议或动作系统，未改变数据库、规则和事务。

## 平台核心结构整理（2026-10-05）

app.ts 装配现有服务；routes/AccountRoutes、RoomRoutes、MatchRoutes 分别管理账户/资料/模型设置、房间、对局的传输边界，共用 routes/context 的会话、Origin、CSRF 和响应包装。realtime/index 拥有认证/公开 WS、连接、订阅、presence、会话撤销与广播，返回明确清理入口。服务关闭继续先等待房间清理与 AI 在途工作，再释放 realtime 和数据库；不新增运行单元。

MatchService 的真人/automation 入口各自处理授权、去重和过期校验，随后在原 room → match 锁和同一事务中调用 applyLockedAction，共用规则转换、RNG、结算、事件投影、对局/回放/动作/回执持久化；调用方仍拥有提交和提交后通知。view 与 replay 都使用只读 REPEATABLE READ，使局面及所有控制者元数据来自同一快照。

Web RoomPage/MatchPage 消费 useRoomSession/useMatchSession，不再拥有订阅和动作恢复细节；房间 hook 验证 WS 快照及 presence 并拒绝旧 presenceSeq。ModelSettingsPage 拆为配置目录、编辑器和 useModelSettings；AssetAdminPage 拆出草稿编辑器和 useAssetWorkspace。保持原路由、页面结构和操作步骤。

styles/index.css 明确 foundation/platform/components/games/shell/theme 优先级及子层顺序；按需加载样式进入声明层，不再靠加载时机加权。除跳转链接和减少动态效果外，移除普通布局/主题 !important。璀璨宝石与花砖样式由各自游戏客户端拥有，build 复制 CSS，平台不提前加载璀璨宝石样式。格式检查限定本次整理模块，保留其他模块后续迁移空间。

平台 AppShell 通过 useGameOverlayInset 测量导航高度，向扩展暴露 --platform-top-inset；ResizeObserver 随页面切换清理。璀璨宝石固定行动提示使用该安全高度，避免移动端导航换行后遮挡，游戏仍拥有提示布局。

## 平台统一回放（2026-10-04）

MatchService.replay 在只读 REPEATABLE READ 事务读取固定参与者、帧范围/指定帧/名称，再调用原精确扩展 getView/projectEvents。029 在开局和动作原事务捕获 State，真人/automation 附加事件，不增加规则执行或第二套动作入口。Web 独立 ReplayPage 复用原桌面和图包，只有历史身份化 View，禁用动作与 live 音频。详情见 [回放](replays.md)。

## 无人房间生命周期（2026-10-04）

RoomService 拥有持久活动续期和有界超时关闭事务；app 在认证房间/active 对局读取、健康 WS 订阅时调用续期，大厅、内部广播和 AI 行动不续期。app 装配每分钟单飞扫描，服务关闭时停止计时器并等待在途清理再关闭数据库；WS 控制帧心跳清理半开连接。沿用 room → match 锁序与提交后 room changed 通知，不增加运行单元或游戏规则分支。028 活动时间跨重启保存，presence 仍为单实例，不宣称多副本实时协调。

## 常驻聊天与导航外壳（2026-10-04）

App 统一装配独立 ChatDock、NavigationTools 与左下角辅助导航；ChatDock 从 SocialProvider 获取当前频道/会话/收起状态，按需加载 PublicChatPage，公共名片与私聊继续使用 DirectChat 和原类型化传输。隐藏频道通过 visible 停止消息同步及已读，未展开不挂载正文，退出会话清理挂载内容。NavigationTools 独立管理浮层关闭与监听清理；shell-social.css 在主题后限定外壳样式，覆盖游戏 header 与侧栏冲突。没有新增服务端边界、运行单元或身份路径。

## 对局玩家名称展示（2026-10-04）

MatchService 从固定 match_participants 与账户读取公开 players 元数据，经原认证 HTTP/WS 快照发送。MatchPage 将 seatId→displayName 映射作为 GameBoard 第七个可选参数，Web registry 装配到花砖物语和璀璨宝石；平台不解析游戏 State，不从当前房间座位推断旧局身份。game-sdk/presentation 独立客户端工具提供名称与本人标记，未修改被规则摘要覆盖的 SDK 核心。迁移 027 和 RoomService 原开局事务保存参与者名称。

## 公共聊天（2026-10-04）

原 social/service 与 routes 增加认证公共消息读写，迁移 026 的 public_messages 与 direct_messages 分离；复用同一社交锁、活跃身份重验、请求摘要回执及事务，成功去重先于公共频控。protocol/social.ts 提供公共消息及分页 DTO，client-sdk 边界解析 unknown。好友申请增加可选 expectedAccountId 防止名片中的可变好友 ID 复用导致目标改变，不新增身份或关系系统。

Web 独立 /chat 路由与 PublicChatPage 负责名片/好友流程；DirectChat 选择 typed 公共或私聊传输，共用分页/补取/重试生命周期，公共模式不推进私聊读取水位。ChatExpressions 只将固定文字码展示为原创 SVG、提供按光标插入的按需选择器，消息仍为纯文本，不执行 HTML 或加载外部表情。没有新运行单元、社交 WS 或游戏规则依赖。

## 五子棋可见区域修复（2026-10-04）

本轮修正下方 1.0.1 内容增高方案：五子棋 1.0.2 使用 iframe 视口高度约束内容宽度，同时预留状态栏和落子确认；不再从内容测量并报告高度，避免自动增高把棋盘推到屏幕外。规则通过原生 dialog 按需展示。PackageBoard 接受通用可选 fit:viewport 后，测量 iframe 文档位置并使用窗口剩余高度，监听 body ResizeObserver 和窗口 resize，卸载清理，切换包重置。没有按 gameId 分支；原内容高度模式和旧包继续兼容。旧宿主固定 560px 也完整显示新版棋盘。规则、HTTP/WS、数据库与旧局锁定版本不变。

## 在线桌面自适应高度（2026-10-04）

Web PackageBoard 在原 sandbox 消息监听中接收当前 iframe 的有界 boardgame:resize，使用组件状态设置高度，切换 id/version 清理尺寸并重建 iframe；旧包不发消息时保留原 560px 最小高度。五子棋 1.0.1 在内容 main 上使用 ResizeObserver，仅尺寸变化时发送，pagehide 断开观察器并取消动画帧；宽度上限 1000px，手机仍按可用宽度。平台没有按游戏 ID 分支；不改变规则、服务端包生命周期、HTTP/WS、数据库或旧局精确版本。

## 自动备份后更新（2026-10-15）

监督进程在关闭 API/AI worker 后、执行迁移与游戏同步前调用 `scripts/update-backup.mjs`，用原受控命令执行器运行 pg_dump/pg_restore，复制并校验资源、保存私密恢复配置与版本引用，完整备份原子发布到私有状态目录。备份失败恢复旧进程，不执行数据库准备。新增迁移默认继续；显式 UPDATE_ALLOW_MIGRATIONS=false 保留人工维护选择，已有迁移修改/删除/重命名始终拒绝。备份不自动覆盖回数据库，保留逐迁移提交与旧进程恢复的真实边界；单实例部署与原业务事务不变。首次需安装 PostgreSQL 客户端并重启监督脚本。详见 [在线更新](online-update.md)。

## 有限等待的服务更新（2026-10-04）

本轮替换下方历史静默/active match/WS 排空条件。监督进程在候选构建完成后封闭 HTTP/WS 新入口，API 通过原本地 IPC 排空：向连接发送 1012 并在一秒后终止未响应连接（含闸门前已接收的晚完成握手），等待已接收 HTTP 请求最多 30 秒。超时返回失败并恢复服务；监督 IPC 最多等待 35 秒，过期排空通过世代校验取消。数据库中的 active matches 不作阻塞项，State/RNG/revision/请求回执与参与者继续由原事务持久化。停止 API 仍通过 app.close 等待 AI 调度器关闭，再运行原迁移/同步和候选就绪/失败恢复流程。不新增协议字段、数据库变更或运行单元；短暂断线通过既有认证重连与权威快照恢复，精确版本缺失仍报错。新版监督脚本须安装到启动目录并重启后才生效。

## 管理员更新控制（2026-10-04）

后台独立 `/admin/updates` 页面经共享 protocol/client-sdk 读取和触发服务更新；admin/routes 复用 session、角色、Origin、CSRF，UpdateControl 仅提供有超时/关联 ID/严格响应解析的本地父子 IPC。监督进程仍是唯一部署命令执行者，没有新增 HTTP 监督端口或 API 内 Git/构建执行。update-control.mjs 管理公开阶段和有界请求去重，手动和定时任务共用原串行构建/排空/恢复流程。生产默认 main，显式配置保持；状态轮询不推进监督静默时间，实际在途请求/WS/active match 排空校验保持。没有数据库迁移或新的运行单元。下方“无网络更新权限接口”描述为 2026-10-03 的历史边界，现在新增的是经过管理员鉴权的 API 触发入口。

## 社交全局同步与聊天浮窗（2026-10-04）

Web App 外壳装配 SocialProvider，统一认证后的社交概要读取、取消/世代检查和会话清理；useSocial 转为上下文消费者，原好友页、ID 管理及房间邀请不再分别轮询。SocialNotifications 投影本人未读/待处理数量与短暂站内提示；ChatDock 复用 DirectChat 的消息分页、增量补取、读取水位和 requestId 重试。最小化保留草稿但停止读取/已读，手机及会话深链接继续使用原独立页面。资料按 summary/edit/identity/history 路由分工，只有历史页请求对局记录。API、协议、数据库、房间权限和游戏规则均未改变；没有新增运行单元或社交 WS，仍是每 5 秒认证 HTTP 同步。

## Linux 生产部署入口（2026-10-03）

`deploy.sh` 编排独立生产配置、Compose PostgreSQL/HTTPS 入口、原有迁移/游戏/资源同步及 systemd 用户 API 服务；业务模块和协议不变。生产 API 在宿主机当前部署账户运行，使用其已有本机 Docker 权限调用原有隔离媒体处理器，网站容器不挂载 Docker socket。Caddy 通过 Linux host 网络访问回环 API 3301，生产 PostgreSQL 仅发布回环 5435；开发环境继续使用原配置。网站只复制 Web 构建文件并排除 sourcemap。生产资源和主密钥保存在私有 `.data/deploy`，更新迁移前停服备份；仍为单 API、需要维护窗口，无自动数据库降级或零停机承诺。使用与信任边界见 [部署指南](deployment.md)。

## 生产更新监督（2026-10-03）

`scripts/online-update.mjs` 是显式启用的生产启动入口，托管静态 Web、同源 HTTP/WS 代理及唯一 API 子进程；不是第二套业务服务或多副本协调。GitHub 分支提交在私有独立目录构建，源工作区不被拉取覆盖。`update-drain.ts` 只通过父进程 IPC 设置请求入口闸门，然后核对请求计数、WS 和数据库 active matches，无网络更新权限接口、不改变房间/动作事务。切换复用迁移与安装脚本、就绪检查和精确版本恢复；默认迁移待维护，数据库不随代码回退。共享绝对资源目录，保留旧 Web chunk，成功就绪后才切换并原子记录版本。具体运维边界见 [在线更新](online-update.md)。

## 花砖计分移动与节拍音效（2026-10-03）

AzulBoard 只使用公开 round.scored 重建待结算满行，TileFlight 测量当前板内源/目标格，通过独立无点击飞行层移动，落位后显示权威分步得分。clientGames 的可选 boardAudio 装配 PresentationAudioPort；MatchPage 授权 PresentationConsumer 接受的可播放 live eventId，BoardAudio 绑定 AudioManager 的失效世代并有界去重。游戏只决定时点，统一播放器继续管理资源、静音、owner、后台和断线取消；教程不提供回调。没有变更服务端规则/摘要、投影/网络 schema、数据库或不可变图包。

## 注册入口（2026-10-03）

`registration-routes.ts` 管理公开注册的 Origin/JSON/正文上限和有界 IP 限流，app 只装配；AuthService.register 复用既有 Argon2id 和 accounts，在 social-write 锁与单事务中创建普通账户及指定初始好友 ID。协议校验位于 protocol/auth.ts，client-sdk.register 解析输入/公开结果；Web RegisterPage 按需加载，有重复提交锁与卸载清理，成功后返回 LoginPage，仅传递公开 ID。登录支持可选 @，继续使用原 session/CSRF 体系。无新数据库迁移或运行服务。

## 在线游戏 ZIP（2026-10-03）

catalog/package-service 与 package-routes 拥有固定三文件 ZIP 校验、安装事务与持久回执；registry/package-runtime 使用有界 QuickJS WASM 适配既有 GameExtension，同步 JSON 方法不注入宿主对象或权限。规则与空默认清单只在 registry 装配；已有 rooms/matches 仍拥有身份、状态、RNG、revision、事件投影与事务。Web game-registry 对在线版本装配 PackageBoard，sandbox iframe 只收到本人 View/live 投影事件，动作回到原平台命令链路。

023/024 在 PostgreSQL 保存不可变包，提交后装配；涉及游戏的请求前读取版本目录并补齐新版本，包含下架版本以恢复旧局。安装源码不依赖上传者账户生命周期，不执行 npm/子进程或 Node.js 动态 import，不创建额外服务。桌面 HTML 是公开程序。v1 只支持自包含同步规则/HTML 和真人玩法，原静态扩展保留所有已有能力。详情见 [ADR-005](adr/005-runtime-game-packages.md)。下方关于“没有上传/热加载”的记录为此前能力边界。

## 社交模块（2026-10-03）

022 将好友 ID 修改间隔与最后修改时间持久化于 social_settings/accounts；social 服务拥有管理员设置的规则/事务，与 ID 修改共用社交写锁和回执，不新增独立配置服务。后台总览 SocialSettingsPanel 经 typed client-sdk 编辑；FriendIdCard 消费服务端 eligibility。平台后台导航补齐 SPA 白名单，「更多」只保留管理入口、个人设置与开发专用工具，管理子项集中在后台。

API `social/service` 与独立 routes 拥有可变好友 ID、申请/关系、私聊/单调读取水位、定向房间邀请；复用既有 auth，protocol/social.ts 与 client-sdk 提供严格 schema/DTO。Web FriendsPage 按 `/friends`、`/friends/add`、`/friends/requests`、`/friends/invitations` 和 `/friends/chat/:accountId` 渲染独立任务页面；统一页面路由和 SPA 白名单管理地址/标题/历史，主导航在所有子页保持选中。FriendIdCard、DirectChat、InviteFriends 各自管理表单和交互，共用可取消的每 5 秒 HTTP 同步 hook，无新运行单元或私聊 WS 广播。浏览器只收到本人有权读取的社交投影。

020 持久化社交表，短写事务通过 PostgreSQL advisory lock 排序，重验活跃账户/session，内容摘要回执在 revision 前去重；只读 REPEATABLE READ 保持一致。定向邀请与 room 锁序保持 room → account/session，接受在同一事务调用 rooms 受信任 joinMemberWithClient，复用原状态/成员/密码/容量/ready/revision 规则，邀请结果与回执一起提交；commit 后经原 room realtime 广播。没有新建认证、座位权限或平行游戏动作系统。完整边界见 [社交功能](social.md)。

## 花砖物语扩展（2026-10-03）

`games/azul` 的 `azul.base@1.0.0` 拥有经典彩墙规则、隐藏袋序、公开板、逐砖计分与存档守恒检查。API registry 装配摘要/说明/音频契约，Web registry 按需加载桌面，policy worker 装配只消费 View 的策略。复用 rooms/matches 的身份、回执、revision、事务、恢复与终局房间复位，不增加平台规则分支或迁移。

客户端有界队列仅播放 MatchPage 提供的去重 live `round.scored` 投影，最新 View 与服务端计分保持权威，不阻塞操作或补播历史。`scripts/azul-audio.ts` 生成原创短音，经既有 seed-assets 和隔离媒体校验安装；AudioManager 维持偏好和 owner，没有另建播放器。游戏 build 复制 CSS 至生产 client 位置。

## 管理员后台（2026-10-03）

apps/api/src/admin 拥有平台非秘密统计、账户状态与安装版本启停事务；routes 负责传输和既有认证边界，app 只装配。protocol/admin.ts 与 client-sdk 提供共享 schema 和类型化方法，Web 后台按需加载，并在渲染内容前验证管理员身份。资料审核、展示和资源仍由原 catalog/assets 模块拥有。

019 的 admin_revision 触发器覆盖接口及 CLI 的实质状态更新；独立管理回执与状态/会话撤销/通知原子提交，重复成功先于 revision 检查。房间安装校验通过共享安装行锁与版本启停串行化。健康检查允许已安装版本下架，游戏目录仍只返回已启用版本；matches 精确规则恢复不依赖目录启用状态。不新增运行单元、动态代码执行或第二套游戏规则系统。

## 游戏接入申请（2026-10-03）

catalog/submissions 与 submission-routes 拥有纯资料申请、本人读取及管理员审阅；app 只装配。protocol 定义严格输入/输出，client-sdk 提供六个类型化方法，公开 SDK 白名单包含新协议源码。018 持久化申请与去重/审核记录；事务锁与数据库配额防止并发重复和无限存储，写入内重验 session/active account/管理员角色。申请相关路由有有界、无定时器的单进程 IP 请求限流，错误和成功均 no-store。

不接收文件或规则入口，不使用 fetch、DNS、解压、动态 import、eval、子进程或安装命令；GitHub 地址只作为资料。reviewed 不是源码安全认证，不改变静态 registry、game_installations、房间或旧局版本。现有可信注册流程继续保留；第三方代码隔离运行及动态发布尚未实现。

## 可选交互教程（2026-10-03）

`game-sdk/tutorial` 定义公开练习帧、步骤、动作反馈与纯进度转换；不依赖 React 或具体游戏规则。Web `game-registry.tsx` 的 `clientTutorials` 按精确 gameId@version 装配可选异步教程，详情仅在提供教程时显示入口。`/games/:id/:version/tutorial` 按页加载，先确认公开目录仍启用该版本，再加载原 GameBoard 与教程。TutorialPlayer 管理步骤、重试、进度、高亮和完成返回；练习操作只调用扩展教程回调。刷新重新开始，不持久化完成记录。

Color Match 的 `client/tutorial.ts` 只使用固定公开练习 View 和投影格式事件；游戏语义与动作解析由扩展拥有。客户端不导入 server、不读取正式 State、不调用正式动作 API、不创建练习房间，不改变既有规则 manifest/源码摘要、对局事务或权限。单元测试将每步动作和 View/事件与真实 server 规则对照，防止练习漂移；正式规则仍只在 server 执行。 璀璨宝石的独立 ./tutorial 导出复用同一播放器，十一个固定场景仅加载合成公开投影；离线作者脚本调用真实规则生成练习数据，测试逐动作核对完整 View 与投影事件。正式桌面不加载练习数据，规则摘要与存档不变。公开 SDK 白名单包含教程契约源码，开发者可选择不注册教程。

## 游戏目录与详情入口（2026-10-02）

首页的 GameCatalog 消费既有公开游戏目录，经本地 Zod schema 解析 unknown，排除 developmentOnly；登录与未登录页面共用目录。`/games/:id/:version` 按页加载 GameDetailPage，`/games/:id/:version/new` 复用 NewRoomPage/RoomCreateForm 并带入精确目录版本，缺失时禁用创建而不自动换版本；旧 `/rooms/new` 保留兼容。navigation 的页面链接白名单包含新路由，延续 history、焦点及无刷新导航。

详情页默认复用 Lobby 的 gameId 筛选、密码与分页，在列表标题旁提供创建入口；RoomInviteForm 与 GameRules 放到列表下方的折叠区域。邀请码仍决定实际房间，服务端权限与校验保持。公开加入有请求锁与页面世代检查，卸载或筛选变更后的迟到回复不导航。首页保留参与房间。

catalog/GamePresentationService 与独立 routes 拥有目录展示配置，管理员写入继续使用 AuthService 的角色、Origin 和 CSRF 校验。迁移 015 的 game_presentations 按精确安装版本保存图片地址/revision；保存锁安装版本行并在事务内检查 revision，避免并发首写或编辑覆盖。公开只投影三个地址与版本，不暴露修改者。protocol/client-sdk 共用 schema，Web 将游戏清单与公开展示配置合并；客户端 catalog-art 提供游戏专属默认插画，GameArtwork 处理图像加载失败。新增公开源码也进入开发 SDK 下载白名单。图片配置不修改 manifest/rule digest、秘密 State、房间版本或对局资源绑定，不新增媒体上传或规则分支。

## 平台外壳与依赖检查（2026-10-02）

Web 的 app/routes.tsx 统一路由、工作区标题和按页加载；App 只保留站点外壳、导航和文档标题更新，RootPage 管理首页会话状态。app/developer-guides.ts 为路由标题与文档目录提供同一份元数据，文档页不再在卸载时覆盖下一页标题。app/PageBoundary.tsx 隔离页面加载/绘制失败，保留导航和整页重新加载入口；main 的路径 key 与房间/对局 ID 隔离继续保留。

scripts/check-boundaries.ts 自动发现游戏，通过 dependency-boundaries.ts 的 TypeScript AST 校验 Web、UI、client-sdk、protocol、game-sdk 及全部游戏源目录；覆盖字面量静态/动态/类型导入与再导出及相对路径归一化。不是第三方依赖完整图或计算型导入校验，生产 bundle/API runtime 检查仍独立执行。没有改变业务 API、数据库、规则、身份或广播。审查和后续批次见 [项目优化](project-optimization-2026-10-02.md)。

MatchPage 在 WS 非专用失效码断线后也通过既有认证 HTTP 读取复核会话，处理升级握手拒绝而没有 4001 的情况。复核发现 UNAUTHENTICATED 时清除旧 View 与待定请求；只有当前页面世代、当前 socket 和有效快照仍存在才安排重连，避免过期异步结果创建额外连接。继续使用同一身份化快照接口，不新增协议或权限通道。

## 公开开发者文档（2026-10-02）

Web 主导航新增无需 session 的 `/developers` 及指南子页面，页面按需加载并读取 `apps/web/public/developer-docs/*.md`。受限 Markdown 渲染使用 React 文本转义，不解释 HTML 或可执行链接；文档目录、搜索、页内锚点和下载保留浏览器语义。

`apps/web/developer-publication.ts` 是 Vite 构建/开发插件，只读取显式白名单中的 game-sdk、client-sdk、protocol 公开源码及 package.json，生成 `/developer-sdk/sdk-sources.json`、逐文件源码与 `/llms-full.txt`。开发与生产使用同一生成器，源码包记录 SHA-256，避免手工副本漂移；不遍历仓库、不发布 API/游戏 server、环境或本地资源。业务 API 的 session/Origin/CSRF/成员权限不变，没有新增安装游戏的业务端点或 npm 发布流程。

## 大厅与个人资料（2026-10-01）

首页 DashboardPage 收拢为游戏大厅，展示参与房间、邀请码和公开大厅；创建只通过大厅按钮进入 `/rooms/new`，导航保留游戏大厅与我的资料。`ProfileService` 拥有本人资料更新和参与历史概要查询，app 只装配现有认证/CSRF 与 schema 边界。资料与历史由 protocol/client-sdk 共享类型，ProfilePage 不读取秘密 State。旧对局沿用 MatchPage 身份化 View；初次打开 aborted 对局只读展示，不订阅已关闭房间，在线 active 对局被关闭时仍回大厅。下方快速创建描述为历史实现。

## 第九阶段 UI 边界

平台共享 PageFeedback、ActionHint 与 GameErrorBoundary；MatchPage 的 GameSurface 在渲染边界内调用现有 clientGame，不从具体 server State 推导提示。规则、动作事务、DTO 与资源锁未改变。Grid Garden 新增最近公开行动表现，仍只接收 MatchPage 过滤并按 eventId 去重后的 live 事件；恢复不补入历史表现。App 按 room/match ID 挂载页面，RoomPage 在卸载后停止旧写回复导航。

开发 `/dev/ui` 使用匿名公开 View 和本地点击记录，与正式 API/模型隔离；生产 build 关闭开发标志并替换开发模块，检查场景数据没有进入构建。UI 系统与维护见 ui-system.md、ui-development.md。

## 第八阶段多行动者扩展

`games/grid-garden` 是第二个正式规则扩展：服务端拥有 4×4 独立棋盘、秘密选择、原子公开、落子和计分；客户端只消费身份化 `GardenView`。最后选择/落子仍由既有 `MatchService` 在 room → match 锁、receipt、revision、epoch 和事务边界内提交，平台核心不包含 Grid Garden 规则分支。

game-sdk 的可选 `getDecisionRequests` 表达一个快照中的多个合法行动席位。AI 调度器据此为每个席位创建任务，但 claim 查询保持同局单自动任务；任务计算后仍以 sourceRevision/controllerEpoch/lease fencing 进入统一动作服务。`ai_decision_groups` 跨 sourceRevision 记录模型外部发送次数，避免同一决策组在 stale/重启后无限计费。

Grid Garden 独立 asset contract 与 presentation adapter 复用阶段 7 的不可变资源版本、AssetResolver 和 AudioManager。未公开选择只产生不含 choice 的公共提交事件，只有 reveal/place/finish 投影事件映射声音。

## 第七阶段资源与表现

API assets 模块拥有草稿/媒体状态/配额/清单/引用/回执，LocalAssetStorage 保存不可变字节。上传先预留、事务外隔离 FFmpeg 解码与写文件、短事务激活。Docker 工具容器使用 65534、无网络、只读、无挂载及 CPU/内存/PID/时间限制，不是额外常驻业务服务。房间先锁 room 再锁资源 catalog，资源管理不反向锁 room；match 同事务固定资源引用。旧 CSS 资源锁和规则摘要不改写。

可信游戏独立 assets 入口声明 contract 与已投影事件到 cue 的适配器，仅 registry 装配。Web AssetResolver 校验精确清单 hash，游戏通过逻辑 key 渲染；统一 AudioManager 消费同步后 WS live 完整批次、控制世代/水位/owner，不参与规则或 AI。管理预览使用固定演示数据及独立音量。详见 ADR-003、assets.md、audio.md；下方旧阶段不含资源的描述为当时边界。

## 运行单元与模块

- `apps/web`：React 平台外壳；只接收公开 DTO 和当前账户的玩家视图。
- `apps/api`：Fastify 模块化单体，包含 auth/session、rooms、matches 正式动作、room/match realtime、持久 AI 调度、registry 和开发 runner。
- PostgreSQL：账户、会话、房间、邀请码、match 状态与动作、参与者、receipts 和扩展安装元数据的真相来源。
- `games/test-counter`：同一规则实现提供 developmentOnly `demo.test-counter` 和正式身份验收用 `demo.counter-room` 两个不可变 manifest。
- `games/color-match`：独立的 2–4 人完整卡牌游戏；server 规则、shared schema 和 client 桌面分离。

```text
web -> client-sdk -> HTTP / authenticated WS
                       |
                    Fastify routes
                       |
       auth/session -- rooms service -- PostgreSQL
                          |
                     registry interface
                          |
                     trusted game setup
```

路由只做 schema、身份和浏览器安全边界；房间 service 拥有房间事务，match service 拥有正式动作事务、锁、revision、receipts 与身份化 View。游戏规则不依赖 React、HTTP、账户或数据库。registry 是平台引用具体 server 扩展的唯一装配层。

## 关键数据流

登录：Origin → 统一凭据错误/限流 → Argon2id verify → 随机 session/CSRF → token 摘要落库 →安全 cookie 与公开账户 DTO。

房间命令：session → Origin/CSRF → receipt 去重 → `SELECT room FOR UPDATE` → 成员/房主/revision/状态规则 → 原子写入并递增 revision → commit → WS 完整快照。

开局：锁 room → 校验全员入座、ready 和 active account → 精确 registry 安装版本与默认资源清单 → 注入 RNG 调用 setup → serialize/deserialize 自检 → 保存 match/participants/state/RNG → room 进入 in_game → commit 后广播 matchId。

视图：session account → match participant seatId → deserialize 权威 state → `getView(seat viewer)`；房主没有越权读取其他座位的接口。

房间快照：在单个连接的只读 `REPEATABLE READ` 事务内读取房间、成员、座位与扩展安装信息，确保同一响应的 roomRevision 与内容来自同一数据库视图；身份与成员权限仍在每次查询时校验。

正式动作：session → Origin/CSRF → 锁 room 与 match → 固定参与者/控制权 → request receipt 去重 → match revision → 扩展 parse/validate/apply → 原子保存 state、RNG、revision、动作和结果引用 → commit 后分别投影并广播玩家 View/事件。失败回滚且不广播。

第四阶段恢复：正式动作在锁内再次检查 session/账户；对局回执与 match 同生命周期保留。客户端未知结果先查询本人回执，再用原 requestId 重试；刷新后从数据库完整快照恢复，不调用 setup。新对局锁定规则源码与内置资源清单摘要，状态/RNG 不兼容时只阻塞该局。WS 订阅提供本人初始快照，客户端按 revision 合并并通过 15 秒权威读取收敛漏广播。详情见 [可靠性](reliability.md) 和 [恢复步骤](recovery.md)。

第五阶段 AI：waiting 房间座位可由无账户 bot 占用；开局固定 owner/occupant/controller/policy。调度器从 PostgreSQL 任务表扫描并领取，短事务生成当前 seat 的 View 与合法候选，在可终止 worker 中运行可信策略，冻结 proposal 后按 room → match → participant → task 锁序调用统一动作事务。automation principal、revision、controllerEpoch、策略摘要和 leaseGeneration 共同 fencing。控制与 AI 状态使用独立版本并按身份广播，不推进游戏 revision。

## 边界与限制

阶段 6 设置修复（2026-09-25）：`model-profiles.ts` 拥有个人配置、版本、加密凭证与事务；`model-ai.ts` 保留公网地址校验、模型传输和输出解析。`app.ts` 只装配认证路由，client-sdk 解析共享 DTO，设置页管理表单和逐配置操作状态。模型调用继续沿用原调度器与正式动作入口。当前使用活跃绑定检查阻止在对局中修改配置，完整的版本化绑定、预算和模型长租约仍属未完成项。

`/api/v1/ws` 仍只做公开诊断。`/api/v1/ws/session` 使用 cookie、Origin，并在订阅、消息和广播时重验会话/成员。presence 在单 API 进程内维护，最后连接关闭 10 秒后离线，不改变 roomRevision。

开发实验台仍需 `NODE_ENV=development && ENABLE_DEV_LAB=true`，正式页面不提供 test seat 切换。阶段 5 只包含内置脚本策略，不包含外部模型、资源上传、事件音效、观战或公网部署。match 页继续按身份投影视图并用 eventId 去重。服务仍是单 API 实例，不能把进程内广播当成多副本协调。

## 房间体验修复（2026-09-25）

大厅公开概要和密码加入继续由 rooms 拥有；app 仅装配认证/频控，protocol/client-sdk 提供共享 schema 边界。快速创建和独立创建页共用 RoomCreateForm，大厅筛选/分页由 Lobby 管理。新增公开说明由各游戏的独立 rules 入口导出，仅在 API registry 精确版本装配，再供规则接口和 AI context 共用；不修改已有规则源文件或摘要，旧局规则锁不受说明文案影响。真人脚本托管禁用不取消既有模型配置功能。

正常结算由 matches 在原动作事务和 room → match 锁内恢复房间 waiting、清除本局关联和真人准备；真人与 automation 共用事务内复位函数。commit 后 match 变更通知标记房间也有变化，由 app 同时广播两类快照。房间可承载多轮，固定的 match participant 不依赖后续房间座位是否保留；旧对局的 View、receipt、规则摘要继续独立恢复。

## 璀璨宝石扩展（2026-10-01）

2026-10-02 独立 assets 契约在 API registry 注册，Web registry 将精确 AssetResolver 传入桌面并装配固定素材预览。scripts/seed-splendor-assets.ts 通过现有 AssetService 安装 SVG 空映射和本地 TTS 完整映射，重用媒体隔离、哈希、不可变发布和既有房间/对局绑定。不改变 shared/server/catalog 源码或其摘要，不增加数据库迁移；原空绑定对局保持兼容。素材仅持久于本地资源存储，不放入浏览器包或规则 State。

新增 games/splendor，shared 定义动作/View 和功能牌表，server 拥有权威牌堆、预留、阶段、规则与存档检查，client 绘制原创 SVG 并提供确认式交互。API registry、Web game-registry、AI policy worker 与安装脚本分别装配该包；没有新增平台规则分支、HTTP/WS 协议或数据库表。splendor.base@1.0.0 摘要额外覆盖 catalog 源码。存档恢复按字段验证最终分数，允许 JSONB 键重排。详见 [璀璨宝石](games/splendor.md)。


2026-10-02 璀璨宝石可玩性优化：Web registry 将现有 MatchPage 去重后的 live 公开事件传给 SplendorBoard；客户端 Activity 在边界解析事件、按 eventId 保留短记录并展示临时行动／购买卡面。visuals 共享精确资源与失败回退，interaction 用本人 View 的合法候选校验本地宝石草稿，正式提交仍由原 matches 链路处理。没有改变 shared/server/catalog、规则摘要、事件投影、HTTP/WS 或数据库；既有存档和图包锁继续兼容。

## 模型 bot 授权（2026-10-03）

RoomService 复用原房间写事务添加和修改 bot 的脚本/模型配置；协议共用 botSeatCommandSchema 与 roomSnapshotSchema，client-sdk saveRoomBot 解析请求和完整房间响应。房间公开模型类型，仅房主快照包含 botModelProfileId，成员不读取私人模型配置、端点或密钥。Web BotSeatSettings 只管理候选和表单，RoomPage 保持命令、revision 与页面世代处理。

开局时 bot 的 account_id 仍为 NULL；model_owner_account_id 单独固定授权房主，复合外键保证 profile 归属。调度器以该授权账户取得凭证，按 bot 自己的 View 决策，自动动作仍走原 matches 事务；提交时也检查授权账户 active。profile 行共享锁与编辑/删除串行化，活跃模型 bot 与真人模型绑定共同阻止配置编辑/删除。见 [ADR-004](adr/004-model-bot-authorization.md)。

模型决策组：单行动者扩展按 sourceRevision + decisionKey 区分已提交动作后的下一次决定，避免固定 phase/seat 键令整局两次调用后永久兜底；有 getDecisionRequests 的同时行动扩展保留原跨 revision 决策组。每组最多两次外部尝试，旧 epoch/proposal/lease fencing 保持。

## 在线包 AI 与默认展示图（2026-10-03）

registry/PackageRuntime 对可选 getDecisionContext 做严格有界 JSON 适配，基础 worker 按需加载内置策略、其他 basic-v1 使用包的有序合法候选；不在宿主加载包 JS，不新增 gameId 规则分支。脚本/模型仍使用 AiScheduler、matches 权限/事务。catalog/package-art 校验 PNG 数据，025 在包表保存不可变默认图，package-routes 提供公开 PNG，presentations.list 以管理员 URL 优先、包默认次之。浏览器复用既有 GameArtwork，不接触 State、图片 base64 或数据库。UNO 1.1.0 在 ZIP 中携带原创图标/封面/背景和自己的私密 View 候选排序。

## 在线游戏更新审核（2026-10-04）

catalog/package-service 复用同一隔离规则生命周期检查生成只读审核摘要，按 gameId 查询安装版本及启停 revision。发布在原安装 advisory lock、管理员/session 重验与回执事务中校验 catalogHash，再原子下架同 ID 旧版本并插入新版本。registry 保留全部不可变规则，旧 matches 不迁移；没有新增认证、数据库表或运行单元。上传弹窗以检查/审核发布两步消费 protocol/client-sdk，不解析 ZIP 或秘密 State。

## 平台官方 AI 与点数（2026-10-16）

`official-ai/service` 拥有官方目录、本人授权配置、点数钱包/账本/回执与调用预留生命周期；`official-ai/routes` 管理身份/CSRF 传输边界。来源配置复用 model-profiles 加密凭证，玩家官方配置无凭证。AiScheduler 在原 model 路径选择个人或官方来源，官方调用只收到本人 View、公开规则和候选，不增加动作入口。MatchService.actAutomation 在原 room→match→task 事务内调用 OfficialAiService.charge，使动作与扣点共同回滚；恢复按 task/租约/revision/epoch 释放过期预留，保留可提交的冻结提案。Web 独立 `/official-ai`、`/admin/official-ai` 页面，原模型设置保留，房间及对局复用 profile 选择。无独立服务、支付或通用 API 转售端点。详见 [官方 AI](official-ai.md)。
