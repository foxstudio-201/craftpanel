#!/usr/bin/env bash
#
# CraftPanel — one-command production installer (multi-distro)
# Supports: Ubuntu/Debian (apt), Arch/Manjaro/CachyOS (pacman), Fedora (dnf)
# ---------------------------------------------------------------------------
# Usage (one command, no variables required):
#   curl -fsSL https://raw.githubusercontent.com/foxstudio-201/craftpanel/main/install.sh | sudo bash
#
# Optional overrides:
#   sudo USE_PM2=1 bash install.sh          # use PM2 instead of systemd
#   sudo SOURCE_DIR=/path/to/checkout bash install.sh   # install from local files
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
PKG_MGR=""                                # detected: apt | pacman | dnf

# Source of the application code. Defaults to the official repository so the
# installer works out of the box with no variables. Override only if needed:
#   SOURCE_DIR — local directory to copy from instead of cloning
REPO_URL="${REPO_URL:-https://github.com/foxstudio-201/craftpanel.git}"
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

# Universal: pick a package manager. No distro name is ever used to block.
detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    PKG_MGR="apt"
  elif command -v pacman >/dev/null 2>&1; then
    PKG_MGR="pacman"
  elif command -v dnf >/dev/null 2>&1; then
    PKG_MGR="dnf"
  else
    # The ONLY supported failure: no usable package manager at all.
    die "No supported package manager found (need one of: apt, pacman, dnf)."
  fi
  [ -r /etc/os-release ] && . /etc/os-release
  ok "Detected ${PRETTY_NAME:-Linux}; using package manager '$PKG_MGR'."
}

# pkg_install <packages…> — install via the detected package manager.
pkg_install() {
  case "$PKG_MGR" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" ;;
    pacman) pacman -S --needed --noconfirm "$@" ;;
    dnf)    dnf install -y "$@" ;;
  esac
}

# pkg_refresh — refresh package metadata.
pkg_refresh() {
  case "$PKG_MGR" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get update -y ;;
    pacman) pacman -Sy --noconfirm ;;
    dnf)    dnf -y makecache || true ;;
  esac
}

# --------------------------- Resolve source --------------------------------
# Default: clone the official repository. SOURCE_DIR overrides to copy locally.
detect_source() {
  if [ -n "$SOURCE_DIR" ]; then
    REPO_URL=""   # local copy takes precedence over cloning
    log "Installing from local source: $SOURCE_DIR"
  else
    log "Installing from repository: $REPO_URL ($BRANCH)"
  fi
}

# --------------------------- System dependencies ---------------------------
install_base_packages() {
  log "Installing base packages (git, curl, build tools)…"
  pkg_refresh
  case "$PKG_MGR" in
    apt)    pkg_install ca-certificates curl gnupg git build-essential python3 rsync openssl ufw ;;
    pacman) pkg_install base-devel git curl rsync openssl ;;
    dnf)    pkg_install ca-certificates curl git gcc-c++ make rsync openssl ;;
  esac
  ok "Base packages installed."
}

node_major_ok() {
  command -v node >/dev/null 2>&1 && \
    [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -ge 18 ] 2>/dev/null
}

install_node() {
  if node_major_ok; then
    ok "Node.js $(node -v) already present."
    return
  fi
  log "Installing Node.js (LTS) for '$PKG_MGR'…"
  case "$PKG_MGR" in
    pacman) pkg_install nodejs npm ;;
    dnf)    pkg_install nodejs npm ;;
    apt)
      # Ubuntu/Debian repos ship an EOL Node — use NodeSource for a current LTS.
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
      pkg_install nodejs
      ;;
  esac
  command -v npm >/dev/null 2>&1 || pkg_install npm
  node_major_ok || warn "Installed Node.js $(node -v 2>/dev/null) is older than 18; the app requires >=18."
  ok "Node.js $(node -v) / npm $(npm -v) ready."
}

install_docker() {
  # CraftPanel manages real Docker containers (dockerode) — required at runtime.
  if command -v docker >/dev/null 2>&1; then
    ok "Docker already present ($(docker --version | awk '{print $3}' | tr -d ,))."
  else
    log "Installing Docker for '$PKG_MGR'…"
    case "$PKG_MGR" in
      apt)    pkg_install docker.io ;;
      pacman) pkg_install docker ;;
      dnf)    pkg_install docker ;;
    esac
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
Documentation=https://github.com/foxstudio-201/craftpanel
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
  detect_pkg_manager
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
