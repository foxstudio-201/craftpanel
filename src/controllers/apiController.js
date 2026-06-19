import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as keys from '../services/apikey.service.js';
import * as svc from '../services/server.service.js';
import { getServerMetrics } from '../services/metrics.service.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isAdmin = (u) => u.role === 'admin';

// ── Key management (session-authenticated) ────────────────────────────
export const listScopes = asyncHandler(async (_req, res) => ok(res, { scopes: keys.SCOPES }, 'Scopes'));

export const listKeys = asyncHandler(async (req, res) => {
  const all = isAdmin(req.user) && req.query.all === 'true';
  return ok(res, { keys: keys.listForOwner(req.user.id, all) }, 'API keys');
});

export const createKey = asyncHandler(async (req, res) => {
  const { name, scopes, rateLimit, expiresAt } = req.body;
  // Only admins may mint admin-scoped keys.
  if ((scopes || []).includes('admin') && !isAdmin(req.user)) throw ApiError.forbidden('Only admins can create admin-scoped keys');
  const { record, secret } = keys.createKey({ name, ownerId: req.user.id, scopes, rateLimit, expiresAt });
  logActivity('apikey.create', { actor: { id: req.user.id, username: req.user.username }, target: record.name });
  return created(res, { key: record, secret }, 'API key created — copy the secret now, it will not be shown again');
});

export const renameKey = asyncHandler(async (req, res) => {
  const key = db.data.apiKeys.find((k) => k.id === req.params.id);
  if (!key) throw ApiError.notFound('API key not found');
  if (key.ownerId !== req.user.id && !isAdmin(req.user)) throw ApiError.forbidden();
  if (!req.body.name) throw ApiError.badRequest('name is required');
  keys.rename(key, req.body.name);
  return ok(res, { key: keys.publicKey(key) }, 'API key renamed');
});

export const keyUsage = asyncHandler(async (req, res) => {
  const usage = keys.getUsage(req.params.id, req.user.id, isAdmin(req.user));
  return ok(res, { usage }, 'API key usage');
});

export const revokeKey = asyncHandler(async (req, res) => {
  keys.revoke(req.params.id, req.user.id, isAdmin(req.user));
  return ok(res, {}, 'API key revoked');
});

// ── External API (X-API-Key authenticated) ────────────────────────────
function scopedServers(req) {
  const adminScope = req.apiKey?.scopes.includes('admin');
  return adminScope ? db.data.servers : db.data.servers.filter((s) => s.ownerId === req.user.id);
}

export const v1ListServers = asyncHandler(async (req, res) => {
  const servers = await Promise.all(scopedServers(req).map((s) => svc.toClient(s)));
  return ok(res, { servers }, 'Servers');
});

export const v1GetServer = asyncHandler(async (req, res) => {
  const server = scopedServers(req).find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  return ok(res, { server: await svc.toClient(server, { detail: true }) }, 'Server');
});

export const v1Metrics = asyncHandler(async (req, res) => {
  const server = scopedServers(req).find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  return ok(res, await getServerMetrics(server.id), 'Metrics');
});

export const v1Power = asyncHandler(async (req, res) => {
  const server = scopedServers(req).find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  await svc.power(server, req.body.action, { id: req.user.id, username: `apikey:${req.apiKey.name}` });
  return ok(res, { server: await svc.toClient(server) }, `Server ${req.body.action} issued`);
});

export const v1Command = asyncHandler(async (req, res) => {
  const server = scopedServers(req).find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  const docker = await import('../services/docker.service.js');
  const out = await docker.rcon(server.dockerId, String(req.body.command || '').replace(/^\//, ''));
  return ok(res, { response: out }, 'Command executed');
});

export const v1Docs = asyncHandler(async (_req, res) =>
  ok(res, {
    version: 'v1',
    auth: 'Send header `X-API-Key: <your key>`',
    scopes: keys.SCOPES,
    endpoints: [
      { method: 'GET', path: '/api/v1/servers', scope: 'servers.read', desc: 'List servers visible to the key' },
      { method: 'GET', path: '/api/v1/servers/:id', scope: 'servers.read', desc: 'Server detail' },
      { method: 'GET', path: '/api/v1/servers/:id/metrics', scope: 'servers.read', desc: 'Live CPU/RAM/disk/net/TPS' },
      { method: 'POST', path: '/api/v1/servers/:id/power', scope: 'servers.control', desc: 'Body {action: start|stop|restart|kill}' },
      { method: 'POST', path: '/api/v1/servers/:id/command', scope: 'servers.control', desc: 'Body {command} — runs via RCON' },
    ],
  }, 'CraftPanel API v1')
);
