# 游戏扩展 SDK

## 统一回放（2026-10-04）

内置和在线 ZIP 扩展自动接入回放，无需额外规则接口；平台通过原精确版本 deserialize/getView/projectEvents 保持本人历史视角。宿主负责禁用交互、丢弃 onAction 且不提供 live 音效授权。连续前进支持原有计分/移动动画，平台处理兼容和播放等待，见下方“回放动画”。详见 [回放](replays.md)。

## 可选玩家名称（2026-10-04）

Web GameBoard 第七个可选参数 playerNames 为公开 seatId→displayName 映射，来自身份化 MatchView.players，独立于规则 View。扩展可用 @boardgame/game-sdk/presentation 的 PlayerNames 与 playerLabel 显示昵称，本人附加「（你）」；未提供名称时保留匿名标签，教程和图包预览不需要账户。花砖物语及璀璨宝石在玩家区、等待/先手提示、公开行动与结算中消费此参数。规则身份仍来自服务端 session 和固定 participant，名称不能授权动作。

## 在线 ZIP 适配（2026-10-03）

管理员可在线安装 boardgame-package-v1，自包含 server.js 声明 game 并实现现有同步 JSON GameExtension，client.html 通过 iframe 消息桥收取本人 View 并提交动作。规则契约、确定性 RNG、投影和正式事务继续复用；不接受 Node.js imports/require 或普通源码 ZIP。v1 可选 getDecisionContext 接入基础脚本/模型 AI，可选 game.json.presentation 内嵌 PNG 展示图；不装配平台图包/音效或教程；完整限制与可玩模板见 [在线游戏 ZIP](../apps/web/public/developer-docs/game-packages.md)。

## 客户端终局展示（2026-10-03）

Web `clientGames` 注册项可选 `finishBehavior: 'stay'`。声明后 MatchPage 在 active → finished 时保留最终身份化 View 和 live 投影事件，游戏可以播完计分/奖励；玩家用已有「返回房间」按钮主动离开。未声明的游戏维持自动返回行为。该项只是客户端表现策略，不改变服务端结算、房间 waiting 复位、权限、协议或版本锁。花砖物语使用此项；平台不按 gameId 添加规则分支。

客户端可通过 `game-sdk/assets` 的 `PresentationAudioPort(eventId, cueId, key)` 请求动画节拍音效。Web 注册项设 `boardAudio: true` 后，GameBoard 第六个可选参数接收此端口，原即时 cue 播放由桌面替代；每个移动/得分节拍须使用稳定且不同的 key。平台只授权本页已接受且可播放的 WS live 事件，按事件/音效/键去重，静音、断线、后台、主控变化和卸载使旧授权失效。端口缺失（如教程）时保持静音；游戏不能创建独立音频播放器、从快照推断音效或将请求失败当成动作失败。



## 回放动画（2026-10-11）

平台连续前进时保留桌面、传递本人投影 events 和 busy=false，让旧游戏的原有动画代码执行；平台观察 CSS/Web Animations 和 DOM 变化来等待结束，无需升级游戏。初始化、倒退和跳转不传表现事件并保留 busy=true。宿主拦截输入、禁用控件并丢弃动作，busy=false 不授予动作权限。

第八个可选参数 `@boardgame/game-sdk/presentation` 的 `ReplayPresentation`：`{id,animate,hold(durationMs)}`，仅供 Canvas/WebGL 或较长自定义空白延迟等无法自动观察的序列补充 1–60000ms 时长。id 标识当前呈现，过期回调无效；手动跳转允许中断，扩展清理自己的计时器和动画。不提供 audio 端口、不执行规则或提交动作、不传完整 State。在线 ZIP 接入见 [包格式](../apps/web/public/developer-docs/game-packages.md)。

## 可选交互教程（2026-10-03）

`@boardgame/game-sdk/tutorial` 提供 `GameTutorial`、`TutorialStep`、`TutorialFrame`、`TutorialActionResult` 与进度函数。教程独立于服务端 `GameExtension` 与 manifest；开发者可以不编写，有教程才显示详情入口。教程绑定精确版本，不自动降级或使用最新版。

- `GameTutorial`：标题、简介与非空的 `steps`，步骤 ID 必须唯一。
- `TutorialStep`：`id/title/instruction`、固定 `initial: { view, events }`、可选 `focusArea`（桌面区域的 aria-label）和 `onAction({ action, frame })`。
- 回调先用游戏 schema 解析 unknown；未达教学目标返回 `{ accepted: false, feedback }`；成功返回 `{ accepted: true, frame, complete, feedback }`。允许多次操作完成一课，例如先出数字 5 再确认目标。
- `startTutorialStep` 克隆初始帧；`applyTutorialAction` 隔离回调输入，拒绝操作保留原帧，完成后忽略重复操作。完成当前课后由玩家主动点击下一步。

在游戏 client 入口导出教程，再在 `apps/web/src/game-registry.tsx` 的 `clientTutorials['gameId@version']` 注册异步 loader。已有 `clientGame` 的 GameBoard 会直接绘制练习 View 并收取本地 onAction，不需要平台理解游戏动作。完整实例见 `games/color-match/src/client/tutorial.ts`。

只提供公开固定场景与投影格式事件，禁止嵌入真实对局完整 State、他人秘密、session 或密钥，禁止调用正式动作 API 或把练习当真实成绩。教程不是一套正式规则执行器；固定结果必须用测试与真实游戏规则对照。当前支持单人分步练习、重试/上一步/重新开始，无账号进度保存、教程编辑器或自由练习对局；刷新从头开始。

