/**
 * Cloudflare Tunnel integration — SAFE BY DEFAULT.
 *
 * The panel READS the existing tunnel config (never writes /etc, never restarts
 * cloudflared unless an operator opts into sudo apply). Project routes are kept
 * in db.data.routes and merged into a *proposed* config written to the project
 * workspace, by textually splicing a delimited "managed block" immediately
 * before the `http_status:404` catch-all — every existing Pterodactyl rule is
 * preserved verbatim. The proposed file is validated with the real
 * `cloudflared tunnel ingress validate` before it is ever shown as applyable.
 */
import fs from 'node:fs';
import tls from 'node:tls';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import db from '../data/store.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';

const run = promisify(execFile);
const BEGIN = '# >>> multihost-managed (do not edit by hand)';
const END = '# <<< multihost-managed';

const cf = () => config.cloudflared;

// ── Read + parse the live config (read-only) ────────────────────────────
export function readConfig() {
  const path = cf().configPath;
  try {
    const raw = fs.readFileSync(path, 'utf8');
    return { exists: true, path, raw };
  } catch (err) {
    return { exists: false, path, raw: '', error: err.code || err.message };
  }
}

/** Extract the tunnel id from the config (or the configured override). */
export function tunnelId() {
  if (cf().tunnelId) return cf().tunnelId;
  const m = readConfig().raw.match(/^\s*tunnel:\s*([0-9a-f-]{36}|\S+)\s*$/m);
  return m ? m[1] : '';
}

/**
 * Parse ingress entries in order. Returns [{ hostname|null, service }], where a
 * null hostname is the catch-all. Regex-based and tolerant of formatting; used
 * for display + duplicate detection only (we never re-emit existing entries).
 */
export function parseIngress(raw = readConfig().raw) {
  const entries = [];
  const lines = raw.split('\n');
  let inIngress = false;
  let cur = null;
  const flush = () => { if (cur && (cur.hostname || cur.service)) entries.push(cur); cur = null; };
  for (const line of lines) {
    if (/^\s*ingress:\s*$/.test(line)) { inIngress = true; continue; }
    if (!inIngress) continue;
    if (/^\S/.test(line) && line.trim() && !line.trimStart().startsWith('-')) { flush(); inIngress = false; continue; }
    const dash = line.match(/^\s*-\s*(.*)$/);
    if (dash) {
      flush(); cur = { hostname: null, service: null };
      const rest = dash[1].trim();
      const kv = rest.match(/^(hostname|service):\s*(.+)$/);
      if (kv) cur[kv[1]] = kv[2].trim();
      continue;
    }
    const kv = line.match(/^\s*(hostname|service|path):\s*(.+)$/);
    if (kv && cur) cur[kv[1]] = kv[2].trim();
  }
  flush();
  return entries;
}

/** Hostnames already present in the live config (to detect collisions). */
export function existingHostnames() {
  return parseIngress().map((e) => e.hostname).filter(Boolean);
}

// ── Real tunnel status ──────────────────────────────────────────────────
export async function status() {
  if (!cf().enabled) return { enabled: false };
  const out = { enabled: true, tunnelId: tunnelId(), configPath: cf().configPath, service: cf().service };
  try { const r = await run('systemctl', ['is-active', cf().service]); out.active = r.stdout.trim() === 'active'; }
  catch (e) { out.active = (e.stdout || '').trim() === 'active'; }
  try {
    const r = await run('cloudflared', ['tunnel', 'info', tunnelId()], { timeout: 6000, env: { ...process.env, HOME: process.env.HOME } });
    out.info = r.stdout.split('\n').slice(0, 12).join('\n');
    out.connected = /connector|CONNECTOR|edge/i.test(r.stdout);
  } catch (e) { out.infoError = (e.stderr || e.message || '').split('\n')[0]; }
  return out;
}

/**
 * Read the REAL TLS certificate served for a hostname (Cloudflare edge cert when
 * the route is live). Returns null if nothing is served yet. Never fabricated.
 */
export function certInfo(hostname) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; try { socket.destroy(); } catch { /* */ } resolve(v); } };
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname, rejectUnauthorized: false, timeout: 6000 }, () => {
      const c = socket.getPeerCertificate();
      if (!c || !c.valid_to) return finish(null);
      finish({ issuer: c.issuer?.O || c.issuer?.CN || 'unknown', subject: c.subject?.CN || hostname, validFrom: c.valid_from, validTo: c.valid_to });
    });
    socket.on('error', () => finish(null));
    socket.on('timeout', () => finish(null));
  });
}

