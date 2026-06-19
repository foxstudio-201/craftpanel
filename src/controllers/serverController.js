import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as svc from '../services/server.service.js';
import * as mc from '../services/minecraft.service.js';
import { publicCatalog } from '../services/service.catalog.js';
import { publicRegistry } from '../services/service-registry.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

/** Find a server the caller is allowed to see/manage, or throw. */
function authorizedServer(req, { admin = false } = {}) {
  const server = db.data.servers.find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  const owns = server.ownerId === req.user.id;
  if (admin && !isStaff(req.user)) throw ApiError.forbidden('Staff role required');
  if (!owns && !isStaff(req.user)) throw ApiError.forbidden('You do not have access to this server');
  return server;
}

const actor = (req) => ({ id: req.user.id, username: req.user.username });

// ── Installer metadata ────────────────────────────────────────────────
export const listSoftware = asyncHandler(async (_req, res) =>
  ok(res, { software: mc.softwareCatalog() }, 'Supported software')
);

export const listVersions = asyncHandler(async (req, res) =>
  ok(res, { software: req.params.software, versions: await mc.getVersions(req.params.software) }, 'Versions')
);

/** Generic (non-Minecraft) service catalog for the Marketplace deploy modals. */
export const listServices = asyncHandler(async (_req, res) =>
  ok(res, { services: publicCatalog() }, 'Service catalog')
);

/** Full service-type registry: page manifests, feature flags, wizards. */
export const getRegistry = asyncHandler(async (_req, res) =>
  ok(res, publicRegistry(), 'Service registry')
);

// ── CRUD + lifecycle ───────────────────────────────────────────────────
export const listServers = asyncHandler(async (req, res) => {
  let servers = db.data.servers;
  if (!isStaff(req.user)) servers = servers.filter((s) => s.ownerId === req.user.id);
  const out = await Promise.all(servers.map((s) => svc.toClient(s)));
  return ok(res, { servers: out }, 'Servers');
});

export const getServer = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const players = await svc.listPlayers(server);
  return ok(res, { server: await svc.toClient(server, { detail: true }), players }, 'Server');
});

export const createServer = asyncHandler(async (req, res) => {
  // Only administrators may provision servers. They assign an owner (defaults
  // to themselves); regular users cannot create servers at all.
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only administrators can create servers');
  const server = await svc.createServer({ ...req.body }, actor(req));
  return created(res, { server: await svc.toClient(server, { detail: true }) }, 'Server created & installed');
});

/** Update editable service identity: name, description, and (admin) owner. */
export const updateServer = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const { name, description, ownerId } = req.body;
  if (typeof name === 'string' && name.trim()) server.name = name.trim();
  if (typeof description === 'string') server.description = description;
  if (ownerId && ownerId !== server.ownerId) {
    if (!isStaff(req.user)) throw ApiError.forbidden('Only staff can transfer ownership');
    if (!db.data.users.find((u) => u.id === ownerId)) throw ApiError.badRequest('Owner does not exist');
    server.ownerId = ownerId;
  }
  db.save();
  return ok(res, { server: await svc.toClient(server, { detail: true }) }, 'Service updated');
});

export const powerAction = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const server2 = await svc.power(server, req.body.action, actor(req));
  return ok(res, { server: await svc.toClient(server2) }, `Server ${req.body.action} issued`);
});

export const reinstallServer = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  await svc.reinstall(server, actor(req));
  return ok(res, { server: await svc.toClient(server, { detail: true }) }, 'Server reinstalled');
});

export const cloneServer = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const clone = await svc.cloneServer(server, actor(req));
  return created(res, { server: await svc.toClient(clone) }, 'Server cloned');
});

export const deleteServer = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  await svc.deleteServer(server, actor(req));
  return ok(res, {}, 'Server deleted');
});

export const setSuspended = asyncHandler(async (req, res) => {
  const server = authorizedServer(req, { admin: true });
  await svc.setSuspended(server, req.body.suspended !== false, actor(req));
  return ok(res, { server: await svc.toClient(server) }, server.suspended ? 'Server suspended' : 'Server unsuspended');
});

// ── SFTP connection details ─────────────────────────────────────────────
export const sftpInfo = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const cfg = (await import('../config/index.js')).default;
  const host = cfg.sftp.publicHost || cfg.network.publicIp || cfg.network.internalIp || req.hostname;
  return ok(res, {
    enabled: cfg.sftp.enabled,
    host,
    port: cfg.sftp.port,
    username: `${req.user.username}.${server.id}`,
    note: 'Use your panel password. Connect with FileZilla or WinSCP (protocol: SFTP).',
    status: cfg.sftp.enabled ? 'online' : 'disabled',
  }, 'SFTP details');
});

// ── Backups ────────────────────────────────────────────────────────────
export const listBackups = asyncHandler(async (req, res) => {
  authorizedServer(req);
  const backups = db.data.backups.filter((b) => b.serverId === req.params.id);
  return ok(res, { backups }, 'Backups');
});

export const createBackup = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const backup = await svc.createBackup(server, actor(req));
  return created(res, { backup }, 'Backup created');
});

export const restoreBackup = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const backup = db.data.backups.find((b) => b.id === req.params.backupId && b.serverId === server.id);
  if (!backup) throw ApiError.notFound('Backup not found');
  await svc.restoreBackup(server, backup, actor(req));
  return ok(res, {}, 'Backup restored');
});

export const downloadBackup = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const backup = db.data.backups.find((b) => b.id === req.params.backupId && b.serverId === server.id);
  if (!backup) throw ApiError.notFound('Backup not found');
  return res.download(backup.file, backup.name);
});

export const deleteBackup = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const backup = db.data.backups.find((b) => b.id === req.params.backupId && b.serverId === server.id);
  if (!backup) throw ApiError.notFound('Backup not found');
  await svc.deleteBackup(backup);
  return ok(res, {}, 'Backup deleted');
});
