# Coexistence Install — running alongside Pterodactyl + cloudflared

This panel is designed to run on the **same host** as Pterodactyl Panel, Wings and
a Cloudflare Tunnel **without touching any of them**. By default it never edits
`/etc/cloudflared`, never restarts cloudflared, never uses Pterodactyl's Docker
network, and allocates ports from its own pool. This document covers the optional
privileged steps an operator may run to enable the full feature set.

## 1. Dedicated workspace (recommended)

Create an isolated workspace outside Pterodactyl directories:

```bash
sudo mkdir -p /srv/multihosting/{services,backups,sftp,docker,data}
sudo chown -R "$USER":"$USER" /srv/multihosting
```

Then in `.env`:

```
MULTIHOST_ROOT=/srv/multihosting
```

If unset, the panel falls back to the in-project `./storage` tree and still runs
fully (just not under `/srv`).

## 2. Isolation defaults (no action required)

- **Docker network:** `multihost_net` (created on boot) — never `pterodactyl_nw`.
- **Container labels:** `multihost.managed=true` on every project container.
- **Ports:** allocated from `26000–26999`, after live-scanning OS listeners +
  Docker port maps + a reserved list (80, 443, 2022, 2026, 2028, 25565, 3306,
  6379, …). Extend with `RESERVED_PORTS=`.
- **SFTP:** independent server on `:2122`, chrooted per service volume — separate
  from Wings SFTP on `:2022`.
- **Panel HTTP:** `:3000`. **Caddy is disabled** (80/443 belong to nginx + Wings).

## 3. Cloudflare Tunnel — propose mode (default, unprivileged)

The panel reads the active tunnel config (`CF_CONFIG`, default
`/etc/cloudflared/config.yml`) **read-only**, shows real tunnel status, and when
you add a route it writes a **merged** config to a workspace file
(`CF_PROPOSED`) that preserves every existing Pterodactyl rule and inserts the
new project rule **before** the `http_status:404` catch-all. It then runs
`cloudflared tunnel ingress validate` on that file. **Nothing in `/etc` changes.**

The Infrastructure page shows the exact diff and the two commands to apply it
manually:

```bash
sudo cp /srv/multihosting/docker/cloudflared-desired.yml /etc/cloudflared/config.yml
sudo systemctl restart cloudflared   # ~1-2s reconnect for ALL tunnels
```

## 4. Cloudflare Tunnel — sudo apply mode (optional, one-click)

To let the panel apply routes itself, install the helper and a **narrow** sudoers
rule, then set `CF_APPLY_MODE=sudo`.

```bash
sudo install -m 0755 bin/cf-apply.sh /usr/local/sbin/mh-cf-apply
# /etc/sudoers.d/multihosting  (validate with: sudo visudo -c)
neo ALL=(root) NOPASSWD: /usr/local/sbin/mh-cf-apply
```

The helper itself: validates the proposed config, backs up the current one, copies
it into place, and restarts cloudflared. It refuses to run if validation fails or
if any existing hostname would be dropped. It only ever touches
`/etc/cloudflared/config.yml` — never Wings, the Panel, or DNS.

## 5. DNS

Per-service hostnames (`web-<id>.apps.<BASE_DOMAIN>`) require a wildcard CNAME
`*.apps.<BASE_DOMAIN> → <tunnelId>.cfargotunnel.com` in Cloudflare. Core
hostnames (`market`, `api`, `admin`) need their own CNAMEs. The panel never
fabricates DNS — the route "test connectivity" action reports the real result.
