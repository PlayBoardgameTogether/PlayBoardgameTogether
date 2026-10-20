# 在线更新与恢复

管理员从「后台 → 服务更新」检查并更新发布分支，通常不需要登录服务器。首次接通更新器需要维护者配置一次；网页按钮不能安装或重启更新器本身。

## 先确认启动方式

| 启动方式                                       | 网页更新是否可用 | 下一步                                         |
| ---------------------------------------------- | ---------------- | ---------------------------------------------- |
| `pnpm dev` 或单独启动 API                      | 不可用           | 本地开发继续原流程；生产使用下面的在线托管入口 |
| `bash deploy.sh` 默认部署                      | 不可用           | 完成下方 systemd 与 Caddy 接入                 |
| `pnpm start:online` 或系统服务运行在线更新脚本 | 可用             | 管理员进入服务更新页                           |

## 手动部署接入

先按仓库 README 完成依赖、数据库迁移、游戏与资源准备、生产构建。保留现有 `.env`，只补充需要的更新配置：

```dotenv
UPDATE_BRANCH=main
UPDATE_PORT=8080
UPDATE_HOST=127.0.0.1
UPDATE_ENABLED=true
UPDATE_ALLOW_MIGRATIONS=true
```

`WEB_ORIGIN` 保持网站实际访问地址，HTTPS 使用 `COOKIE_SECURE=true`。`ASSET_STORAGE_DIR` 使用已有持久资源目录的绝对路径。更新器和 API 端口必须不同，均只需监听回环地址。

在维护窗口停止原 API，执行 `pnpm start:online`。让现有 HTTPS 反向代理的**全部网站路径**转发到 `127.0.0.1:8080`，保留 Host、Origin 与 WebSocket Upgrade。不要同时保留旧静态站点作为主页，否则可能只更新了 API。

使用已有系统服务管理该长驻命令，使其在退出 SSH 后继续运行。服务器还需安装与数据库主版本匹配的 `pg_dump` 和 `pg_restore`；例如 PostgreSQL 17 使用 17 客户端。部署账户必须能连接数据库、写入私有备份目录，并通过 Git credential helper 读取仓库；不要把 token 写在仓库 URL 中。

## deploy.sh 部署接入

先完成首次部署。在维护窗口为已有 `boardgame-production.service` 添加用户级 drop-in：

```bash
systemctl --user edit boardgame-production.service
```

填入以下结构，将占位路径替换为服务器上真实的绝对路径：

```ini
[Service]
ExecStart=
ExecStart=/实际的/node路径 /项目绝对路径/scripts/online-update.mjs
```

保留原服务的 WorkingDirectory、PATH 和 `.data/deploy/production.env` 的 EnvironmentFile。在该配置文件补充上面的 UPDATE 项，保留原数据库、密钥、资源、`API_PORT=3301` 和 HTTPS `WEB_ORIGIN`。不要覆盖配置或重新生成密钥。

Caddy 保留原域名和 HTTPS 配置，将全部路径统一反向代理到 `127.0.0.1:8080`，替换原静态文件服务和单独的 API 代理。按原部署流程重建并加载网站配置，然后执行：

```bash
systemctl --user daemon-reload
systemctl --user restart boardgame-production.service
systemctl --user status boardgame-production.service
```

检查公网主页与 `/health/ready`，再回后台重新读取状态。接入后常规兼容更新使用网页入口；后续再次运行 `deploy.sh` 前，应核对其默认静态网站配置与已配置的在线托管方式。

## 更新时会发生什么

默认每五分钟检查 `origin/main`。点击「检查并更新」可立即触发同一流程：检查提交 → 安装与构建 → 等待已接收请求完成 → 停止 API 并备份 → 迁移与游戏同步 → 启动并验证 → 开放服务。

准备阶段原服务继续运行；切换时会短暂断连。页面自动重连，只有更新器确认完成后才显示成功。不显示估算百分比，也不将断连当作更新成功。对局进度保留，玩家页面不会自动刷新。管理员可在成功后点击「刷新使用新版」。

服务器版本取自实际运行目录的根 `package.json`，不使用浏览器构建版本冒充。老更新器缺少信息时显示未提供，仍可读取原有状态。

## 遇到问题

- **未启用托管**：检查上述启动与代理配置；旧版更新器需同时更新 API、Web 与监督脚本后重启。只推送代码不会替换正在运行的更新器。
- **已停用**：维护者将现有配置的 `UPDATE_ENABLED` 改为 `true` 并重启更新器。
- **需要维护**：`UPDATE_ALLOW_MIGRATIONS=false` 选择了人工维护。先核对迁移兼容性及备份，再安排维护；不要关闭迁移校验。
- **更新未完成**：查看失败步骤和处理建议，展开「版本详情与诊断」复制诊断，按失败时间检查 `journalctl --user -u boardgame-production.service` 的私有日志。诊断不包含密钥、环境或原始命令输出。
- **无法连接**：页面自动重试，保留最后确认的状态；重连前结果仍未确认。请求响应丢失时，再次确认会复用原请求编号，不重新生成另一条更新请求。

备份在私有 `UPDATE_STATE_DIR/backups`（默认 `.data/updates/backups`）。只有具有 `COMPLETE.json` 且摘要校验通过的目录才是完整备份；备份包含敏感恢复配置，不要公开或随诊断发送。失败只尝试恢复原进程，**不会回退数据库**。

需要恢复数据库时，停止所有写入并保留失败现场，由维护者先在独立空库验证备份，再恢复匹配的数据库、资源、密钥和源码构建。不要在运行中的生产库覆盖恢复，不要靠删除对局或改写历史迁移解决升级问题。
