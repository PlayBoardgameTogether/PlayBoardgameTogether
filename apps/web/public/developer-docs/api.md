# HTTP API

认证 GET `/api/v1/social/updates?version=<64位小写十六进制摘要>` 支持概要条件同步，首次省略 version。变化返回 `{changed:true,version,overview}`，未变返回 `{changed:false,version}`；均通过标准 envelope 包装且 no-store。每次重新核验会话并计算当前账户概要，version 不授予权限。旧 GET `/api/v1/social` 始终完整返回。

## 对局回放（2026-10-04）

GET `/matches/:id/replay?revision=N`：活跃 session 的原固定参与者只读已结束/中止对局的本人历史视角。省略 revision 取最早可用帧；严格拒绝 seatId 等额外 query，非负整数最大 2147483647。返回 matchId/gameId/gameVersion、finished/aborted status、firstRevision/lastRevision/revision、seatIndex、actorSeatId、recordedAt、公开 players、assetBinding、本人 view 及已投影 events。无 State/RNG/原动作/内部事件；no-store。非参与者 404，进行中 422，无对应步骤 400，精确版本/存档不可恢复 503。client-sdk `matchReplay` 解析共享 schema。

迁移 029 后新局从初始步骤保存，旧局只有当前步骤起的帧。客户端桌面 busy=true，只读静音，不发送动作或重放计分动画。

## 公共聊天

以下路径均带 `/api/v1` 前缀并需要活跃 session，响应 no-store。GET `/social/public/messages` 接收互斥的 before/after UUID，每页 30 条正序，返回 `{items,nextCursor}`；消息包含 id、sequence 字符串、senderId、text、createdAt 和 sender（账户 UUID、好友 ID、昵称、内置头像）。after 为连续补取，nextCursor 非空时继续读取；公共和私聊游标分离。

POST 同路径严格接收 `{requestId:UUID,text}`，要求 Origin/X-CSRF-Token；trim 后 1–2000 字，重复成功先返回原结果，修改内容或跨操作复用编号返回 REQUEST_ID_CONFLICT。公共新发言每账户最多 20 条/分钟、累计 20000 条，仍受原社交命令配额限制。正文为纯文本，Emoji 与 `[微笑]` 等固定文字表情码不改变消息 schema；不解析 HTML，不支持图片上传。

POST `/social/requests` 接收 `{requestId,friendId,expectedAccountId?}`；可选账户 UUID 用来核对名片的预期目标，防止可变好友 ID 被其他人复用，不授予权限。不匹配为 STATE_CONFLICT，旧调用继续兼容。

## 管理员在线 ZIP 安装

POST `/admin/game-packages?requestId=UUID` 接收 application/zip 二进制（最多 5 MiB），只允许管理员 session + 同源 Origin + X-CSRF-Token；共享响应 `{gameId,version,name,hash}`。重复成功去重，不覆盖同版本，新版本必须提升版本号。GET `/game-packages/example.zip` 为公开示例下载，GET `/game-packages/:id/versions/:version/desktop` 为强制 sandbox CSP 的公开桌面。完整格式、资源限制与桥接见 [在线游戏 ZIP](/developers/game-packages)。这些路径均带 `/api/v1` 前缀。

## 管理员后台

GET `/admin/social-settings` 返回 `{friendIdChangeDays,revision}`；PUT 使用 `{requestId,expectedRevision,friendIdChangeDays}` 设置好友 ID 修改间隔（0–3650 整数天，默认 30，0 不限）。首次自定义不受限，后续从最后成功改名时间算起；管理员调整立即按原时间重新计算。`/social` 的 identity 与 `/social/id` 返回 changeIntervalDays、nextChangeAt、canChange；冷却期间实际改名返回 RATE_LIMITED。重试先返回原成功结果，相同 ID 不重新计时。schema 与 SDK 方法见公开 social.ts/index.ts 源码。

