/**
 * Server orchestration — the bridge between panel server records and real
 * Docker containers. Owns the full lifecycle: create/install, power actions,
 * suspend, clone, backup, restore, reinstall and delete.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import tar from 'tar-fs';

import db from '../data/store.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import ApiError from '../utils/ApiError.js';
import * as docker from './docker.service.js';
import * as mc from './minecraft.service.js';
import * as ports from './ports.service.js';
import * as cloudflared from './cloudflared.service.js';
import * as tunnel from './tunnel.service.js';
import { SERVICES, getTemplate, isServiceType } from './service.catalog.js';
import { typeOf, feature } from './service-registry.js';
import { logActivity } from './activity.service.js';
import { pushNotification, getIO, onServerStateChange } from '../sockets/index.js';

const backupsRoot = config.backupsRoot;

const find = (id) => db.data.servers.find((s) => s.id === id);
export { find as findServer };

const isService = (server) => server.kind === 'service';

/**
 * Make a service volume writable by the container user.
 *
 * The yolks runtime images run as uid 1001 (`container`), while the panel runs
 * unprivileged (typically uid 1000) and owns the bind-mounted volume — so it
 * cannot chown to 1001. The reliable cross-uid fix is world-writable perms:
 * directories 0777, files 0666, applied recursively. This must run not only at
 * install but **before every start**, because files the user adds afterwards
 * (git clone, uploads, npm-written package-lock.json) are created 1000:1000 and
 * would otherwise give the container EACCES (e.g. `npm install` writing
 * /home/container/package-lock.json). Best-effort: per-entry failures are
 * ignored so one stubborn file never blocks a start.
 */
function ensureVolumeWritable(uuid) {
  const root = mc.volumePath(uuid);
  fs.mkdirSync(root, { recursive: true });
  const walk = (p, isDir) => {
    try { fs.chmodSync(p, isDir ? 0o777 : 0o666); } catch { /* best effort */ }
    if (!isDir) return;
    let entries = [];
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      // Skip symlinks (don't chmod link targets outside the volume).
      if (e.isSymbolicLink()) continue;
      walk(path.join(p, e.name), e.isDirectory());
    }
  };
  walk(root, true);
}

/** Image required by a server (service image or Minecraft itzg image). */
function serverImage(server) {
  return isService(server) ? server.image : mc.SOFTWARE[server.software]?.image;
}

/** Build docker.createContainer options for any server (Minecraft or service). */
function buildContainerOptions(server) {
  if (!isService(server)) return mc.containerOptions(server);

  const port = server.allocation.port;
  // The yolks entrypoint evaluates STARTUP ({{VAR}} → ${VAR}); all referenced
  // variables must be present as real env. SERVER_PORT/PORT expose the alloc.
  const envObj = {
    STARTUP: server.startup,
    SERVER_PORT: String(port),
    PORT: String(port),
    P_SERVER_UUID: server.uuid,
    // Hint the container user/group to match the panel's (documents intent; the
    // primary cross-uid remedy is the recursive chmod in ensureVolumeWritable).
    UID: String(process.getuid?.() ?? 1000),
    GID: String(process.getgid?.() ?? 1000),
    ...(server.env || {}),
  };
  const env = Object.entries(envObj).map(([k, v]) => `${k}=${v}`);

  return {
    name: server.uuid,
    image: server.image,
    env,
    volumePath: mc.volumePath(server.uuid),
    mountPath: '/home/container',
    ports: [{ container: port, host: port, proto: 'tcp' }],
    cpus: server.limits.cpu,
    memoryMb: server.limits.ramMb,
  };
}

/**
 * Reconcile stored state with the REAL container state from Docker, mapped to
 * the canonical lifecycle: offline | starting | running | stopping |
 * restarting | crashed | installing. Honours short-lived transition states
 * set by power actions, validated against the actual container status.
 */
