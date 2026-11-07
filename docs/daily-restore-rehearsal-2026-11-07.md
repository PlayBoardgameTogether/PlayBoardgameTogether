# D6 备份恢复演练

北京时间 2026-11-07，提前执行 [D6](30-day-update-plan-2026-11-06.md)。使用本地专用 PostgreSQL 17 容器、两个独立数据库和各自的资源目录。源库中的账户与对局均为本轮测试数据，恢复库从空库开始。生产备份的取用、跨主机恢复与线上切换另行验收。

## 演练流程

1. 核对源库、目标库和资源目录。目标库必须为空，且与源、开发、生产库不同。用 `pnpm exec tsx scripts/prepare-test-db.ts`、`pnpm exec tsx scripts/migrate.ts --test`、`pnpm exec tsx scripts/sync-games.ts --test` 和 `pnpm exec tsx scripts/seed-assets.ts --test` 准备源测试库。仅向进程提供演练用配置。
2. 从 [五子棋 1.0.3 正式 Release](https://github.com/PlayBoardgameTogether/playboard-game-gomoku/releases/tag/gomoku-v1.0.3) 下载精确 ZIP、`release.json` 与 `SHA256SUMS`，核对标签提交、版本、游戏 ID 和实际 ZIP 摘要。通过管理员原安装接口安装 ZIP，用真实 session、Origin 和 CSRF 建立一局已走两步的活动局及一局已结束的九步对局。记录参与者视图和回放、迁移历史、包版本与摘要。
3. 关闭源 API，等待连接和后台任务退出后，调用在线更新器的 `backupUpdate` 生成数据库自定义格式归档、资源目录、恢复配置及版本清单。Windows 演练将 PostgreSQL 命令和路径映射到专用容器，实际由 PostgreSQL 17 的 `pg_dump` 和 `pg_restore --list` 执行。
4. 核对 `COMPLETE.json` 与实际文件清单，逐文件验证字节数和 SHA-256，核对归档 `PGDMP` 签名及版本记录。使用 `createdb --template=template0` 建立新库，运行 `pg_restore --single-transaction --exit-on-error --no-owner --no-privileges` 并显式指定目标库和归档。将资源复制到独立目录后再次核对摘要。演练用加密主密钥从备份恢复配置载入，数据库地址和资源路径仍使用新目标。
5. 用匹配的代码及恢复后的库和资源启动 API，验证 `/health/ready`、迁移校验和、游戏包摘要、两局的版本与保存状态。使用原测试会话读取本人视图和已结束对局回放，核对非参与者访问被拒。重试一条旧请求确认回执保留，再从备份时的 revision 继续一步，并只读确认源库 revision 保持原值。

## 实测结果

| 检查 | 结果 |
| --- | --- |
| 演练基线 | 平台候选 `adb1b3ad1f8d88da25a7e2db923f1613eec944fb`（1.2.2）。API、更新脚本、协议、游戏及来源锁与远程 `main@cdb3499` 和 D5 候选一致 |
| 数据库隔离 | 专用 PostgreSQL 17 容器仅绑定 `127.0.0.1:15446`。源库 `playboard_d6_source_test_20261107`，目标库 `playboard_d6_restore_test_20261107_1`。源库 40 个迁移全部应用，恢复后校验和逐项一致 |
| 正式游戏包 | 标签提交 `6fee46b49071475688257ff13c51cbe60ac86af6`，`online.gomoku@1.0.3` ZIP 实测 SHA-256 `f6cff578f4c6134259f5fda6840d611989202613eb491a1a7b51d2a0243471d3`。恢复后包摘要、规则源码、桌面及对局锁定的规则、内容和资源版本字段保持一致 |
| 归档与资源 | 185 个文件、63,206,682 字节，大小和 SHA-256 全部通过，包含 182 个资源文件。恢复后的 182 个资源再次通过摘要校验，抽样通过原 API 读取的文件字节与源库记录一致 |
| 可用与耗时 | 备份 3.22 秒。逐项校验、空库恢复、资源复制及启动就绪合计 3.37 秒，其中 API 启动至 `/health/ready` 返回 200、数据库就绪为 0.17 秒。耗时仅代表本地演练样本 |
| 活动局 | 恢复时保存状态、RNG 与本人视图相同。原请求重试返回原 revision 1 回执，当前局仍为 revision 2。合法落子后恢复库进入 revision 3，源库仍为 2 |
| 已结束对局 | 参与者本人可读 revision 9，响应与备份前一致。另一参与者可读取 revision 0 的本人视图，非参与者请求返回 404 |

演练命令为 `node --env-file=.data/d6-recovery-20261107/database.env --import tsx .data/d6-recovery-20261107/rehearse.ts`，结果退出码 0。脚本、附件、归档和演练配置保存在本地忽略目录。原资源准备流程使用了本地已有的可选璀璨宝石图包，文件随本地备份保留。

本轮仅提交内部文档，平台版本沿用各自分支。演练未取用生产备份，未验证跨主机恢复或生产加密凭据解密，未连接生产写入端。D3 真实收件已确认，生产验证、注册和登录仍待闭环。D4 及 D5 交付依赖依次为 [PR #55](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/55) 和 [PR #56](https://github.com/PlayBoardgameTogether/PlayBoardgameTogether/pull/56)。
