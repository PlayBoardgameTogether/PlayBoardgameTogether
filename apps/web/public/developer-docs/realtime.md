# WebSocket 与恢复

## 临时故障与重连

确认会话失效使用 WS 关闭码 4001；临时数据库/服务不可用使用 1013，重新鉴权、订阅并读取本人完整快照即可恢复。升级握手阶段分别返回 HTTP 401/503。只有确实失去访问权才发送 subscription.revoked，不把临时故障当成退出登录或成员撤销。

客户端应指数退避并加入随机抖动，仅在收到有效订阅快照后重置；HTTP 成功不能证明 WS 已恢复。平台房间/对局退避上界分别为 10/15 秒，实际等待为上界的 50%–100%。重连前保留原待确认动作并查询回执，不以新编号盲目重发。

正式地址 /api/v1/ws/session，通过 session cookie 和 Origin 认证。/api/v1/ws 仅用于公开诊断 ping/pong，不发送私人对局数据。

## 建立连接与订阅

```typescript
const url = new URL('/api/v1/ws/session', location.href);
url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(url);
socket.addEventListener('open', () => {
  socket.send(JSON.stringify({
    protocolVersion: 1,
    type: 'room.subscribe',
    roomId,
  }));
});
// 页面卸载时调用 socket.close()，并清理自己设置的计时器和监听器。
```

示例需要先登录且为 roomId 的成员。订阅返回 room.snapshot；房间有 activeMatchId 时还会发送本人的 match.snapshot。session.ready 表示认证连接已建立。

## 客户端消息

| type | 字段 |
| --- | --- |
| room.subscribe | protocolVersion:1、roomId（UUID） |
| room.unsubscribe | protocolVersion:1、roomId（UUID） |
| ping | protocolVersion:1、requestId |

每连接最多订阅 10 个房间，每秒最多 10 条消息。不要将游戏动作直接发送到诊断 WS；正式动作通过 HTTP /matches/:id/actions 提交。

## 服务端消息

| type | 含义 |
| --- | --- |
| session.ready | 会话连接就绪 |
| room.snapshot | roomId、roomRevision、完整 snapshot |
| room.presence | 独立 presenceSeq 的在线状态 |
| match.snapshot | matchId、revision、本人完整 snapshot |
| room.closed | 房间关闭通知 |
| subscription.revoked | 订阅权限撤销 |
| pong | 对应 requestId 的心跳响应 |
| error | 协议错误码 |

从 unknown JSON 开始解析，使用 @boardgame/protocol 的实际消息 schema；未知消息不能被强制断言为完整快照。session 在订阅、消息处理和投递时持续校验，失效会断开。

## 版本合并

- roomRevision 管理房间业务，不接受更旧的房间快照。
- presenceSeq 管理在线状态，不能当作 roomRevision。
- match revision 管理权威游戏状态，不接受更旧的游戏快照。
- controllerVersion、aiStatusVersion 独立更新，即使游戏 revision 相同也可能改变。
- 结算时 finished 对局和 waiting 房间分别按自身版本合并，不依赖先后到达。

游戏事件仅消费 delivery=live 且已投影的事件，按 eventId 去重。initial/resync/receipt 不重播事件音效。旧请求的回执 View 不一定是最新游戏视图。

## 断线与待确认动作

断线不是退出，不释放座位、不转让房主、不自动开启 AI。重新认证、重新订阅并 GET 本人 MatchView；平台现有客户端还以周期权威读取收敛漏广播。

动作结果未知时，先查询本人回执；仍未知则使用原 requestId、原内容重试。刷新前保留待确认动作；确认前暂停新决定。不能重放过期 revision 或 controllerEpoch。

对局结束后房间恢复 waiting，订阅不会继续补发上一局 snapshot；历史结果通过原 matchId 的 REST 接口读取。恢复不能调用 setup 重建状态。

离开页面时清理连接、订阅、定时器和重试。当前 presence 与广播在单 API 进程中管理，不将它视为多副本高可用协调机制。
