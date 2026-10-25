# UI 开发与回归

生产界面回归：先 `pnpm build`，再 `pnpm test:ui`。`tests/config/ui.config.ts` 统一启动生产预览，运行文档、导航、外壳、主题、移动发现、社交、后台和游戏包管理测试，不调用数据库准备/清理。可追加测试文件缩小范围，例如 `pnpm test:ui platform-shell.spec.ts`；全部入口见 [浏览器测试配置](../tests/config/README.md)。覆盖按页加载、浏览器标题、历史返回与焦点、320px/横屏/桌面布局、登录请求锁与分类反馈、页面加载失败和跨页恢复；截图在测试输出目录。正式身份、房间和完整对局仍使用 `pnpm test:e2e`，不能用模拟登录失败响应替代真实登录验收。

2026-10-02 起 color-match、grid-garden、profile、navigation 回归将新截图写入 testInfo.outputPath，使用 `--output=.data/…` 可隔离本地验收产物；下方 docs/screenshots 路径保留历史记录。Color Match 心跳测试在按需页面加载完成后冻结时钟，并在刷新回归前恢复；不删除会话失效、心跳/重连或单连接断言。

无刷新站内导航与 View Transition 的能力检测、清理、快速切页保护位于 `apps/web/src/app/navigation.ts`，沿用 `platform.navigate` 和 popstate，不增加路由依赖或传输通道。App 的 main 按路径隔离，离开中的内容 inert，导航后聚焦 main；更多菜单保留用户选择的展开状态，由 summary 手动切换。NewRoomPage 与 RoomCreateForm 在卸载后不执行迟到导航。`tests/e2e/navigation.spec.ts` 检查同一 document、前进后退、键盘焦点、错峰、减少动态效果和无 View Transition 回退；`tests/e2e/navigation-menu.spec.ts` 检查桌面/手机换页与历史导航保留菜单状态及手动收起。桌面/手机截图在 `docs/screenshots/page-motion/`。

2026-10-01 后续动效/控件主题补齐位于 `styles/vibrancy.css`。新增 E2E 检查下拉菜单键盘选择、Escape 返回焦点、选牌位移和减少动态效果，截图位于 `docs/screenshots/motion-controls/`；现有五视口与真实流程继续回归。原生菜单在不支持 `base-select` 的浏览器中仍由系统绘制。

2026-10-01 macOS Vibrancy 改版截图保存在 `docs/screenshots/macos-vibrancy/`。`stage9-ui.spec.ts` 的后续截图写入这个目录，保留阶段 9 旧截图；主题检查区分装饰分隔与表单控件边界，并验证三级灰阶、五视口的站点名称可见性、键盘草稿及无横向溢出。页面外壳在 App.tsx，视觉覆盖在 vibrancy.css；不修改身份、规则或动作链路。

在根目录按 README 启动现有 API 与 Web。设置既有双开发开关 `NODE_ENV=development`、`ENABLE_DEV_LAB=true` 和 `VITE_ENABLE_DEV_LAB=true`，访问 `/dev/ui`。正式对局不需要这些开关。不得覆盖现有 .env。

固定场景位于 `apps/web/src/dev/UiScenes.tsx`：登录错误、空大厅、创建、2/4 人准备；Color Match 本人行动、20 张手牌、附加目标、等待、结束；Grid Garden 初始、本人已提交、多建造者/横竖预览、上轮公开、四人并列；提交中、结果未知、冲突、离线、恢复、会话失效；AI 思考/兜底/受阻、缺图、静音、音频未启用和渲染失败。

场景只包含匿名的公开 Player View。按钮记录本地点击，不生成正式 requestId、不创建房间、不调用模型、不发送动作、不播放事件声音。场景数据不是服务端事实，也不计作真人联机证据。没有完整秘密 State、他人真实手牌或真实邀请码。

生产构建入口为 `apps/web/build.mjs`：在 Vite 解析环境前指定 production。`apps/web/vite.config.ts` 按 build 命令关闭 DEV 并替换开发模块；即使本地 .env 选择 development，固定场景与 React 开发运行时仍被排除。`scripts/check-production-bundle.mjs` 检查场景/卡牌/错误夹具及 jsxDEV 标志，出现即失败。可另运行 `node scripts/check-web-runtime.mjs` 在本机端口5373验证构建登录页和开发路由404，自动退出浏览器与预览进程，不提交登录或写库。

| 职责 | 实际文件/入口 |
| --- | --- |
| 公共视觉 | styles/stage9.css + 最后加载的 styles/vibrancy.css；原 base/stage2/assets 样式仍为基础 |
| 公共反馈/错误隔离 | packages/ui/src/index.tsx |
| 导航、页面身份隔离 | apps/web/src/app/App.tsx；room/match 按 ID 作为 key |
| 登录、大厅、创建、房间 | apps/web/src/pages；Dashboard、Lobby、RoomCreateForm、RoomPage |
| 游戏装配 | apps/web/src/game-registry.tsx 的 clientGame |
| 正式动作与未知恢复 | MatchPage.act/send/reconcile；client-sdk 的 submitMatchAction/matchCommandReceipt |
| 身份化实时同步 | MatchPage.merge、WS 订阅与周期拉取；RoomPage 快照合并 |
| Color Match | games/color-match/src/client/index.tsx，公开 ColorView/事件 |
| Grid Garden | games/grid-garden/src/client/index.tsx，GardenView 的 myChoice/builders/roundResults/legalPlacements/outcome |
| 图片/声音 | assets/resolver.ts、presentation.ts、audio-manager.ts、AudioControls.tsx |
| 精确版本帮助 | GameRules → client-sdk.gameRules → registry 的公开说明 |

两个游戏的草稿可取消。Color Match 先点牌再出牌；数字 5 的已有独立目标阶段先选目标再确认。Grid Garden 先选收获/建造再确认，保存后不能重选；落子预览仍按当前 View 合法候选校验。公开上轮结果保留在 roundResults，即使自动进入下一轮也可查看。

修改 UI 不导入 server、State、数据库或密钥。不复制动作/订阅通道。结果未知必须保留原请求查询本人回执；明确冲突后同步并由真人再次确认。AI 文案来自 controller/aiStatus，`AI_FALLBACK_USED` 翻译为脚本兜底，不展示私密提案或供应商原始错误。

批次验收：typecheck、lint、unit、integration、E2E、build。集成和 E2E 都清理独立 boardgame_test，必须顺序执行。新增 `tests/e2e/stage9-ui.spec.ts` 覆盖失败重试、手动复制、视口、键盘、草稿取消、200% 字体、开发动作隔离和真实四账户并列；两款游戏原 E2E 继续验证回执、离线、冲突及完整对局。截图在 `docs/screenshots/stage-9/before` 与 `after`，开发图片用 fixture 前缀，真实流程用 real/游戏名称区分。

浏览器确认属于原生弹窗，回归继续使用现有 room-close 测试。没有新 React modal；后续加入时需要焦点进入、关闭后返回及 Escape 清理。不要通过取消未知请求、降低断言或重新开局来掩盖恢复缺陷。
