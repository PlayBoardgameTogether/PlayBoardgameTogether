# 数据模型

## 官方 AI 优先电脑开局（0.18.0）

无新迁移。电脑创建可填充原 `seats.bot_model_profile_id`、`bot_policy_id='model'`，开局按原逻辑固定 `match_participants.model_owner_account_id`。余额/单局预算不足时预留事务回滚，不创建模型调用和扣费记录；同一 AI task 保存免费脚本提案并走原动作事务，`safe_error_code='AI_FALLBACK_USED'`。不更改控制类型、epoch、付款身份或预算，不重放已完成的脚本行动。

## 公开终局摘要（034，0.12.0）

新增 `matches.result_summary`（可空 JSONB），数据库约束要求非空时对局为 finished 且值为对象。原真人/自动动作事务在规则确认终局后，用 registry 中按精确版本显式登记的投影生成仅含 seatId/winner/可选 score 的公开摘要；与 State、RNG、revision、回放帧、动作、回执和房间复位原子提交或共同回滚。重复成功请求不生成新结果。不是完整 outcome 或额外权威规则来源，不参与随机与规则摘要计算。

历史行保留 NULL，不重写 State、锁定版本或历史成绩；未接入结果投影的游戏仍为 NULL。个人历史通过固定 match_participants 查询本人参与的记录与本人摘要，不依据后续房间座位推断身份。电脑建房只使用原 seats 的 bot/policy 字段，无新钱包或 AI 计费记录。

## 官方 AI token 计价（033，0.11.0）

新增 `official_ai_offers.token_pricing` 可空 JSON（输入/输出基础点价、加价百分比）；为空时保持旧固定点价，不回填历史价格。`official_ai_reservations` 和 `ai_point_ledger` 增加 `token_billing` 用量/价格快照。预留点数允许 0，以支持有效零费用提案；零费用成功行动标记 released，无零额账本。token 档位先预留单次上限/余额/剩余预算最小值，ready 在 task → wallet 锁下冻结实际费用、释放多余额度；动作与消费账本继续原子提交，charged 仍引用唯一账本行。详见 [ADR-008](adr/008-official-ai-token-pricing.md)。

## 桌游币（032，2026-10-16）

独立 `boardgame_coin_wallets` 保存账户余额（0–1,000,000,000）和 revision；首次调整创建，无行读取为 0。`boardgame_coin_ledger` 保存每次非零调整及余额、原因、管理员审计 UUID/requestId/时间，账户 revision 与管理员 requestId 分别唯一。管理员写入复用 `admin_command_receipts`，余额、流水、版本及回执原子提交；读取同一 SQL 快照。与 AI 点数无共享余额、兑换或扣费。完整契约见 [桌游币](coins.md)。

## 玩家徽章（030，2026-10-11）

`player_badge_settings` 保存每账户精选 JSON 数组（最多三项）及 revision；`player_badge_grants` 以账户/徽章为主键保存身份荣誉、授予时间及授予管理员；`player_badge_receipts` 保存本人展示命令输入/结果，按账户/requestId 唯一。管理员授予/收回继续使用 `admin_command_receipts`；收回同时清除精选。成就进度直接由固定 match participant 的已完成正式对局计算，没有新增胜负统计或修改旧对局。详见 [玩家徽章](badges.md)。

## 回放帧（2026-10-04）