管理员通过 GET `/admin/overview` 读取平台计数，GET `/admin/accounts?search=&before=` 搜索并分页读取账户，GET `/admin/games` 读取全部安装版本。PUT `/admin/accounts/:id/status` 接收 `{requestId,expectedRevision,status}`，status 为 active/disabled；PUT `/admin/games/:id/versions/:version/status` 接收 `{requestId,expectedRevision,enabled}`。requestId 必须为 UUID；写入检查 Origin、session、CSRF 与管理员角色，事务内再次验证身份；相同成功重试返回原结果，内容复用冲突 REQUEST_ID_CONFLICT，旧 revision 返回 STATE_CONFLICT。所有响应 no-store。

只能启停普通账户，不能修改角色；停用撤销全部会话，启用后重新登录。游戏下架隐藏目录并阻止新建/开局，进行中对局继续精确版本；上架要求可信规则与资源已加载。没有上传、安装或任意代码热加载接口。DTO 与类型化方法见 [管理协议源码](/developer-sdk/packages/protocol/src/admin.ts) 和 [客户端 SDK](/developer-sdk/packages/client-sdk/src/index.ts)。

基址 /api/v1。本文列出正式接口；/health/live 与 /health/ready 位于基址之外。请求体为 JSON（媒体上传除外），字段应按共享 Zod schema 严格校验，未知身份字段不能赋予权限。

## 认证与响应

注册使用 POST /auth/register，严格输入 { displayName, userId, password }。displayName 为 1–32 字昵称，userId 允许可选 @ 加 3–32 位字母/数字/下划线且大小写不敏感，password 6–128 位并含字母和数字。成功 201 返回 { username, displayName, friendId }，不会自动登录。仅允许配置 Origin，每 IP 每分钟 5 次，ID 占用返回 STATE_CONFLICT。登录使用 POST /auth/login，输入 { username, password }，username 接受带/不带 @ 的注册 ID 或旧用户名。登录校验 Origin，成功设置 session cookie，data 返回 account、csrfToken、expiresAt。GET /auth/me 恢复本人身份与 CSRF，POST /auth/logout 注销。没有 API key 或任意跨域授权接口。

需要会话的写请求携带 X-CSRF-Token，并满足部署配置的同源 Origin；cookie 必须随请求发送。公开文档无需登录不意味着下面的业务接口无需登录。

```json
{ "ok": true, "data": {}, "traceId": "request-trace" }
```

```json
{
  "ok": false,
  "error": {
    "code": "STATE_CONFLICT",
    "message": "Match changed; reload",
    "retryable": false
  },
  "traceId": "request-trace"
}
```

认证、房间、对局响应 no-store。媒体成功响应为二进制，不套 JSON envelope。错误码以 protocol 的 errorCodes 为准。

## 游戏目录：无需登录

| 方法 | 路径 | 响应 data |
| --- | --- | --- |
| GET | /games | 已安装启用的游戏清单数组，数据库未就绪返回 503 |
| GET | /games/:id/versions/:version | 精确版本清单，缺失 404 |
| GET | /games/:id/versions/:version/rules | { gameId, version, rules } |
| GET | /games/:id/ai-policies | 可用策略描述数组，不暴露执行模块 |
| GET | /games/presentations | 公开展示配置数组，含 gameId/version/revision/iconUrl/coverUrl/backgroundUrl；不含修改者或内部记录 |

目录是查询接口，当前没有 POST /games 上传或安装规则代码接口。

## 游戏接入申请

申请只保存纯文本和固定格式 GitHub 仓库地址，不下载、不执行、不安装。详情和完整字段见 [添加游戏](/developer-docs/add-game.md)。

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| POST | /game-submissions | 登录 + Origin + CSRF；严格 JSON，8 KiB 上限 |
| GET | /game-submissions | 本人的申请，每页最多 20，before 为 UUID 游标 |
| GET | /game-submissions/:id | 本人申请，越权/不存在统一 404 |
| GET | /admin/game-submissions | 管理员分页查询 |
| GET | /admin/game-submissions/:id | 管理员详情 |
| POST | /admin/game-submissions/:id/review | 管理员 + Origin + CSRF，pending → reviewed/rejected |

