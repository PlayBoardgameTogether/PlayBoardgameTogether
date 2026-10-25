# 协议

## 官方 AI 优先电脑开局（0.18.0）

`createRoomInputSchema` 增加可选 `computerModelProfileId: UUID`，必须同时提供 `computerOpponents: true`，且为当前创建者自己的有效官方配置。原创建事务验证并填充 bot 的 model 配置，准备/开局、身份、revision 和回执语义不变；省略字段保持免费脚本兼容。Web 先通过原 enroll 请求显式保存档位及每席位预算，再创建房间；整个分步进度保存在会话存储，重试复用各步骤原请求。无新端点或数据库迁移。

官方 bot 额度不足的当次行动通过现有脚本 worker 和正式动作事务提交，任务保留 `AI_FALLBACK_USED`；真人官方托管仍使用 `AI_BLOCKED`。停用/授权失效不作为额度回退，不改变本人 View 投影与自动动作 fencing。

## 电脑开局与公开结果（0.12.0）

公开 `GET /api/v1/games` 为每个已启用的精确版本增加 `supportsScriptAi`，按 registry 的真实 `getDecisionContext` 能力计算，不改 manifest 或规则摘要。`POST /api/v1/rooms` 新增可选 `computerOpponents: true`：仅用于私密房间，游戏必须支持脚本 AI；原建房事务将首席绑定本人，其他席位设置为无账户 basic-v1 bot。本人仍未准备。配额、身份/CSRF、安装版本、请求回执与失败回滚沿用原接口。

Web `/games/:id/:version/computer` 由玩家确认总人数和默认规则后，按原接口依次创建、本人准备、开始对局。三条命令分别使用固定 requestId 与原 expectedRoomRevision（0、1），发送前保存绑定账户/精确游戏版本的会话进度；刷新后手动继续，离页不继续发送后续命令，未知结果不另建请求。房间被其他操作改变时保留冲突和已建房间入口，不覆盖他人的修改。该模式使用免费脚本 AI，属于正式对局，计入对局记录。

MatchView 增加可选 `result: null | {players: [{seatId,winner,score?}]}`。仅在 finished 时返回，来自明确登记的公开结果投影；只保留胜者与可选得分，不暴露完整 outcome、秘密 State 或原始事件，不按分数推断名次/破同分规则。Color Match、Grid Garden、璀璨宝石、花砖物语与正式计数验收扩展按精确版本接入；在线 ZIP 默认无结果摘要。Color Match 不合成分数；多胜者标记共同胜出。active/aborted、旧局与未接入版本返回 null，最终身份化棋桌及原本人回放仍可使用。

`GET /api/v1/profile/matches` 新增可选 gameId 筛选，游标必须属于本人及当前筛选游戏。每条记录增加可选 `result: null | {winner,sharedWin,score?}`，仅投影当前固定参与者的结果。查询使用同一条 SQL，保留身份、过滤、游标及元数据的一致快照。SDK `matchHistory(before?, gameId?)` 保留原调用兼容。公开 SDK 源码白名单增加 match-result.ts。

## 官方 AI token 计价（0.11.0）

发布官方 AI 的原请求新增可选 `tokenPricing: { inputPointsPerMillion, outputPointsPerMillion, markupPercent }`；输入/输出基础点价为 0–10 亿整数点/百万 token，不能同时为零，加价为 0–1000 整数百分比。目录返回可选同名字段；存在时 `pointsPerAction` 表示单次预留上限，无该字段仍为原固定行动点价。官方 profile 新增可选 `official_token_pricing`，本人账本可选 `tokenBilling` 包含档位 ID、价格/加价快照、输入/输出 token 与实际扣点。旧请求、响应与持久回执继续兼容；身份、CSRF、去重、预算及正式动作契约不变。调价发布新档位，详见 [官方 AI](official-ai.md)。

## 桌游币（2026-10-16）

`GET /api/v1/profile/coins` 按 session 读取本人钱包；管理员通过 `GET/POST /api/v1/admin/accounts/:id/coins` 读取和调整。读取只接受可选正整数 `before`；写入严格 `{requestId,expectedRevision,delta,reason}`，不透支，不与 AI 点数兑换。共享 schema、字段、分页、权限及重试语义见 [桌游币](coins.md)。

## 玩家徽章（2026-10-11）

新增认证 GET/PUT `/api/v1/profile/badges`，本人读取完整收藏并提交 `{requestId,expectedRevision,displayed}`（最多三枚无重复且已获得）；GET `/api/v1/profile/badges/:id` 仅返回对方主动精选的有效徽章，不公开完整进度。管理员 GET/PUT `/api/v1/admin/accounts/:id/badges` 读取收藏或提交 `{requestId,expectedRevision,badgeId,granted}`，只能授予/收回三种身份荣誉，不能写成就。所有响应 no-store；写操作保留 Origin/CSRF、事务内 session/身份复验、回执优先和 revision 冲突。共享 schema 位于 protocol/badges.ts；完整语义、SDK 与迁移见 [玩家徽章](badges.md)。

