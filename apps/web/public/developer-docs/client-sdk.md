# 客户端 SDK

## 超时与取消

通用 HTTP 请求默认 30 秒，二进制上传（含服务端校验）为 120 秒，覆盖响应正文读取。既有对局、回放及消息发送等 10 秒期限保持，以较早的取消/超时为准。`api.me(signal?)`、`api.room(id, signal?)`、`api.matchSnapshot(id, signal?)` 接受页面 AbortSignal；正常完成或失败后会释放默认期限和调用者取消监听。

超时抛出 `TimeoutError`，主动取消抛出 `AbortError`。SDK 不自动重发写请求；动作超时仍可能已经提交，继续使用原 requestId 查询回执或重试，不能换编号。页面离开时可取消读取，防止旧请求继续占用资源。

## 公共聊天

恢复 session 后通过 `api.publicMessages(before?, signal?, after?)` 读取公共历史；before/after 互斥，nextCursor 非空时按对应方向继续。`api.sendPublicMessage({requestId,text})` 保存公共发言并返回包含公开 sender 的消息。两者使用共享 schema 解析响应，发送也校验输入，沿用同源 cookie/CSRF。确认丢失时保留相同 requestId 和正文重试，不能每次生成新编号。

`api.requestFriend({requestId,friendId,expectedAccountId?})` 可绑定名片目标账户，好友 ID 已变化/复用时返回冲突，刷新后重新选择；旧调用继续可用。公共及私聊表情均保存为纯文本，使用固定 `[微笑]` 等码或 Unicode Emoji；第三方客户端可保留文字码，不执行 HTML。

## 游戏接入申请

登录后调用 `api.submitGame({ requestId, gameId, version, name, description, repositoryUrl })` 提交纯资料申请；`api.gameSubmissions(before?)`、`api.gameSubmission(id)` 读取本人申请。管理员使用 `adminGameSubmissions(before?)`、`adminGameSubmission(id)`、`reviewGameSubmission(id, { requestId, expectedRevision, status, reviewNote })`。所有这些方法在边界校验请求与响应，不接受任意泛型断言。reviewed 只表示资料审阅，不能安装或执行游戏；字段、配额和示例见 [添加游戏](/developer-docs/add-game.md)。

包：@boardgame/client-sdk，当前版本 0.1.0。ApiClient 默认基址 /api/v1，使用同源 cookie；登录或 me 响应中的 CSRF token 会用于后续写请求。ApiError 提供 code、message、retryable、traceId。

## 登录与创建房间

```typescript
import { ApiClient, ApiError } from '@boardgame/client-sdk';

const api = new ApiClient();
// username/password 来自用户输入，不硬编码或写入日志。
await api.login(username, password);
// 页面刷新后先恢复 session 和 CSRF：
await api.me();
const created = await api.createConfiguredRoom({
  requestId: crypto.randomUUID(),
  name: '开发者测试房间',
  gameId: 'color-match',
  version: '1.0.0',
  options: {},
  seatCount: 2,
  visibility: 'private',
});
// created.roomId 可用于继续读取房间。
// created.inviteCode 只按一次性显示语义提供给用户，不能写入日志。
```

示例要求已有账户、数据库已安装对应游戏，账户未超过建房配额。普通用户可通过 `/register` 注册，或调用 `api.register({ displayName: '桌游玩家', userId: '@rst307', password })` 后再 `api.login('rst307', password)`；密码 6–128 位且包含字母和数字。管理员账户仍通过维护命令创建。

## 优先使用解析响应的方法

| 方法 | 用途 |
| --- | --- |
| createConfiguredRoom(input) | 共享 schema 校验的建房请求和结果 |
| lobby(query) | 公开房间分页，仍需要登录 |
| gamePresentations() | 无需登录读取 schema 解析后的游戏展示配置 |
| saveGamePresentation(id, version, input) | 管理员保存图标/封面/背景地址，使用 expectedRevision 防止覆盖他人修改 |
| joinPublicRoom(id, input) | 加入公开房 |
| gameRules(id, version) | 精确游戏版本规则说明 |
| matchSnapshot(id) | 解析本人权威快照 |
| submitMatchAction(id, body) | 提交动作并解析结果 |
| matchCommandReceipt(id, requestId) | 查询本人的动作回执 |
| setMyController(id, body) | 主动模型托管或收回 |
| profile() / saveProfile(input) / matchHistory(before) | 本人资料与参与历史 |
| modelProfiles() 与模型配置方法 | 管理本人模型设置与凭证 |
| assets | AssetClient 资源管理与读取 |

login、me、logout、rooms、room、createRoom、joinRoom 和 matchView 已绑定共享响应 schema，不再接受调用方泛型。只有校验成功的登录/me 响应才能更新 SDK 的 CSRF token。games 和开发实验台旧方法仍需将外部数据作为 unknown 并用共享或游戏 schema 解析。

房间操作使用有类型的命令对象，替代原 `roomCommand(id, path, method, body)`：

```typescript
const room = await api.room(roomId);
await api.roomCommand(roomId, {
  type: 'ready', requestId: crypto.randomUUID(),
  expectedRoomRevision: room.roomRevision, ready: true,
});
```

支持 seat/unseat、ready、config、assets、invite、start、leave、close、host、add-bot/configure-bot/remove-bot。机器人命令带 seatId，新增/编辑带 settings（脚本 policyId 或模型 controllerType/profileId）。SDK 负责选择固定 URL/HTTP method、移除本地 type/seatId/settings 包装并校验输入与各操作响应；HTTP 格式、会话身份、revision 与请求去重语义保持。

## 提交正式动作

```typescript
const snapshot = await api.matchSnapshot(matchId);
const command = {
  requestId: crypto.randomUUID(),
  expectedRevision: snapshot.revision,
  expectedControllerEpoch: snapshot.controller.controllerEpoch,
  action: { type: 'draw_card' },
};
try {
  const result = await api.submitMatchAction(matchId, command);
  // 仅按版本合并 result，不能让旧重试响应覆盖更新快照。
} catch (error) {
  if (error instanceof ApiError) {
    // 根据 error.code 展示反馈，traceId 用于定位，不记录秘密输入。
  }
  throw error;
}
```

draw_card 是 Color Match 示例，不是通用游戏动作；必须在本人当前 View 允许摸牌时调用，服务端仍会验证。业务动作体不传 seatId 或 automation 标记。

## 超时与重试

动作超时可能已经提交。保存原 command，暂停新动作，先查 matchCommandReceipt；accepted 表示已提交，应拉取最新快照。not_found 仍可能有执行中的事务，需要以原 requestId 和完全相同内容重试，不能生成新 ID 再次执行同一决定。

STATE_CONFLICT、ROOM_CONFIG_CHANGED 和 CONTROLLER_CONFLICT 需要刷新权威数据并重新决定。retryable=true 不代表可以盲目重放过期决定。会话失效应重新登录。源码提供请求能力，应用仍需管理连接、订阅、待确认动作和生命周期。

SDK 的 credentials=same-origin 面向同源浏览器应用；自定义 base 不代表任意跨域应用已获准访问。服务端的 Origin、cookie 和 CSRF 约束继续生效。
