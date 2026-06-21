#!/usr/bin/env bash
#
# CraftPanel — one-command production installer for Ubuntu Server 22.04+
# ---------------------------------------------------------------------------
# Usage (remote):
#   curl -fsSL https://raw.githubusercontent.com/<you>/craftpanel/main/install.sh | sudo bash
#
# Or with options:
#   curl -fsSL .../install.sh | sudo REPO_URL=https://github.com/you/craftpanel.git bash
#   sudo ./install.sh                       # from a local checkout (auto-copies ./ )
#   sudo USE_PM2=1 ./install.sh             # use PM2 instead of systemd
#
# This script ONLY automates deployment. It does not modify application logic.
# ---------------------------------------------------------------------------
set -Eeuo pipefail

# ----------------------------- Configuration -------------------------------
APP_NAME="craftpanel"
INSTALL_DIR="${INSTALL_DIR:-/opt/craftpanel}"
SERVICE_USER="${SERVICE_USER:-craftpanel}"
NODE_MAJOR="${NODE_MAJOR:-20}"            # Node.js LTS line to install
APP_PORT="${APP_PORT:-3000}"
USE_PM2="${USE_PM2:-0}"                   # 1 = run via PM2 instead of systemd

# Source of the application code (choose ONE):
#   REPO_URL  — git repository to clone/pull (preferred for `curl | bash`)
#   SOURCE_DIR— local directory to copy from (auto-detected when run from a checkout)
REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-main}"
SOURCE_DIR="${SOURCE_DIR:-}"

# --------------------------------- Helpers ---------------------------------
log()  { printf '\033[1;36m[craftpanel]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[  ok  ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[ warn ]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[ fail ]\033[0m %s\n' "$*" >&2; exit 1; }

trap 'die "Install failed on line $LINENO. Re-run after fixing the error above."' ERR

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Run as root:  curl -fsSL .../install.sh | sudo bash"
}

require_ubuntu() {
  [ -r /etc/os-release ] || die "Cannot detect OS (no /etc/os-release)."
  . /etc/os-release
  case "${ID:-}:${ID_LIKE:-}" in
    *ubuntu*|*debian*) : ;;
    *) die "This installer targets Ubuntu/Debian (apt). Detected: ${PRETTY_NAME:-unknown}" ;;
  esac
  command -v apt-get >/dev/null 2>&1 || die "apt-get not found; Ubuntu Server required."
}

# --------------------------- Detect local source ---------------------------
# When executed from inside a checkout (not piped), default to copying it.
detect_source() {
  if [ -z "$REPO_URL" ] && [ -z "$SOURCE_DIR" ]; then
    local self_dir
    self_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
    if [ -n "$self_dir" ] && [ -f "$self_dir/package.json" ] \
       && grep -q '"name": *"craftpanel"' "$self_dir/package.json" 2>/dev/null; then
      SOURCE_DIR="$self_dir"
      log "Detected local CraftPanel source at $SOURCE_DIR (will copy)."
    fi
  fi
  [ -n "$REPO_URL" ] || [ -n "$SOURCE_DIR" ] || die \
"No source specified. Provide one of:
  REPO_URL=https://github.com/you/craftpanel.git  (git clone)
  SOURCE_DIR=/path/to/checkout                     (copy local files)
e.g.  curl -fsSL .../install.sh | sudo REPO_URL=https://github.com/you/craftpanel.git bash"
}

# --------------------------- System dependencies ---------------------------
install_base_packages() {
  log "Installing base packages (git, curl, build tools)…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg git build-essential python3 rsync ufw openssl
  ok "Base packages installed."
}

install_node() {
  if command -v node >/dev/null 2>&1 && \
     [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] 2>/dev/null; then
    ok "Node.js $(node -v) already present."
    return
  fi
  log "Installing Node.js ${NODE_MAJOR}.x (LTS) from NodeSource…"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) / npm $(npm -v) installed."
}