## 管理员更新失败详情（2026-10-11）

`GET /api/v1/admin/updates` 和 `POST /api/v1/admin/updates/check` 的状态 DTO 增加可选、可空的 `failure`。非空时包含严格枚举 `stage` / `reason`、可空整数 `exitCode` 与 ISO `occurredAt`，定义见 `packages/protocol/src/admin.ts`。旧监督进程可缺省该字段；新监督进程在重试受理时返回 null，失败时提供分类详情，经原关联 ID IPC 和共享 schema 校验。原会话、管理员角色、Origin/CSRF、requestId 去重及串行更新保持不变。禁止返回原始命令输出、环境、路径或凭据；无法分类时用 unknown，不伪造具体原因。旧 API 的严格 schema 不接受新增字段，部署必须同时加载新版 API 并重启监督进程，后台刷新加载新版 Web。

## 社交条件同步（2026-10-11）

新增认证 GET `/api/v1/social/updates`，严格 query 可选 `version` 为 64 位小写十六进制摘要。返回判别式 `socialUpdatesSchema`：变化时 `{changed:true,version,overview:SocialOverview}`，未变时 `{changed:false,version}`。每次认证并读取当前账户一致性快照，摘要包含账户身份及所有概要字段和时间相关资格；不同账户的摘要不能抑制首次完整返回。继续 no-store，不采用 HTTP 304 或浏览器缓存。旧 `/social` 返回保持。SDK 新增 `socialUpdates(version?,signal?)`；客户端登出清除版本，仅在收到 changed=true 时替换概要。

## 网络恢复与请求期限（2026-10-11）

认证 WS 仅在确认 session 过期、撤销或账户失效时使用关闭码 4001。鉴权、订阅和广播中的临时服务异常使用 1013，客户端重新鉴权、订阅及读取本人快照；不发送 subscription.revoked，也不因此清除待确认动作。订阅权限确实丢失仍发送 subscription.revoked。握手阶段明确未认证返回 401，临时服务异常返回 503，两者均 no-store。Origin 和各次投递权限检查保留。

client-sdk 通用 HTTP 请求默认 30 秒，二进制上传及其服务端校验默认 120 秒，期限涵盖响应正文读取；原有对局/私聊等 10 秒期限继续生效，以较早的取消或超时为准。me(signal?)、room(id, signal?)、matchSnapshot(id, signal?) 支持页面取消。超时为 TimeoutError，主动取消为 AbortError；SDK 不自动重发写请求，动作结果仍通过原 requestId/回执确认。

## 账户与房间客户端契约（2026-10-05）

protocol/auth 提供 AccountPublic、SessionPublic 与登录/登出响应 schema；RoomService 的公开 RoomSnapshot 直接使用共享 schema 推导类型。房间 revision、座位、准备、配置、房主、加入等输入由 protocol 定义，API 与 client-sdk 复用。旧 HTTP 格式不变。

client-sdk 的账户/房间方法不再允许调用者指定返回泛型，所有响应先作为 unknown 校验。roomCommand 接收 RoomCommand 判别对象，选择固定传输路径与响应 schema；type/seatId/settings 仅为 SDK 包装，不进入原 HTTP 正文。迁移示例见 [客户端 SDK](../apps/web/public/developer-docs/client-sdk.md)。

## 对局回放（2026-10-04）

2026-10-11 回放表现兼容：公开桌面 HTML 路径支持可选 `?replay=1`，仅给原 sandbox/CSP 响应添加平台输入拦截和动画观察包装，普通响应及数据库保存的包字节/hash 不变。非法 replay 值返回校验错误。本人历史 View/events 仍经原认证回放接口读取；此开关不授予身份、动作或网络权限，不改变 WS/规则/存档 DTO。

