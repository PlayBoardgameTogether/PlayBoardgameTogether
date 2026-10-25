# 认证与账户管理

## 注册邮箱验证（1.0.0）

新网页注册必须填写邮箱并输入邮件中的 6 位数字验证码。先调用 `POST /api/v1/auth/register/email-code`，再将 email、challengeId、emailCode 与原注册字段一起提交 `/api/v1/auth/register`。邮箱 trim/lowercase，最长 254 字；每个邮箱限一个注册账号。未验证前不创建 accounts/session，也不能登录。既有账户和维护 CLI 账户不追补邮箱，登录、房间及会话权限保持原实现；邮箱不加入公开账户 DTO，也不作为登录名或密码找回入口。

验证码 10 分钟内有效，每次最多输错 5 次；同一邮箱至少间隔 60 秒、每小时最多申请 5 次（含发送失败）。重发替换旧 challenge，验证码仅存 Argon2id 哈希。错误次数持久化；错误提交会提交次数，成功时核销 challenge 与创建账号同事务，失败插入回滚核销。验证码请求和注册分别每 IP 每分钟最多 5 次，单进程有界限流；邮箱限额在数据库串行化，重启不清零。挑战表最多保留 10,000 个近期邮箱，申请时清理一小时前的记录；不为发信持有数据库事务。

管理员从「管理员后台 → 系统维护 → 邮件设置」(`/admin/mail`) 填写 SMTP 公网域名、465/TLS 或 587/STARTTLS、SMTP 账号、发件邮箱及授权码，勾选启用并保存，立即用于后续注册邮件，无需重启。授权码留空保留，修改服务器/端口/账号时须重新填写；可关闭发信并清除授权码。填写测试收件邮箱后发送测试邮件（全平台每分钟一次），以实际收件确认投递，服务端受理不等于到达收件箱。未保存的修改不能测试，避免误测旧配置。

后台凭据使用现有 `MODEL_CREDENTIALS_KEY` 平台加密主密钥进行 AES-256-GCM 加密，独立 AAD，随机 nonce；读取仅返回 hasPassword，不回显授权码、密文或加密参数。管理员回执只保存 HMAC 指纹与脱敏结果。主密钥需由维护者在私有服务器环境一次性配置为 32 字节 Base64；已有值必须沿用，不能为启用邮件另行覆盖，数据库和该密钥必须一并备份。缺失时后台会提示，拒绝保存授权码。测试邮件先提交回执再连接 SMTP，同 requestId 只发送一次；进程中断可能保留 sending/结果未知，不能自动补发，可先检查收件箱，再刷新页面决定是否另建测试请求。

