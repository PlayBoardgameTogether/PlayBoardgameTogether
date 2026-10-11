# 在线游戏 ZIP

管理员在「更多 → 管理员后台 → 游戏管理 → 上传游戏 ZIP」选择包，点击「检查游戏包」，查看识别结果并审核通过后上架或更新。成功后立即出现在大厅，支持创建房间、真人完整对局、刷新与 API 重启恢复。下载 [可玩示例 ZIP](/api/v1/game-packages/example.zip)，解压即可查看全部规则和桌面代码。

## 包格式 v1

ZIP 根目录必须恰好包含以下三个文件，无父目录、附加文件、加密、符号链接或 ZIP64。压缩包最大 5 MiB，解压后总共最多 2 MiB；采用 ZIP stored 或 deflate。

| 文件 | 内容 |
| --- | --- |
| game.json | 严格 JSON：`{"format":"boardgame-package-v1","rules":"公开规则说明"}`，可选 presentation。rules 必填，最多 16000 字符 |
| server.js | 无 imports/require 的独立 JavaScript，声明 `const game = {...}`，实现现有 GameExtension 方法 |
| client.html | 自包含桌面 HTML，内联 JavaScript/CSS，图片可用 data URL |

这是一种运行时包格式，普通 GitHub 源码仓库 ZIP 或现有 workspace 源码 ZIP 不能直接上传。可先把共享规则及 schema 依赖打包为独立 JavaScript，再导出全局 game；不得依赖 Node.js、React 服务端、文件、网络、异步函数或宿主对象。当前没有在服务器安装 npm 依赖、执行包内脚本或编译源码的步骤。

## 服务端规则

方法沿用 [游戏 SDK](/developers/game-sdk)：manifest、validateOptions、parseAction、setup、getView、getActionSpec、validateAction、applyAction、projectEvents、getOutcome、serialize、deserialize、getFallbackAction。输入/输出只允许 JSON；validateAction 可返回 undefined。默认选项必须接受 `{}`，其他选项可在建房时填写。manifest 必须是正式游戏，兼容 `^0.1.`，游戏 ID 和版本满足 SDK；版本最多 32 字符。

setup 接收 `{seats,options,rng}`，applyAction 接收 `(state,actor,action,rng)`，返回 `{state,events}`。rng 仅提供同步 `nextInt(min,max)`，使用与平台相同的 mulberry32-v1，最多调用 10000 次。getOutcome 返回 `{status:'ongoing'}` 或 `{status:'finished',winners:[seatId]}`。规则错误和失败转换不会提交状态、RNG、revision 或动作回执。

每次调用独立创建 QuickJS WASM 环境：16 MiB 内存、512 KiB 栈、100 ms 执行上限、256 KiB JSON 结果上限。环境不提供 Node.js、文件、网络、时钟、宿主回调；Math.random 禁用，随机必须使用注入 RNG。跨方法的可变全局变量不会保留，所有权威进度必须在 State 内。计时中断不是硬实时保证，WASM 初始化与 JSON 处理也有额外开销。

安装会验证所需方法及最小/最大人数下的 setup、序列化恢复、本人 View、动作说明、初始事件投影和结局格式。该检查不证明所有规则或私密投影正确；管理员仍应选择可信来源并审查玩法与投影。完整 State 只传给服务端规则；桌面仅收到当前身份的 View 和已投影事件。

v1 使用游戏自身内联桌面与空默认图包，不接入图包切换、平台音效或教程。可以通过可选 getDecisionContext 接入现有脚本/模型 AI，未声明的旧包继续只支持真人。原静态游戏保留已有全部能力。

## 可选 AI（2026-10-03）

server.js 可实现 `getDecisionContext(state,viewer)`：无需行动返回 null，否则返回严格 `{decisionKey,legalActions}`，key 为 1–256 字符，候选 1–1000 个 JSON 动作。它在同一个有界 QuickJS 中执行；合法候选只包含该身份能够提交的动作，不携带其他玩家秘密。key 区分摸牌前后等持久阶段，不能依赖时间或可变全局。

