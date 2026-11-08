# 对局恢复与故障处理

## 玩家侧

刷新或短暂断网后，保持在 `/matches/<matchId>`。页面按当前 session 找到固定座位，重新订阅并读取完整本人视图；同步期间不能提交新动作。若出现“操作结果尚未确认”，点击“确认操作结果”会查询回执并用原请求继续确认，不要另开标签页构造新动作。会话失效后重新登录原账户，再访问原对局地址。

`RECOVERY_BLOCKED` 表示存档格式、RNG 或规则/资源摘要不匹配。页面保留现有只读局面并暂停操作；恢复对应精确代码与资源后重新加载。绝不能直接改 `matches.state` 或把 gameVersion 改成新版来消除错误。

## 管理员侧

1. 确认 PostgreSQL 可用，并执行 `pnpm db:migrate`、`pnpm games:sync`。先核对 `TEST_DATABASE_URL` 与开发/生产库不同，再运行会清理测试库的测试命令。
2. 检查 `/health/ready`。数据库不可用时业务不会从旧内存状态继续写入；数据库恢复后让玩家重新同步。
3. 某局阻塞时核对其 `game_id`、`game_version`、`content_version`、`resource_pack_id/version` 和已安装的可信扩展。新局还要核对源码/清单摘要；保存备份与原始数据，恢复对应构建。不要把完整 State、RNG、session 或手牌放进工单和日志。
4. API 重启不调用游戏 setup，也不重新发牌。提交前异常终止由数据库回滚；提交后、HTTP 回复前终止时，动作与回执同时存在。客户端以原 requestId 查询/重试可收敛。

真实子进程故障测试覆盖 COMMIT 前和 COMMIT 后丢回复窗口。2026-11-08 的 [D6 演练](daily-recovery-drill-2026-11-08.md)另覆盖已有生产备份的隔离恢复，以及测试账号活动局的备份、恢复、继续行动与回放；不代表异机灾难恢复或生产切库已验收。

## 在线更新备份的隔离恢复

以下适用于 `scripts/update-backup.mjs` 的 `COMPLETE.json` 格式；`deploy.sh` 的归档格式不同，不能混用。先确认当前进程、私有 current.json 和备份所属版本，选择已经完成且不再写入的备份目录。

1. 使用已审查的工具核对完整文件集合、大小和 SHA-256：

   ```bash
   node scripts/verify-update-backup.mjs /private/backups/update-EXAMPLE
   ```

   工具只读，不加载 `recovery-config.json` 到环境、不连接数据库；成功仅输出文件数、总大小、时间与提交号。拒绝缺项、多余文件、摘要差异、路径穿越及目录内符号链接。摘要依赖可信备份和清单的共同保管，不是来源签名。归档另用匹配版本的 `pg_restore --list` 检查。

2. 记录 `release.json.previous.sha` 与对应构建。备份发生在迁移前，数据库属于 **previous**，不能直接按 candidate 运行迁移或重同步游戏。核对该构建的迁移文件与已存 checksum，保留锁定规则、资源及游戏包版本。
3. 在专用 PostgreSQL 实例新建空测试库，确认目标主机、端口、账户及库名，与开发/生产 URL 和名称均不同；恢复命令不使用 `--clean` 或覆盖已有库。测试库准备继续使用项目原隔离检查，不把生产连接填进 `TEST_DATABASE_URL`。恢复连接参数通过私有进程环境传入：

   ```bash
   pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
     --dbname=playboard_recovery_test /private/backups/update-EXAMPLE/database.dump
   ```

   `PGHOST`、`PGPORT`、`PGUSER`、`PGPASSWORD` 和所需 TLS 参数只指向已确认的隔离目标；不把连接 URL/密码放进参数。不要直接加载备份中的生产 `DATABASE_URL`。本地演练的 `--no-owner --no-privileges` 用于测试账户映射；正式异机恢复的角色和权限另行核对。
4. 将 `assets/` 复制到全新的私有目录，核对有效资源记录对应的文件长度/摘要、已安装精确游戏版本与所有对局的版本引用。配置、主密钥与数据库须配套私密保管；不要为了检查而打印配置。含真实用户数据的恢复副本先只读检查，不启动 API、AI、邮件、订阅或其他后台任务。
5. 使用专用测试账号和合成对局验证恢复后的正式链路：原会话读取本人快照、原 requestId 重试、合法行动、确定性 RNG、已结束局初始/终局回放及非成员拒绝。重试不应增加 revision 或消耗 RNG。已有生产备份没有活动局时，单列这个测试范围，不推断所有真实活动局均验收。
6. 记录耗时、命令、失败和实际范围。关闭本轮副本连接，按精确库名删除本轮新建的恢复库并清理副本；保留原备份和脱敏结果。生产恢复仍需单独授权及维护安排，先停止全部写入并保存失败现场，不自动降级数据库。

可重复的受控回归为 `tests/integration/backup-recovery.test.ts`，通过原 `pnpm test:integration` 准备链定向执行；要求可用的 `pg_dump`、`pg_restore` 和测试账户建库权限。它仅对独立 `TEST_DATABASE_URL` 建立测试数据，随机新建 `playboard_restore_test_*` 恢复库，在结束时清理自己创建的库与临时备份，不对生产数据启动应用。
