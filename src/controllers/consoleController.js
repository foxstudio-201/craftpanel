import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as docker from '../services/docker.service.js';
import * as mc from '../services/minecraft.service.js';
import { typeOf, feature } from '../services/service-registry.js';
import { emitConsoleLine } from '../sockets/index.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

function authorizedServer(req) {
  const server = db.data.servers.find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');
  return server;
}

function parseLevel(line) {
  if (/\b(ERROR|SEVERE)\b/.test(line)) return 'ERROR';
  if (/\bWARN/.test(line)) return 'WARN';
  return 'INFO';
}

/** Recent real container logs. */
export const getLogs = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  if (!server.dockerId) return ok(res, { logs: [] }, 'Console logs');
  let lines = [];
  try {
    lines = await docker.getRecentLogs(server.dockerId, 300);
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  const logs = lines.map((text) => ({ ts: new Date().toISOString(), level: parseLevel(text), text: text.replace(/\r$/, '') }));
  return ok(res, { logs }, 'Console logs');
});

/**
 * Validate the full command path against real infrastructure before executing.
 * Returns the live container state. Throws precise errors the terminal renders.
 */
async function validateExecutable(server) {
  if (!server.dockerId) throw ApiError.notFound('Container not found — the server is not installed');
  if (!(await docker.isAvailable())) throw new ApiError(503, 'Docker daemon is not reachable');
  const info = await docker.inspect(server.dockerId);
  if (!info) throw ApiError.notFound('Container not found — reinstall the server');
  if (info.State?.Status !== 'running') throw ApiError.badRequest('Server is offline — start it before running commands');
  return info;
}

/** Execute a command on the real server (RCON) or proxy (stdin). */
export const sendCommand = asyncHandler(async (req, res) => {
  const server = authorizedServer(req); // permission check
  const command = String(req.body.command || '').trim().replace(/^\//, '');
  if (!command) throw ApiError.badRequest('Command is required');

  await validateExecutable(server);

  // Echo the command into the console stream for everyone watching.
  emitConsoleLine(server.id, { level: 'INFO', text: `> ${command}` });

  // Minecraft servers use RCON; proxies and generic services receive the
  // command on the container's stdin (the real process input).
  let response = '';
  const usesRcon = feature(typeOf(server), 'rcon') && !mc.isProxy(server.software);
  if (usesRcon) {
    response = await docker.rcon(server.dockerId, command);
    if (response) emitConsoleLine(server.id, { level: 'INFO', text: response });
  } else {
    await docker.writeStdin(server.dockerId, command);
  }

  logActivity('console.command', { actor: { id: req.user.id, username: req.user.username }, target: server.name, serverId: server.id, meta: { command } });
  return ok(res, { response }, 'Command executed');
});
