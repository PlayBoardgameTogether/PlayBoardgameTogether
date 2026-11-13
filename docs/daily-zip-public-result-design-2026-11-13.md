# D15：在线 ZIP 游戏公开结果设计

执行日期：2026-11-13（北京时间）；原排期 D15 / 11-20，按每日任务顺序提前推进。

**D15 设计已完成，运行时尚未实现。** 基线为最新 `main@add094003876376b8fef83b7cfde5b9aeea87f76`，平台 **1.2.6**。本轮仅交付设计、兼容边界与后续验收清单；D16–D21 仍未开始，不把本方案写成已可安装的包契约。[ADR-011](adr/011-optional-package-public-results.md) 状态为 Proposed。

## 已核对的实现与缺口

| 当前代码 | 核对结果与设计约束 |
| --- | --- |
| [公开结果投影](../apps/api/src/registry/public-results.ts)、[registry](../apps/api/src/registry/index.ts) | `resultSummaries` 仅为五个精确内置/验收扩展版本显式注册。回调已接收 `outcome` 与固定参与者席位；不能给全部 ZIP 自动注册现有 `publicResult` |
| [MatchService](../apps/api/src/matches.ts) 的 `applyLockedAction` | 真人与自动行动共用终局路径：转换、恢复校验、outcome、摘要、State/RNG/revision、回放、房间复位、动作及回执都在原事务中；不需要第二条结算写入接口 |
| [结果 DTO](../packages/protocol/src/match-result.ts)、[ProfileService](../apps/api/src/profiles.ts) | 已有 `{players:[{seatId,winner,score?}]}`、本人 `winner/sharedWin/score?` 和按游戏过滤游标。DTO 自身不验证完整参与者集合，ZIP 适配器必须补验 |
| [PackageRuntime](../apps/api/src/registry/package-runtime.ts) | 规则同步运行于逐次新建的有界 QuickJS；`getOutcome` 目前只作为 JSON 返回，没有公开结果投影。不能从任意 outcome 的字段名认定信息公开 |
| [包读取](../apps/api/src/catalog/game-package.ts)、[安装/装配](../apps/api/src/catalog/package-service.ts) | `game.json` 严格接受 format/rules/presentation；数据库单独保存源码、规则与图片，没有保存可选结果声明。安装自检只检查初始 outcome 状态，不证明任意终局正确 |
| [版本恢复](../apps/api/src/matches.ts)、[摘要构造](../apps/api/src/catalog/package-service.ts) | ZIP 规则摘要包括固定格式/引擎标记、包 hash、源码和公开规则；内置摘要还读取 SDK 核心源码。改 SDK 核心或给所有旧包加摘要后缀，都可能使原局 `RECOVERY_BLOCKED` |
| [结算面板](../apps/web/src/matches/MatchResultPanel.tsx) | 已支持共同胜出、无分数及未知摘要；未知时保留最终桌面，回放/回房间/本人记录入口已存在。D18 验证实际衔接，不重复建设页面 |