029 新增 match_replay_frames，(match_id, revision) 主键，保存服务端 State 和内部事件，与对局级联保留/删除。开局和状态更新触发器沿用原事务，真人与自动动作附加行动者和事件，失败整体回滚，重复不增加步骤。历史迁移只保存当前帧。详情和容量边界见 [回放存储](replays.md#存储与扩展)。

## 房间活动时间（2026-10-04）

028 新增 rooms.last_activity_at（timestamptz，NOT NULL，默认 now()）与未关闭房间的部分索引。历史行以迁移时间初始化，认证成员访问及健康订阅续期，不计入业务 revision。超时关闭保留成员、固定对局参与者、State 和动作记录，未结束 match 原子标记 aborted；不物理删除房间或历史。

## 对局显示名称（2026-10-04）

新增 027_match_player_names.sql，为 match_participants 添加可空 display_name；开局在原事务中固定真人/AI 显示名称，AI 名称不依赖后续房间座位。真人投影优先读取固定 account_id 对应账户的当前昵称。迁移补齐旧真人名称，旧 AI 仅在房间仍绑定该局时安全补齐；无法恢复的历史 AI 使用带编号的 AI 名称，不猜测新房间占用者。规则状态、RNG 与版本锁不变。

## 公共消息（2026-10-04）

迁移 `026_public_chat.sql` 新增 `public_messages`：UUID 主键、唯一 bigint identity sequence、sender_id（accounts 外键，删除账户级联）、text（数据库长度 1–2000）、created_at（服务端时钟）。索引 sender_id/created_at 用于频控与容量计数，sequence 唯一索引用于最新/历史/增量分页。正文为纯文本，经典表情保存文字快捷码，不保存图片、外部 URL 或资料副本。与私聊表、水位分离。

公共消息写入与原 `social_command_receipts` 在同一 advisory lock 和事务中原子提交；摘要操作为 public-message，重复成功优先于新发言配额。回执保存原发送 DTO，读取历史时联结当前公开昵称/头像。回滚可能使 identity sequence 有间隙，分页只比较有记录的 sequence，不假定连续整数。没有自动过期清理，单账户累计上限 20000 条。

## 在线包默认展示图（2026-10-03）

025_game_package_presentation.sql 给 game_packages 追加 presentation jsonb NOT NULL DEFAULT '{}'，对象/长度受约束；可选 icon/cover/background 保存 PNG data URL，随包安装同事务提交，不另存磁盘。旧包默认空对象，包 hash 包含 descriptor/图片字节，同版本不可覆盖。game_presentations 保留管理员独立配置与 revision，读取以非空配置覆盖包默认；清空配置恢复默认，不改变旧规则或 State。


## 公开注册（2026-10-03）

无新增迁移。注册复用 accounts 与现有唯一约束，在共享 social-write advisory lock 的事务中同时写入规范 username_canonical、显示昵称、Argon2id password_hash、固定 user/active 和相同的显式 friend_id。登录 ID 或好友 ID 冲突整笔回滚，不由默认 ID trigger 添加后缀；不创建 session 或保存明文密码。social_revision、好友 ID 修改时间等继续使用原默认值，注册 ID 是初始值，首次后续自定义遵循现有政策。

## 在线游戏包 023/024（2026-10-03）

023 新增 `game_packages`，按 game_id/game_version 关联既有安装版本，持久 SHA-256、独立规则源码、自包含桌面、公开规则与安装审计 UUID/时间，文本总字节数限制 2 MiB；版本不可改写。`game_package_receipts` 按 account_id/request_id 唯一保存输入 hash 和公开结果，与安装行和包同事务提交。024 移除上传者账户外键，保留审计 UUID，使删除上传者或账户生命周期操作不会连带删除旧局规则。回执仍随账户级联，不影响已安装版本。安装全局事务锁保证并发去重与 100 版本/10000 回执配额。

## 好友 ID 修改规则 022（2026-10-03）

`022_friend_id_policy.sql` 新增单行 social_settings（friend_id_change_days 0–3650、revision），默认 30 天；accounts.friend_id_changed_at 保存最后一次成功显式修改时间。旧时间由返回 friendId/revision 的历史回执补齐，不把默认分配或 021 迁移计入。管理员设置与 ID 修改共用社交写锁；设置/revision/摘要回执或 ID/时间/revision/回执在单事务提交，失败回滚。0 不限；冷却由服务端 clock_timestamp 与固定 24 小时天数计算。

## 自定义 @好友名字 021（2026-10-03）

021 替换 accounts 的默认好友 ID 分配触发器：默认使用 username_canonical，重名时追加有界 `_2` 等后缀，分配与社交编辑共享 advisory lock。只迁移 social_revision=1 且仍等于原 `p_`+UUID 的账户，保留自定义 ID；迁移推进 social revision，不改变账户 UUID、关系、消息和对局。展示和复制添加 `@`，输入接受可选 `@`，存储/DTO 继续保存无前缀 canonical 名字。下方 020 为历史迁移行为。

## 社交 020（2026-10-03）

accounts 新增唯一 lowercase friend_id 和 social_revision；迁移及插入 trigger 为既有/新账户分配 `p_` + UUID hex。friendships 使用有序账户 UUID 对作为主键，保存 requested_by、pending/accepted/rejected/removed、revision 和更新时间。direct_messages 保存单调 sequence、消息 UUID、双方身份、文字和时间；direct_message_reads 为每人/peer 保存单调读取水位。friend_room_invitations 保存房间/发送人/接收人、pending/accepted/rejected 和 24 小时 expiry；social_command_receipts 保存 account/requestId 主键、输入 SHA-256 和投影结果，不保存房间密码正文。均有外键及约束，没有完整 State 或对局权限副本。

社交写事务 advisory lock 排序；房间邀请相关操作 room → account/session 锁序。接受时同事务调用原 rooms 加入规则并更新邀请与回执；失败整体回滚，commit 后原 realtime 通知。社交读取使用 REPEATABLE READ。记录随账户保留，无自动清理，配额和边界见 [社交功能](social.md)。

## 管理员后台 019（2026-10-03）

新增 accounts.admin_revision 与 game_installations.admin_revision，初始 1；数据库触发器仅在 status/enabled 实质改变时递增，覆盖既有账户 CLI 和管理接口，避免外部更新绕过并发检查。

admin_command_receipts 使用 account_id + UUID request_id 主键，保存仅含非秘密目标/命令字段的 input、公开结果 DTO 和创建时间；管理员命令去重先于 revision 校验。罕见管理写入通过独立事务 advisory lock 串行化，账户/session 重验、目标行锁、状态变更、会话撤销、pg_notify 与回执在同一事务提交。回执无自动清理；账户的既有不物理删除约束保留。不读取或修改 State/RNG、动作、match participants 或锁定资源。旧迁移未改写。

## 游戏接入申请 018（2026-10-03）

game_submissions 持久化申请人 account_id、UUID request_id、严格校验的 input JSONB（纯文本与 GitHub 地址），唯一键为账户 + 请求 ID。id、created_at 组成分页顺序与索引。状态 pending/reviewed/rejected；pending revision=1，审核后 revision=2，review_note/reviewed_by/review_input/reviewed_at 由 CHECK 约束保持同步；审核回执只用于同一申请和审核者去重，不作为代码安全或安装许可。

新申请在独立 advisory transaction lock 与账户/session 锁内去重、检查配额、写入；每账户 pending≤3、24 小时新申请≤5、累计≤100，全平台累计≤10000。去重先于配额；审核锁申请并检查原 revision，原子保存审阅与回执。失败回滚；quota/receipt 不依赖进程内存。无自动清理以保留回执，累计容量需维护者另行管理。申请与 game_installations 没有外键/触发器或激活逻辑，申请游戏 ID 无需已安装。

## 游戏展示 015（2026-10-02）

`015_game_presentations.sql` 新增 game_presentations，以 game_id/game_version 为主键并引用 game_installations；保存可空 icon_url/cover_url/background_url、递增 revision、updated_by 与 updated_at。公开查询只投影游戏 ID、版本、revision 与图片地址。管理员保存先锁安装版本行，串行化首建和后续编辑，校验 expectedRevision 后单事务写入；冲突或无版本不产生记录。null 使用客户端内置图片。未改写历史迁移、manifest、State、RNG、对局资源摘要或房间 revision；展示地址属于平台目录配置，不是对局资源版本。

## 个人资料 014（2026-10-01）

`014_account_profiles.sql` 为 accounts 新增 avatar（dice/leaf/cat/rocket/star/coffee，默认 dice）和 bio（最多 300 字，默认空字符串），保留既有 display_name 与账户 UUID。历史列表直接查询 match_participants → matches → rooms 的非秘密概要，不新建第二份对局记录，不读取 State、RNG 或动作。单语句使用 created_at/id 降序游标，每页 20 项，游标也要求属于本人；关闭房间不删除参与历史。

## 第七阶段 011/012

新增 asset_drafts（manifest/revision/status/report/hash）、asset_files（staged/processing/validated/failed/tombstone/deleted、source/final hash、元数据、reserved_bytes）、asset_versions（packId+version 唯一、不可变 manifest/hash/contract）、asset_version_files/asset_draft_files 引用及 asset_receipts。版本状态只允许发布/归档/逻辑删除；触发器阻止原地改写清单身份与内容。相同最终内容可由多个文件记录共用 storage_key，权限仍由各自版本/草稿引用决定。文件内 delete_after 承担持久删除任务。

rooms.asset_version_id 与 matches.asset_version_id 外键绑定精确版本；match 保存 asset_manifest_hash 和 asset_contract_version。保留已有 resource_pack_id/version/digest，历史 NULL 继续旧 CSS 空清单，不改 State/RNG/revision/控制/预算/回执。新引用在统一 catalog 锁下建立；全部保留 match 状态都阻止删除。

- `schema_migrations`：迁移版本、checksum；已应用 SQL 不可静默修改。
- `game_installations`：精确扩展 manifest 与启用状态。
- `accounts`：canonical username 唯一、display name、Argon2id hash、role、status；不物理删除。
- `sessions`：account、唯一 token hash、CSRF hash、绝对 expiry、revocation。
- `rooms`：host、状态、锁定前的游戏配置、seatCount、roomRevision、activeMatchId。
- `room_members`：room+account 主键及稳定 joinedAt。
- `seats`：服务端 seat UUID、room 内唯一 index，`occupant_kind=human|bot`。真人 owner 必须是成员；bot 无 owner/account，保存服务端名称和精确策略版本。
- `room_invites`：每房当前 code hash、issuedAt、expiresAt；无原码。
- `matches`：一房多轮历史、同房最多一个 active 对局；每局保存精确游戏/内容/资源版本、完整 state、RNG state、match revision 和状态。迁移 005 为新局增加 `state_schema_version`、`rule_digest`、`resource_digest`；旧局无法可靠回填摘要，保留 NULL 并按原精确版本恢复，不伪造构建指纹。
- `match_participants`：开局时固定 match/seat/index/owner；真人 account 非空，专用 bot 为空。controller、controllerEpoch、独立 controller/AI status 版本及精确策略引用均在此保存。
- `command_receipts`：`principal_key+operation+requestId` 唯一；human principal 保留 account 外键，automation principal 由服务端按 match/seat/epoch 构造。房间命令默认 7 天；match 动作与控制命令随对局保留。
- `match_actions`：每局 revision 唯一，保存 principal、已提交动作、操作者私密结果 View 和已投影事件；automation 动作的 account 为空，普通客户端不能读表。
- `ai_tasks`：决策快照键、策略摘要、状态、有限 attempt、lease fencing、冻结 proposal/requestId 和安全错误。唯一决策键防重复唤醒。

房间写操作统一先锁 `rooms` 行，再读取/修改成员和座位。数据库唯一约束是并发最后防线。`rooms(active_match_id,id)` 复合外键只能引用同房 match。邀请、session 和密码原文均不持久化；普通 receipts 不保存邀请码、session 或私密状态。

迁移 `004_match_actions.sql` 为第三阶段新增表；不修改已应用的历史迁移。正式动作依次锁房间和 match，在同一事务提交 state、rng_state、revision、status、match_actions 与 command_receipts。

迁移 `005_match_reliability.sql` 不重写旧迁移。新局的规则摘要由 registry 对可信扩展的 manifest、游戏 shared/server 源码及 game-sdk 源码计算；资源摘要覆盖当前内置资源清单。当前内置资源清单为空，尚无阶段 7 的上传文件及其字节摘要。普通客户端只能读取本人 View 和本人命令回执，不能读取 `match_actions`、State、RNG 或他人回执。

迁移 `006_script_ai.sql` 将既有座位/参与者回填为 human、既有回执 principal 回填为 `human:<accountId>`，不改变旧 request hash 或 controllerEpoch。任务索引覆盖可领取、过期 lease 与 match/seat 查询。

模型配置修复沿用既有 007/008 表结构，无新增迁移：model_profiles 保存当前配置，model_profile_versions 每次编辑追加不可变的非秘密快照，model_credentials 保存密文及撤销状态。保存时锁 profile 行并检查 expectedVersion；凭证替换、旧凭证撤销和版本插入同事务。删除设置 deleted_at/enabled 并撤销凭证，不移除历史外键引用。模型绑定以 profile 共享锁与编辑/删除串行化；已有活跃模型绑定时暂时拒绝编辑/删除。

迁移 009_room_lobby.sql：rooms 新增 creator_account_id、visibility、password_hash 与创建者/大厅索引。历史创建者以当前房主回填；历史房为 private，既有重复房间保留，配额由创建事务串行强制检查。密码原文不写入响应或 receipt result_ref。历史 human/script controller 被归还 human、推进 epoch/controllerVersion 并取消旧 epoch 任务；专用 bot 与模型控制器保留。

迁移 010_room_match_rounds.sql：移除 matches.room_id 的全局唯一约束，改为 status=active 的部分唯一索引并增加房间历史索引。match_participants.seat_id 是开局固定的身份，移除其对可重配 seats 的外键，使下一轮缩减座位不破坏历史；动作与 AI 任务仍通过 match_id/seat_id 复合外键引用参与者，开局仍从锁定的房间座位创建参与者。迁移仅将引用 finished 对局的 in_game 房间恢复 waiting、清空 active_match_id、递增 room_revision、取消真人准备。后续结算在原动作事务中执行同样复位，失败完整回滚，旧请求回执不再次复位房间。

## 模型 bot 016/017（2026-10-03）

016 为 seats 增加 bot_model_profile_id，并为 match_participants 增加 model_owner_account_id。模型 bot 保持 account_id=NULL，controller_type=model，保存 model_profile_id 与独立授权 owner；二者的复合外键引用 model_profiles(id,owner_account_id)。真人沿用既有账户/profile 外键且 model_owner_account_id=NULL。017 进一步约束：model 座位必须有模型引用，脚本和真人座位不得有该引用。测试库已应用的 016 初版保持原校验和，约束增强使用后续迁移，不修改其历史含义。

等待房间只保存 profile 引用，开局重新校验所有者、active、enabled、未删除和凭证，并在同一开局事务中固定授权。使用既有活跃绑定保护冻结本局配置；未新增 profile 版本快照机制。模型调用失败继续使用已有合法 fallback。

## 官方 AI 点数（031，2026-10-16）

035（0.19.0）为 official_ai_offers 增加 deleted_at，约束归档项必须停用。目录编辑保留旧行的来源/价格、推进旧 revision 并归档，同事务插入新 ID 替代项；删除仅归档并停用。查询目录和 100 项上限排除归档项，外键、历史配置、预留和账单继续引用旧行。原持久回执在新状态检查前重放，归档项不可重新开放。

031 新增 official_ai_offers（固定来源配置/行动点价、可停用 revision）、ai_point_wallets（整数余额）、ai_point_ledger（发放/行动审计）、ai_point_receipts（账户+请求去重）和 official_ai_reservations（task 唯一、attempt 唯一、预留/ready/charged/released、唯一消费账本引用）。model_profiles 增加 official_offer_id/official_match_budget，官方占位端点不可被普通模型输入选用。余额以钱包行锁串行消费与发放，预留/已消费按 match/seat/payer 累计；正式动作与钱包/账本/回执在原事务提交。model_attempts 保存供应商返回用量或 unknown，不保存 View/State/密钥。独立于桌游币，详见 [官方 AI](official-ai.md)。
