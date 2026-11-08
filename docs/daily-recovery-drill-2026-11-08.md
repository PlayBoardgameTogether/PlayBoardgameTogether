# D6：备份校验与隔离恢复演练

原排期 2026-11-11；2026-11-08 按用户“继续推进每日任务”提前执行。**隔离恢复已通过；备份脚本修复为 1.2.3 候选，生产切库、合并与监督进程维护未执行。**

## 基线与范围

开始及运行脚本修改前均成功获取 main，基线为 `96d57febdd476d0ab3da1d65850342ed352bfb13` / **1.2.2**。原工作区的 36 项已有改动保留；本轮在 `/tmp/playboard-d6-recovery-drill`、`codex/d6-recovery-drill` 独立实施。

读取现有交付记录并通过 GitHub 复核：D4 [PR #55](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/55) open，head `889b52d`；D5 [PR #56](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/56) open，head `c3e418a`，仍以 D4 分支为 base。D3 的真实收件已由用户确认，完整注册/登录仍待；不重发邮件、不创建生产账号。D5 的 1.2.2 是旧候选，当前 main 的 1.2.2 来自已合并的游戏图片修复；后续合并 D5 必须重新核对版本与完整差异，不能覆盖图片改动。本轮不混入两个 PR。

真实目标 `/opt/boardgame`、`boardgame-local.service` 为 active/running、NRestarts=0；私有 current.json 指向上述 main SHA / 1.2.2。使用原独立 PostgreSQL 17 测试容器 `playboard-daily-test-20261105`、回环端口 **15441**；scratch、测试源库、恢复库分别命名，未连接生产数据库执行写操作。

## 已有生产备份恢复

选择最新完整目录 **update-uEXMkv**，创建时间 `2026-11-07T15:41:45.338Z`，即北京时间 11 月 7 日 23:41:45。其 previous 为 `cdb349950d5976e396e5a9af69c4830843d23364`，candidate 为 `96d57fe`；数据库按 previous 的构建核验。

- 清单 **76 个文件、6,045,158 字节**全部核对；其中数据库 custom archive 为 **5,737,955 字节**，其余为资源、私有恢复配置及版本元数据。没有打印配置或复制主密钥到应用环境。
- 经原 `prepare-test-db.ts` 隔离检查新建 `playboard_d6_production_restore_test_20261108`，随后实际执行 `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --dbname=<本轮恢复库>`。连接仅在 libpq 环境中指向 15441；拒绝已有目标，不使用 `--clean`。
- 将资源复制到私有新目录，只读 REPEATABLE READ 核验 **40 项迁移 checksum**与 previous 构建一致，**15 个在线游戏精确版本**可读，**76 条有效资源记录**对应文件长度/摘要正确（存储去重后 73 个资源文件），对局精确安装版本缺失数 **0**。
- 副本包含 **10 局已结束、0 局活动对局，573 个行动、711 个命令回执**；只输出这些汇总，不输出账户、session、手牌、State 或 RNG。没有启动该副本的 API、调度器、邮件或订阅。
- 首次数据库恢复成功，资源复制因辅助脚本先建立空目标目录而被 `errorOnExist` 拒绝。修正为直接复制到不存在的目标，移除本轮空目录后只续接资源/只读校验，未重复覆盖数据库。首次命令总墙钟约 0.59 秒但不是完整恢复耗时；续接验证 66 ms，数据库恢复单独计时未留存，不补造数值。

## 活动局与回放的真实往返

新增通用 `tests/integration/backup-recovery.test.ts`，不改游戏仓库或平台锁定副本。通过原 `test:integration` 准备、迁移、游戏/资源同步链在 **playboard_d6_source_test_20261108** 创建专用账号，用平台原三文件示例 ZIP、真实 session/API/QuickJS/事务建立一局活动局和一局已结束局。

应用关闭后调用真实 `backupUpdate`、校验完整清单，在同一专用容器随机新建 `playboard_restore_test_*` 空库，真实 pg_restore 并复制资源。恢复前后完整比较 matches（含 State/RNG/revision/版本）、参与者/控制权、房间、行动、命令回执和包摘要；重新认证原测试会话后验证：

- 本人快照保持；旧 requestId 在新的 revision 下仍返回原成功，不重复行动。
- 恢复后可提交下一合法行动；原测试源副本执行相同下一行动，State/RNG 完全相同。
- 已结束局的初始/终局本人回放可读取，精确版本保持；非成员读取被拒绝。
- 资源字节一致；本轮随机恢复库和私有临时备份在 finally 清理。

该往返 **1/1，无 skip**；实际备份与校验 **181 ms**，pg_restore 加资源复制 **171 ms**，77 文件/504,703 字节。数字仅代表这份小型测试数据及当前机器，不承诺生产恢复时间。生产备份没有活动局，因此活动行为的证据来自这条专用测试，不冒充真实玩家活动局演练。

## 实测修复与验证

首轮受控往返在 `pg_dump` 失败；最小 schema-only 诊断确认其尝试默认本地 socket。核对 API 运行目录与长驻监督进程启动目录后发现：**服务器已有 `postgresClientEnvironment` 运维补丁，main 尚未包含**。本轮将等价的显式 libpq 参数转换纳入 `scripts/update-backup.mjs`，额外规范 IPv6 主机括号；不覆盖服务器文件、不修改运行配置。

新增 `scripts/verify-update-backup.mjs` 只读工具，核对完整文件集合与摘要，拒绝路径穿越、重复/缺失/多余项和符号链接；CLI 失败不回显原始解析错误或私密路径/配置。补充[恢复操作说明](recovery.md#在线更新备份的隔离恢复)，明确 previous/candidate、空库、凭据、后台任务及清理边界。

| 实际命令 | 结果与范围 |
| --- | --- |
| `pnpm install --offline --frozen-lockfile` | 成功，未升级依赖或修改锁文件 |
| `pnpm --config.verify-deps-before-run=false typecheck` | 全工作区与现有测试配置类型检查通过；后续仅 JS 修复/文档/版本改动，不重复无影响的 TS 检查 |
| `pnpm ... lint` | ESLint、20 个源码根 AST 和原格式检查通过；后续 JS 补丁发现 `URL` 全局 lint 错误，改为显式 `node:url` 导入后，全部五个受影响代码/测试文件定向 ESLint 通过 |
| `node tests/deployment/update-backup.test.mjs` | **13/13，无 skip**；既有失败恢复/顺序/完整备份，加编码凭据、TLS、IPv6/socket 与无秘密错误 |
| `node tests/deployment/verify-update-backup.test.mjs` | **4/4，无 skip**；正常完整核验、损坏/缺失/多余、穿越/重复/不完整、链接保护。沙箱中的 `node --test` 仅显示文件汇总，最终采用直接执行各 node:test 文件的逐用例结果计数 |
| 原 `pnpm ... test:integration --config .data/d6/vitest.config.mjs` | 首轮 0/1，复现上述默认 socket 故障；连接补丁后经原完整准备链复验 **1/1，无 skip**，含实际 dump/restore，不用 mock 命令 |
| `pnpm ... build` | 全工作区生产构建通过，包含 bundle、编译 API、隔离 ZIP 恢复和 AI worker；保留既有模型查看器大 chunk 提示 |

没有交互、页面布局、SDK/API/WS 或迁移变化，不新增 E2E，也未运行无关游戏全量回归。资源准备使用原原创 SVG 回退。日志、私有配置与脱敏结果留在忽略 `.data/d6/`；不提交数据库、资源副本、凭据或生成文件。

平台 **1.2.2 → 1.2.3（PATCH）**，因为备份运行脚本兼容修复；README 同步。游戏/在线包/workspace 包版本、官方登记、来源锁均不变，本轮没有游戏发布或安装操作。

## 交付边界

没有恢复生产库、停服、主动更新、发信或模型调用。真实恢复副本只作只读检查，已按精确库名删除本轮生产恢复库与测试源库、删除资源副本，随机恢复库残留为 0；原生产备份保持。2026-11-08 23:00（北京时间）复核 current.json、API cwd 与 package.json 仍一致为 `96d57fe` / 1.2.2，systemd active/running、NRestarts=0，匿名 Chromium 公网 ready 200 / database.ready=true。提交、推送及 PR 结果在本轮交付时补入；未获准合并前不把候选 1.2.3 说成上线。监督进程已有的服务器补丁保持，后续加载已合并脚本时仍需比较及原维护验收。

D6 的隔离恢复验收完成，下一独立主题为 D7 缓冲：先核对 D4/D5 待合并依赖、版本冲突及剩余真实邮件闭环，不提前实现后续游戏功能。异机恢复、生产角色/权限映射、真实活动玩家对局、物理设备及灾难恢复时长均未验收。
