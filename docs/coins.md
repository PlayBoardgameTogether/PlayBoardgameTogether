# 桌游币

桌游币是 PlayBoard 平台通用货币，AI 点数仅用于 AI；两者使用独立钱包、流水和扣费链路。本期只交付基础钱包与管理员调整，不提供兑换、转账、充值、商城或自动奖励。所有新旧账户初始余额为 0，没有注册补贴或对局奖励。

玩家从「我的资料 → 我的桌游币」查看本人余额和流水，可刷新与加载更多。管理员从「账户管理 → 管理桌游币」查看指定账户，填写整数数量与原因后发放或扣回；原因会显示给玩家，勿填写秘密信息。余额范围为 0–1,000,000,000，扣回不得透支。后台展示目标昵称及账户 ID，避免同名误发。

## 协议与事务

- `GET /api/v1/profile/coins`：会话决定本人身份，严格查询只允许可选 `before`（正整数流水 revision）。不接受客户端指定账户。
- `GET /api/v1/admin/accounts/:id/coins`：管理员读取目标账户钱包，同一分页语义。
- `POST /api/v1/admin/accounts/:id/coins`：严格输入 `{requestId, expectedRevision, delta, reason}`。delta 为非零整数，绝对值最多 1,000,000,000；reason trim 后 1–200 字符。

共享 schema 位于 `packages/protocol/src/coins.ts`，SDK 提供 `coinWallet`、`adminCoinWallet` 和 `adjustAdminCoins`。读取返回账户 ID、昵称、当前 balance/revision、最多 20 条倒序 entries 和 nextCursor。流水包含 id、revision、delta、balanceAfter、reason、createdAt；不向玩家返回操作管理员、请求 ID 或其他账户流水。余额与该页流水在单条 SQL 的同一快照读取；加载旧页时余额仍为当前余额。

写入复用 AdminService 原有管理员事务：Origin/CSRF/角色检查，事务内重验活跃账户和未撤销会话，同一管理员的 requestId 全操作去重，锁定钱包、校验 revision 和余额，原子保存余额、revision、审计流水及 admin_command_receipts。相同请求重试先返回原结果，不再发放；不同内容或目标复用 ID 返回 REQUEST_ID_CONFLICT。过期钱包返回 STATE_CONFLICT，余额不足/超上限返回 ACTION_NOT_ALLOWED；失败全部回滚。页面在未知结果时冻结表单并保留原请求重试，成功后重新读取最新钱包，避免旧回执覆盖新余额。刷新或离开页面后应先查看权威流水再决定，不能将新操作当作未知请求的重试。

## 存储与更新

迁移 `032_boardgame_coins.sql` 新增 `boardgame_coin_wallets` 和 `boardgame_coin_ledger`。钱包首次调整时创建，无行时读取为 0。流水按 `(account_id,revision)` 唯一，按 `(actor_account_id,request_id)` 唯一；保留审计管理员 UUID、请求 ID 和时间，审计 UUID 不建立级联删除外键。钱包和流水随目标账户删除级联清理，与现有账户生命周期一致。没有自动归档或过期清理，需随数据库备份。

更新时运行 `pnpm db:migrate`；本轮不自动修改开发/生产数据库，不部署。该迁移不依赖 AI 点数表，迁移编号不要求连续。后续商城和奖励应继续通过同一钱包/流水事务完成，并另行定义奖励、消费、退款和幂等规则。
