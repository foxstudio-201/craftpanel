import { nanoid } from 'nanoid';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as svc from '../services/server.service.js';
import * as infra from '../services/infra.service.js';
import { logActivity } from '../services/activity.service.js';

const isAdmin = (u) => u.role === 'admin';
const isStaff = (u) => u.role === 'admin' || u.role === 'moderator';

/** Ensure at least the node's primary IP exists in the pool. */
function ensureDefaultIp() {
  if (!db.data.ips.length) {
    const net = infra.getNetworkIdentity();
    db.data.ips.push({ id: nanoid(8), ip: net.internalIp, label: 'Primary (node)', primary: true, createdAt: new Date().toISOString() });
    if (net.publicIp) db.data.ips.push({ id: nanoid(8), ip: net.publicIp, label: 'Public', primary: false, createdAt: new Date().toISOString() });
    db.save();
  }
}

function allocationsForServers(servers) {
  return servers.map((s) => ({
    serverId: s.id, server: s.name, ip: s.allocation?.ip || '0.0.0.0',
    port: s.allocation?.port, protocol: 'tcp', primary: true, status: 'assigned',
    owner: db.data.users.find((u) => u.id === s.ownerId)?.username,
    additional: (s.allocation?.additionalPorts || []).map((p) => ({ port: p, protocol: 'tcp', status: 'assigned' })),
  }));
}

export const overview = asyncHandler(async (req, res) => {
  ensureDefaultIp();
  const servers = isStaff(req.user) ? db.data.servers : db.data.servers.filter((s) => s.ownerId === req.user.id);
  const allocations = allocationsForServers(servers);

  const payload = {
    allocations,
    pool: { range: `${config.ports.min}-${config.ports.max}` },
  };
  if (isAdmin(req.user)) {
    const usedPorts = db.data.servers.map((s) => s.allocation?.port).filter(Boolean);
    payload.ips = db.data.ips;
    payload.stats = {
      ips: db.data.ips.length,
      allocated: usedPorts.length,
      free: (config.ports.max - config.ports.min + 1) - usedPorts.length,
    };
  }
  return ok(res, payload, 'Network');
});

// ── Admin: IP pool ───────────────────────────────────────────────────
export const addIp = asyncHandler(async (req, res) => {
  const { ip, label } = req.body;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip || '') && !/^[a-fA-F0-9:]+$/.test(ip || '')) throw ApiError.badRequest('Invalid IP address');
  if (db.data.ips.find((i) => i.ip === ip)) throw ApiError.conflict('IP already in pool');
  const entry = { id: nanoid(8), ip, label: label || '', primary: false, createdAt: new Date().toISOString() };
  db.data.ips.push(entry);
  db.save();
  logActivity('network.ip.add', { actor: { id: req.user.id, username: req.user.username }, target: ip });
  return created(res, { ip: entry }, 'IP added');
});

export const removeIp = asyncHandler(async (req, res) => {
  const entry = db.data.ips.find((i) => i.id === req.params.id);
  if (!entry) throw ApiError.notFound('IP not found');
  if (entry.primary) throw ApiError.badRequest('Cannot remove the primary IP');
  if (db.data.servers.some((s) => s.allocation?.ip === entry.ip)) throw ApiError.badRequest('IP is in use by a server');
  db.data.ips = db.data.ips.filter((i) => i.id !== req.params.id);
  db.save();
  return ok(res, {}, 'IP removed');
});

/** Admin: reassign a server's primary port (recreates the container to apply). */
export const reassignPort = asyncHandler(async (req, res) => {
  const server = db.data.servers.find((s) => s.id === req.body.serverId);
  if (!server) throw ApiError.notFound('Server not found');
  const port = Number(req.body.port);
  if (!port || port < 1024 || port > 65535) throw ApiError.badRequest('Invalid port');
  if (db.data.servers.some((s) => s.id !== server.id && s.allocation?.port === port)) throw ApiError.conflict('Port already allocated');

  server.allocation.port = port;
  if (req.body.ip) server.allocation.ip = req.body.ip;
  db.save();
  await svc.reinstall(server, { id: req.user.id, username: req.user.username });
  logActivity('network.reassign', { actor: { id: req.user.id, username: req.user.username }, target: server.name, serverId: server.id, meta: { port } });
  return ok(res, { server: await svc.toClient(server, { detail: true }) }, 'Port reassigned (container recreated)');
});
