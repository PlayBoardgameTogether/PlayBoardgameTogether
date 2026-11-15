#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
ROOT=$PWD
CONFIG="$ROOT/.data/deploy/production.env"
ACTION=${1:-deploy}
SERVICE=boardgame-production.service
usage() {
    cat <<'EOF'
Linux 一键部署（Docker Compose v2、Node 22、pnpm 11、systemd 用户服务）
  bash deploy.sh              首次部署或更新；首次询问域名
  bash deploy.sh status       查看运行状态
  bash deploy.sh logs         查看最近日志
  bash deploy.sh stop         停止网站，保留数据
  bash deploy.sh backup       暂停网站并备份数据库、资源和密钥
  bash deploy.sh admin        创建首位管理员（密码不回显）
  bash deploy.sh help         显示帮助
首次运行前：域名解析到服务器；开放 TCP 80/443 和 UDP 443。
部署期间会停服；更新迁移前自动备份。不会拉代码或删除数据卷。
EOF
}
case "$ACTION" in
    help|--help|-h) usage; exit 0 ;;
    deploy|status|logs|stop|backup|admin) ;;
    *) usage >&2; exit 2 ;;
esac
for command in docker node pnpm curl openssl flock systemctl loginctl git; do
    command -v "$command" >/dev/null || { echo "缺少 $command，请先安装。" >&2; exit 1; }
done
[[ $(uname -s) == Linux ]] || { echo '此入口适用于 Linux 服务器。' >&2; exit 1; }
[[ $(node -p 'process.versions.node.split(".")[0]') == 22 ]] || { echo '需要 Node.js 22。' >&2; exit 1; }
[[ $(pnpm --version) == 11.* ]] || { echo '需要 pnpm 11（项目锁定 11.15.1）。' >&2; exit 1; }
# Restrict paths because they also appear in a systemd unit, not only shell arguments.
[[ "$ROOT" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo '部署路径仅支持 ASCII 字母、数字、下划线、点、斜线和连字符。' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
[[ -S /var/run/docker.sock && -z ${DOCKER_HOST:-} && $(docker context show) == default ]] || {
    echo '需要当前账户已有的本机 Docker 权限，不支持远程 Docker。' >&2; exit 1;
}
systemctl --user show-environment >/dev/null || { echo 'systemd 用户服务不可用，请参阅 docs/deployment.md。' >&2; exit 1; }
[[ $(loginctl show-user "$(id -un)" -p Linger --value) == yes ]] || {
    echo "请先运行 sudo loginctl enable-linger $(id -un)，让服务在退出 SSH 后继续运行。" >&2; exit 1;
}
mkdir -p "$ROOT/.data/deploy/assets"
exec 9>"$ROOT/.data/deploy/operation.lock"
flock -n 9 || { echo '已有部署/维护操作正在运行。' >&2; exit 1; }

if [[ ! -f "$CONFIG" ]]; then
    [[ "$ACTION" == deploy ]] || { echo '尚未部署，请先运行 bash deploy.sh。' >&2; exit 1; }
    read -r -p '公网域名（例如 games.example.com，不含 https://）：' DOMAIN
    [[ ${#DOMAIN} -le 253 && "$DOMAIN" == *.* && "$DOMAIN" != *..* && "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z][a-zA-Z0-9-]*[a-zA-Z0-9]$ ]] || {
        echo '域名无效；请填写完整公网域名。' >&2; exit 1;
    }
    TEMP_CONFIG=$(mktemp "$ROOT/.data/deploy/config.XXXXXX")
    DB_PASSWORD=$(openssl rand -hex 32)
    MODEL_KEY=$(openssl rand -base64 32)
    cat >"$TEMP_CONFIG" <<EOF
BOARDGAME_DOMAIN=${DOMAIN,,}
BOARDGAME_DB_PASSWORD=$DB_PASSWORD
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=3301
DATABASE_URL=postgresql://boardgame:$DB_PASSWORD@127.0.0.1:5435/boardgame
WEB_ORIGIN=https://${DOMAIN,,}
COOKIE_SECURE=true
ENABLE_DEV_LAB=false
LOG_LEVEL=info
MODEL_CREDENTIALS_KEY=$MODEL_KEY
ASSET_STORAGE_DIR=$ROOT/.data/deploy/assets
EOF
    mv -- "$TEMP_CONFIG" "$CONFIG"
    unset DB_PASSWORD MODEL_KEY
    echo '已生成独立生产配置；开发 .env 未修改。'
fi
set -a
source "$CONFIG"
set +a
# Prevent Vite from reading development VITE_* flags from the existing .env.
export VITE_ENABLE_DEV_LAB=false VITE_API_BASE=/api/v1
COMPOSE=(docker compose --env-file "$CONFIG" -f "$ROOT/compose.prod.yml")
"${COMPOSE[@]}" config --quiet
trap 'echo "操作失败，未删除数据。查看 bash deploy.sh status / logs；迁移后失败请保持停服，修复后重跑。备份见 .data/deploy/backups。" >&2' ERR

stop_site() {
    "${COMPOSE[@]}" stop web
    systemctl --user stop "$SERVICE" 2>/dev/null || {
        # A missing unit is normal only before first installation.
        [[ ! -f "$HOME/.config/systemd/user/$SERVICE" ]]
    }
}
backup_data() {
    local destination="$ROOT/.data/deploy/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$destination"
    "${COMPOSE[@]}" exec -T postgres pg_dump -U boardgame -d boardgame -Fc >"$destination/database.dump"
    tar -C "$ASSET_STORAGE_DIR" -czf "$destination/assets.tar.gz" .
    cp -- "$CONFIG" "$destination/production.env"
    git rev-parse HEAD >"$destination/source-commit.txt" 2>/dev/null || true
    printf '%s\n' complete >"$destination/COMPLETE"
    echo "完整备份：$destination（含私密密钥，请移到服务器外安全保存）"
}
case "$ACTION" in
    status) "${COMPOSE[@]}" ps; systemctl --user status "$SERVICE" --no-pager; exit ;;
    logs) "${COMPOSE[@]}" logs --tail=100; journalctl --user -u "$SERVICE" -n 100 --no-pager; exit ;;
    stop) stop_site; exit ;;
    backup)
        API_RUNNING=$(systemctl --user is-active "$SERVICE" || true)
        WEB_RUNNING=$("${COMPOSE[@]}" ps --status running --services web)
        stop_site
        backup_data
        if [[ "$API_RUNNING" == active ]]; then systemctl --user start "$SERVICE"; fi
        if [[ "$WEB_RUNNING" == web ]]; then "${COMPOSE[@]}" start web; fi
        exit ;;
    admin)
        read -r -p '管理员用户 ID（默认 admin）：' ADMIN_NAME
        ADMIN_NAME=${ADMIN_NAME:-admin}
        read -r -s -p '管理员密码（12–128 字符）：' ADMIN_PASSWORD
        printf '\n'
        printf '%s\n' "$ADMIN_PASSWORD" | pnpm exec tsx scripts/accounts.ts admin:init "$ADMIN_NAME" 管理员
        unset ADMIN_PASSWORD
        exit ;;