创建输入 `{ requestId, gameId, version, name, description, repositoryUrl }`；审核输入 `{ requestId, expectedRevision, status, reviewNote }`。两种 requestId 都是 UUID。reviewed 仅标记资料审阅，不代表源码安全或发布。接口均 no-store，不提供代码/文件上传；未知字段拒绝。相同成功请求优先去重，不同内容复用 ID 返回 REQUEST_ID_CONFLICT，竞争审核返回 STATE_CONFLICT，配额返回 RATE_LIMITED，超大正文 413，不支持的内容类型 415，畸形 JSON 400（均使用 VALIDATION_ERROR）。

管理员可 PUT /games/:id/versions/:version/presentation，输入 `{ expectedRevision, iconUrl, coverUrl, backgroundUrl }`。三个图片地址可为 null（使用客户端内置图片）、公开 HTTPS URL（不含用户信息、查询参数或片段），或 /game-art/ 下的图片路径；禁止 data/javascript、目录穿越与私密 API 路径。写入需要 administrator、Origin、session 与 CSRF。配置按游戏精确版本保存，并发旧 revision 返回 STATE_CONFLICT；缺失或停用游戏版本返回 GAME_NOT_FOUND。此接口只设置目录图片地址，不上传媒体、安装游戏或修改对局图包。

## 房间：需要会话

写操作均需要 requestId（1–128 字符）。下表中的 R 表示 { requestId, expectedRoomRevision }，expectedRoomRevision 为非负整数；这是房间版本，不是对局 revision。

| 方法 | 路径 | 请求 / 用途 |
| --- | --- | --- |
| GET | /rooms | 本人房间；limit 默认 20、最大 50，cursor 分页 |
| GET | /rooms/lobby | 公开概要及当前房主 hostDisplayName/hostFriendId（无 @ 的公开 ID）；limit/cursor/gameId/roomType/status 可选，不返回登录名、房主账户 UUID 或成员名单 |
| POST | /rooms | 创建，下方给出完整示例；返回 { roomId, inviteCode } |
| POST | /rooms/join | { requestId, inviteCode, password? } |
| POST | /rooms/:id/join | { requestId, password? }，只允许公开房 |
| GET | /rooms/:id | 本人成员房间的完整快照 |
| PATCH | /rooms/:id/config | R + name/gameId/version/options/seatCount；房主配置 |
| PUT | /rooms/:id/my-seat | R + seatIndex（零起始） |
| DELETE | /rooms/:id/my-seat | R，离座 |
| PUT | /rooms/:id/my-ready | R + ready:boolean |
| POST | /rooms/:id/invite | R，房主刷新邀请码；原码仅本次响应显示 |
| POST | /rooms/:id/leave | R，退出；进行中拒绝 |
| POST | /rooms/:id/host | R + targetAccountId，转让给房间成员 |
| POST | /rooms/:id/start | R，房主开局；返回 matchId 等结果 |
| POST | /rooms/:id/close | R，房主关闭；进行中对局中止 |
| PUT | /rooms/:id/assets | R + versionId，waiting 房主选择图包 |
| PUT | /rooms/:id/seats/:seatId/bot | R + policyId:'basic-v1'，或 controllerType:'model'/profileId（房主本人），waiting 房主添加 AI |
| PATCH | /rooms/:id/seats/:seatId/bot | 同 PUT 设置，修改已有 AI；取消真人准备 |
| DELETE | /rooms/:id/seats/:seatId/bot | R，waiting 房主移除 AI |

```json
{
  "requestId": "unique-create-request",
  "name": "开发者房间",
  "gameId": "color-match",
  "version": "1.0.0",
  "options": {},
  "seatCount": 2,
  "visibility": "private"
}
```

visibility 可为 public/private，省略时 private；password 可选，1–128 字符。游戏人数和 options 还会由对应扩展验证。创建者自动成为房主、成员并坐 0 号位，但未准备；加入不自动入座。每个创建者最多一个未关闭房间。

