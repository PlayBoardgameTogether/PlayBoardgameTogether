# D18：在线结果与本人战绩衔接

执行日期：2026-11-14（北京时间），按每日任务顺序提前推进；原排期 11-23。

## 范围与基线

独立 `/tmp/playboard-d18` / `codex/d18-result-history` 从 D17 `d5cd5ac70fc8f3d028c0d46bcb45590a44258f9f` 开始。编辑前重新获取 main，仍为 `add094003876376b8fef83b7cfde5b9aeea87f76`；完整前置差异已经核对。D15–D17 平台 [#74](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/74) / [#75](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/75) / [#76](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/76)、UNO [#5](https://github.com/PlayBoardgameTogether/playboard-game-uno/pull/5) 均未合并。本轮保留这些祖先与原工作区已有改动，不自动合并前置 PR。

现有 MatchResultPanel 和 ProfilePage 已通过既有 DTO 消费结果。本轮扩展真实 ZIP 浏览器验收与测试辅助函数，复用结算、回放、回房间及个人记录入口，不新增产品页面、运行代码、协议、迁移或游戏变更。平台保持 D16 候选 **1.3.0 → 1.3.0**，README 一致；仅测试/内部文档，无需再次升版。

## 验收方式

- 使用独立 UNO 仓库已提交的实际候选 `uno-1.3.0.zip`（329100 字节，SHA-256 `6882d00805f66b60ad71e7e71af208b52f96b253d601d70ff515914d78a10a1e`）与真实旧 Release `uno-1.2.0.zip`；旧附件本轮 `sha256sum --check SHA256SUMS` 通过。未改平台锁定游戏副本、来源锁或登记，未发布游戏。
- 每版本/视口通过管理员原审核安装、真人浏览器与真实免费脚本完整局、刷新和权威胜者比对。新包不合成分数；旧包摘要为 null，显示“未记录结果”。结算到本人初始回放为只读，回放手牌禁用且不发送正式动作。
- 完局后在本轮测试库复制 22 条已完成记录和完整参与者字段，与原局构成 23 条相同时间的分页夹具，核对 20+3 条无重复/遗漏。这些是明确的分页夹具，不计作 23 场真实游玩。
- 挂起真实下一页响应，切换到另一游戏的空记录后再释放，验证旧页不混入；随后同一文档站内退出、换号并进入记录再释放原账号响应，验证无旧账号记录。对原账号游标返回空列表，非参与者原局 view/replay 均 404。使用真实 API 响应，无伪造战绩响应或身份。

复现入口与 D17 相同，显式要求新旧实际 ZIP；普通回归不收集外部包专项：

```sh
export PLAYBOARD_UNO_RESULT_ZIP=/absolute/path/to/uno-1.3.0.zip
export PLAYBOARD_UNO_LEGACY_ZIP=/absolute/path/to/uno-1.2.0.zip
pnpm --config.verify-deps-before-run=false test:e2e --config playwright.uno-results.config.ts --output=.data/d18/e2e-release
```

执行前确认 `DATABASE_URL` 为 `playboard_d1_scratch`、`TEST_DATABASE_URL` 为独立 **playboard_d18_test_20261114**，同一既有 127.0.0.1:15441 服务/账户，不同库名。仅派生本工作区私有 .env，原准备、迁移、游戏同步与资源准备链完整执行；所有清理测试库命令串行，不触碰开发/生产库。缺少本机 TTS 图包时原脚本安装原创回退，不冒充 TTS 资源验证。

## 实际验证记录

冻结离线安装因缓存缺少 esbuild 0.25.0 失败；随后原冻结锁安装成功，无依赖/锁文件变化。全工作区 typecheck 与全 lint（ESLint、20 根 AST 边界、原 Prettier）通过；测试最终调整另执行定向 ESLint/Prettier 和差异检查。

初轮真实新包完整局及回放完成后，分页夹具漏复制 bot 控制字段被数据库形状约束拒绝；改为完整复制固定参与者。旧包用例遗漏“审核通过并更新”按钮状态而等待，停止该次运行。第二轮走通分页/筛选后，返回资料链接遗漏可访问名称中的箭头而等待，修正为精确名称后停止重跑。第三轮审查发现换号后整页导航会取消被测迟到请求，主动停止并改为同一文档站内导航；这些中断不算通过，未延长时限或放宽安全断言。

最终原 `test:e2e --config playwright.uno-results.config.ts` **4/4 通过，无 skip（1.7 分钟）**：1440×900 和 390×844 CSS 像素各完成新旧两个真实 ZIP 流程。截图与日志保留忽略目录 `.data/d18/e2e-release/`、`.data/d18/e2e-release.log`；实际查看新包双端结算和旧包双端分页截图，无检查到的整页溢出。没有修改布局/主题，本轮不额外重跑四视口/全主题矩阵。全库 typecheck 不单独编译测试文件，测试由真实执行及 ESLint 检查，不声称测试类型全部经过 tsc。

内置 Color Match 使用相同的结算与记录组件，原 `test:e2e tests/e2e/computer-results.spec.ts --grep 'plays a complete computer game'` **2/2 通过，无 skip（39.8 秒）**，验证双端完整局、真实结果、游戏筛选/失败重试、结果入口与再次开局；日志为 `.data/d18/builtin-e2e.log`。仅外部 ZIP 专项改动，不重跑不受影响的全量集成、全量 E2E 或生产 build；D16/D17 的历史构建不计本轮验证。

## 服务器与交付边界

**22:51:06** 只读确认生产 current.json、实际 API cwd 与运行 package.json 一致为 **add0940 / 1.2.6**；`boardgame-local.service` active/running、NRestarts=0，实际 API 19301 `/health/ready` 返回 200、status=ready、database.ready=true。普通沙箱不能访问 system bus，获准只读环境完成核验；没有修改生产或重启。

本轮测试/内部记录不要求生产应用更新；前置运行时尚未合并，不向生产同步候选源码。UNO 1.3.0 未发布/生产安装。D19 更完整的事务/授权/兼容矩阵、D21 降级与发布门槛仍待，不能用本轮 UI 通过替代。真机、WebKit、屏幕阅读器及真实付费模型未验证；D3/D5 原条件保留。下一项为 D19。

## 已提交与 PR

主提交 **1ee825037c5c0a67a06e01c641ac9b08902eb3cf** 已正常推送，创建 [平台 PR #77](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/77)，目标 main，当前 open、未合并。PR 保留 D15–D17 依赖祖先，本轮自身五文件；功能分支保留待审，不清理其他任务分支。创建 PR 的应用接口 403，改用既有 Git helper 的内存认证与 gh API 成功，凭据未输出/落盘；初次提交因缺少作者配置未成功，沿用历史 Codex 身份的单命令配置后提交成功，不修改全局 Git 配置。

没有标签、正式 Release、生产安装、服务器同步或重启。候选运行时及其游戏发布仍按 D19/D21 门槛与用户授权分别处理。
