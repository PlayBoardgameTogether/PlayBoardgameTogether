# 决策记录

- [ADR-006](adr/006-bounded-online-update.md)：候选构建后暂停新请求、在途请求最多排空 30 秒，常驻连接和未结束对局不再永久阻塞；短暂断线沿用持久快照与回执恢复，排空超时恢复服务并报告失败，首次上线需选择新版 API 并重启新版监督脚本。

- [ADR-005](adr/005-runtime-game-packages.md)：管理员即时安装固定三文件 ZIP，QuickJS WASM 规则与 sandbox HTML 桌面，复用正式游戏事务，持久精确版本并保留旧局；普通源码项目不执行在线 npm 构建。

- 第九阶段保持原生 CSS 和 details/summary；公共 UI 增加状态反馈与扩展渲染边界，不引入新的游戏/通信框架。房间和对局页面按 ID 分别挂载，异步回复在原页面卸载后不得导航至旧对局。Grid Garden 的本地秘密选择与 Color Match 的目标选择新增显式确认，不新增服务端动作或人工公开步骤。
- 固定 UI 场景只使用匿名公开 View，生产由 Vite build 命令关闭开发标志并替换开发模块。发现本地 .env 的 development 会影响 Vite 构建，故按构建命令约束，不覆盖用户 .env；生产 marker 检查实际验证排除。卡牌、棋盘的已确认变化仍以服务端快照为准，动画只展示 live 公开事件，不延迟规则。

- 第八阶段为同时行动新增可选 `MultiActorDecisionRequests`，不把 `currentPlayerId` 扩展成特殊数组，也不改变旧游戏接口。调度器可以枚举多个需求，但每局仍串行一个自动决策；真人继续靠严格 revision 处理并发。模型外部尝试按 `(match, seat, controllerEpoch, decisionKey)` 持久计数，最多两次，stale/重启不清零；耗尽后基于新鲜 View 使用合法脚本 fallback。
- Grid Garden 的 reveal 与能量结算保持在最后选择的同一规则转换和动作事务中；最后落子同样同步推进。没有客户端 reveal/next-round 系统动作。自定义棋盘、资源和声音均留在扩展与既有表现接口，平台服务不解释花园坐标或计分。

- 第七阶段见 [ADR-003](adr/003-stage-7-assets-presentation.md)：保留历史空清单和规则摘要，独立 assets 子入口；新图片版本完整展开、精确锁定；资源 catalog 串行引用保护；WS 完整 revision 批次水位去重；Web Locks 单可见 owner。媒体校验采用短生命周期 Docker FFmpeg 工具容器，满足低权限/无网络/CPU/内存隔离，不增加业务服务。暂不引入 ZIP/S3/CDN。

- 采用规格指定的 pnpm TypeScript workspace、React/Vite、Fastify、PostgreSQL 与 Zod；仓库原先无代码，不存在迁移冲突。
- 保持模块化单体；只创建有实际职责的包，不创建空 AI worker。
- Test Counter 是 developmentOnly 可信代码扩展；正式平台核心不包含游戏规则分支。
- 阶段 1 对局使用有界内存 runner，明确不提供重启恢复或持久化去重。
- 生产环境不注册测试扩展和开发路由，即使误设 `ENABLE_DEV_LAB=true`。
- 前端使用少量共享组件和全局设计变量，避免在骨架阶段引入大型 UI 框架。
- 开发 PostgreSQL 宿主端口由建议值 5433 调整为 5434，因为本机已有其他项目合法占用 5433；容器内仍使用 5432，连接始终由 `DATABASE_URL` 配置。
- 阶段 2 继续使用模块化单体；账户/session、房间事务、初始 match 和 realtime 都位于同一 API 运行单元。
- 采用 `argon2` 0.45.1 的 Argon2id 默认安全参数；参数编码在 hash 中。
- session/CSRF/invite 原值均由密码学随机源生成，数据库保存摘要；邀请码只在签发响应显示一次。
- 不修改 developmentOnly `demo.test-counter@0.1.0`；新增 `demo.counter-room@1.0.0` 作为正式身份开局示例。
- 登录/加入限流和 room presence 暂为单 API 进程内存状态；多副本之前才引入共享协调。
- 第三阶段 Color Match 使用独立扩展和已有正式 match 表；动作在 `MatchService` 内串行提交，房间与认证流程不重建。
- 采用任务书对 Color Match 的完整规则：最后一张数字 5 在目标摸牌后胜利；无牌可摸且全员连续跳过时，最少手牌者获胜，可并列。当前默认卡牌用 CSS 绘制，逻辑牌 ID 与素材文件分离。
- 第四阶段继续每步完整 PostgreSQL 快照，不增加事件重放恢复；`match_actions` 只承担成功动作审计与回执结果引用。正式动作回执保持到对局清理，房间命令保留原 7 天策略。
- 新局对可信扩展 manifest、游戏 shared/server 源码、game-sdk 源码和内置资源清单记录 SHA-256 摘要。跨 tsx/编译运行使用同一源码字节，避免运行时函数文本不稳定。旧局无可靠摘要时保留 NULL，不伪造回填；部署需随编译产物保留这些源码，阶段 10 可改为构建期签名清单。
- 对局恢复使用完整本人 View；网络未知结果在当前标签页保存原请求并查询本人回执。周期性权威读取弥补单进程 WS 漏通知，不引入多副本协调或新的事件溯源系统。
- 阶段 5 采用 PostgreSQL `ai_tasks`，不引入 Redis；内存只负责唤醒，启动/周期扫描是提交后崩溃的补偿路径。
- 脚本策略使用可终止 worker thread。worker 文件是仓库内固定装配，不接受上传、eval 或任意模块路径；这不是不可信代码沙箱。
- 控制变更不伪造游戏 revision，使用独立 controllerVersion/aiStatusVersion。旧阶段 4 客户端只在 controllerEpoch=0 时兼容缺少 expectedControllerEpoch，以保留已冻结旧请求的恢复语义。
- automation receipt 使用无账户 principal，不借用房主账户。成功动作、回执和任务完成尽量在统一动作事务中原子落库。

- [ADR-007](adr/007-official-ai-points.md)：官方 AI 复用 model 控制器，钱包预留并在原动作事务按成功行动结算点数；来源/点价固定、每席位上限、失败不收费，不接支付。