基础脚本在没有专用内置策略时选择第一个候选，开发者可按自己的 View 排序，getFallbackAction 必须返回同组合法候选。安装最小/最大人数自检调用各身份 context、校验首个候选和兜底；所有实际动作仍经 matches 原事务再次校验。模型沿用已有个人配置/凭证、choiceId、revision/epoch/租约检查，只接收 bot 自己的 View、公开规则和候选。不是在宿主 worker 执行上传的 JS 策略；包源码仍只在 QuickJS 中运行。

## 可选展示图（2026-10-03）

`game.json.presentation` 为可选严格对象，支持 icon、cover、background；每个值是 `data:image/png;base64,...`。仅 PNG、单图字节最多 320 KiB、宽高 1–2048；校验 canonical base64、PNG 头/块边界及结束块。SVG/JPEG/外链不作为此字段接收。三图与规则/HTML 总共仍受 ZIP 解压后 2 MiB 限制。建议用方形图标、横向封面和背景；PNG 可由原创 SVG 在打包时渲染。不要在图像或元数据中嵌入秘密。

025 迁移为 game_packages 增加 presentation；图像与同版本源码/安装回执原子保存，包 SHA-256 含图像。图库返回 `/api/v1/game-packages/:id/versions/:version/art/{icon|cover|background}.png`，响应 image/png、nosniff、sandbox CSP、不可变缓存。大厅和详情自动使用这些默认图，管理员原展示配置优先，清空后恢复包默认。旧包默认空对象，旧版本和对局不覆盖。仅声明图像即可自动展示，无需编辑平台 gameId 分支。

## 桌面桥接

HTML 在 `sandbox="allow-scripts"` 的独立不透明来源 iframe 中运行，不能读父页面、平台 cookie 或存储。响应 CSP 禁用外部脚本、网络连接、表单、子框架和外部图片；仅允许内联脚本/样式和 data 图片。桌面代码只应通过下面的消息桥操作平台，不读取或导航到外部地址。

```javascript
window.addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'boardgame:view') return;
  const { view, busy, events } = event.data;
  // 使用 textContent 等方式绘制 View，busy 时禁用提交。
});
parent.postMessage({type:'boardgame:ready'}, '*');
// 用户选择合法操作后：
parent.postMessage({type:'boardgame:action', action:{type:'your-action'}}, '*');
// 可选：内容尺寸变化后报告实际高度，消除 iframe 内部滚动。
parent.postMessage({type:'boardgame:resize', height:900}, '*');
// 或：让宿主按屏幕剩余空间设置高度；桌面 CSS 必须自行适配该高度。
parent.postMessage({type:'boardgame:resize', height:560, fit:'viewport'}, '*');
```

父页面只接受当前 iframe 的消息，动作最大 8 KiB，并继续交给原 match 命令链路做身份、控制权、revision、去重和规则校验。'*' 仅用于向不透明来源 iframe/父页面传递本人 View，不广播到其他窗口。桌面无跨局权限；卸载清理监听器。历史版本桌面始终可读取以恢复下架版本旧局，其 HTML 是公开程序，不能包含秘密或凭据。

可选 `boardgame:resize` 只接受有限数字 height，范围 320–4096 CSS px，向上取整后设置桌面高度；非法值或其他来源忽略。旧包不发消息时保留 560px 最小高度与原滚动行为。建议用 ResizeObserver 测量内容根节点（而非 iframe 视口或至少等于视口的 scrollHeight），仅在高度变化时发送，避免反馈循环；卸载时清理观察器和动画帧。消息只控制展示尺寸，不授予动作权限。

2026-10-04 新增可选 `fit:'viewport'`：通过同一来源/height 检查后，由宿主根据 iframe 页面位置、窗口高度及 16px 底部留白计算高度（180–4096px），之后忽略该桌面的内容高度请求。宿主观察页面尺寸与窗口 resize，卸载时清理；切换版本重置模式。桌面须使用自己的 iframe 视口高度限制棋盘，并预留状态与操作区，不能把 `overflow:hidden` 当作完整展示。旧宿主忽略 fit 时仍按 height 提示设为 560px；旧包未声明 fit 保持内容高度模式。该可选字段不改变 HTTP/WS、正式动作或权限。