esac

echo '1/6 启动独立生产数据库'
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 postgres
echo '2/6 暂停网站；已初始化的数据库先备份'
stop_site
INITIALIZED=$("${COMPOSE[@]}" exec -T postgres psql -U boardgame -d boardgame -Atc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")
if [[ "$INITIALIZED" == t ]]; then backup_data; fi
echo '3/6 安装依赖、构建生产代码和媒体处理器'
pnpm install --frozen-lockfile --prod=false
pnpm build
node scripts/runtime-compatibility.mjs "$ROOT"
"${COMPOSE[@]}" build web
docker build -t boardgame-media:1 "$ROOT/scripts/media"
echo '4/6 数据库迁移、游戏和原创资源同步'
for script in migrate sync-games; do pnpm exec tsx "scripts/$script.ts"; done
# A deployment from a development checkout must not implicitly import its local TTS art.
(
    unset SPLENDOR_TTS_ASSET_DIR
    cd "$ROOT/.data/deploy"
    node "$ROOT/node_modules/tsx/dist/cli.mjs" "$ROOT/scripts/seed-assets.ts"
)
echo '5/6 安装用户服务并启动 API 与 HTTPS 网站'
NODE_BIN=$(command -v node)
[[ "$NODE_BIN" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo 'Node 路径不支持空格或特殊字符。' >&2; exit 1; }
mkdir -p "$HOME/.config/systemd/user"
cat >"$HOME/.config/systemd/user/$SERVICE" <<EOF
[Unit]
Description=Boardgame production API
[Service]
Type=simple
WorkingDirectory=$ROOT
EnvironmentFile=$CONFIG
Environment="PATH=$PATH"
ExecStart=$NODE_BIN --conditions=production apps/api/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=45
UMask=0077
[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE"
curl --fail --silent --show-error --retry 20 --retry-all-errors --retry-delay 3 --max-time 5 \
    http://127.0.0.1:3301/health/ready >/dev/null
"${COMPOSE[@]}" up -d web
echo '6/6 检查公网 HTTPS、页面和数据库就绪状态'
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --max-time 10 \
    "https://$BOARDGAME_DOMAIN/health/ready" >/dev/null
curl --fail --silent --show-error --max-time 15 "https://$BOARDGAME_DOMAIN/" >/dev/null
echo "部署成功：https://$BOARDGAME_DOMAIN"
echo '首次部署后执行 bash deploy.sh admin 设置管理员；普通用户可在网站注册。'
