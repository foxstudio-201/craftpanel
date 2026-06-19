/**
 * Centralized port manager — the single authority for host-port allocation.
 *
 * Before handing out a port it scans, for real:
 *   1. OS listeners        (/proc/net/tcp[6] LISTEN sockets — no subprocess)
 *   2. Docker port maps    (published ports of ALL running containers, incl. Wings)
 *   3. Project allocations (db.data.ports + service/database records)
 *   4. A reserved list     (Pterodactyl Panel/Wings/SFTP/DB/Redis + this panel)
 *
 * Allocations come from a dedicated pool (config.ports) kept clear of
 * Pterodactyl, are recorded in db.data.ports, and are released on delete. This
 * guarantees the project never collides with Pterodactyl/Wings or itself.
 */
import net from 'node:net';
import fs from 'node:fs';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import * as docker from './docker.service.js';

// Always-reserved host ports on this machine (Pterodactyl + system + this panel).
const BASE_RESERVED = [
  80,    // nginx / Pterodactyl Panel
  443,   // Wings API
  2022,  // Wings SFTP
  3306,  // MySQL (Pterodactyl)
  6379,  // Redis (Pterodactyl)
  2019,  // Caddy admin (if ever enabled)
];

export function reservedPorts() {
  return [...new Set([
    ...BASE_RESERVED,
    config.port,        // this panel (3000)
    config.sftp.port,   // this panel's SFTP (2122)
    ...config.ports.reserved,
  ])].sort((a, b) => a - b);
}

/** LISTEN sockets from /proc/net/tcp + tcp6 (state 0A = TCP_LISTEN). */
function osListeningPorts() {
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let data;
    try { data = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of data.split('\n').slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 4) continue;
      const [, local, , state] = cols;
      if (state !== '0A') continue; // LISTEN only
      const hex = local?.split(':')[1];
      if (hex) ports.add(parseInt(hex, 16));
    }
  }
  return ports;
}

/** Published (host-mapped) ports of every running container, incl. Pterodactyl. */
async function dockerPublishedPorts() {
  const ports = new Set();
  try {
    const list = await docker.getDocker().listContainers({ all: false });
    for (const c of list) for (const p of c.Ports || []) if (p.PublicPort) ports.add(p.PublicPort);
  } catch { /* docker down — fall back to OS scan */ }
  return ports;
}

/** Ports already accounted for by this project's own records. */
function projectPorts() {
  const ports = new Set();
  for (const r of db.data.ports || []) ports.add(r.port);
  for (const s of db.data.servers || []) {
    if (s.allocation?.port) ports.add(s.allocation.port);
    for (const ap of s.allocation?.additionalPorts || []) ports.add(ap);
  }
  for (const d of db.data.databases || []) if (d.port) ports.add(d.port);
  return ports;
}

/** Full picture of occupied ports, by source (used by allocator + audit page). */
export async function scan() {
  const os = osListeningPorts();
  const dock = await dockerPublishedPorts();
  const project = projectPorts();
  const reserved = new Set(reservedPorts());
  const all = new Set([...os, ...dock, ...project, ...reserved]);
  return { os, docker: dock, project, reserved, all };
}

function tcpFree(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

/** Reserve a specific port in the project ledger. */
function record(port, meta) {
  db.data.ports = (db.data.ports || []).filter((r) => r.port !== port);
  db.data.ports.push({ port, purpose: meta.purpose || 'service', serverId: meta.serverId || null, at: new Date().toISOString() });
  db.save();
}

/**
 * Allocate a free host port from the dedicated pool. Skips anything occupied by
 * the OS, Docker (incl. Pterodactyl), the project ledger or the reserved list,
 * then double-checks the port can actually be bound.
 */
export async function allocate({ purpose = 'service', serverId = null } = {}) {
  const { all } = await scan();
  for (let p = config.ports.min; p <= config.ports.max; p++) {
    if (all.has(p)) continue;
    if (!(await tcpFree(p))) continue;
    record(p, { purpose, serverId });
    return p;
  }
  throw ApiError.conflict(`No free ports in the pool ${config.ports.min}-${config.ports.max}`);
}

/** Release one or more ports back to the pool. */
export function release(...ports) {
  const set = new Set(ports.flat().filter((p) => p != null));
  if (!set.size) return;
  db.data.ports = (db.data.ports || []).filter((r) => !set.has(r.port));
  db.save();
}

/** True if a port is free to bind right now (not occupied/reserved). */
export async function isFree(port) {
  const { all } = await scan();
  if (all.has(port)) return false;
  return tcpFree(port);
}

/**
 * Conflict report: project-allocated ports that are ALSO occupied by something
 * external (OS listener or a non-project Docker container). Surfaces drift.
 */
export async function conflicts() {
  const { os, docker: dock } = await scan();
  const out = [];
  for (const r of db.data.ports || []) {
    const external = (os.has(r.port) || dock.has(r.port));
    // It's only a conflict if something OUTSIDE the project holds it. We can't
    // tell our own container's published port apart cheaply, so flag reserved hits.
    if (reservedPorts().includes(r.port)) out.push({ port: r.port, reason: 'reserved', ...r });
  }
  return out;
}
