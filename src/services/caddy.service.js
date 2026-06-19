/**
 * Caddy reverse proxy — run as a panel-managed Docker container and driven via
 * its admin API (:2019). This is the real ingress: Caddy terminates HTTP/HTTPS,
 * reverse-proxies each mapped domain to the owning service container over the
 * shared docker network, and provisions + auto-renews TLS certificates via ACME.
 *
 * The panel never fakes SSL: certificate status/expiry is read from the real
 * served certificate (TLS handshake), and `reconcile()` pushes the live config
 * to Caddy on every domain change.
 */
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';

import config from '../config/index.js';
import db from '../data/store.js';
import logger from '../utils/logger.js';
import { getDocker, ensureImage, ensureNetwork, getState } from './docker.service.js';

const CFG_DIR = path.resolve(config.volumesRoot, '..', 'caddy');
const CFG_FILE = path.join(CFG_DIR, 'caddy.json');
const DATA_DIR = path.join(CFG_DIR, 'data');

const adminUrl = config.caddy.adminUrl.replace(/\/$/, '');
// Admin API listens on all interfaces (reached via the published port), so Caddy
// requires an explicit allowlist of permitted Host headers for admin requests.
const ADMIN_HOST = (() => { try { return new URL(adminUrl).host; } catch { return '127.0.0.1:2019'; } })();
const ADMIN_ORIGINS = [...new Set([ADMIN_HOST, '127.0.0.1:2019', 'localhost:2019', `${config.caddy.containerName}:2019`])];
const adminBlock = () => ({ listen: '0.0.0.0:2019', origins: ADMIN_ORIGINS });