扩展实现 `GameExtension<State, Options, Action, View, InternalEvent, PublicEvent>`，包含 manifest、options/action 运行时校验、setup、玩家视图、动作说明、服务端校验与转换、事件投影、结局、序列化、恢复和 AI 合法兜底。支持脚本 AI 的扩展另实现 `getDecisionContext`，返回当前座位的稳定 decisionKey 与完整合法候选；无行动需求返回 null。若同一快照可以等待多个席位，再实现可选 `MultiActorDecisionRequests<State>`，返回所有 `{seatId, decisionKey}`。这只描述需求，不替代 revision、参与者身份或 controller epoch 授权。

State 只在服务端存在；View 是面向一个身份单独构造的类型。内部事件必须经 `projectEvents` 过滤后才能发给客户端。动作列表用于交互提示，不替代 `validateAction`。

随机只使用 `DeterministicRng` 的 `nextInt`；存档保留 `mulberry32-v1` 状态。失败转换不得提交状态或 RNG。

新增可信扩展步骤：

1. 建立独立包，拆分 shared/server/client 导出。
2. 用 `manifestSchema` 校验 manifest，并声明 SDK 兼容范围。
3. 服务端只在 `apps/api/src/registry` 注册 server 入口。
4. 前端只在 `apps/web/src/game-registry.ts` 注册 client 入口。
5. 运行投影、非法动作、确定性、序列化和边界测试。
6. 升级版本后运行 `pnpm games:sync`；不得改写已安装同版本含义。

## Grid Garden 多行动者示例

`games/grid-garden` 在 selecting 阶段为每个尚未提交的 seat 返回 `round:N:select`，在 placing 阶段为每个尚未落子的 builder 返回 `round:N:place`。平台调度器枚举这些需求，但同局一次只执行一个自动任务。扩展的 `getDecisionContext` 仍按单一 viewer 生成合法候选，脚本、模型与 fallback 共享这些动作。

秘密选择只存在于服务端 State 和本人 View。公共 `choice.submitted` 事件只含 seat；全部提交后才投影 `choices.revealed`。棋盘客户端从 `GardenView` 渲染并通过平台 `onAction` 提交，不导入 server State。资源图片由 `AssetResolverPort` 提供，cue 在服务端事件投影之后生成，均不参与规则。

## Color Match 示例

`games/color-match` 分为 `shared/server/client`。规则状态包含 40 张实例牌的私密牌堆、各座位手牌、弃牌堆、阶段和胜者；客户端只解析当前座位的 View。服务端 `validateAction/applyAction` 处理 `play_card`、`draw_card` 和 `choose_target`，平台只负责身份、事务与修订号。数字 5 的目标选择是持久化阶段；若数字 5 为最后一张，目标效果完成后才结算胜利。牌堆和可重洗弃牌都空时，摸牌成为跳过；全员连续跳过按最少手牌结算，可并列。

客户端通过点击卡牌选择并高亮，再提交动作；合法卡牌和目标列表来自玩家 View，仅作为提示。最终校验始终在服务端进行。实例牌 ID 为 `card.<color>.<number>.<copy>`，逻辑内容 ID 为 `card.<color>.<number>`，显示资源不参与规则。

Color Match 的 decision context 只由该座位 View 派生出 `play_card`、`draw_card` 或 `choose_target` 候选。平台调度器不理解颜色、数字或目标语义；`basic-v1` 位于游戏服务端包，worker 策略注册只做可信装配。复杂游戏未来可以扩展为按需候选协议，本阶段不要求无限枚举。

## 公开规则说明

各游戏通过独立 ./rules 入口导出 publicRules，在 API registry.rules 中按 gameId@version 装配。Color Match、计数测试与正式计数房均有公开说明，涵盖目标、回合、合法动作、特殊效果、终局和信息边界。房间/建房/对局页支持展开及复制；调度器将同一版本文本注入脚本 worker 的 publicRules 和模型 adapter 的 rules。说明不包含 State、隐藏手牌或凭据，不改变原有规则摘要或存档版本。新增游戏需同时注册其公开说明。

## 璀璨宝石扩展示例（2026-10-01）

2026-10-02 通过独立 ./assets 入口增加 109 槽图片契约和两套可选资源，原 SVG 空映射与 TTS 卡面复用同一客户端回退。下段空清单描述是首次实现的历史状态，规则与身份化 View 未改变。当前图包操作见游戏指南。

games/splendor 的 splendor.base@1.0.0 是轮流行动的宝石引擎构筑扩展。动作由 take/reserve/reserve_deck/buy/return/noble/pass 描述；支付使用严格代币数量对象，退币和贵族选择作为持久化阶段。本人 View 仅含自己的预留卡，其他座位仅含预留数量；牌堆只提供数量。公开事件不含预留/盲抽牌身份。合法候选枚举所有精确支付（含主动黄金替代），脚本和模型沿用统一命令链路。原创客户端 SVG 使用空的不可变默认资源清单，不依赖管理员上传或外链。详见 [规则与维护](games/splendor.md)。

璀璨宝石另提供独立 `@boardgame/splendor/tutorial` 导出，Web 的精确版本 loader 直接加载此入口，避免正式桌面同时加载练习数据。十一个固定练习由真实规则生成合成公开投影，按字段差异存储后经 shared schema 还原；浏览器没有 server 依赖。生成入口为 `scripts/generate-splendor-tutorial.ts`，参考状态只在测试目录，规则对照覆盖完整 View、legalActions、投影事件和多操作中间阶段。