export async function syncStatus(server) {
  if (server.installStatus === 'installing') { server.state = 'installing'; return server.state; }
  if (!server.dockerId) { server.state = 'offline'; return server.state; }

  let info;
  try { info = await docker.inspect(server.dockerId); }
  catch { server.state = 'offline'; return server.state; }
  if (!info) { server.state = 'offline'; server.transition = null; return server.state; }

  const st = info.State || {};
  let state;
  switch (st.Status) {
    case 'running': state = 'running'; break;
    case 'restarting': state = 'restarting'; break;
    case 'paused': state = 'stopping'; break;
    case 'created': state = 'offline'; break;
    case 'exited':
    case 'dead':
      if (server.expectStop) {
        // A stop/kill we initiated — graceful regardless of exit signal.
        // Stays sticky until the next start so repeated syncs don't flip to crashed.
        state = 'offline';
      } else {
        // Exited without us asking → clean (0) is offline, anything else is a crash.
        state = st.OOMKilled || (st.ExitCode ?? 0) !== 0 ? 'crashed' : 'offline';
      }
      break;
    default: state = 'offline';
  }

  // Apply a transient transition (start/stop/restart) until Docker confirms the
  // terminal state or the short window elapses — reflects real action progress.
  if (server.transition && Date.now() < (server.transitionUntil || 0)) {
    if (server.transition === 'starting' && state !== 'running') state = 'starting';
    else if (server.transition === 'stopping' && state === 'running') state = 'stopping';
    else if (server.transition === 'restarting' && state !== 'running') state = 'restarting';
    else server.transition = null; // settled
  } else if (server.transition) {
    server.transition = null;
  }

  server.state = state;
  // Keep the runtime session consistent with the real container state: a running
  // container always has a session id (covers panel restarts mid-run); any
  // terminal state destroys it so the live console clears.
  if (state === 'running') { if (!server.runtimeId) server.runtimeId = crypto.randomUUID(); }
  else if (state === 'offline' || state === 'crashed') { server.runtimeId = null; }
  return server.state;
}

