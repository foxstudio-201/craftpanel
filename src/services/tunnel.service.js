/**
 * Dedicated "voxelx-services" tunnel manager — Hosted Services Public Access.
 *
 * Fully ISOLATED from the Pterodactyl /etc/cloudflared (pelican) tunnel: this
 * module only ever touches the panel-owned config file
 * (~/.cloudflared/voxelx-services.yml) and reloads the panel-owned *user*
 * systemd unit (voxelx-services-tunnel.service) — no sudo, no /etc, never the
 * production tunnel.
 *
 * Per-service public hostnames (created on service create, removed on delete):
 *   discord-{id}.voxelx.io.vn   node-{id}.voxelx.io.vn
 *   python-{id}.voxelx.io.vn    web-{id}.voxelx.io.vn      → HTTP via the tunnel
 *   mc-{id}.voxelx.io.vn        → Minecraft is raw TCP; tunnels proxy HTTP only,
 *                                 so this is surfaced as a real publicIp:port
 *                                 endpoint (tcp-direct), NOT a fake HTTPS route.
 *
 * A single wildcard *.voxelx.io.vn DNS CNAME points every *-{id} name at this
 * tunnel, so no per-service DNS call is needed and explicit production records
 * (panel/node/oauth/dash) always win over the wildcard.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import db from '../data/store.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

const run = promisify(execFile);
const BEGIN = '# >>> multihost-managed (do not edit by hand)';
const END = '# <<< multihost-managed';
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Matches a complete managed block (escaped — BEGIN/END contain regex metachars).
const MANAGED_RE = new RegExp(`[\\t ]*${reEsc(BEGIN)}[\\s\\S]*?${reEsc(END)}[^\\n]*\\n?`, 'g');

const cfg = () => config.servicesTunnel;

function routes() {
  if (!db.data.serviceRoutes) db.data.serviceRoutes = [];
  return db.data.serviceRoutes;
}

/** serviceType → public hostname prefix (discord/node/python/web/mc). */
function prefixFor(server) {
  const t = server.serviceType || (server.kind === 'server' ? 'minecraft' : server.kind);
  return cfg().prefixes[t] || (t || 'svc');
}

/** Minecraft (and MC proxies) are raw TCP — they cannot ride the HTTP tunnel. */
function isTcp(server) {
  return (server.serviceType || '') === 'minecraft' || server.kind === 'server';
}

/** Public hostname for a service, e.g. node-AbC123.voxelx.io.vn. */
export function hostnameFor(server) {
  return `${prefixFor(server)}-${server.id}.${cfg().baseDomain}`.toLowerCase();
}

// ── Config file (panel-owned, NOT /etc) ─────────────────────────────────
/** Splice the managed block (HTTP routes only) before the http_status:404 catch-all. */
function buildConfig() {
  const path = cfg().configPath;
  const raw = fs.readFileSync(path, 'utf8');

  // Strip ALL previous managed blocks so regeneration is idempotent.
  const stripped = raw.replace(MANAGED_RE, '');

  const indent = '  ';
  const httpRoutes = routes().filter((r) => r.mechanism === 'http-tunnel');
  const block = httpRoutes
    .map((r) => `${indent}- hostname: ${r.hostname}\n${indent}  service: ${r.service}`)
    .join('\n');
  const managed = `${indent}${BEGIN}\n${block}${block ? '\n' : ''}${indent}${END}`;

  const catchAll = stripped.match(/^[\t ]*-\s*service:\s*http_status:404\s*$/m);
  if (catchAll) {
    const idx = stripped.indexOf(catchAll[0]);
    return stripped.slice(0, idx) + managed + '\n' + stripped.slice(idx);
  }
  // No catch-all found — append the block (cloudflared will still serve it).
  return stripped.replace(/\s*$/, '\n') + managed + '\n';
}

