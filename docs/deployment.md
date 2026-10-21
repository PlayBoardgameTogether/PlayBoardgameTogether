# Linux 一键部署

适用于单台 Linux 服务器、一个公网域名和单 API 实例。入口为项目根目录 `deploy.sh`，不是公网部署已完成的声明。

## 首次准备

1. 安装 Node.js 22、pnpm 11.15.1、Docker Engine 和 Docker Compose v2。系统需提供 Bash、curl（支持 `--retry-all-errors`）、openssl、flock、git、systemd 和用户服务。使用支持 systemd 的常规 Linux 主机，不适用于共享虚拟主机或无 systemd 的容器。
2. 使用固定部署账户，通过 `docker info` 确认其已有本机 Docker 使用权限。脚本不会授予 Docker 权限，也不把 Docker socket 挂入网站容器。API 在宿主机以该账户运行，沿用现有媒体隔离容器；网站入口和 PostgreSQL 由 Compose 管理。
3. 执行 `sudo loginctl enable-linger "$USER"`，确保该账户退出 SSH 和主机重启后仍运行用户服务；确认 `systemctl --user show-environment` 可用。Docker Engine 本身也需启用开机启动。
4. 把域名 A 记录指向服务器；有 AAAA 记录时 IPv6 也必须可访问此服务器。开放 TCP 80/443、UDP 443，确保端口未被其他服务占用。数据库 5435 和 API 3301 仅绑定本机回环，不在防火墙中开放。
5. 从项目 GitHub 仓库检出需要部署的已提交版本，放在固定路径，例如 `/opt/boardgame`，目录归部署账户所有。路径不支持空格、中文或特殊字符。不要移动正在运行的部署目录。

Docker 和 pnpm 的安装由服务器管理员完成，脚本不使用未经审核的 `curl | sh`、不改变系统用户/防火墙。若此前以开发方式安装过本项目，生产入口不会覆盖 `.env`、使用开发数据库或搬运本机 TTS 商业图包。

## 部署和管理员

在仓库根目录运行：

```bash
bash deploy.sh
```

首次输入完整域名，例如 `games.example.com`。配置和随机数据库密码、32 字节 Base64 模型凭证主密钥保存到 `.data/deploy/production.env`，权限受 `umask 077` 限制。后续运行保持原密钥。不要删除或重新生成已有部署配置：数据库密码和模型主密钥丢失会导致连接或已存凭证解密失败。

程序依次启动独立数据库、停服并备份既有数据、安装全部构建依赖、构建生产代码和媒体镜像、迁移、同步游戏/原创资源、安装并启用 `boardgame-production.service` 用户服务、启动网站，再检查有效公网 HTTPS、主页和数据库就绪。只有全部成功才显示“部署成功”。Caddy 管理 HTTPS 和 WebSocket 转发，同一域名保持 Cookie/Origin/CSRF 语义。首次证书申请需要域名与端口满足上述条件，失败不会假装成功。依据：[Caddy 官方配置模式](https://caddyserver.com/docs/caddyfile/patterns)、[Compose 启动及健康等待](https://docs.docker.com/reference/cli/docker/compose/up/)。

部署成功后创建首位管理员：

```bash
bash deploy.sh admin
```

密码不回显，通过 stdin 传递到现有账户 CLI，不进入参数或部署文件；已有管理员不会被重置。普通用户在网站注册。

## 更新、日志和备份

希望后续在网页后台一键更新时，首次部署后按 [在线更新](online-update.md) 接通 systemd 在线托管与 Caddy 全路径代理；网站内也提供 `/developers/online-update` 指南。`deploy.sh` 默认仍是下述维护部署方式，运行脚本本身不会启用网页更新。

```bash
# 自行检出/拉取审查后的版本，然后部署；脚本不会自行 git pull
bash deploy.sh
bash deploy.sh status
bash deploy.sh logs
bash deploy.sh backup
bash deploy.sh stop
```

更新会停服，不提供零停机或自动源码回滚；活跃玩家应提前结束对局。备份命令也会暂时停止 API 和入口，让数据库及资源目录保持一致，成功后只恢复原先运行的服务。更新在迁移前自动生成同样的备份。互斥锁阻止本项目的部署/备份/管理员操作同时运行；不要另行同时写入该生产库。

每份备份位于 `.data/deploy/backups/<UTC时间>-<进程ID>/`，包括 `database.dump`、`assets.tar.gz`、`production.env` 和 `source-commit.txt`，`COMPLETE` 标记所有备份步骤成功。没有此标记的目录不算完整备份。源码版本必须是可恢复的已提交版本，用户自行修改的未提交源码不会被数据库备份保存。将完整备份和相应 Git 版本移到服务器外安全保存。数据库、资源和模型主密钥缺一不可，HTTPS 证书另由 Compose 的 Caddy 持久卷保存。

迁移、资源同步或构建失败时保持停服，修复原因后重新运行；既有迁移有校验和，已安装游戏/资源保持精确版本。公网检查失败时进程可能已启动，请查看日志和实际状态。脚本不重置数据库、不删除持久卷，也不自动降级已迁移的数据库。恢复应先停服，备份当前失败状态，再由维护者在隔离环境验证 `pg_restore`、恢复资源和原主密钥并检出对应源码；不要只回退代码后继续运行新数据库。

## 运行结构与限制

- PostgreSQL 数据：Compose `postgres` 命名卷，独立于 `compose.dev.yml`；端口 `127.0.0.1:5435`。
- API：当前部署账户的 systemd 用户服务，`127.0.0.1:3301`；生产模式、Secure Cookie、开发实验台关闭。
- 静态网站：Caddy 镜像，仅复制生产 Web 文件，排除 sourcemap；Linux host 网络访问回环 API，监听 80/443。
- 原创及上传资源：`.data/deploy/assets`；原有隔离媒体处理器仍使用无网络、无挂载、非 root、有界资源容器。部署账户原有 Docker 权限属于服务器信任边界，API 不新增远程 Docker 管理接口。
- 模型功能：仅配置加密主密钥，供应商密钥/模型由用户在网页设置；不自动调用付费供应商。
- 不自动配置 DNS、安全组、域名购买、服务器购买或迁移旧环境。服务重启可能断开 WS，客户端沿用既有重新认证与快照恢复。

一次性检查命令、实际结果及未验证项见 `docs/progress.md` 的本轮部署记录。
