/**
 * Environment variables — dedicated CRUD for the per-service Environment page.
 *
 * Env is stored on the service record (`server.env`) and applied to the real
 * container on (re)install. Editing here recreates the container so the new
 * variables take effect, mirroring `startupController.updateStartup`.
 */
import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as svc from '../services/server.service.js';
import { typeOf, feature, featureValue } from '../services/service-registry.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (u) => (ROLE_LEVEL[u.role] || 0) >= ROLE_LEVEL.moderator;

function server(req) {
  const s = db.data.servers.find((x) => x.id === req.params.id);
  if (!s) throw ApiError.notFound('Server not found');
  if (s.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');
  return s;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const getEnv = asyncHandler(async (req, res) => {
  const s = server(req);
  const type = typeOf(s);
  if (!feature(type, 'environment')) throw ApiError.badRequest('Environment editing is not supported for this service type');
  return ok(res, {
    env: s.env || {},
    packages: featureValue(type, 'packages'), // 'npm' | 'pip' | 'auto' | null
  }, 'Environment variables');
});

export const updateEnv = asyncHandler(async (req, res) => {
  const s = server(req);
  const type = typeOf(s);
  if (!feature(type, 'environment')) throw ApiError.badRequest('Environment editing is not supported for this service type');

  const incoming = req.body.env;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) throw ApiError.badRequest('env must be an object');

  const env = {};
  for (const [k, v] of Object.entries(incoming)) {
    const key = String(k).trim();
    if (!KEY_RE.test(key)) throw ApiError.badRequest(`Invalid variable name: ${k}`);
    env[key] = v == null ? '' : String(v);
  }
  s.env = env;
  db.save();

  await svc.reinstall(s, { id: req.user.id, username: req.user.username });
  logActivity('server.env.update', { actor: { id: req.user.id, username: req.user.username }, target: s.name, serverId: s.id, meta: { keys: Object.keys(env) } });
  return ok(res, { env: s.env }, 'Environment updated (container recreated)');
});
