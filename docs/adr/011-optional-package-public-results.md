# ADR-011：在线 ZIP 可选公开结果投影

状态：**Proposed**，2026-11-13。D15 设计交付，不代表契约已实现或已发布。

现有内置扩展通过 registry 的精确版本显式结果回调接入原终局事务；在线 ZIP 的 getOutcome 没有公开信息声明，不能直接将其 winners/scores 当作可向参与者公开的战绩。旧包、旧局与已保存的规则摘要须继续有效。

拟在 game.json 增加可选 `publicResult: "winners-scores-v1"`，同时要求 server.js 提供同步 `getPublicResult(outcome)`。返回显式 null 或严格的公开 winners/可选完整 scores；宿主校验固定参与者，构造既有 MatchResult DTO。非法输出、异常和资源超限回滚原终局动作事务，不静默忽略，不在读取时补算。方法仍运行于原有界 QuickJS，不进入 Node 或客户端。

声明通过后续可空列与原安装事务持久化，按精确游戏版本装配到已有 resultSummaries。未声明旧包不启用投影，旧摘要构造逐字节保留；无需修改 GameExtension 必需方法或被内置游戏指纹读取的 SDK 核心。历史结果不回填。

旧运行时的严格 descriptor 会拒绝新包；先部署平台再发布依赖游戏。新包安装后不能保证降级旧运行时仍维持结果语义，发布前须明确运维阻断与验证。若必须更改旧摘要、State 或已有公开契约含义，应停止实现并重新确认迁移范围。

完整语义、失败策略、兼容矩阵与 D16–D21 待执行验收见 [D15 设计](../daily-zip-public-result-design-2026-11-13.md)。在实现和兼容验收完成前保持 Proposed，不改写现有包规范为已支持该能力。