install_docker() {
  # CraftPanel manages real Docker containers (dockerode) — required at runtime.
  if command -v docker >/dev/null 2>&1; then
    ok "Docker already present ($(docker --version | awk '{print $3}' | tr -d ,))."
  else
    log "Installing Docker Engine (official convenience script)…"
    curl -fsSL https://get.docker.com | sh
    ok "Docker installed."
  fi
  systemctl enable --now docker >/dev/null 2>&1 || warn "Could not enable docker service."
}

# ------------------------------ Service user -------------------------------
ensure_user() {
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    log "Creating system user '$SERVICE_USER'…"
    useradd --system --create-home --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  # Grant Docker access so the panel can manage containers.
  if getent group docker >/dev/null 2>&1; then
    usermod -aG docker "$SERVICE_USER"
    ok "User '$SERVICE_USER' added to 'docker' group."
  fi
}

# ------------------------------ Fetch source -------------------------------
fetch_source() {
  mkdir -p "$INSTALL_DIR"
  if [ -n "$REPO_URL" ]; then
    if [ -d "$INSTALL_DIR/.git" ]; then
      log "Updating existing checkout in $INSTALL_DIR…"
      git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
      git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
    else
      log "Cloning $REPO_URL ($BRANCH) → $INSTALL_DIR…"
      rm -rf "${INSTALL_DIR:?}/"* 2>/dev/null || true
      git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
  else
    log "Copying source from $SOURCE_DIR → $INSTALL_DIR…"
    rsync -a --delete \
      --exclude '.git' --exclude 'node_modules' --exclude 'storage' \
      --exclude '.env' --exclude 'src/data/db.json' \
      "$SOURCE_DIR"/ "$INSTALL_DIR"/
  fi
  ok "Source ready in $INSTALL_DIR."
}

# ------------------------------ Environment --------------------------------
configure_env() {
  local env_file="$INSTALL_DIR/.env"
  if [ ! -f "$env_file" ]; then
    if [ -f "$INSTALL_DIR/.env.example" ]; then
      cp "$INSTALL_DIR/.env.example" "$env_file"
      log "Created .env from .env.example."
    else
      : > "$env_file"
      warn ".env.example missing — created an empty .env."
    fi
  else
    ok ".env already exists — leaving it untouched."
    return
  fi

  # Force production runtime values.
  set_env NODE_ENV production
  set_env PORT "$APP_PORT"
  set_env HOST 0.0.0.0

  # Generate a strong JWT secret if the placeholder is present or empty.
  if ! grep -qE '^JWT_SECRET=.+[^[:space:]]' "$env_file" || \
       grep -qiE '^JWT_SECRET=(change|replace|your|secret|)$' "$env_file"; then
    set_env JWT_SECRET "$(openssl rand -hex 48)"
    ok "Generated a random JWT_SECRET."
  fi
}

# set_env KEY VALUE — idempotent upsert into $INSTALL_DIR/.env
set_env() {
  local key="$1" val="$2" env_file="$INSTALL_DIR/.env"
  if grep -qE "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$val" >> "$env_file"
  fi
}

# ------------------------------ Build & deps -------------------------------
install_deps_and_build() {
  log "Installing npm dependencies (this can take a few minutes)…"
  if [ -f "$INSTALL_DIR/package-lock.json" ]; then
    run_as_user "cd '$INSTALL_DIR' && npm ci"
  else
    run_as_user "cd '$INSTALL_DIR' && npm install"
  fi

  # Run a build only if the project actually defines one (kept generic).
  if has_npm_script build; then
    log "Running 'npm run build'…"
    run_as_user "cd '$INSTALL_DIR' && npm run build"
  elif has_npm_script css:build; then
    log "Building production CSS ('npm run css:build')…"
    run_as_user "cd '$INSTALL_DIR' && npm run css:build" || warn "css:build failed (non-fatal)."
  else
    log "No build script defined — skipping build step."
  fi
  ok "Dependencies installed."
}

