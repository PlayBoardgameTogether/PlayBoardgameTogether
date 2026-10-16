# 平台官方 AI 与点数

官方 AI 是 PlayBoard 使用平台凭证提供的模型陪玩，沿用已有 model 控制器、身份化 View、合法候选、租约 fencing 和正式动作事务。基础脚本 AI 免费，玩家自带模型继续使用本人凭证；AI 点数与桌游币分开，不自动兑换。

## 管理员开通

1. 执行新增迁移 `031_official_ai.sql`，配置既有 `MODEL_CREDENTIALS_KEY`，更新 API 与 Web。
2. 管理员在 `/settings/models` 保存本人真实模型及 API key，显式测试连接。
3. 在 `/admin/official-ai` 选择该配置、填写玩家可见名称及每次成功行动扣点，发布官方档位。
4. 搜索玩家并发放点数，必填账单说明。发放不是支付订单，不代表已接入充值或收款。

真实服务沿用受 SSRF 防护的公网 HTTPS OpenAI-compatible Chat Completions 适配器。开发和生产禁止将 mock 发布为官方 AI；自动测试可在 NODE_ENV=test 下使用 mock 验证完整链路。没有预置假官方模型、密钥或余额。模型标识、真实价格、地区可用性和上游账户由运营者配置；没有测试真实供应商就不能声称真实调用已验收。

档位的来源模型、地址与价格固定；变更需发布新档位并停用旧档位。被引用的来源配置禁止编辑/删除，凭证仍可轮换和撤销。停用阻止新调用，已经发送的有效结果可能按原价格完成。服务端只解密来源所有者的凭证，玩家目录不返回来源配置 ID、地址或密钥。

模型耗时仍受 `AI_DECISION_TIMEOUT_MS` 约束。接入慢模型时按实测调整，并保证 `AI_LEASE_MS` 足够覆盖请求、持久化和提交；超时释放玩家预留，不代表供应商没有收费。当前没有自动切换模型档位或超额扣点。

## 玩家使用

进入“更多 → 官方 AI 与点数”(`/official-ai`)，查看余额、使用中预留和分页账单；选择官方档位并设置每席位单局上限。启用后，在房间“选择模型 AI”添加官方 AI，或在对局“控制方式”授权本人托管。

- 本人托管由本人付费，可随时收回；添加专用模型 AI 继续由房主选择自己的官方配置，开局固定付款账户。
- 付款不授予 bot 私密 View 的读取权限。房主转让后，开局前新房主必须重新选择本人的配置。
- 单局上限按 `(付款账户, match, seat)` 累计，不因收回/再次授权或换档位清零；多个席位各有上限，共享同一钱包。
- 活跃绑定期间只能显式提高该配置上限，不能降低。页面明确说明调整适用于此官方 AI 的所有进行中席位。余额或上限不足时 AI 受阻；补点或提高上限后自动继续未调用的决策，也可收回本人控制。平台不会自行提高预算。
- 关闭页面不停止托管。点数仅用于平台官方 AI，当前由管理员发放，不提供支付充值、退款、转账或提现。

## 计费和恢复

第一版按成功行动收取固定整数点数，不按 token 扣费。所有余额和点数使用整数，钱包上限 10 亿点；单次发放最多 100 万点，每次行动 1–10000 点，每席位上限 1–100 万点。

1. 调用前锁 task、重验租约/身份/状态和官方授权，再锁付款钱包；检查可用余额及该席位累计消费/预留。
2. 同事务创建一次调用记录及额度预留。网络调用在事务外执行，只有本人 View、公开规则和合法候选。
3. 保存供应商 requestId、模型 ID、可获得的 input/output token 和耗时；通过结构化 choiceId 校验后标记 ready。
4. 正式动作原事务校验 epoch/revision/规则，保存 State/RNG/回执、扣除钱包余额、写消费账本和标记预留 charged；整体成功提交后才广播。扣费持久化失败时游戏与扣费一起回滚。

同 task 最多发出一次官方调用；同 decision group 仍最多两次外部尝试。冻结的有效提案可跨租约恢复提交，不再次调用或扣点。请求重试由持久回执去重；不同内容复用 requestId 返回冲突。授予点数、启用配置、目录发布/停用也有持久回执。

失败、非法输出、脚本兜底、过期/取消的结果不收费。扫描器释放终止 task 或过期未完成调用的预留，ready 提案保留供恢复；不确定调用记录为 unknown。调用已记录但结果未冻结时，不再次请求供应商，以新鲜 View 免费兜底；兜底前释放旧预留，防止误扣点。迟到响应可以补充用量，但不能复活已释放预留。供应商成本由平台承担并另行对账，后台 token 汇总不能视为已核对的货币成本或利润；缓存/推理细分、供应商账单对账与自动成本核算未在本版实现。

## API 与存储

共享 schema 在 `packages/protocol/src/official-ai.ts`；SDK 边界解析所有输入/输出。

| 接口 | 权限与行为 |
| --- | --- |
| GET `/api/v1/official-ai/offers` | 登录，读取开放档位及每次行动价格 |
| GET `/api/v1/me/official-ai/profiles` | 本人官方配置及上限 |
| POST `/api/v1/me/official-ai/enroll` | 本人；requestId、offerId、matchBudget |
| GET `/api/v1/me/ai-points` | 本人余额/预留/可用点数 |
| GET `/api/v1/me/ai-points/ledger?before=UUID` | 本人账单，每页20条，游标限定本人 |
| GET/POST `/api/v1/admin/official-ai/offers` | 管理员目录/发布，来源必须是本人配置 |
| PUT `/api/v1/admin/official-ai/offers/:id` | 管理员；requestId、expectedRevision、enabled |
| POST `/api/v1/admin/ai-points/grant` | 管理员；requestId、accountId、points、note |
| GET `/api/v1/admin/official-ai/stats` | 管理员非秘密点数及用量汇总 |

所有写入验证 Origin/CSRF，会话、活跃账户及管理员角色在事务重验；接口 no-store。复用 FORBIDDEN、STATE_CONFLICT、REQUEST_ID_CONFLICT、AI_BLOCKED 等既有错误码。

031 新增 `official_ai_offers`、`ai_point_wallets`、`ai_point_ledger`、`ai_point_receipts`、`official_ai_reservations`，为个人配置增加官方档位与单局上限。来源/价格不在原地更新，预留按 task 唯一，调用按 attempt 唯一，charged 必须引用唯一账本行。保留现有对局、身份、规则和版本锁定模型；不新增通用代理 API、支付服务或独立 worker。