新增认证 GET `/api/v1/matches/:id/replay?revision=N`，严格 query 和本人投影响应由 matchReplayQuerySchema/matchReplaySchema 定义。仅固定参与者读取 finished/aborted 对局，no-store；未指定 revision 从可用起点开始。完整 DTO、错误与隐私约束见 [回放协议](replays.md#协议)。

## 无人房间关闭（2026-10-04）

无需新增 DTO 或客户端命令。认证房间读取、active 对局读取和健康 WS 房间订阅续期；约 30 分钟无人访问后沿用 closed 快照、room.closed 通知与 aborted 对局状态。续期不改变业务 revision。新增服务端 WebSocket 控制帧 ping/pong 存活探测，浏览器自动回复，现有 JSON ping/pong 保留。

## 对局玩家名称（2026-10-04）

身份化 MatchView 新增可选 players 数组，每项只包含 seatId、seatIndex、displayName、occupantKind（human/bot）。HTTP 读取与 WS 快照沿用同一投影；只有固定对局参与者可以读取，不包含登录名、账号 UUID、模型配置或凭据。旧服务端未提供时客户端保留匿名标签。此元数据独立于游戏 View/State，不参与动作身份授权。

## 公共聊天（2026-10-04）

GET `/api/v1/social/public/messages` 使用原 socialPageQuerySchema，before/after 为互斥 UUID，最新/更早 30 项按正序返回，after 为正序连续补取；nextCursor 为继续分页的 UUID 或 null。共享 publicMessagePageSchema 的消息包含 id、sequence（十进制字符串）、senderId、text、createdAt 及 sender（socialPerson：id/friendId/displayName/avatar）。需活跃 session，no-store；私聊游标不能跨到公共消息。

POST 同路径使用原严格 messageInputSchema：`{requestId:UUID,text}`，trim 后 1–2000 字；需 session/Origin/CSRF。同账户请求摘要包含 public-message 操作，重复成功返回原消息，改正文或跨操作复用 ID 为 REQUEST_ID_CONFLICT。新请求每分钟最多 20 条/账户，累计 20000 条；原社交配额继续有效。输入或限流失败不保存消息/回执，事务故障整体回滚。

POST `/social/requests` 新增可选 expectedAccountId UUID，作为预期接收账户与规范 friendId 联合核对；不匹配返回 STATE_CONFLICT，不能授予身份或绕过关系规则。旧调用省略时保持精确好友 ID 查找。经典表情仍为纯文本 `[微笑]` 等固定快捷码，Emoji 保留 Unicode，客户端不解析 HTML；没有表情 URL、图片上传或私聊 schema 变化。

## 在线桌面适配可见区域（2026-10-04）

`boardgame:resize` 新增可选 `fit:'viewport'`，仍验证当前 contentWindow 和合法 height（320–4096 有限数字）。声明后宿主按 iframe 文档位置计算视口剩余高度，预留底部 16px，限定 180–4096px；后续内容高度消息不再改变该模式。window resize 与页面尺寸变化重新计算，切换包版本恢复默认。桌面自身按 iframe 高度约束棋盘与操作区，旧平台忽略 fit 时可继续使用 height 提示。只影响布局，无 HTTP/WS schema 或权限变更。

## 在线桌面高度消息（2026-10-04）

客户端 iframe 桥新增可选 `{type:'boardgame:resize',height:number}`，只接受当前 iframe contentWindow，height 必须为 320–4096 的有限数字，向上取整设置窗口高度。未声明的旧包继续使用 560px 最小高度；切换游戏/版本恢复默认尺寸。该消息只控制布局，不改变 HTTP/WS DTO、正式动作、身份或权限。内容端应观察内容根节点、去重尺寸并在卸载时清理；完整示例见 [在线包](../apps/web/public/developer-docs/game-packages.md)。

## 管理员服务更新（2026-10-04）

GET `/api/v1/admin/updates` 返回严格 `adminUpdateStatusSchema`：enabled、branch、currentSha、candidateSha、lastCheckedAt、phase。phase 为 unavailable/disabled/idle/checking/building/current/waiting/maintenance/applying/updated/failed；提交为完整 SHA 或 null，不包含环境、日志、凭据或文件路径。仅管理员可读，响应 no-store。

0.13.0 增加可选的 currentVersion/candidateVersion（对应运行/候选目录根 package.json 的纯数字平台版本或 null）、stage、stageStartedAt（当前步骤开始时间或 null）及 checkIntervalMs（至少 10000 的整数毫秒）。stage 为 fetch/history/checkout/install/build/drain/stop/backup/migrate/sync/start/persist/restart；不提供估算百分比、命令输出或私有路径。backup 细分自动备份，但失败 DTO 继续沿用 migrate 阶段以兼容原诊断契约。父子 IPC 通过 statusVersion=2 请求扩展元数据；旧 API 未声明能力时监督进程过滤这些新增字段，旧监督进程返回原 DTO 时新版页面显示信息未提供。

本轮 waiting 表示等待已接收请求完成，最多 30 秒；不再等待 active matches、常驻连接或连续静默。排空超时转 failed，恢复接收请求；切换维护期间新 HTTP 请求收到 Retry-After: 3 的 503，WS 使用 1012 服务重启码后沿用既有重连与快照恢复。DTO 字段、动作事务和回执语义保持。

POST `/api/v1/admin/updates/check` 严格接收 `{requestId: UUID}`，验证 session、管理员、Origin、CSRF 后经本地 IPC 触发既有监督流程，返回 202 和同一状态 DTO；表示受理而非更新成功。拒绝额外执行参数。进程内最近 256 个受理 ID 去重；同时进行的触发合并，重启或淘汰后可再次检查。没有监督进程或配置停用时返回 unavailable/disabled，旧监督进程/IPC 超时返回 SERVICE_UNAVAILABLE。没有数据库、对局或规则协议变更。

## 账号注册（2026-10-03）

### 邮箱验证扩展（1.0.0，2026-10-25）

当前强制邮箱验证，以下原三字段注册记录为历史。新增 POST `/api/v1/auth/register/email-code`，严格 JSON `{email}`，返回 `{challengeId,expiresInSeconds:600,retryAfterSeconds:60}`；不创建账号或 session，不返回验证码。注册请求扩展为 `{displayName,userId,password,email,challengeId,emailCode}`，由 `emailRegistrationInputSchema` 校验；成功仍为原 201 公开结果。email trim/lowercase，最长 254 字；emailCode 必须 6 位数字，challengeId 为 UUID。验证码必须已发送、匹配邮箱、未过期/用尽/核销。原三字段请求返回 VALIDATION_ERROR；失败验证码也为该错误，不泄露真实验证码或邮箱存在性。用户 ID/邮箱唯一冲突统一 STATE_CONFLICT，邮件未配置/发送失败 SERVICE_UNAVAILABLE，发送冷却/配额 RATE_LIMITED。两接口均要求精确 Origin、JSON、4 KiB 上限、no-store；分别每 IP 每分钟 5 次，同邮箱另有 60 秒冷却与每小时 5 次持久化配额。`ApiClient.requestRegistrationEmailCode` 与 `register` 均用共享 schema 解析。需要配对升级网页与 API，既有登录/session/WS 契约不变；版本升级获用户明确授权。

POST `/api/v1/auth/register`：严格 JSON `{displayName,userId,password}`，由 `protocol/auth.ts` 共享 schema 校验。displayName trim 后 1–32 字，userId 可带单个 @、名字部分 3–32 位 ASCII 字母/数字/下划线，trim/lowercase；password 6–128 位，含 ASCII 字母和数字，不 trim。成功 201 返回 `{username,displayName,friendId}`，username/friendId 是无 @ 的规范 ID。固定普通账户，不创建 session；Origin 必须匹配，4 KiB 上限，每 IP 每分钟 5 次。ID 已被登录名或好友 ID 使用返回 STATE_CONFLICT/409；无效输入 VALIDATION_ERROR/400，频控 RATE_LIMITED/429。响应 no-store，无密码/摘要/令牌。ApiClient.register 使用共享输入/响应 schema，返回类型由 schema 推导。登录 username 最大 33 位，以接受 32 位 ID 加 @，服务端去前缀后沿用既有身份认证。

## 在线游戏 ZIP 的 AI 与展示图（2026-10-03）

boardgame-package-v1 的 game.json 可选 presentation，icon/cover/background 为有界 PNG data URL；新增 025 持久字段，与安装元数据和回执原子提交。GET /api/v1/game-packages/:id/versions/:version/art/{icon|cover|background}.png 返回公开 PNG、nosniff/sandbox CSP/immutable 缓存；games/presentations 的三个 URL 允许这类精确路径，管理员配置优先于包默认。图片不包含秘密，不覆盖旧版本。server.js 可选 getDecisionContext 在 QuickJS 中返回 key 与有界合法候选，接入原脚本/模型调度，未改变正式动作协议或身份。

## 管理员在线游戏 ZIP（2026-10-03）

POST `/api/v1/admin/game-packages?requestId=UUID` 使用 application/zip 字节（最大 5 MiB），管理员/Origin/CSRF 在读正文前检查，事务内重验活跃身份。共享 `gamePackageResultSchema` 返回 `{gameId,version,name,hash}`，client-sdk `installGamePackage` 解析 unknown。重复成功按账户/requestId/ZIP SHA-256 返回原结果；不同字节复用 ID 为 REQUEST_ID_CONFLICT；同版本不同包/覆盖内置版本为 STATE_CONFLICT。提交后注册并可立即建房，新动作沿用原事务。

GET `/api/v1/game-packages/example.zip` 下载固定时间戳的可玩示例；GET `/api/v1/game-packages/:id/versions/:version/desktop` 返回公开自包含 HTML，CSP 强制 sandbox allow-scripts、限制外部资源与连接。旧版本下架后保留桌面以恢复旧局；源码和 HTML 均不能嵌入秘密。桥接 boardgame:view/ready/action 只面向本人 iframe，不新增正式动作协议。完整限制见 [包格式](../apps/web/public/developer-docs/game-packages.md)。

恢复读取时使用实际源码参与规则摘要；损坏或变更与已保存摘要不一致时，沿用既有 RECOVERY_BLOCKED/503，不重置 State、RNG 或 revision。

## 好友 ID 冷却规则（2026-10-03）

socialIdentity 增加 changeIntervalDays（0–3650）、nextChangeAt（ISO UTC 或 null）、canChange。首次自定义或 0 天不受限，实际改名后按服务端时间重新计算；失败、原成功请求重试及相同 ID 不重新计时。冷却期间改名为 RATE_LIMITED。GET `/api/v1/admin/social-settings` 返回 `{friendIdChangeDays,revision}`，PUT 接收 `{requestId,expectedRevision,friendIdChangeDays}`，管理员/Origin/CSRF 校验与事务角色重验，严格拒绝额外字段。成功回执先于 revision；设置与改名串行。旧 ID 回执重试保留原 friendId/revision，并补齐当前策略元数据。

## 好友、私聊与邀请（2026-10-03）

好友名字输入（ID 编辑、精确搜索和申请）接受可选单个 `@`，trim 后去前缀、lowercase 并严格校验；`@RST307` 与 `rst307` 指向同一名字。DTO 保持无前缀值，Web 展示与复制使用 `formatFriendId` 输出 `@rst307`。数据库及关系身份仍使用原账户 UUID。

新增需 session 的 `/social`、`/social/search`、`/social/id`、`/social/requests`、`/social/friends/:id`、`/social/friends/:id/messages`、`/social/friends/:id/read`、`/social/invitations/:id` 以及 `/rooms/:id/friend-invitations`。严格 schema/DTO 由 protocol/social.ts 共享，client-sdk 逐响应解析 unknown。写请求保留 Origin/CSRF，并在事务重验活跃账户/session；UUID 回执摘要绑定操作、目标和完整内容，重复成功先于 revision。私聊按双方关系授权，分页游标和已读水位不能跨会话。社交同步采用可见页面每 5 秒认证 HTTP 读取，未新增 WS 广播私聊正文。拒绝、撤回或删除好友后，新的申请在关系最后更新起 15 秒内返回 RATE_LIMITED/429，满 15 秒可再次申请；原成功请求仍优先重放回执。字段、配额和错误见 [社交 API](social.md#api)。

## 管理员后台（2026-10-03）

新增 GET `/api/v1/admin/overview`（真实非秘密计数）、GET `/api/v1/admin/accounts?search=&before=`（20 项账户概要分页）、PUT `/api/v1/admin/accounts/:id/status`、GET `/api/v1/admin/games`（全部安装版本，包括下架）、PUT `/api/v1/admin/games/:id/versions/:version/status`。均要求管理员 session，响应和错误 no-store/nosniff。写入额外校验 Origin/CSRF，并在事务内重验身份。

账户命令为严格 `{requestId: UUID, expectedRevision: positive integer, status: active|disabled}`；游戏命令为严格 `{requestId,expectedRevision,enabled:boolean}`。同一管理员 UUID 请求跨目标/内容复用返回 REQUEST_ID_CONFLICT，相同成功重试优先返回原 DTO；旧 revision 返回 STATE_CONFLICT。禁止通过 body 修改角色，禁止后台停用管理员账户。上架规则/资源缺失返回 GAME_VERSION_UNAVAILABLE，不存在版本 GAME_NOT_FOUND。共享 schema 位于 protocol/admin.ts；client-sdk 提供五个类型化管理方法并解析请求/响应。

下架仅更改安装启用状态，隐藏目录、阻止新建/开局，已开始对局按原锁定版本继续；游戏安装检查用共享行锁与上下架串行化。健康就绪检查核对安装和清单，不要求所有安装版本启用。申请审核沿用既有接入 API，没有安装或执行代码能力。见 [管理指南](admin.md)。

## 游戏接入申请（2026-10-03）

`POST /api/v1/game-submissions` 接收 gameSubmissionInputSchema：UUID requestId、gameId、version、name、description、固定格式 HTTPS GitHub repositoryUrl。只存纯文本资料，不下载/执行代码或修改游戏目录。登录用户 GET 同一路径（before UUID 游标，20 项分页）与 `/:id` 只读取本人；越权/不存在统一 GAME_NOT_FOUND/404。

管理员 GET `/api/v1/admin/game-submissions`、`/:id` 读取全部申请；POST `/:id/review` 接收 gameSubmissionReviewSchema：UUID requestId、expectedRevision、reviewed/rejected、必填 reviewNote。仅 pending 可审核，revision 1 → 2；reviewed 仅代表资料审阅。写入沿用 Origin/session/CSRF，事务内再次验证账户、会话及管理员角色。创建按账户 + requestId 去重，审核按申请 + 审核者 + requestId 去重，重复成功优先于配额/revision 检查；内容冲突 REQUEST_ID_CONFLICT，竞争审核 STATE_CONFLICT。

DTO 不包含申请人/审核人 ID、请求回执或会话信息，全部响应 no-store。仅 JSON，8 KiB 上限，未知字段拒绝；传输错误按 VALIDATION_ERROR 返回 400/413/415。配额与单进程 IP 限流及完整示例见 [公开接入指南](../apps/web/public/developer-docs/add-game.md)。client-sdk 提供六个类型化方法，逐边界解析共享 schema；没有上传、安装或热加载端点。

## 游戏展示配置（2026-10-02）

`GET /api/v1/games/presentations` 无需登录，返回 `{gameId,version,revision,iconUrl,coverUrl,backgroundUrl}[]`，没有配置时 revision 为 0、地址为 null。`PUT /api/v1/games/:id/versions/:version/presentation` 仅管理员可调用，继续验证 Origin/session/CSRF，输入 `{expectedRevision,iconUrl,coverUrl,backgroundUrl}`。地址为 null、公开 HTTPS（不含凭据/查询/片段）或 `/game-art/` 图片路径；禁止脚本/data/私密 API 和路径穿越。旧 revision 返回 STATE_CONFLICT，停用或不存在版本返回 GAME_NOT_FOUND。接口 no-store；返回公开展示字段，不返回修改者。协议 schema 与 client-sdk 方法共用校验。此配置不进入规则清单、对局状态或图包摘要，不提供上传端点。

## 本人资料与历史（2026-10-01）

- `GET /api/v1/profile`：返回 id、username、displayName、avatar、bio、createdAt，只能读取当前 session 账户。
- `PUT /api/v1/profile`：严格输入 `{ displayName, avatar, bio }`，昵称 trim 后 1–32 字，avatar 为内置枚举，bio trim 后最多 300 字；需要 Origin 和 CSRF，返回保存后的本人资料。不接收 accountId 或外部图片 URL。
- `GET /api/v1/profile/matches?before=<match UUID>`：返回 `{ items, nextCursor }`，每项仅 id、gameId、gameVersion、roomName、status、createdAt；按固定参与者身份过滤，每页 20 项。before 必须是 UUID，非本人游标不返回记录。

共享 schema 与类型在 protocol/profile.ts，client-sdk 的 profile/saveProfile/matchHistory 解析 unknown 响应。未新增全局胜率或胜负推断，游戏结果仍由各扩展的本人 View 展示。

## 第七阶段资源接口

GET `/assets/contracts`、`/assets/versions?gameId=...`、`/assets/versions/:id`、`/assets/files/:id` 需要登录。文件先鉴权后 ETag，private/max-age=0/must-revalidate、nosniff、正确 MIME 和长度。

管理员 `/admin/assets/drafts` 支持 GET/POST；`/:id` GET/PATCH/DELETE；`/:id/files` GET/POST；`/:id/validate`、`/:id/publish` POST；`/admin/assets/versions` GET，`/:id/archive` POST，`/:id` DELETE。写请求保持 Origin/CSRF/session/role。上传原始媒体正文，头部 X-Request-Id、X-File-Name（URI 编码仅显示）、X-File-Size、X-Content-SHA256，接收前预留配额；重复请求绑定全部内容。草稿编辑传 manifestText，服务端检查重复 JSON 键；发布传 expectedDraftRevision/contentHash/requestId。

PUT `/rooms/:id/assets`：requestId/expectedRoomRevision/versionId，只允许 waiting 房主，复用房间命令事务与 ready 失效。RoomSnapshot 增加 assetVersionId；MatchView 增加 nullable assetBinding(versionId/manifestHash/contractVersion) 和可选 cues(eventId/cueIndex/cueId)。cue 只在已投影 WS live 完整批次出现，HTTP receipt/initial/resync 静默；同 revision 的完整 cue 批次消费后关闭水位。错误复用 VALIDATION_ERROR、FORBIDDEN、STATE_CONFLICT、REQUEST_ID_CONFLICT、GAME_VERSION_UNAVAILABLE、SERVICE_UNAVAILABLE。

HTTP envelope 为 `{ok:true,data,traceId}` 或 `{ok:false,error:{code,message,retryable},traceId}`。认证/房间/match 响应带 `Cache-Control: no-store`。

## HTTP

- `POST /api/v1/auth/login`、`GET /auth/me`、`POST /auth/logout`
- `GET/POST /api/v1/rooms`、`POST /rooms/join`；列表默认 20、最大 50，返回 `{items,nextCursor}`，用 `?cursor=...` 翻页
- `GET /rooms/:id`
- `PATCH /rooms/:id/config`
- `POST /rooms/:id/invite|leave|host|start|close`
- `PUT|DELETE /rooms/:id/my-seat`、`PUT /rooms/:id/my-ready`
- `PUT|PATCH|DELETE /rooms/:id/seats/:seatId/bot`：waiting 房主添加/修改/移除 AI。script 输入 policyId=basic-v1（兼容省略 controllerType）；model 输入 controllerType=model 与本人的 profileId。请求严格校验并携带 requestId/expectedRoomRevision；回执绑定目标 seatId。模型变更取消真人准备，开局重新校验并固定授权。快照仅房主可见 botModelProfileId，其他成员该字段为 null；没有 profile 地址、密钥或 bot 私密 View。
- `GET /games/:id/ai-policies`：公开兼容策略描述，不返回模块路径。
- `GET /api/v1/matches/:id/view`
- `POST /api/v1/matches/:id/actions`：`{requestId,expectedRevision,expectedControllerEpoch,action}`；不接受客户端 seatId/automation 标记。epoch 0 的旧阶段 4 请求保留兼容，发生控制切换后必须携带当前 epoch。
- `PUT /api/v1/matches/:id/my-controller`：本人 set human/model（human 座位设置 script 返回 FORBIDDEN），带 requestId、expectedControllerEpoch；model 必须提供本人的 profileId。
- `POST /api/v1/matches/:id/seats/:seatId/ai-retry`：本人或专用 bot 房主重试 blocked 调度。
- `GET /api/v1/matches/:id/commands/:requestId`：只允许当前 session 对应的固定参与者查询本人 `match.action` 结果。返回 `{outcome:'accepted',requestId,appliedRevision}` 或 `{outcome:'not_found',requestId}`；not_found 不证明正在执行的请求最终不会提交，客户端必须以原 ID 和原内容重试。

所有房间写请求带 requestId；依赖当前决定的写请求再带 expectedRoomRevision。身份字段不由 body 接收。未找到和非成员对外统一 404 语义。

正式动作按 session account 映射固定参与者，事务内再次检查 session/账户状态，先查同一 requestId 的已提交结果，再检查 match revision 与规则。相同请求返回原 revision/View，但不重放原 live 事件；不同内容复用 ID 返回 `REQUEST_ID_CONFLICT`；旧 revision 返回 `STATE_CONFLICT`；非法或终局动作返回 `ACTION_NOT_ALLOWED`。成功后同一事务保存状态、RNG、revision、动作和结果引用。正式动作回执在对局保留期内不设 7 天 TTL；客户端不可把旧回执 View 当作最新视图。

阶段 5 新增 `CONTROLLER_CONFLICT`、`CONTROLLER_NOT_HUMAN`、`AI_POLICY_UNAVAILABLE`、`AI_NOT_SUPPORTED`、`AI_TASK_STALE`、`AI_BLOCKED`。内部 lease 细节不通过公共接口泄露。

## 模型设置

模型设置接口（均以当前 session 为所有者，写入保留 Origin/CSRF 校验，响应 no-store）：

- `GET /api/v1/model-endpoints`：公共可选服务目录；`GET /api/v1/me/model-settings`：只返回 credentialsAvailable。
- `GET/POST /api/v1/me/model-profiles`：列出本人未删除配置／原子创建配置与可选 apiKey。
- `PATCH /api/v1/me/model-profiles/:id`：完整编辑字段加 expectedVersion；可选 apiKey 缺省表示保留，地址改变必须重新提供密钥；版本冲突返回 STATE_CONFLICT。
- `DELETE /api/v1/me/model-profiles/:id`：软删除并撤销凭证；正在用于活跃对局模型托管的配置拒绝编辑和删除。
- `PUT|DELETE /api/v1/me/model-profiles/:id/credential`：替换／撤销本人密钥，不返回密钥内容。
- `POST /api/v1/me/model-profiles/:id/test`：显式触发一次无私密游戏数据的连接测试，返回 attemptId、status、kind（real/mock）。

共享 modelProfileInputSchema、modelProfileUpdateSchema 及响应 schema 位于 protocol，client-sdk 在响应边界解析，不再由调用者传泛型断言模型设置响应。

## WebSocket

`/api/v1/ws`：公开诊断 hello/ping/pong。

`/api/v1/ws/session`：cookie session + Origin。客户端发送 `room.subscribe(roomId)`、`room.unsubscribe(roomId)`、`ping`；服务端发送 `session.ready`、`room.snapshot`、`room.presence`、`room.closed`、`subscription.revoked`、`pong`、`error`。snapshot 是完整替换，客户端只接受不低于当前 roomRevision 的版本。presence 使用独立 presenceSeq，不推进 roomRevision。每连接最多订阅 10 个房间、每秒最多处理 10 条消息；会话失效时断开连接。

订阅正在进行的房间时，服务端在 `room.snapshot` 后发送本人初始 `match.snapshot`。阶段 5 snapshot 增加本人 controller、公开 controllers 和 aiStatus；控制/任务状态可在相同游戏 revision 下更新。客户端分别按 revision、controllerVersion、aiStatusVersion 合并，仍只对 live 游戏事件按 eventId 去重。

正常结算提交后推送 finished 的 `match.snapshot` 和 waiting 的 `room.snapshot`；两者分别按自身 revision 合并，不依赖到达顺序。waiting 快照的 activeMatchId 和 matchStatus 均为 null，真人 ready 为 false。历史结果继续通过原 matchId 的 View 接口按参与者身份读取。订阅 waiting 房间不会补发上一局 match.snapshot；结果页在房间订阅确认后用 REST 同步已结束的对局，不无限等待已移除的 activeMatchId。

## 房间大厅与规则（2026-09-25）

- POST /rooms：共享 createRoomInputSchema；可选 visibility=public/private、password（1–128 字符）。缺省 private 保持旧客户端隐私。重复 requestId 不重复建房；新请求超过一个未关闭创建房间返回 ROOM_CONFIG_CHANGED/409。
- GET /rooms/lobby：需要会话；limit 默认 20、最大 50，cursor、gameId、roomType=open/password、status=waiting/in_game/finished/closed 可选。返回 lobbyPageSchema 的公开概要与 nextCursor，不返回成员、私密 State、邀请码或密码摘要。2026-10-04 每项新增 hostDisplayName、hostFriendId（无 @ 的公开用户 ID），单条查询关联当前房主账户；Web 使用 formatFriendId 展示 @ID，不提供登录名或内部账户 UUID。旧客户端可忽略新增字段，新客户端需要更新后的 API。
- POST /rooms/:id/join：公开房通过 requestId 和可选 password 加入。私人房返回 ROOM_NOT_FOUND。邀请码路径 POST /rooms/join 同样接受 password；密码错误 FORBIDDEN/403；共享加入频控。
- GET /games/:id/versions/:version/rules：精确版本的公开规则文本，返回 gameId/version/rules；未知版本明确 404。
- room.snapshot 增加 visibility、hasPassword、matchStatus；进行中退出返回 ROOM_ALREADY_STARTED/409；关闭仅限房主，允许终止 active 对局，非房主返回 FORBIDDEN/403。关闭与终止同事务提交，成功后广播关闭快照/通知。导航不改变成员资格。

新大厅/创建结果/规则的客户端响应均经共享 schema 校验。控制器仍保留协议 script 枚举用于专用 bot 与历史回执；真人新请求无法开启脚本。

## 在线游戏包审核与替换（2026-10-04）

POST `/api/v1/admin/game-packages/review` 接收 application/zip 字节，沿用管理员 session/Origin/CSRF/大小及限流保护，只检查不写库。共享 gamePackageReviewSchema 返回 gameId/version/name/hash/kind/installedVersions/catalogHash；kind 为 new/update/installed，按 manifest.id 识别。安装 query 新增可选 expectedCatalogHash，已有游戏的新版本必须提供审核时 catalogHash。事务内目录哈希冲突返回 STATE_CONFLICT；重复成功回执优先返回。新版本与旧版本下架及安装回执原子提交，旧精确规则不改写。同版本相同包不改变上架状态。

## 官方 AI 与 AI 点数（2026-10-16）

新增共享 `official-ai.ts` schema 与 typed SDK：登录读取 `/official-ai/offers`、本人 `/me/official-ai/profiles`、POST `/me/official-ai/enroll`（requestId/offerId/matchBudget）、GET `/me/ai-points` 和 `/me/ai-points/ledger?before=UUID`。管理员 GET/POST `/admin/official-ai/offers`、PUT `/:id`（requestId/expectedRevision/enabled）、POST `/admin/ai-points/grant`（requestId/accountId/points/note）及 GET `/admin/official-ai/stats`。全部 no-store，写入 Origin/CSRF、事务会话与角色重验，持久成功回执优先；错误复用既有代码。modelProfile DTO 增加可选官方档位/上限/行动价格，个人模型列表仍仅个人配置，官方目录不暴露来源 ID/密钥。房间/控制动作继续使用已有 model+本人 profileId，不新增 seat 授权方式。详见 [官方 AI API](official-ai.md#api-与存储)。
