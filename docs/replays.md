# 对局回放

在「我的资料 → 对局记录」选择已结束或中止的对局，点击「查看回放」。进行中记录仍是「继续对局」。已结束对局桌面中的「对局工具」也提供入口。

棋桌保持游戏自己的样式，底部支持逐步查看、跳到开头/末尾、拖动进度及自动播放，速度为 0.5×、1×、2×、4×。播放到末尾自动停止，再点播放从可用起点开始。刷新返回最早可用帧。回放是只读且静音的局面切换，不重放移动或计分动画；不能发送正式动作。

只有原对局参与者可以读取自己的历史视角。对手手牌、私密预留、同时选择等仍按该步的原投影隐藏，房主也没有额外读取权限。不开放公开分享、旁观或切换其他玩家的秘密视角。

升级执行 `pnpm db:migrate` 应用 029，加载新版 API/Web。新对局从 revision 0 完整保存，真人、脚本 AI、模型 AI 和在线 ZIP 均沿用原提交事务。失败动作不生成存档，重复成功重试不增加步骤。

旧局只能从迁移时当前局面开始；页面显示可用起点。无法恢复更早过程，因为旧数据没有完整初始 State 和每一步多视角存档。游戏原精确规则版本缺失或摘要不符会明确阻塞，不替换成最新版。原图包绑定继续保留，图片暂不可用时显示游戏默认画面。

存档随对局保留，包含服务端秘密 State 和内部事件，不能作为公开数据导出；响应仅含投影后的本人 View 和事件。完整帧的存储空间随动作数量和 State 大小增长，当前没有压缩或独立清理策略。部署与备份应保留数据库、原游戏版本和图包。

## 协议

GET `/api/v1/matches/:id/replay?revision=N` 要求活跃 session 和固定参与者身份。不存在/非参与者统一 MATCH_NOT_FOUND/404，active 对局 ACTION_NOT_ALLOWED/422。严格 query 只允许可选非负整数 revision（最大 2147483647），省略取最早可用帧；无此步骤 VALIDATION_ERROR/400，版本/存档不兼容 RECOVERY_BLOCKED/503。响应 no-store，不续期房间。

共享 matchReplaySchema 返回 matchId/gameId/gameVersion、整局 finished/aborted 状态、firstRevision/lastRevision/revision、seatIndex、actorSeatId（初始或旧局补帧为 null）、recordedAt、公开 players、assetBinding、本人 view 和经 projectEvents 投影的 events（稳定 eventId）。不返回 State、原始动作、内部事件、RNG、凭据或其他座位 View。client-sdk 的 matchReplay 解析请求与 unknown 响应。

## 存储与扩展

029 新增 match_replay_frames，主键 (match_id, revision)，对局删除级联删除；保存服务端 state、步骤 status、internal_events、可空 actor_seat_id、created_at。matches INSERT / UPDATE OF state,revision 触发器在原事务保存一次状态帧，重复同 revision 不覆盖。真人/自动动作在原 matches 事务附加内部事件及行动座位；后续 action/receipt/commit 故障一并回滚。控制权变化不生成步骤。

MatchService.replay 在只读 REPEATABLE READ 事务中读取身份、范围、帧与公开参与者，通过原精确 registry 扩展 deserialize/getView/projectEvents 投影，不重新执行规则。Web 的 `/matches/:id/replay` 按需加载 ReplayPage，复用 clientGame/PackageBoard，宿主阻止输入、禁用原生控件、丢弃动作且无 live 音效授权。连续前进保留桌面，跳转重建内置桌面，在线包始终保留 iframe。读取下一步时保留当前局面与步骤说明，完成后一起更新，仍以 aria-busy 表达读取状态。读取世代忽略迟到请求，卸载清理播放/观察定时器，不缓存视图到本地存储。

## 回放动画（2026-10-11）

以上“内置桌面每步重建”是初版行为；现在连续「下一步」和自动播放保留桌面实例，传递该步本人投影事件，让开发者已有动画完整呈现。跳转、倒退及重新开始不传表现事件；内置桌面重置，在线包保持 iframe 并收到 replay.animate=false。读取期间仍保留上一帧。

连续前进时平台传 busy=false，让旧桌面按原有 View/事件逻辑播放动画；只读保护由宿主拥有，busy 不代表动作授权。平台观察有限 CSS/Web Animations 和 DOM 变化，等待动画及最后一次变化后 500ms 的稳定窗口；观察最长 60 秒，忽略无限装饰动画，卸载/跳转清理。不读取完整 State、不执行规则、不合成动画。GameBoard 第八个可选参数 ReplayPresentation 的 hold(durationMs) 可补充平台无法推断的特殊序列时长，接受有限 1–60000ms，过期步骤回调无效；它不是普通游戏动画的接入前提。

在线包的 desktop?replay=1 响应在原不透明 sandbox/CSP 内加入平台观察及输入拦截包装，数据库中的 HTML、包 hash、规则/内容版本保持不变；普通 desktop 响应不变。旧拉密 1.0.3 和未修改的花砖桌面直接播放原有动画，无需新 ZIP。上一方案的拉密 1.0.4 改动已撤回，旧局继续使用原精确版本即可。

自动观察适用于 CSS/Web Animations 和连续 DOM 变化；任意 Canvas/WebGL、自定义长空白延迟或仅存在于用户点击处理器、未响应 View/事件的动画，平台不能从历史局面可靠推断。开发者可选用 hold 或 boardgame:replay-animation 补充时长，平台仍不重放原始秘密动作或声称能自动恢复任意前端程序的内部状态。
