import fs from 'node:fs';
import path from 'node:path';

import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as docker from '../services/docker.service.js';
import * as mc from '../services/minecraft.service.js';
import * as svc from '../services/server.service.js';
import { typeOf, feature } from '../services/service-registry.js';
import { logActivity } from '../services/activity.service.js';
import { getIO } from '../sockets/index.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

function authorizedServer(req, id) {
  const server = db.data.servers.find((s) => s.id === id);
  if (!server) throw ApiError.notFound('Server not found');
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');
  return server;
}

function readJsonFile(uuid, file) {
  try {
    const p = path.join(mc.volumePath(uuid), file);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return []; }
}

/** Real player view: online (RCON), banned + whitelist (server files). */
export const listPlayers = asyncHandler(async (req, res) => {
  const serverId = req.query.serverId;
  if (!serverId) throw ApiError.badRequest('serverId is required');
  const server = authorizedServer(req, serverId);
  if (!feature(typeOf(server), 'players')) throw ApiError.badRequest('Player management is not supported for this service type');

  const live = await svc.listPlayers(server);
  const banned = readJsonFile(server.uuid, 'banned-players.json').map((b) => b.name);
  const whitelist = readJsonFile(server.uuid, 'whitelist.json').map((w) => w.name);
  const ops = readJsonFile(server.uuid, 'ops.json').map((o) => o.name);

  const names = new Set([...live.names, ...banned, ...whitelist, ...ops]);
  const players = [...names].map((name) => ({
    id: name,
    name,
    serverId,
    online: live.names.includes(name),
    banned: banned.includes(name),
    whitelisted: whitelist.includes(name),
    op: ops.includes(name),
  }));

  return ok(res, { players, online: live.online, max: live.max }, 'Players');
});

const COMMANDS = {
  ban: (n) => `ban ${n}`,
  unban: (n) => `pardon ${n}`,
  kick: (n) => `kick ${n}`,
  op: (n) => `op ${n}`,
  deop: (n) => `deop ${n}`,
  'whitelist-add': (n) => `whitelist add ${n}`,
  'whitelist-remove': (n) => `whitelist remove ${n}`,
};

export const playerAction = asyncHandler(async (req, res) => {
  const server = authorizedServer(req, req.params.serverId);
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden();
  if (!feature(typeOf(server), 'players')) throw ApiError.badRequest('Player management is not supported for this service type');

  const action = req.params.action;
  const name = String(req.body.name || '').trim();
  if (!COMMANDS[action]) throw ApiError.badRequest('Invalid action');
  if (!name || !/^[A-Za-z0-9_]{1,16}$/.test(name)) throw ApiError.badRequest('Invalid player name');

  const state = await docker.getState(server.dockerId);
  if (state !== 'running') throw ApiError.badRequest('Server must be running');

  const out = await docker.rcon(server.dockerId, COMMANDS[action](name));
  logActivity(`player.${action}`, { actor: { id: req.user.id, username: req.user.username }, target: name, serverId: server.id });
  getIO()?.emit('players:update', { serverId: server.id });
  return ok(res, { result: out }, `Player ${action}`);
});