has_npm_script() {
  node -e "process.exit(require('$INSTALL_DIR/package.json').scripts?.['$1']?0:1)" 2>/dev/null
}

run_as_user() {
  # Run a shell snippet as the service user with a clean PATH.
  sudo -u "$SERVICE_USER" -H env PATH="/usr/bin:/usr/local/bin:/bin" bash -lc "$1"
}

fix_permissions() {
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"
  ok "Ownership set to $SERVICE_USER."
}

# ------------------------------- systemd -----------------------------------
install_systemd() {
  local unit="/etc/systemd/system/${APP_NAME}.service"
  log "Writing systemd unit → $unit"
  cat > "$unit" <<UNIT
[Unit]
Description=CraftPanel — Server Management Dashboard
Documentation=https://github.com/your-org/craftpanel
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
EnvironmentFile=-${INSTALL_DIR}/.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
TimeoutStopSec=20
KillMode=mixed
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

# Hardening (kept conservative so Docker socket + bind mounts still work)
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable "${APP_NAME}.service" >/dev/null
  systemctl restart "${APP_NAME}.service"
  ok "systemd service '${APP_NAME}' enabled and started."
}

# --------------------------------- PM2 -------------------------------------
install_pm2() {
  log "Installing PM2 globally…"
  npm install -g pm2
  install -d -o "$SERVICE_USER" -g "$SERVICE_USER" /var/log/craftpanel
  run_as_user "cd '$INSTALL_DIR' && pm2 start ecosystem.config.js --update-env"
  run_as_user "pm2 save"
  # Configure PM2 to resurrect on boot for the service user.
  env PATH="$PATH" pm2 startup systemd -u "$SERVICE_USER" --hp "$INSTALL_DIR" | tail -n 1 | bash || \
    warn "Could not auto-configure pm2 startup; run the printed 'pm2 startup' command manually."
  ok "PM2 process started and saved."
}

# ------------------------------- Firewall ----------------------------------
configure_firewall() {
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
    ufw allow "${APP_PORT}/tcp" >/dev/null 2>&1 || true
    ok "ufw: opened port ${APP_PORT}/tcp."
  else
    warn "ufw inactive — if you enable it later, allow port ${APP_PORT}:  sudo ufw allow ${APP_PORT}/tcp"
  fi
}

# -------------------------------- Summary ----------------------------------
summary() {
  local ip; ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  cat <<EOF

  ┌──────────────────────────────────────────────────────────────┐
  │  CraftPanel installed successfully                           │
  └──────────────────────────────────────────────────────────────┘

  Location : ${INSTALL_DIR}
  Runtime  : $( [ "$USE_PM2" = "1" ] && echo "PM2" || echo "systemd (${APP_NAME}.service)" )
  URL      : http://${ip:-localhost}:${APP_PORT}

  Manage the service:
EOF
  if [ "$USE_PM2" = "1" ]; then
    cat <<EOF
    sudo -u ${SERVICE_USER} pm2 status
    sudo -u ${SERVICE_USER} pm2 logs ${APP_NAME}
    sudo -u ${SERVICE_USER} pm2 restart ${APP_NAME}
EOF
  else
    cat <<EOF
    systemctl status ${APP_NAME}
    journalctl -u ${APP_NAME} -f          # live logs
    systemctl restart ${APP_NAME}
EOF
  fi
  cat <<EOF

  Edit configuration : sudo nano ${INSTALL_DIR}/.env  (then restart the service)

EOF
}

# --------------------------------- Main ------------------------------------
main() {
  require_root
  require_ubuntu
  detect_source
  install_base_packages
  install_node
  install_docker
  ensure_user
  fetch_source
  configure_env
  install_deps_and_build
  fix_permissions
  if [ "$USE_PM2" = "1" ]; then
    install_pm2
  else
    install_systemd
  fi
  configure_firewall
  summary
}

main "$@"