/** Ensure the Caddy container exists and is running. Safe to call repeatedly. */
export async function ensureCaddy() {
  if (!config.caddy.enabled) return { enabled: false };
  const d = getDocker();
  const name = config.caddy.containerName;

  // Seed the on-disk config with the full desired state so Caddy starts already
  // configured (correct admin origins + current domain routes). Cert data dir
  // persists across restarts.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CFG_FILE, JSON.stringify(buildConfig(), null, 2));
  try { fs.chmodSync(CFG_DIR, 0o777); fs.chmodSync(DATA_DIR, 0o777); } catch { /* best effort */ }

  await ensureImage(config.caddy.image);
  await ensureNetwork();

  // Reuse an existing container if present.
  const existing = (await d.listContainers({ all: true, filters: { name: [name] } }))
    .find((c) => c.Names.some((n) => n.replace(/^\//, '') === name));
  if (existing) {
    if (existing.State !== 'running') await d.getContainer(existing.Id).start().catch(() => {});
    await waitForAdmin();
    return { enabled: true, id: existing.Id, reused: true };
  }

  const bind = config.caddy.adminBind;
  const container = await d.createContainer({
    name,
    Image: config.caddy.image,
    Cmd: ['caddy', 'run', '--config', '/config/caddy.json'],
    ExposedPorts: { '80/tcp': {}, '443/tcp': {}, '443/udp': {}, '2019/tcp': {} },
    HostConfig: {
      Binds: [`${CFG_DIR}:/config`, `${DATA_DIR}:/data`],
      PortBindings: {
        '80/tcp': [{ HostPort: String(config.caddy.httpPort) }],
        '443/tcp': [{ HostPort: String(config.caddy.httpsPort) }],
        '443/udp': [{ HostPort: String(config.caddy.httpsPort) }],
        '2019/tcp': [{ HostIp: bind, HostPort: '2019' }],
      },
      RestartPolicy: { Name: 'unless-stopped' },
    },
    Env: ['XDG_DATA_HOME=/data'],
    Labels: { 'multihost.managed': 'true', 'multihost.role': 'reverse-proxy' },
  });
  try { await d.getNetwork(config.docker.network).connect({ Container: container.id }); } catch { /* optional */ }
  try {
    await d.getContainer(container.id).start();
  } catch (err) {
    // Don't leave a broken (e.g. port-conflict) container behind.
    await d.getContainer(container.id).remove({ force: true }).catch(() => {});
    throw new Error(`Caddy failed to start: ${err.message}`);
  }
  await waitForAdmin();
  logger.success('Caddy reverse proxy started (admin :2019)');
  return { enabled: true, id: container.id, reused: false };
}

/** Poll the admin API until it answers (Caddy needs a moment after start). */
async function waitForAdmin(attempts = 15) {
  for (let i = 0; i < attempts; i++) {
    if (await isAvailable()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** True if the Caddy admin API is reachable. */
export async function isAvailable() {
  if (!config.caddy.enabled) return false;
  try {
    const res = await fetch(`${adminUrl}/config/`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch { return false; }
}

/** Build the full Caddy JSON config from the current domain records. */
function buildConfig() {
  const routes = [];
  for (const dom of db.data.domains) {
    const server = dom.serverId ? db.data.servers.find((s) => s.id === dom.serverId) : null;
    // Upstream: reach the service container by name over the shared network.
    const dial = server
      ? `${server.uuid}:${server.allocation?.port}`
      : (dom.target || '').replace(/^https?:\/\//, '');
    if (!dial) continue;
    routes.push({
      match: [{ host: [dom.domain] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial }] }],
      terminal: true,
    });
  }

  const cfg = {
    admin: adminBlock(),
    apps: { http: { servers: { srv0: { listen: [':80', ':443'], routes } } } },
  };
  if (config.caddy.acmeEmail) {
    cfg.apps.tls = { automation: { policies: [{ issuers: [{ module: 'acme', email: config.caddy.acmeEmail }] }] } };
  }
  return cfg;
}

/** Push the current desired config to Caddy. No-op when Caddy is unavailable. */
export async function reconcile() {
  if (!config.caddy.enabled) return { ok: false, reason: 'disabled' };
  const cfg = buildConfig();
  // Mirror to disk so a Caddy restart resumes the same config.
  try { fs.mkdirSync(CFG_DIR, { recursive: true }); fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2)); } catch { /* best effort */ }
  try {
    const res = await fetch(`${adminUrl}/load`, {
      method: 'POST',
      // Caddy's admin API enforces an Origin allowlist for mutating requests.
      headers: { 'Content-Type': 'application/json', Origin: `http://${ADMIN_HOST}` },
      body: JSON.stringify(cfg), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Caddy load ${res.status}: ${t.slice(0, 200)}`); }
    return { ok: true, routes: cfg.apps.http.servers.srv0.routes.length };
  } catch (err) {
    logger.warn(`Caddy reconcile failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

/**
 * Read the REAL TLS certificate served for a domain (issuer + expiry). Connects
 * over TLS with SNI; returns null when no cert is served yet (DNS not pointed /
 * ACME pending). Never fabricates a status.
 */
export function certInfo(domain) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch { /* */ } resolve(v); } };
    const socket = tls.connect({
      host: config.network.publicIp || domain, port: config.caddy.httpsPort, servername: domain,
      rejectUnauthorized: false, timeout: 4000,
    }, () => {
      const c = socket.getPeerCertificate();
      if (!c || !c.valid_to) return finish(null);
      finish({ issuer: c.issuer?.O || c.issuer?.CN || 'unknown', subject: c.subject?.CN || domain, validFrom: c.valid_from, validTo: c.valid_to });
    });
    socket.on('error', () => finish(null));
    socket.on('timeout', () => finish(null));
  });
}

/** Caddy status for the infrastructure overview. */
export async function status() {
  if (!config.caddy.enabled) return { enabled: false };
  let state = 'unknown';
  try { state = await getState((await getDocker().listContainers({ all: true, filters: { name: [config.caddy.containerName] } }))[0]?.Id); } catch { /* */ }
  return { enabled: true, running: await isAvailable(), container: config.caddy.containerName, admin: adminUrl, state };
}