/** Real HTTP reachability check via the public edge. */
export async function testReachability(hostname) {
  try {
    const r = await fetch(`https://${hostname}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return { reachable: true, httpStatus: r.status };
  } catch (e) { return { reachable: false, error: e.message }; }
}

// ── Project routes (db.data.routes) ─────────────────────────────────────
export function projectRoutes() {
  return db.data.routes || [];
}

function assertHostname(hostname) {
  if (!/^([a-z0-9_-]+\.)+[a-z]{2,}$/i.test(hostname || '')) throw ApiError.badRequest('Invalid hostname');
}

/** Add (or update) a project route, then regenerate + validate the proposal. */
export async function addRoute({ hostname, service, serverId = null, purpose = 'service' }, actor) {
  assertHostname(hostname);
  if (!/^https?:\/\/\S+$/.test(service || '')) throw ApiError.badRequest('Service must be an http(s):// target');

  // Never shadow a hostname owned by an existing (e.g. Pterodactyl) rule.
  const ours = projectRoutes().some((r) => r.hostname === hostname);
  if (!ours && existingHostnames().includes(hostname)) throw ApiError.conflict(`Hostname ${hostname} already exists in the tunnel`);

  db.data.routes = projectRoutes().filter((r) => r.hostname !== hostname);
  db.data.routes.push({ id: hostname, hostname, service, serverId, purpose, createdAt: new Date().toISOString() });
  db.save();
  const v = await writeProposed();
  return { hostname, service, validation: v };
}

export async function removeRoute(hostname) {
  db.data.routes = projectRoutes().filter((r) => r.hostname !== hostname);
  db.save();
  await writeProposed();
  return true;
}

// ── Merge (textual splice) + validate ───────────────────────────────────
function detectIndent(raw) {
  const m = raw.match(/^(\s*)-\s*(hostname|service):/m);
  return m ? m[1] : '  ';
}

/** Build the merged config text: original verbatim + managed block before 404. */
export function buildProposed() {
  const { raw, exists } = readConfig();
  if (!exists) throw ApiError.badRequest(`cloudflared config not found at ${cf().configPath}`);

  // Strip any previous managed block so regeneration is idempotent.
  const stripped = raw.replace(new RegExp(`\\n?[\\t ]*${BEGIN}[\\s\\S]*?${END}[^\\n]*\\n?`, 'g'), '\n');

  const indent = detectIndent(stripped);
  const block = projectRoutes().map((r) =>
    `${indent}- hostname: ${r.hostname}\n${indent}  service: ${r.service}`).join('\n');
  const managed = `${indent}${BEGIN}\n${block}${block ? '\n' : ''}${indent}${END}`;

  // Insert immediately before the catch-all (http_status:404). If absent, append
  // to the end of the ingress list (validate will catch a malformed result).
  const catchAll = stripped.match(/^[\t ]*-\s*service:\s*http_status:404\s*$/m);
  if (catchAll) {
    const idx = stripped.indexOf(catchAll[0]);
    return stripped.slice(0, idx) + managed + '\n' + stripped.slice(idx);
  }
  return stripped.replace(/\s*$/, '\n') + managed + '\n';
}

/** Write the proposed merged config to the workspace and validate it. */
export async function writeProposed() {
  const text = buildProposed();
  const dest = cf().proposedConfig;
  fs.mkdirSync(dest.replace(/\/[^/]*$/, ''), { recursive: true });
  fs.writeFileSync(dest, text);
  return validate(dest);
}

/** Run the REAL cloudflared validator against a specific config file.
 *  The `--config` global flag must precede the subcommand, otherwise cloudflared
 *  validates the default config instead of our proposed file. */
export async function validate(file = cf().proposedConfig) {
  // cloudflared exits 0 only when the config is valid; non-zero rejects the
  // promise. Rely on the exit code, not on parsing the message text.
  try {
    const r = await run('cloudflared', ['--config', file, 'tunnel', 'ingress', 'validate'], { timeout: 8000 });
    return { ok: true, output: (r.stdout || r.stderr || 'valid').trim() };
  } catch (e) {
    return { ok: false, output: (e.stderr || e.stdout || e.message || 'validation failed').trim() };
  }
}

/** Unified diff (proposed vs live) for the Infrastructure page. */
export function diff() {
  const live = readConfig().raw;
  let proposed = '';
  try { proposed = buildProposed(); } catch { proposed = ''; }
  return { live, proposed, changed: proposed && proposed !== live };
}

/**
 * Apply the proposed config to the live tunnel.
 *  - applyMode 'propose' (default): never touches /etc; returns the manual steps.
 *  - applyMode 'sudo': invokes the operator-installed helper via sudo, which
 *    validates → backs up → installs → restarts cloudflared.
 */
export async function apply(actor) {
  const v = await writeProposed();
  if (!v.ok) throw ApiError.badRequest(`Refusing to apply — validation failed: ${v.output}`);

  if (cf().applyMode !== 'sudo') {
    return {
      applied: false, mode: 'propose', validation: v, proposed: cf().proposedConfig,
      manual: [
        `sudo cp ${cf().proposedConfig} ${cf().configPath}`,
        `sudo systemctl restart ${cf().service}`,
      ],
    };
  }
  try {
    const r = await run('sudo', ['-n', cf().applyHelper, cf().proposedConfig, cf().configPath, cf().service], { timeout: 20000 });
    logger.success(`cloudflared route apply via helper by ${actor?.username || 'system'}`);
    return { applied: true, mode: 'sudo', output: (r.stdout || '').trim() };
  } catch (e) {
    throw new ApiError(500, `Apply helper failed: ${(e.stderr || e.message || '').split('\n')[0]}`);
  }
}