已核对平台锁定的 UNO 休闲版：当前集成源码为 1.2.0，`getOutcome` 提供公开 winners、没有 scores；当前正式版本为 D14 已交付的 1.2.1，不能将平台副本当作其唯一开发来源。D17 必须重新获取 [UNO 独立仓库](https://github.com/PlayBoardgameTogether/playboard-game-uno) 的最新源码、发布配置与真实 ZIP，核对终局规则后接入，不修改集成副本或覆盖 1.2.1。毫不留情不在本次试点范围。

## 拟采用的可选契约

继续使用固定三文件 `boardgame-package-v1`。在 `game.json` 增加可选、严格枚举的声明：

```json
{
  "format": "boardgame-package-v1",
  "rules": "该版本的公开规则说明",
  "publicResult": "winners-scores-v1"
}
```

声明代表作者明确承诺该版本输出的是面向所有原参与者的公开结果；管理员审核仍须核对来源、规则和隐私。严格字段限制不能证明一个数字没有编码秘密，不能将运行时校验等同于隐私审计。

声明包的 `server.js` 必须提供同步 `game.getPublicResult(outcome)`；仅接收该次权威 `getOutcome` 的 JSON，不获得身份、数据库、宿主回调或 RNG。方法通过原 QuickJS 调用，不能在 Node 中执行上传函数。传入的 outcome 仍是服务端数据，可以含内部字段；只有下述严格白名单返回值能够离开结果适配边界。

```typescript
// 设计示意，尚未加入 SDK 或运行时。
type PackagePublicResult = null | {
  winners: string[];
  scores?: Record<string, number>;
};
```

- 未声明：不注册结果回调，保持旧包行为；即使源码恰好有同名方法也不自动启用。
- 已声明但缺少方法、声明值未知或类型错误：检查/安装失败，不产生安装记录、回执或上架变化。
- 已声明：仅在原终局动作事务检测到 `status === 'finished'` 后调用；普通进行中动作、快照读取、回放和个人记录读取不调用。
- 返回 `null`：作者明确没有可记录的公开结果，终局正常提交且摘要为 NULL。缺方法、`undefined`、异步对象、抛错、超时或非法结构不能被转换成 `null`。
- 新方法只投影 outcome；未来需要更多公开信息时由游戏在新版本 outcome 中提供并显式投影，不扩展为宿主读取 State 或客户端猜成绩。

无需修改现有 `GameExtension` 必需方法、HTTP/WS DTO 或 SDK 核心源码。包专有声明和投影保留在 catalog/registry 边界，避免仅为一个可选能力改变全部内置游戏规则摘要。

## 结果语义与严格校验

适配器先将输出作为 `unknown`，按严格 schema 校验，再与当前 match 的固定 `match_participants` 核对；不使用当前房间座位、浏览器 seatId 或作者传入的参与者列表。

| 输入情形 | 保存与展示语义 |
| --- | --- |
| 一名 winners，无 scores | 该席位胜出，其余未胜出；所有玩家省略 score，不补 0、不算负分 |
| 多名 winners | 各自标记 winner=true；本人记录的 sharedWin 仅对胜者为 true，不按分数重新打破并列 |
| 全员 winners | 仅当游戏明确给出全员获胜时接受；不能将“平局”自动变成全员共同获胜 |
| 提供 scores | 必须恰好覆盖固定参与者全部席位，值为有限数字；保留负数、0 和小数。不以分数排序推断胜者或名次 |
| `null` 或旧包未声明 | `result_summary=NULL`；结果未知，不计成失败、0 分、平局或胜利；保持现有最终桌面说明 |
| 空 winners、重复/陌生席位、缺失/多余分数键 | 拒绝；不能制造全部未胜出的“已知结果”。当前 DTO 没有独立平局/合作失败类别，这些情形由作者返回 null |
| 任意额外字段，包括 hands、reason、排名、账号或任意文本 | 整份拒绝，不先剥离后当作成功；公开摘要仅投影 seatId/winner/可选 score |

`winners` 为 1–20 个唯一、1–128 字符的固定席位 ID，且不超过本局人数；scores 若出现只能使用同组席位键。最终 `players` 按 `seat_index` 排序，由宿主逐席构建，不能由包增删参与者。输出仍通过现有 `matchResultSchema`。

沿用 QuickJS **16 MiB 内存、512 KiB 栈、100 ms 执行和 256 KiB JSON 结果上限**；结果投影另加最多 **16 KiB 编码长度**，小于全局结果上限，不放大任何现有限制。新的调用包装须区分显式 null 与 undefined，并拒绝非同步 JSON 返回值；不得复用当前把 undefined 统一归为 null 的通用 `call` 而丢失这一差异。

非法结构/席位/分数返回既有 `VALIDATION_ERROR`；VM 执行失败/超限沿用 `ACTION_NOT_ALLOWED`。响应和日志只含固定错误文案及既有追踪标识，不附原始 outcome、源码、投影值、异常或 schema 输入。既有内置投影的宽容剥离/null 行为保持，本次不顺带更改其错误语义。

## 装配、存储与终局事务

1. 包读取在严格 descriptor schema 增加 `publicResult` 枚举。检查阶段校验方法存在；最小/最大人数自检若初始状态已结束，额外校验其投影，否则不伪造终局，也不声称已验证终局。
2. 用后续新增迁移为 `game_packages` 增加可空 `public_result_contract`，约束为 NULL 或 `winners-scores-v1`；旧记录保持 NULL。安装声明、源码、桌面、包 hash、图片、目录切换和安装回执仍在同一事务保存，不改历史迁移。
3. `refresh/register` 读取持久声明。PackageRuntime 提供独立结果适配入口，在 QuickJS 检查并调用可选方法；GamePackageService 按 `gameId@version` 注册到原 `registry.resultSummaries`。使用现有 `(outcome,seats) => MatchResult|null` 回调即可，无 gameId 特判，无第三套状态存储。登记完成后才标记该精确版本 loaded，失败不得遗留可被误认为完整装配的版本。
4. `applyLockedAction` 保留原调用位置及锁序。投影失败直接抛出脱敏错误，原外层事务回滚；不降级为成功无摘要、不异步补写、不在读取时补算。
5. 只有提交成功才确认并广播；重试成功请求继续优先返回原回执，不受新 revision 或终局状态阻挡。自动行动复用原 proposal/epoch/decisionId/预算校验及动作事务，结果不另行收费或发币。

失败回滚范围须包括 State、RNG、revision/status、摘要、回放帧、房间 waiting/ready 复位、动作记录、命令回执及关联自动任务/账单变更。声明了非法投影的包可能无法完成其终局动作，这是明确的失败语义；必须靠独立游戏终局测试在发布前发现，不能为避免卡局而绕过校验或改写已安装字节。

## 精确版本与兼容安排

| 组合 | 预期行为 |
| --- | --- |
| 新平台 + 旧包/旧活动局 | 声明仍为 NULL；不注册新回调，保持原规则/资源摘要和恢复流程，终局仍无新增摘要 |
| 新平台 + 旧结束局 | 直接读取已存摘要或 NULL；不执行新投影，不回填历史成绩 |
| 新平台 + 新声明包 | 经过严格安装后，原终局事务写入结果；API 重启从持久声明恢复同一回调 |
| 1.2.6 旧平台 + 新 ZIP | 旧 `game.json` 的 strict schema 会拒绝 publicResult，手动安装和官方订阅均应失败并保留原版本；不能静默安装后丢掉声明 |
| 旧平台连接已装有新包的数据库 | **不能承诺可降级运行。** 旧 refresh 不读取新列，可能忽略声明；新包安装后不得自动回退到 1.2.6。D21 发布前必须核对并提供运维阻断方案；不能靠旧校验器自行识别已持久化声明 |

新声明包的 rule digest 须加入明确的结果契约版本标记；未声明旧包的摘要构造必须逐字节保持现有路径，不能追加 `null`、空字段或整体修改引擎标记。包 hash 已覆盖新声明和源码；额外标记将运行时对新投影的解释绑定到新包，不给旧包制造恢复差异。内置源码指纹不变；不把新接口塞进被所有内置摘要读取的 SDK index。

兼容方向为新平台继续支持所有旧包/旧局，不保证旧运行时接受新能力。现有 SDK `^0.1.0` 没有平台结果能力标记，不用伪造 SDK 版本表达兼容。未来 D16 平台属于向后兼容新能力，预计 **MINOR** 升级；精确版本在其交付时决定，本轮保持 **1.2.6 → 1.2.6**。

发布顺序：先验收并部署平台支持，再在 UNO 独立仓库生成新游戏版本；先验证真实 ZIP 及旧局兼容，之后才按授权发布新标签/ZIP/release.json/SHA256SUMS。旧平台严格拒绝新 descriptor 的自动回归、平台实际运行版本核验及降级限制，是游戏正式发布前的门槛。若实现需要改变旧规则摘要、迁移旧 State 或改变既有 DTO 含义，停止该实现并重新确认迁移范围。

目录仍使用原 [官方登记](game-repositories.md#官方游戏目录登记与每次发布检查)；本轮只做平台内部设计，无游戏更新、版本发布或目录变更。D17 必须核对 catalog、独立仓库 release.config 和包 manifest，元数据不变则记录“登记已核对，无需改动”。来源锁仅在正式导入完整 SHA 时更新，订阅发布不自动漂移平台副本。

## D16–D21 实施与验收入口

以下均为后续待执行项，本轮没有将它们计为测试通过。

| 范围 | 应扩展的入口与关键可观察断言 |
| --- | --- |
| D16 / 解析与 VM | `tests/unit/game-packages.test.ts`：旧三文件包照常加载；声明值/方法不符拒绝；只有显式声明启用；进行中不调用；显式 null、单胜、共同胜出、无分数、负/零/小数分正确；缺失/多余键、重复/陌生席位、空胜者、额外秘密字段、undefined/异步/非有限值、异常/超时/超长返回均拒绝且错误不含秘密标记 |
| D16/D19 / 持久与原子性 | `tests/integration/game-packages.test.ts`、`computer-results.test.ts`：安装声明原子保存；存储故障无半安装；终局非法投影/持久故障使前述全部状态不变；原 requestId 重试仅一次结算，不同内容复用 ID 冲突；真人和脚本同链；API 重建后恢复声明、原精确规则与摘要 |
| D17 / UNO 试点 | 独立 UNO 仓库终局规则测试和真实打包/QuickJS 校验；公开 winners 与权威结果一致，含规则允许的共同胜出；无 scores。平台相关 UNO E2E 使用真实 ZIP，真人/脚本完整局、回复丢失/重试及原版本活动局恢复；不从手牌数反算平台结果 |
| D18 / 已有 UI | 结算卡、回房间/回放、本人按游戏筛选记录，桌面与手机实际渲染；未知摘要保留说明，账号切换和分页不串数据，旁观/非参与者不能因“公开结果”绕过原读取权限 |
| D19 / 兼容 | 固定旧包/内置摘要与原活动局夹具跨升级相等；同库新旧包/旧结束局共存，无回填；旧 descriptor schema 对真实新 ZIP 明确拒绝；源码/版本缺失或摘要篡改拒绝恢复，不换最新版 |
| D21 / 发布顺序 | 平台部署实际 SHA/版本、服务/ready 通过后才发布依赖包；核对订阅失败保持旧安装、旧版本保留及不可降级边界；记录平台提交、游戏提交/版本、Release 附件与实际安装，不能互相代替 |

D16 的 TypeScript/持久化/包导出影响要求 typecheck、lint、相关单测、原 `pnpm test:integration` 和 build；D17–D19 有用户流程时走原 `pnpm test:e2e` 准备链。集成和 E2E 必须使用明确独立的 TEST_DATABASE_URL，并串行清理；不在开发/生产库验证回滚。

## 本轮实际验证与交付边界

- 已重新 `git fetch origin main` 成功；原目录落后 main 143 个提交且有 36 项既有变更，保持不动。使用已存在、干净且与 main 无差异的 `/tmp/playboard-d15-result-design` / `codex/d15-zip-result-design`，无其他未交付提交。
- 逐项核对上述调用者、DTO、迁移、包解析/装配、现有结果与包测试。`git diff --check` 通过；文档检查脚本确认仅本轮五份 Markdown 变化、21 个新增相对链接存在、两份新文档代码围栏配对、package/README 同为 1.2.6。首轮全历史链接扫描遇到 progress 中既有 Windows `file:///` 链接，未修改无关历史，改为只校验本轮新增链接后通过。仅内部设计不运行数据库测试、E2E 或构建，不将历史结果计成本轮通过。
- **23:38:23（北京时间）**，服务器 current.json 的 `add094003876376b8fef83b7cfde5b9aeea87f76` 与实际 API 进程 cwd 一致，运行 package.json **1.2.6**；服务 active/running、NRestarts=0，本机 `/health/ready` 200、database.ready=true。仅只读核验，没有请求安装、写生产库、重启、发信或调用收费模型；本轮文档尚未同步服务器，不把 D14 公网验收当作本轮重测。
- D3 的生产收件→注册→登录、其余四个头像候选及真机/WebKit 条件保持原记录；本轮不扩大处理范围。

交付状态将在文档检查与提交完成后补记。