## 可选回放动画

平台在回放时加载同一精确版本的 `desktop?replay=1`，在原 sandbox/CSP 内添加输入拦截和动画观察包装，不修改已安装 HTML、hash 或规则版本。连续前进传 busy=false 和该步本人投影事件，让旧包原有动画执行；初始化、倒退和进度跳转传 busy=true 且不传表现事件。平台禁用控件、拦截交互、丢弃动作，busy=false 不代表授予操作权限；没有实时音效授权。CSS/Web Animations 和连续 DOM 变化由平台自动观察，最长 60 秒，无需发布新包。

可选 `boardgame:view.replay={id,animate}` 和 `parent.postMessage({type:'boardgame:replay-animation',id:replay.id,durationMs:1200},'*')` 可补充 Canvas/WebGL、长空白延迟等无法自动推断的时长。宿主仅接受当前 iframe/当前 id 和有限 1–60000ms；自动播放等待步间隔和动画，手动跳转允许中断。平台只执行原桌面的 View/事件表现代码，不重跑规则，也无法从局面猜出仅在原点击处理器中的动画。

## 安装 API 与版本

先 POST `/api/v1/admin/game-packages/review`（相同 ZIP 正文和身份保护）执行格式及规则生命周期检查，不持久化或改变上架状态。返回 gameId/version/name/hash、kind（new/update/installed）、installedVersions 和 catalogHash。按 manifest.id 判断同一游戏，名称不参与身份判断。管理员人工审核来源、规则及私密投影后发布。更新必须在安装请求 query 传 expectedCatalogHash；审核后的安装版本或上架状态变化返回 STATE_CONFLICT，需重新检查。同 ID 新版本原子下架所有旧版本并上架上传版本，大厅只显示新版；等待中的旧版本房间无法开局，进行中/历史对局继续使用旧规则。旧源码与桌面不删除，同版本不同内容仍须提升版本号。相同包重传不改变目录状态，也不重复覆盖。

`POST /api/v1/admin/game-packages?requestId=UUID`，正文为 ZIP 字节，Content-Type 为 application/zip；需要管理员 session、同源 Origin 和 X-CSRF-Token。共享返回为 `{ok:true,data:{gameId,version,name,hash},traceId}`。client-sdk 提供 `reviewGamePackage(file,signal)` 和 `installGamePackage(file,requestId,signal,expectedCatalogHash)`。

上传前检查身份及 CSRF，事务内再次检查活跃管理员和未撤销 session。安装元数据、源码、桌面及回执一起原子提交；只有提交后注册并返回成功。同一账户/requestId/ZIP 重试返回原结果，不重复安装；不同字节复用 ID 为 REQUEST_ID_CONFLICT。同版本不同包为 STATE_CONFLICT，必须提升版本，不能覆盖内置或旧版本。相同包重传不会重新上架已下架版本。

最多保存 100 个在线版本、10000 个安装回执；管理员每进程每分钟最多 20 次上传。ZIP 字节不解压到磁盘，不执行安装脚本，不记录源代码或原始错误到日志。规则和桌面持久在 PostgreSQL，数据库备份包括全部包，上传者账户生命周期不删除已安装包。新增 023/024/025 迁移需运行 `pnpm db:migrate`。

规则摘要锁定包 SHA-256、实际规则源码/公开规则、格式/引擎版本与 manifest；源码损坏后的旧局拒绝恢复，保留原状态。旧局锁定精确版本，不自动替换最新版。当前仍为单 API 进程实时部署；其他 API 进程在涉及游戏的请求前同步已安装版本。更换引擎语义需要版本兼容方案，不应直接改变已有规则摘要。没有任意 npm 项目的自动构建和发布能力。