roomType 筛选为 open/password，status 支持 waiting/in_game/finished/closed；正常结束后房间恢复 waiting。房间快照含 id/name/gameId/gameVersion/options/seatCount/roomRevision/activeMatchId/members/seats/permissions/startBlockers，以及资源和可见性字段；不返回邀请码原值、密码摘要或秘密 State。

非成员和未找到的房间对外统一 404。房间配置改变可能取消准备；开局创建固定参与者与权威状态。断线不会退出。

## 对局：需要固定参与者身份

| 方法 | 路径 | 请求 / 响应 |
| --- | --- | --- |
| GET | /matches/:id/view | 本人 MatchView，不接受 seat query 选身份 |
| POST | /matches/:id/actions | { requestId, expectedRevision, expectedControllerEpoch, action }；返回 MatchView |
| GET | /matches/:id/commands/:requestId | 查询本人的 match.action 回执 |
| PUT | /matches/:id/my-controller | { requestId, expectedControllerEpoch, controllerType, profileId? } |
| POST | /matches/:id/seats/:seatId/ai-retry | 本人或专用 bot 房主重试 blocked AI |

```json
{
  "requestId": "unique-action-request",
  "expectedRevision": 0,
  "expectedControllerEpoch": 0,
  "action": { "type": "draw_card" }
}
```

这是 Color Match 示例，只有当前规则允许时才成功。Action 结构由具体游戏 parseAction 决定，并非一律有 payload。新客户端应始终提供当前 epoch，兼容旧请求的省略行为不应作为新集成方案。

MatchView 主要字段为 matchId/roomId/gameId/gameVersion/revision/status/seatIndex/controller/aiStatus/view/delivery，可含 controllers、events、assetBinding、cues；status 为 active/finished/aborted。view 按游戏 schema 解析，不是完整 State。

controllerType 对真人只允许 human/model；model 必须指定本人的 profileId。协议保留 script 以支持专用 bot 和历史兼容，真人不能据此启用脚本托管。

回执 data 为 { outcome:'accepted', requestId, appliedRevision } 或 { outcome:'not_found', requestId }。相同动作成功重试返回原结果，不重放 live 事件；不同内容复用 ID 返回 REQUEST_ID_CONFLICT。超时后用原 ID、原内容恢复，不能盲目新建请求。

## 本人资料：需要会话

| 方法 | 路径 | 请求 / 响应 |
| --- | --- | --- |
| GET | /profile | 本人 id/username/displayName/avatar/bio/createdAt |
| PUT | /profile | { displayName, avatar, bio }，返回保存后的资料 |
| GET | /profile/matches | before 为本人对局 UUID；{ items, nextCursor }，每页 20 |

昵称 trim 后 1–32 字，bio 最多 300 字。avatar 为 dice/leaf/cat/rocket/star/coffee，不接收外部 URL。历史仅显示本人固定参与过的对局概要。

## 模型设置：需要会话，所有者为本人

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /model-endpoints | 可选端点目录，仍需要登录 |
| GET | /me/model-settings | { credentialsAvailable } |
| GET / POST | /me/model-profiles | 本人配置列表 / 创建配置 |
| PATCH / DELETE | /me/model-profiles/:id | 编辑 / 软删除并撤销凭证 |
| PUT / DELETE | /me/model-profiles/:id/credential | { apiKey } 替换 / 撤销密钥 |
| POST | /me/model-profiles/:id/test | 显式连接测试，返回 attemptId/status/kind |

创建字段 name/endpointId/modelId，以及可选 baseUrl/parameters/enabled/apiKey；parameters 支持 temperature 0–2、maxOutputTokens 16–512。编辑增加 expectedVersion，采用完整编辑字段；apiKey 省略表示保留，端点地址变化必须重新提供密钥。活跃模型绑定期间拒绝编辑或删除。列表只显示 has_credential，不返回密钥。

## 资源与管理员接口

GET /assets/contracts、/assets/versions?gameId=...、/assets/versions/:id、/assets/files/:id 均需要登录。媒体文件先鉴权后处理 ETag，按精确发布版本读取。

