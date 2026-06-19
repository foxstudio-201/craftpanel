#!/usr/bin/env bash
#
# cf-apply.sh — privileged Cloudflare Tunnel config applier for the Multi-Service
# Hosting Panel. Run ONLY via a narrow sudoers rule (see docs/INSTALL-coexistence.md).
#
#   sudo /usr/local/sbin/mh-cf-apply <proposed.yml> <target.yml> <service>
#
# Safety guarantees (refuses to proceed otherwise):
#   1. The proposed config passes `cloudflared tunnel ingress validate`.
#   2. EVERY hostname currently in the target (e.g. Pterodactyl's panel/node)
#      is still present in the proposed config — no existing route is dropped.
#   3. A timestamped backup of the target is taken before any write.
# Only then is the config installed and cloudflared restarted.
#
set -euo pipefail

PROPOSED="${1:?proposed config path required}"
TARGET="${2:?target config path required}"
SERVICE="${3:?cloudflared service name required}"

err() { echo "cf-apply: $*" >&2; exit 1; }

[[ -f "$PROPOSED" ]] || err "proposed config not found: $PROPOSED"
[[ -f "$TARGET" ]]   || err "target config not found: $TARGET"
command -v cloudflared >/dev/null || err "cloudflared not found in PATH"

# 1. Validate the proposed config (exit non-zero ⇒ invalid).
cloudflared --config "$PROPOSED" tunnel ingress validate >/dev/null \
  || err "proposed config failed cloudflared validation — aborting"

# 2. No existing hostname may disappear (protect Pterodactyl + others).
mapfile -t CURRENT < <(grep -oE '^\s*-?\s*hostname:\s*\S+' "$TARGET" | awk '{print $NF}' | sort -u)
for host in "${CURRENT[@]:-}"; do
  [[ -z "$host" ]] && continue
  grep -qE "hostname:\s*${host}(\s|$)" "$PROPOSED" \
    || err "refusing to apply — existing hostname '${host}' is missing from the proposal"
done

# 3. Backup, install, reload.
BACKUP="${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
cp -p "$TARGET" "$BACKUP"
install -m 0644 "$PROPOSED" "$TARGET"

if systemctl restart "$SERVICE"; then
  echo "cf-apply: applied; backup at ${BACKUP}; ${SERVICE} restarted"
else
  # Roll back on a failed restart so the tunnel keeps serving.
  cp -p "$BACKUP" "$TARGET"
  systemctl restart "$SERVICE" || true
  err "restart failed — rolled back to ${BACKUP}"
fi
