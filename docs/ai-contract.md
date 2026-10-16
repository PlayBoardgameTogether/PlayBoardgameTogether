# AI 与控制器契约

控制器类型为 human/script/model，并带 `controllerEpoch`。`DecisionInput` 只包含 matchId、seatId、revision、decisionId、controllerEpoch、玩家 View、ActionSpec 与公开规则摘要；不得传入 State 或数据库连接。

`DecisionProvider.decide(input, AbortSignal)` 返回结构化动作、可选公开解释与可获得的用量。返回动作仍走同一服务端校验。Test Counter 的 fallback 仅在轮到自己时返回 add 1。

阶段 1 不启动 worker、不调用模型、不需要密钥。后续任务必须绑定 revision/decisionId/controllerEpoch，真人收回控制后废弃旧结果。

2026-09-25 更新：脚本仅用于专用 bot 座位，真人不得切至 script；个人模型控制仍保留显式授权/收回。调度器从 registry.rules 取当前对局锁定版本的公开规则，脚本消息附 publicRules，模型请求附 rules，仍只传本人 View 与合法候选。

## 模型 AI 座位（2026-10-03）

专用 bot 现可在 waiting 房间选择 script/model；真人仍只能 human/model。模型 bot 的登录身份为空，模型凭证所有者通过独立 model_owner_account_id 在开局固定；授权不会授予读取该 bot View 的权限。房间设置仅用本人 profile，开局后禁止修改，结束后可再配置。profile 编辑/删除需无活跃绑定，密钥可显式撤销。授权账户停用会阻止自动动作提交。模型仍只接收此 bot 的身份 View、公开规则和合法 choiceId，不接收完整 State。

## 在线 ZIP 的 AI（2026-10-03）

上传包可实现 getDecisionContext，在有界规则 VM 中按身份返回稳定 decisionKey 和完整有序合法候选；通用 basic-v1 worker 仅选择首个候选，不加载上传 JS/State。UNO 1.1.0 按自己的 View 优先出彩色牌与效果牌、用最多的手牌颜色选色，保留万能牌；兜底沿用同一排序。模型、冻结提案、epoch/revision/租约与提交校验保持原链路。未声明 context 的旧包仍返回 AI_NOT_SUPPORTED，不能仅靠 manifest 宣称支持。

## 平台官方 AI（2026-10-16）

官方档位沿用 model 控制器和本人 View/合法候选，付款身份继续来自固定参与者的 account/model_owner_account_id。官方配置无玩家凭证，服务端使用管理员来源凭证。调用前以钱包锁预留点数，成功行动与扣点在原 match 事务提交；失败、兜底、取消与过期不扣费。每席位单局上限不随 epoch 清零，同 task 一次外部调用、decision group 最多两次。进行中仅允许用户显式提高同档位所有席位上限，补点/提高上限后重新排队无调用任务，未知调用不自动重发。详见 [官方 AI](official-ai.md)、[ADR-007](adr/007-official-ai-points.md)。