下列接口要求 administrator 角色，写入也保留 Origin/CSRF：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET / POST | /admin/assets/drafts | 列表 / 创建草稿 |
| GET / PATCH / DELETE | /admin/assets/drafts/:id | 读取 / 编辑 / 删除草稿 |
| GET / POST | /admin/assets/drafts/:id/files | 文件列表 / 上传 |
| POST | /admin/assets/drafts/:id/validate | 校验 |
| POST | /admin/assets/drafts/:id/publish | 发布不可变版本 |
| GET | /admin/assets/versions | 管理版本 |
| POST | /admin/assets/versions/:id/archive | 归档 |
| DELETE | /admin/assets/versions/:id | 有引用保护的删除 |

草稿编辑使用 manifestText；发布使用 requestId/expectedDraftRevision/contentHash。媒体上传为原始正文，提供 X-Request-Id、X-File-Name（URI 编码显示名）、X-File-Size、X-Content-SHA256 和正确 Content-Type。详细 DTO 请读取 [资源协议源码](/developer-sdk/packages/protocol/src/assets.ts) 与 [客户端资源接口](/developer-sdk/packages/client-sdk/src/assets.ts)，不能把此索引当成省略字段即可提交的示例。

## 常见错误处理

| 错误 | 处理 |
| --- | --- |
| VALIDATION_ERROR | 修正字段与 schema |
| UNAUTHENTICATED / AUTH_INVALID_CREDENTIALS | 恢复或重新建立会话 |
| FORBIDDEN | 当前身份无权限，不能伪造 seat 重试 |
| STATE_CONFLICT / ROOM_CONFIG_CHANGED / CONTROLLER_CONFLICT | 拉取权威快照后重新决定 |
| REQUEST_ID_CONFLICT | 原 ID 只能关联原请求内容 |
| ACTION_NOT_ALLOWED / CONTROLLER_NOT_HUMAN | 校验当前合法动作与控制权 |
| GAME_VERSION_UNAVAILABLE / RECOVERY_BLOCKED | 恢复精确代码版本或存档兼容性 |
| RATE_LIMITED | 遵守 Retry-After，减少请求 |
| SERVICE_UNAVAILABLE | 恢复连接；先确认待提交动作结果 |

不要依赖错误 message 的文本做程序分支。使用 code，记录必要 traceId，不记录密码、session、CSRF、邀请码、模型密钥或秘密视图。
## 好友社交接口（2026-10-03）

编辑、搜索与申请的 friendId 接受可选单个 `@`（例如 `@RST307`），标准化为 `rst307`。DTO 和持久化继续无前缀，展示/复制使用 protocol 的 `formatFriendId`。新账户默认短用户名，冲突加短后缀；内部 UUID 和登录身份不变。

所有以下路径均以 `/api/v1` 为前缀且需 session；写请求保留 Origin 和 CSRF，UUID requestId 对内容去重，响应 no-store。好友 ID 可变，内部账户 UUID 和登录用户名不变。

- GET `/social`：好友 ID/revision、申请、好友/未读和最近 50 条邀请。
- GET `/social/search?friendId=...`：精确查找活跃用户的非秘密头像/昵称/ID 投影。
- PUT `/social/id`：requestId、friendId、expectedRevision。
- POST `/social/requests`：requestId、friendId。
- POST `/social/friends/:id`：requestId、expectedRevision、accept/reject/cancel/remove action。
- GET/POST `/social/friends/:id/messages`：before UUID 分页读取最新/更早 30 条，或 requestId/text 发送文字；双方须为好友。
- POST `/social/friends/:id/read`：requestId/messageId，同会话单调水位。
- POST `/rooms/:id/friend-invitations`：requestId/friendAccountId/expectedRoomRevision。
- POST `/social/invitations/:id`：requestId、accept/reject action、可选 password；本人接收邀请，在原房间事务检查状态/密码/容量并加入。

共享 `social.ts` 已进入 SDK 源码下载。私聊不是游戏事件，不通过 room/match WS 广播；前端可见时每 5 秒认证读取，网络恢复重新同步。