/** Write the regenerated config, then restart the user tunnel to apply (no sudo). */
async function syncAndReload() {
  if (!cfg().enabled) return { applied: false, reason: 'disabled' };
  try {
    fs.writeFileSync(cfg().configPath, buildConfig());
  } catch (err) {
    logger.warn(`[tunnel] could not write services config: ${err.message}`);
    return { applied: false, reason: err.message };
  }
  return reload();
}

/** Restart the panel-owned user tunnel (cloudflared has no hot ingress reload). */
export async function reload() {
  try {
    await run('systemctl', ['--user', 'restart', cfg().unit], {
      timeout: 15000,
      env: { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? ''}` },
    });
    logger.info(`[tunnel] services tunnel reloaded (${cfg().unit})`);
    return { applied: true };
  } catch (err) {
    // Config is written regardless; an operator/boot will pick it up. Never fatal.
    logger.warn(`[tunnel] services reload skipped (${(err.stderr || err.message || '').split('\n')[0]})`);
    return { applied: false, reason: (err.stderr || err.message || '').split('\n')[0] };
  }
}

// ── Public API used by the service lifecycle ────────────────────────────
/**
 * Create (or refresh) the public route for a service. HTTP types get a real
 * tunnel ingress entry; Minecraft gets a tcp-direct endpoint (publicIp:port).
 * Best-effort: a tunnel hiccup never blocks service creation.
 */
export async function addServiceRoute(server) {
  if (!cfg().enabled) return null;
  const hostname = hostnameFor(server);
  const port = server.allocation?.port;
  if (!port) return null;

  const tcp = isTcp(server);
  const route = {
    id: hostname,
    serverId: server.id,
    hostname,
    type: server.serviceType || server.kind,
    mechanism: tcp ? 'tcp-direct' : 'http-tunnel',
    // HTTP routes point at the real local port; mc exposes a real connect addr.
    service: tcp ? null : `http://localhost:${port}`,
    endpoint: tcp ? `${cfg().publicIp || config.network.publicIp || hostname}:${port}` : null,
    port,
    createdAt: new Date().toISOString(),
  };

  db.data.serviceRoutes = routes().filter((r) => r.serverId !== server.id);
  db.data.serviceRoutes.push(route);
  db.save();

  // Only HTTP routes change the tunnel config; tcp-direct just records the addr.
  const result = tcp ? { applied: true, tcpDirect: true } : await syncAndReload();
  logger.info(`[tunnel] route + ${hostname} (${route.mechanism})`);
  return { ...route, reload: result };
}

/** Remove a service's public route on delete and reload the tunnel if needed. */
export async function removeServiceRoute(serverId) {
  if (!cfg().enabled) return false;
  const existing = routes().filter((r) => r.serverId === serverId);
  if (!existing.length) return false;
  const hadHttp = existing.some((r) => r.mechanism === 'http-tunnel');
  db.data.serviceRoutes = routes().filter((r) => r.serverId !== serverId);
  db.save();
  if (hadHttp) await syncAndReload();
  for (const r of existing) logger.info(`[tunnel] route - ${r.hostname}`);
  return true;
}

export function serviceRoutes() {
  return routes();
}

export function routeForServer(serverId) {
  return routes().find((r) => r.serverId === serverId) || null;
}

/** Live status for the Infrastructure page (real systemd state, never faked). */
export async function status() {
  const out = {
    enabled: cfg().enabled,
    baseDomain: cfg().baseDomain,
    configPath: cfg().configPath,
    unit: cfg().unit,
    dashUnit: cfg().dashUnit,
    routes: routes(),
  };
  for (const [key, unit] of [['servicesActive', cfg().unit], ['dashActive', cfg().dashUnit]]) {
    try { const r = await run('systemctl', ['--user', 'is-active', unit], { env: process.env }); out[key] = r.stdout.trim() === 'active'; }
    catch (e) { out[key] = (e.stdout || '').trim() === 'active'; }
  }
  return out;
}
