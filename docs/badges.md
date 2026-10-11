# 玩家徽章

第一版包含成长成就与管理员授予的身份荣誉。入口为「我的资料 → 我的徽章」；账户管理中每位玩家的「管理徽章」进入身份荣誉管理。管理员身份本身不自动授予荣誉。

## 获取与展示

| 徽章 | 获取条件 |
| --- | --- |
| 初来乍到 | 已创建平台账户 |
| 初试身手 | 完成 1 局正式对局 |
| 常来坐坐 | 完成 10 局正式对局 |
| 桌游老友 | 完成 50 局正式对局 |
| 游戏探索家 | 完成 3 个不同 gameId 的正式游戏 |
| 内测玩家、社区贡献者、活动荣誉 | 管理员按实际情况授予，可以收回 |

成就每次读取时由服务端固定 `match_participants.account_id`、`matches.status='finished'` 与精确安装版本清单计算，不修改对局事务、RNG 或规则。历史记录自动纳入；进行中、中止及 `developmentOnly` 游戏不计入；同游戏不同版本不增加探索种类。与 AI 完成的正式对局计入，主动托管不取消原账户参与资格，离开房间也不取消资格。成就不是胜场、排名或竞技认证，现阶段不推断各游戏的胜负规则。

成长成就不新增永久授予记录或获取时间：其进度随保留的权威对局记录计算，若维护者将来删除历史记录，进度可能减少。身份荣誉持久化保存授予时间与授予管理员；再次授予已有徽章不覆盖原授予时间，收回后重新授予会产生新时间。管理员命令回执保留授予和收回审计，不通过玩家接口公开管理员账户。

玩家可选择 0–3 枚已获得徽章，按选择顺序展示于本人资料与公共聊天头像名片。默认不展示，未解锁徽章不能选择。收回荣誉与移除精选展示在同一事务完成；资料重新加载或名片重新打开时读取最新状态。没有即时解锁推送、全局通知、上传徽章、自定义荣誉、付费徽章或游戏专属成就。

## API 与权限

以下路径统一以 `/api/v1` 为前缀，所有响应（含错误）`no-store`。

| 方法与路径 | 权限与内容 |
| --- | --- |
| GET `/profile/badges` | 登录本人；全部徽章、条件、截断到目标的进度、获得状态、精选顺序及 revision |
| PUT `/profile/badges` | 登录本人 + Origin/CSRF；`{requestId,expectedRevision,displayed}`，最多三个无重复徽章 ID |
| GET `/profile/badges/:id` | 登录玩家；仅对方主动选择且仍获得的徽章；不返回未解锁进度、账户资料或完整收藏 |
| GET `/admin/accounts/:id/badges` | 管理员；指定玩家完整徽章收藏 |
| PUT `/admin/accounts/:id/badges` | 管理员 + Origin/CSRF；`{requestId,expectedRevision,badgeId,granted}`，仅三种身份荣誉 |

输入与输出由 `packages/protocol/src/badges.ts` 定义，SDK 提供 `badges`、`displayedBadges`、`saveDisplayedBadges`、`adminBadges`、`grantBadge`。新增公开协议进入开发者 SDK 白名单。

写事务重验账户状态与有效 session。本人展示使用专属回执；管理员授予复用现有管理员事务、锁与回执。相同 requestId/相同输入优先返回原结果，不受之后 revision 影响；不同输入复用返回 REQUEST_ID_CONFLICT。客户端成功或重试后读取当前收藏，避免旧成功回执覆盖后来收回。revision 冲突要求刷新，未确认结果保留原请求与选择供重试。成就自然增长不增加配置 revision，写入仍独立验证是否已获得。

完整收藏在一条 SQL 中同时读取进度、精选和身份荣誉，避免 READ COMMITTED 多查询混用快照。配置行锁串行化展示与授予，回执失败同时回滚授予、精选与 revision。

## 数据与更新

执行 `pnpm db:migrate` 应用 `030_player_badges.sql` 后，加载新版 API 与 Web：

新迁移通过 `.gitattributes` 固定 LF，防止 Windows checkout 换行转换改变原脚本的字节校验和；不改变历史迁移的换行约定或校验记录。

- `player_badge_settings`：每账户一行，精选数组及 revision；首次写入惰性创建。
- `player_badge_grants`：账户/徽章唯一，保存当前身份荣誉和授予来源。
- `player_badge_receipts`：本人展示命令的原输入与结果，随账户保留，没有自动清理。

管理员操作继续写 `admin_command_receipts`，不新增授予权限通道，不回填或修改历史对局状态。

## 可选封面与 3D 模型（2026-10-11）

每枚徽章可独立提供封面、3D 模型，两者也可单独使用。默认清单为空，所有现有徽章继续显示原符号；没有内置示例模型。此功能是代码仓库管理的公开静态素材配置，不是玩家或管理员上传入口，不改变获得条件、展示资格、精选数量或数据库/API。

将素材放入 `apps/web/public/badges/`，在同目录 `manifest.json` 按徽章 ID 配置。例如准备好对应文件后：

```json
{
  "welcome": {
    "poster": "/badges/welcome/cover.webp",
    "model": "/badges/welcome/model.glb"
  },
  "contributor": {
    "poster": "/badges/contributor/cover.png"
  }
}
```

可用 ID：`welcome`、`first-match`、`ten-matches`、`fifty-matches`、`explorer`、`beta-player`、`contributor`、`event-honor`。只填写已存在的文件；不需要模型的徽章省略 `model` 或整条配置。封面为透明 PNG/WebP，模型为 glTF 2.0 二进制 GLB；路径须以 `/badges/` 开头，只允许字母、数字、下划线、连字符及子目录，不接受外部 URL、查询参数或目录跳转。

Blockbench 保留 `.bbmodel` 作为制作源文件，导出 glTF 后打包为 GLB（可通过 Blender 导入 glTF 再导出 GLB），把网格和贴图全部嵌入单文件。建议采用低面数、小贴图、单枚模型尽量控制在 2 MB 内；当前没有自动优化或上传大小检查。仅使用自行制作或已授权且可信的素材。不要使用外链纹理、DRACO/Meshopt 压缩、KTX2 或需额外远程解码器的扩展；当前接入以普通自包含 GLB 为验收格式，不提供这些扩展的本地解码资源。

徽章墙仍以封面/原符号展示，只有配置模型时出现「查看 3D」；个人资料与聊天名片对应徽章可点击打开预览。预览用原生模态弹窗，按需加载 `@google/model-viewer` 与模型，支持鼠标/触屏及方向键旋转，不自动旋转或播放动画。关闭/Escape 返回触发按钮，移除预览元素并清理监听与超时。加载错误或等待超过 30 秒可重试；模型失败不阻止普通展示和保存精选。封面失败回退原符号；清单缺失、请求失败或校验不通过时整份清单回退为空，刷新页面后重新读取。

素材和清单随 Web 构建交付，添加或替换后重新构建并走既有发布流程；单纯修改开发源文件不会更新线上网站。所有这些素材均为公开内容，不得包含私密信息。未配置真实模型之前，生产页面不会出现 3D 按钮。