/** Shape a server record for API responses, including live data. */
export async function toClient(server, { detail = false } = {}) {
  await syncStatus(server);
  const owner = db.data.users.find((u) => u.id === server.ownerId);
  const svcDef = isService(server) ? SERVICES[server.serviceType] : null;
  const sw = mc.SOFTWARE[server.software];
  const base = {
    id: server.id,
    uuid: server.uuid,
    name: server.name,
    description: server.description || '',
    kind: isService(server) ? 'service' : (sw?.kind || 'server'),
    serviceType: server.serviceType || 'minecraft',
    template: server.template || null,
    software: server.software,
    softwareLabel: isService(server) ? `${svcDef?.label || server.serviceType} · ${server.template}` : (sw?.label || server.software),
    version: server.version,
    state: server.state,
    status: server.state === 'running' ? 'running' : 'stopped',
    runtimeId: server.runtimeId || null,
    suspended: !!server.suspended,
    installStatus: server.installStatus,
    ownerId: server.ownerId,
    owner: owner ? owner.username : 'unknown',
    node: server.node || 'local',
    limits: server.limits,
    allocation: server.allocation,
    maxPlayers: server.maxPlayers,
    createdAt: server.createdAt,
  };
  if (!detail) return base;
  const info = server.dockerId ? await docker.inspect(server.dockerId) : null;
  return {
    ...base,
    dockerId: server.dockerId,
    containerName: info?.Name?.replace(/^\//, '') || null,
    image: info?.Config?.Image || serverImage(server),
    startup: server.startup || null,
    javaImageVersion: isService(server) ? null : 'OpenJDK (itzg)',
    startedAt: info?.State?.StartedAt && info.State.StartedAt !== '0001-01-01T00:00:00Z' ? info.State.StartedAt : null,
    motd: server.motd,
    difficulty: server.difficulty,
    gamemode: server.gamemode,
    onlineMode: server.onlineMode,
    env: server.env || {},
  };
}

function assertSoftware(software, version) {
  if (!mc.SOFTWARE[software]) throw ApiError.badRequest(`Unsupported software: ${software}`);
}

/**
 * Create + install a server: provisions the volume and the container.
 * The server jar itself is downloaded from the official source by itzg on the
 * first start, so creation is fast and the download is genuinely live.
 */
export async function createServer(input, actor) {
  // Generic services (discord/node/python/static) route to the service path.
  if (isServiceType(input.serviceType) && input.serviceType !== 'minecraft') {
    return createService(input, actor);
  }
  assertSoftware(input.software, input.version);
  if (!input.name) throw ApiError.badRequest('Server name is required');

  const ownerId = input.ownerId || actor.id;
  if (!db.data.users.find((u) => u.id === ownerId)) throw ApiError.badRequest('Owner does not exist');

  const uuid = crypto.randomUUID();
  const { rconPassword, rconPort } = mc.generateServerDefaults();
  const port = await ports.allocate();

  const server = {
    id: nanoid(10),
    uuid,
    name: input.name,
    software: input.software || 'PAPER',
    version: input.version || 'LATEST',
    ownerId,
    node: 'local',
    dockerId: null,
    state: 'installing',
    suspended: false,
    installStatus: 'installing',
    limits: {
      cpu: Number(input.cpu) || 2,
      ramMb: Number(input.ramMb) || 2048,
      diskMb: Number(input.diskMb) || 10240,
    },
    allocation: {
      ip: config.network.internalIp || '0.0.0.0',
      port,
      additionalPorts: [],
    },
    maxPlayers: Number(input.maxPlayers) || 20,
    motd: input.motd || `${input.name}`,
    difficulty: input.difficulty || 'normal',
    gamemode: input.gamemode || 'survival',
    onlineMode: input.onlineMode !== false,
    rconPassword,
    rconPort,
    env: input.env || {},
    createdAt: new Date().toISOString(),
  };

  db.data.servers.push(server);
  db.save();

  try {
    const sw = mc.SOFTWARE[server.software];
    await docker.ensureImage(sw.image);
    const id = await docker.createContainer(mc.containerOptions(server));
    server.dockerId = id;
    server.installStatus = 'installed';
    server.state = 'created';
    db.save();
  } catch (err) {
    server.installStatus = 'failed';
    server.state = 'install_failed';
    db.save();
    logger.error('Server install failed:', err.message);
    throw new ApiError(500, `Install failed: ${err.message}`);
  }

  logActivity('server.create', { actor, target: server.name, serverId: server.id, meta: { software: server.software, version: server.version } });
  pushNotification({ type: 'success', title: 'Server created', message: `${server.name} is installed and ready to start.` });
  return server;
}

/**
 * Create + install a generic service (Discord bot / Node / Python / static) as
 * a real container on the yolks runtime. The user's code lives in the volume;
 * the startup command is executed by the yolks entrypoint at container start.
 */
export async function createService(input, actor) {
  if (!input.name) throw ApiError.badRequest('Service name is required');
  const svc = SERVICES[input.serviceType];
  if (!svc) throw ApiError.badRequest(`Unknown service type: ${input.serviceType}`);
  const template = getTemplate(input.serviceType, input.template);
  if (!template) throw ApiError.badRequest('Unknown template');

  const ownerId = input.ownerId || actor.id;
  if (!db.data.users.find((u) => u.id === ownerId)) throw ApiError.badRequest('Owner does not exist');

  const uuid = crypto.randomUUID();
  const port = await ports.allocate();
  const env = { ...template.env, ...(input.env || {}) };

  const server = {
    id: nanoid(10),
    uuid,
    name: input.name,
    description: input.description || '',
    kind: 'service',
    serviceType: input.serviceType,
    template: template.key,
    software: null,
    version: null,
    ownerId,
    node: 'local',
    dockerId: null,
    state: 'installing',
    suspended: false,
    installStatus: 'installing',
    image: input.image || template.image,
    startup: input.startup || template.startup, // template default is verbatim
    limits: {
      cpu: Number(input.cpu) || 1,
      ramMb: Number(input.ramMb) || 1024,
      diskMb: Number(input.diskMb) || 5120,
    },
    allocation: { ip: config.network.internalIp || '0.0.0.0', port, additionalPorts: [] },
    env,
    createdAt: new Date().toISOString(),
  };

  db.data.servers.push(server);
  db.save();

  try {
    await docker.ensureImage(server.image);
    // yolks runs as uid 1001; make the volume writable by it and the panel.
    ensureVolumeWritable(uuid);
    server.dockerId = await docker.createContainer(buildContainerOptions(server));
    server.installStatus = 'installed';
    server.state = 'created';
    db.save();
  } catch (err) {
    server.installStatus = 'failed';
    server.state = 'install_failed';
    db.save();
    logger.error('Service install failed:', err.message);
    throw new ApiError(500, `Install failed: ${err.message}`);
  }

  // Public access via the dedicated voxelx-services tunnel (fully isolated from
  // the Pterodactyl tunnel). discord/node/python/web get a live HTTP route
  // (<type>-{id}.voxelx.io.vn); Minecraft gets a real TCP-direct endpoint. The
  // route is created here and removed in deleteServer — best-effort, so a tunnel
  // hiccup never blocks the deployment.
  try {
    const route = await tunnel.addServiceRoute(server);
    if (route) { server.publicHostname = route.hostname; db.save(); }
  } catch (err) { logger.warn(`Auto-route for ${server.name} skipped: ${err.message}`); }

  logActivity('server.create', { actor, target: server.name, serverId: server.id, meta: { serviceType: server.serviceType, template: server.template } });
  pushNotification({ type: 'success', title: 'Service deployed', message: `${server.name} (${svc.label}) is installed and ready to start.` });
  return server;
}

/** Recreate the container (keeps the volume). Used for config/limit changes. */
export async function reinstall(server, actor) {
  if (server.dockerId) await docker.remove(server.dockerId, { force: true });
  await docker.ensureImage(serverImage(server));
  if (isService(server)) ensureVolumeWritable(server.uuid);
  server.dockerId = await docker.createContainer(buildContainerOptions(server));
  server.installStatus = 'installed';
  server.state = 'created';
  db.save();
  logActivity('server.reinstall', { actor, target: server.name, serverId: server.id });
  return server;
}

const TRANSITION = { start: 'starting', stop: 'stopping', restart: 'restarting', kill: 'stopping' };

export async function power(server, action, actor) {
  if (server.suspended && action === 'start') throw ApiError.forbidden('Server is suspended');
  if (!server.dockerId) throw ApiError.badRequest('Server is not installed');

  // Validate the daemon + container are real before acting.
  if (!(await docker.isAvailable())) throw new ApiError(503, 'Docker daemon is not reachable');
  const info = await docker.inspect(server.dockerId);
  if (!info) throw ApiError.notFound('Container not found — reinstall the server');

  // Track whether we initiated the stop so a SIGTERM/SIGKILL exit is reported
  // as offline (graceful), not crashed.
  server.expectStop = action === 'stop' || action === 'kill';
  if (action === 'start' || action === 'restart') server.expectStop = false;

  // Runtime session: each start/restart begins a NEW session; stop/kill ends it.
  // The console is tied to this id so it never shows output from a previous run.
  if (action === 'start' || action === 'restart') server.runtimeId = crypto.randomUUID();
  else if (action === 'stop' || action === 'kill') server.runtimeId = null;

  // Before (re)starting a service, make the volume writable by the container
  // user (uid 1001) so npm/git/user files added since install don't EACCES.
  if (isService(server) && (action === 'start' || action === 'restart')) {
    try { ensureVolumeWritable(server.uuid); } catch { /* best effort */ }
  }

  // Mark a real, time-boxed transition and broadcast it immediately.
  server.transition = TRANSITION[action];
  server.transitionUntil = Date.now() + (action === 'start' || action === 'restart' ? 120_000 : 30_000);
  server.state = server.transition;
  db.save();
  onServerStateChange(server.id, server.state);

  try {
    switch (action) {
      case 'start': await docker.start(server.dockerId); break;
      case 'stop': await docker.stop(server.dockerId); break;
      case 'restart': await docker.restart(server.dockerId); break;
      case 'kill': await docker.kill(server.dockerId); break;
      default: throw ApiError.badRequest('Invalid power action');
    }
  } catch (err) {
    server.transition = null;
    await syncStatus(server);
    db.save();
    onServerStateChange(server.id, server.state);
    throw err;
  }

  await syncStatus(server);
  db.save();
  logActivity(`server.${action}`, { actor, target: server.name, serverId: server.id });
  // Push the (possibly still-transitioning) state; the console reacts instantly.
  onServerStateChange(server.id, server.state);
  return server;
}

export async function setSuspended(server, suspended, actor) {
  server.suspended = suspended;
  if (suspended && server.dockerId) await docker.stop(server.dockerId).catch(() => {});
  await syncStatus(server);
  db.save();
  logActivity(suspended ? 'server.suspend' : 'server.unsuspend', { actor, target: server.name, serverId: server.id });
  onServerStateChange(server.id, server.state);
  return server;
}

export async function deleteServer(server, actor) {
  if (server.dockerId) await docker.remove(server.dockerId, { force: true });
  await fsp.rm(mc.volumePath(server.uuid), { recursive: true, force: true }).catch(() => {});
  // Return the host port(s) to the pool and drop any tunnel routes for it.
  ports.release(server.allocation?.port, ...(server.allocation?.additionalPorts || []));
  // Drop the dedicated services-tunnel route (removes its HTTP ingress + reloads).
  await tunnel.removeServiceRoute(server.id).catch(() => {});
  // Also drop any legacy propose-mode (shared tunnel) routes for this server.
  for (const r of cloudflared.projectRoutes().filter((r) => r.serverId === server.id)) {
    await cloudflared.removeRoute(r.hostname).catch(() => {});
  }
  db.data.servers = db.data.servers.filter((s) => s.id !== server.id);
  db.data.backups = db.data.backups.filter((b) => b.serverId !== server.id);
  delete db.data.consoleLogs[server.id];
  db.save();
  logActivity('server.delete', { actor, target: server.name, serverId: server.id });
  return true;
}

export async function cloneServer(source, actor) {
  const uuid = crypto.randomUUID();
  const { rconPassword, rconPort } = mc.generateServerDefaults();
  const port = await ports.allocate();

  const clone = {
    ...structuredClone(source),
    id: nanoid(10),
    uuid,
    name: `${source.name} (Copy)`,
    dockerId: null,
    state: 'installing',
    suspended: false,
    installStatus: 'installing',
    allocation: { ...source.allocation, port, additionalPorts: [] },
    rconPassword,
    rconPort,
    createdAt: new Date().toISOString(),
  };

  // Copy the world/data volume.
  const srcPath = mc.volumePath(source.uuid);
  const destPath = mc.volumePath(uuid);
  fs.mkdirSync(destPath, { recursive: true });
  if (fs.existsSync(srcPath)) await fsp.cp(srcPath, destPath, { recursive: true });

  if (isService(clone)) { try { ensureVolumeWritable(uuid); } catch { /* best effort */ } }

  db.data.servers.push(clone);
  await docker.ensureImage(serverImage(clone));
  clone.dockerId = await docker.createContainer(buildContainerOptions(clone));
  clone.installStatus = 'installed';
  clone.state = 'created';
  db.save();
  logActivity('server.clone', { actor, target: clone.name, serverId: clone.id, meta: { source: source.name } });
  return clone;
}

// ── Backups (real tar.gz of the data volume) ──────────────────────────
export async function createBackup(server, actor, { type = 'manual' } = {}) {
  fs.mkdirSync(path.join(backupsRoot, server.uuid), { recursive: true });
  const name = `${server.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.tar.gz`;
  const dest = path.join(backupsRoot, server.uuid, name);
  const volPath = mc.volumePath(server.uuid);
  fs.mkdirSync(volPath, { recursive: true });

  await pipeline(tar.pack(volPath), zlib.createGzip(), fs.createWriteStream(dest));
  const size = fs.statSync(dest).size;

  const backup = {
    id: nanoid(10),
    serverId: server.id,
    name,
    file: dest,
    sizeGb: +(size / 1e9).toFixed(3),
    sizeBytes: size,
    type,
    createdAt: new Date().toISOString(),
  };
  db.data.backups.unshift(backup);
  db.save();
  logActivity('server.backup', { actor, target: server.name, serverId: server.id, meta: { backup: name } });
  pushNotification({ type: 'success', title: 'Backup created', message: `${server.name} backed up (${(size / 1e6).toFixed(0)} MB).` });
  return backup;
}

export async function restoreBackup(server, backup, actor) {
  if (!fs.existsSync(backup.file)) throw ApiError.notFound('Backup file is missing on disk');
  const wasRunning = (await docker.getState(server.dockerId)) === 'running';
  if (wasRunning) await docker.stop(server.dockerId);

  const volPath = mc.volumePath(server.uuid);
  await fsp.rm(volPath, { recursive: true, force: true });
  fs.mkdirSync(volPath, { recursive: true });
  await pipeline(fs.createReadStream(backup.file), zlib.createGunzip(), tar.extract(volPath));

  if (wasRunning) await docker.start(server.dockerId);
  await syncStatus(server);
  db.save();
  logActivity('server.restore', { actor, target: server.name, serverId: server.id, meta: { backup: backup.name } });
  return true;
}

export async function deleteBackup(backup) {
  await fsp.rm(backup.file, { force: true }).catch(() => {});
  db.data.backups = db.data.backups.filter((b) => b.id !== backup.id);
  db.save();
}

/** Live, real player list via RCON `list` (running servers only). */
export async function listPlayers(server) {
  if (!feature(typeOf(server), 'players') || mc.isProxy(server.software)) return { online: 0, max: server.maxPlayers || 0, names: [] };
  if (server.state !== 'running' && (await syncStatus(server)) !== 'running') return { online: 0, max: server.maxPlayers, names: [] };
  try {
    const out = await docker.rcon(server.dockerId, 'list');
    // "There are 2 of a max of 20 players online: Steve, Alex"
    const m = out.match(/There are (\d+).*?of a max of (\d+).*?:?\s*(.*)$/s);
    const names = m && m[3] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : [];
    return { online: m ? Number(m[1]) : names.length, max: m ? Number(m[2]) : server.maxPlayers, names };
  } catch {
    return { online: 0, max: server.maxPlayers, names: [] };
  }
}
