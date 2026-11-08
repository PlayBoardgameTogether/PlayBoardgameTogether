# D7：第一周修复整合与交付核验

2026-11-09 按用户“继续推进每日任务”提前执行第一周缓冲日。从最新 `origin/main@832f2e8e30076d667924f89011bd415856012d46` / **1.2.3** 建立 `/tmp/playboard-d7-week-one-closeout`、`codex/d7-week-one-closeout`，原目录及其他任务改动完整保留。

## 整合范围

承接 D4 [PR #55](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/55) 的 `889b52dc46775018801bd4d200beb22d83509bda` 与 D5 [PR #56](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/56) 的 `c3e418a3168c7d145ea4231e4e59581afebbf9cb`，保留原提交祖先。重新审查原 PR 全部文件，二者均无阻塞审查；没有纳入昵称或包大小等其他候选。冲突只在 README、根版本、计划和进度记录；保留双方历史事实及 D6 修复，重新编写当前状态。

运行变更仅为原 D5 的订阅面板 CSS：限制箭头尺寸，电脑双选项/三指标、手机单列，沿用现有主题、原生 details/checkbox、键盘及请求恢复逻辑。平台 **1.2.3 → 1.2.4（PATCH）**，README 同步；旧 D5 的 1.2.2 是历史候选，不能覆盖已上线版本。没有协议、迁移、依赖、SDK、游戏规则或包版本变更，来源锁与官方目录保持。

## 本轮实际验证

本轮使用既有专用 PostgreSQL 17 容器的回环端口 15441，新建 **playboard_d7_test_20261109**；运行前确认 DATABASE_URL 为独立 scratch、TEST_DATABASE_URL 为本轮测试库，二者不同且均非开发/生产库。仅新工作区写入私有 `.env`，未覆盖任何已有配置。集成与 E2E 严格串行，均保留原准备、迁移、游戏同步及资源校验链。

| 命令 | 实际结果 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | 冻结安装成功，依赖未升级；初次在版本冲突解决前执行因 JSON 冲突标记拒绝，解决后成功 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 全工作区通过，包含测试类型检查 |
| `pnpm --config.verify-deps-before-run=false lint` | ESLint、20 个源码根 AST 边界、现有格式检查全部通过 |
| `pnpm --config.verify-deps-before-run=false build` | 全工作区生产构建及 bundle/API runtime/ZIP/AI worker 检查通过；保留既有 model-viewer 大 chunk 提示 |
| `pnpm ... exec vitest run tests/unit/official-game-source.test.ts tests/unit/update-backup.test.ts tests/unit/verify-update-backup.test.ts` | 实际只发现来源测试 **3/3**；后两路径不存在，不计为执行，随后使用下面正确入口 |
| `node --test tests/deployment/update-backup.test.mjs tests/deployment/verify-update-backup.test.mjs` | 备份连接、完整性与拒绝损坏输入 **17/17，无 skip**，确认保留 D6 修复 |
| 原 `pnpm ... test:integration --config .data/d7/vitest.config.mjs` | 订阅集成 **7/7，无 skip**；权限/Origin/CSRF、重复回执、revision、下架、并发、关闭中止、授权撤销、部分摘要失败/重试、新旧局精确版本与重启/回放通过 |
| `pnpm ... exec playwright test --config .data/d7/ui.config.ts game-subscription-ui.spec.ts --output .data/d7/ui` | 生产预览 **8/8，无 skip**；1440×900、1280×800、390×844、320×740，未知保存恢复、键盘、箭头尺寸、指标布局、暗色与减少动态偏好通过 |
| 原 `pnpm ... test:e2e tests/e2e/game-subscription.spec.ts --output .data/d7/e2e` | 真实会话/API/数据库/安装运行时桌面与手机 **2/2，无 skip**；保存订阅、安装目录、关闭和刷新恢复通过 |

已实际查看桌面亮色与 320px 手机暗色截图：箭头、选项、指标和操作可见，无整页横向溢出。静态 UI 使用受控 HTTP，真实 E2E 使用原内存发布来源；均不冒充公网正式附件安装或真机。D5 真实波多黎各附件完整对局结果作为历史证据保留，本轮没有重复执行。日志、截图和私有配置只在 `.data/d7/` 等忽略目录，不提交。

## 第一周状态与剩余条件

| 范围 | 当前证据与边界 |
| --- | --- |
| D1 基线、D2 详情直链 | 已交付；D2 原监督修复保留，无新增静态路由变更 |
| D3 邮件 | 用户已确认单封真实收件；本地注册/安全回归已完成。生产验证码验证→注册→登录仍需用户在网页输入秘密信息及专用账号流程，未重发邮件、创建账号、找回或修改 SMTP |
| D4 发布清点 | 七套正式附件及生产安装差异记录整合；三个旧摘要差异保持原字节，六个玩法头像候选尚未正式发布，不把平台展示修复等同于包发布 |
| D5 订阅 | 本轮完整七项集成及双端真实链路通过；面板修复已整合。候选游戏正式发布与生产主动安装仍未执行，不覆盖旧包、不改生产开关、不将历史 current 记录当成本轮新安装 |
| D6 恢复 | 隔离活动局/回放恢复与生产备份演练已完成，修复已上线 1.2.3；本轮备份直接回归通过，无生产数据库切换或恢复 |
| D7 收尾 | 完成本轮整合与必要验证；PR、合并及服务器实际结果另见下面交付记录。D8 新玩家路径检查为下一独立主题 |

没有真实供应商调用、付费模型、游戏发布或生产安装操作；物理手机、Safari/WebKit、屏幕阅读器未验收。原工作区、D4/D5 证据目录保留；合并与分支清理须按精确 head/祖先与实际 GitHub 状态核验。

## Git 与服务器交付

开始及提交前成功 fetch main，基线未变化。生产只读复核：current.json 与运行 package.json 为 **832f2e8 / 1.2.3**，systemd active/running、NRestarts=0；这是本轮合并前状态，不将候选说成上线。最终 PR、运行 SHA、健康、受影响资源及备份校验结果在操作成功后补记。