发信使用 Nodemailer SMTP，只允许公网服务器，解析后固定 IP 并以原域名校验证书，拒绝私网/回环地址。没有后台配置行时，兼容读取以下旧服务端私有环境变量；一旦后台保存，停用或清除也不会自动回退到旧环境密码。不要向聊天、仓库或日志提供授权码：

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=sender@example.com
SMTP_PASSWORD=由邮箱服务提供的SMTP授权码
SMTP_FROM=sender@example.com
```

465 使用直接 TLS；587 使用 `SMTP_PORT=587`、`SMTP_SECURE=false`，仍强制 STARTTLS 并校验证书，不支持明文发信。发件地址须是供应商允许的地址；按服务商要求完成域名和发信身份验证。只有使用旧环境回退或首次加载平台主密钥时，才需按原维护流程重启 API/更新监督进程加载环境；后续后台 SMTP 修改无需重启。缺项、连接、认证或投递拒绝一律返回 SERVICE_UNAVAILABLE/503；不返回验证码、不伪造发送成功、不回退到免验证注册。

迁移 `035_registration_email.sql` 为账户增加私有邮箱/验证时间和唯一索引，新增临时挑战表；`036_registration_mail_settings.sql` 保存后台配置及测试发送配额。保留旧账户 null 值。前后端必须成对更新，新 API 拒绝旧三字段注册。此次属于公开注册契约不兼容变更，用户明确授权平台 `0.18.2 → 1.0.0`；上线后由管理员配置真实 SMTP 并验收收件，完成前新注册不可用。以下日期章节记录原有行为，以本节为准。

## 公开注册（2026-10-03）

`/register` 提供用户名（displayName，trim 后 1–32 字，支持中文）、用户 ID（userId，例如 `@rst307`）和密码/确认密码。ID 接受可选单个 @，trim 后规范为 lowercase ASCII 字母/数字/下划线，名字部分 3–32 位；同一 ID 写入不可变登录名 username_canonical 和初始 friend_id。已有登录名或好友 ID 被占用均明确拒绝，不追加后缀。后续修改好友 ID 不改变登录 ID。

新注册密码 6–128 个 JavaScript 字符单位，至少一个 ASCII 字母和一个数字，允许符号、空格，不 trim；确认密码仅由浏览器核对，不发送到 API。既有账户和 CLI 密码策略不变，不强制旧账户改密。登录接受带/不带 @ 的 ID，原用户名继续可用。

POST `/api/v1/auth/register` 严格 JSON `{displayName,userId,password}`，4 KiB 上限，无 session 要求但必须来自配置的精确 Origin。返回 201 与 `{username,displayName,friendId}`；不创建会话，注册页只把非秘密 ID 放入导航状态并返回登录页。账户角色固定 user、状态 active，不接受 role/status/accountId 等额外字段。Argon2id hash 在服务端计算，账户及指定好友 ID 在与社交编辑共享 advisory lock 的单事务中保存；失败回滚，唯一约束处理并发注册。复用 STATE_CONFLICT 表示 ID 占用，不返回秘密字段。

注册按 IP 限制每分钟 5 次尝试（含成功及校验失败），限流 map 最多 1024 个有效 IP 桶；到期请求惰性清理，不增加计时器。超限 RATE_LIMITED/429 与 Retry-After: 60。此为单 API 进程保护，重启清零。所有认证响应继续 no-store。不提供邮箱/短信验证或密码找回。

## 好友 ID（2026-10-03）

022 增加可由管理员配置的修改间隔（默认 30 天，0 不限，最大 3650）；首次自定义不受限，后续从上次成功修改时间计算。服务端在同一社交写事务内强制冷却，identity 返回当前规则/下一可修改时间/可修改状态。失败、原请求重试或相同 ID 保存不重置计时；旧显式修改时间从回执补齐，默认 ID 自动迁移不计入。详情见 [社交功能](social.md)。

补充：好友 ID 现在以 `@rst307` 展示和复制，可输入带或不带 `@` 的自定义名字。021 将未修改过的长默认 ID 换成用户名形式，重名加短后缀，保留已自定义 ID；新账户也采用短默认名字。`@` 不计入名字的 3–36 位限制，数据库身份和登录名不变。

新增可修改的公开好友 ID（3–36 位 ASCII 字母/数字/下划线，大小写不敏感且唯一）。本人在 `/profile` 或 `/friends` 修改、复制，通过社交模块的 expectedRevision/requestId 事务保存；内部账户 UUID 和登录用户名不变。好友关系及私聊按 UUID 绑定，修改后旧 ID 可被其他用户使用。旧下方“账户 ID、用户名只读”继续指内部身份；好友 ID 是新增的查找入口。详见 [社交功能](social.md)。

## 后台账户管理（2026-10-03）

管理员在 `/admin/accounts` 搜索并分页读取账户概要，可启停普通账户；角色和管理员账户生命周期继续由维护者管理，界面不能自行提权或停用管理员。停用在同一事务更新状态、撤销全部 session、记录非秘密回执并发送既有 PostgreSQL 撤销通知；启用不恢复历史 session。Origin/CSRF/session/role 在路由校验，写事务重新验证活跃管理员和未撤销 session。019 的状态 revision 触发器同时覆盖 CLI 写入。操作入口与限制见 [管理指南](admin.md)。

## 登录界面与握手恢复（2026-10-02）

登录表单默认隐藏密码，可手动显示/隐藏；请求期间锁定表单并阻止重复提交。凭据错误保留统一账户错误，频控和网络/服务失败分别给出可操作提示，不输出原始异常。页面卸载后收到登录回复不再导航到旧页面。

MatchPage 对非 4001 的 WS 断线也通过既有认证 HTTP 快照复核会话。服务端可能在升级握手阶段拒绝过期 cookie，客户端没有机会收到 4001；复核 UNAUTHENTICATED 后清除旧 View 与待定请求并停止安排重连。服务端 Origin、CSRF、session 和成员校验均不变。

## 个人资料（2026-10-01）

登录用户在 `/profile` 编辑昵称、六种内置头像和最多 300 字简介，账户 ID、用户名和加入时间只读。资料持久化在 accounts，保存使用现有 Origin/CSRF/session 边界；不提供其他账户资料写入接口。对局记录按固定 match_participants 的账户身份读取，包含 active/finished/aborted；加入房间但未参与开局不计为对局。资料目前只在本人页面展示，未新增头像上传或公开社交主页。

## 管理命令

密码只能由 stdin/提示输入，不接受密码命令行参数。

```powershell
$secret = Read-Host 'Password (12–128 characters)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | pnpm account -- admin:init admin 管理员
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | pnpm account -- account:create player_a 玩家A
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | pnpm account -- account:reset-password player_a
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}
pnpm account -- account:disable player_a
pnpm account -- account:enable player_a
```

用户名大小写不敏感，允许 3–32 位 ASCII 字母、数字和下划线。密码 12–128 个 Unicode 字符，不 trim。CLI 只接受 stdin 密码，不在终端回显。重置密码和停用账户撤销该账户全部 session，并通过 PostgreSQL 通知在线 API 断开对应 WS；连接还会每 5 秒复核会话。

## 会话与浏览器安全

- session token 为 32 字节密码学随机值；数据库只保存 SHA-256 摘要。
- 密码使用 Argon2id，依赖 `argon2` 的安全默认参数，编码参数随 hash 保存。
- session 默认绝对有效 7 天；cookie 为 HttpOnly、SameSite=Lax、Path=/，生产应设置 `COOKIE_SECURE=true` 并使用 HTTPS。
- 所有浏览器写请求检查精确 `WEB_ORIGIN`；受保护写请求还要求会话绑定的 `X-CSRF-Token`。
- 登录失败按 IP 和 canonical username 单进程限流；重启会清零。
- token 不进入 URL、localStorage、日志或 WS query。响应不包含 password hash 或 session token。
