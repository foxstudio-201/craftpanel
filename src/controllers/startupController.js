import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import * as svc from '../services/server.service.js';
import * as mc from '../services/minecraft.service.js';
import { typeOf, definitionFor, versionsFor, imageForVersion, featureValue } from '../services/service-registry.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (u) => (ROLE_LEVEL[u.role] || 0) >= ROLE_LEVEL.moderator;

function server(req) {
  const s = db.data.servers.find((x) => x.id === req.params.id);
  if (!s) throw ApiError.notFound('Server not found');
  if (s.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');
  return s;
}

const actor = (req) => ({ id: req.user.id, username: req.user.username });

/** The runtime version key currently in use (services with a version selector). */
function currentVersion(s, type) {
  return versionsFor(type).find((v) => v.image === s.image)?.key || null;
}

export const getStartup = asyncHandler(async (req, res) => {
  const s = server(req);
  const type = typeOf(s);

  // ── Minecraft: itzg-managed TYPE/VERSION + server.properties fields ──
  if (type === 'minecraft') {
    const sw = mc.SOFTWARE[s.software];
    return ok(res, {
      serviceType: type,
      software: s.software,
      softwareLabel: sw?.label,
      version: s.version,
      dockerImage: sw?.image,
      startupCommand: sw?.kind === 'proxy' ? 'Managed by itzg/mc-proxy entrypoint' : 'Managed by itzg/minecraft-server entrypoint (TYPE/VERSION)',
      java: 'OpenJDK (auto-selected by image for the chosen version)',
      limits: s.limits,
      maxPlayers: s.maxPlayers,
      motd: s.motd,
      difficulty: s.difficulty,
      gamemode: s.gamemode,
      onlineMode: s.onlineMode,
      env: s.env || {},
      editable: ['version', 'maxPlayers', 'motd', 'difficulty', 'gamemode', 'onlineMode', 'limits.cpu', 'limits.ramMb', 'limits.diskMb'],
    }, 'Startup configuration');
  }

  // ── Generic services (Discord/Node/Python/Static): yolks STARTUP ────
  const def = definitionFor(type);
  return ok(res, {
    serviceType: type,
    template: s.template,
    dockerImage: s.image,
    startupCommand: s.startup,
    versions: versionsFor(type),            // selectable runtime images (may be [])
    version: currentVersion(s, type),
    packages: featureValue(type, 'packages'),  // 'npm' | 'pip' | 'auto' | null
    build: Boolean(def.features?.build),
    limits: s.limits,
    env: s.env || {},
    editable: ['startup', 'version', 'limits.cpu', 'limits.ramMb', 'limits.diskMb'],
  }, 'Startup configuration');
});

/** Update startup config; recreates the container so changes take effect. */
export const updateStartup = asyncHandler(async (req, res) => {
  const s = server(req);
  const type = typeOf(s);
  const b = req.body;

  if (type === 'minecraft') {
    if (b.version) s.version = String(b.version);
    if (b.maxPlayers) s.maxPlayers = Number(b.maxPlayers);
    if (b.motd !== undefined) s.motd = String(b.motd);
    if (b.difficulty) s.difficulty = String(b.difficulty);
    if (b.gamemode) s.gamemode = String(b.gamemode);
    if (b.onlineMode !== undefined) s.onlineMode = !!b.onlineMode;
  } else {
    if (typeof b.startup === 'string' && b.startup.trim()) s.startup = b.startup;
    // Runtime version selector → maps to a yolks image tag.
    if (b.version) {
      const image = imageForVersion(type, String(b.version));
      if (!image) throw ApiError.badRequest('Unknown runtime version');
      s.image = image;
    }
    if (b.env && typeof b.env === 'object') s.env = b.env;
  }

  if (b.limits) {
    s.limits.cpu = Number(b.limits.cpu) || s.limits.cpu;
    s.limits.ramMb = Number(b.limits.ramMb) || s.limits.ramMb;
    s.limits.diskMb = Number(b.limits.diskMb) || s.limits.diskMb;
  }
  if (type === 'minecraft' && b.env && typeof b.env === 'object') s.env = b.env;
  db.save();

  await svc.reinstall(s, actor(req));
  logActivity('server.startup.update', { actor: actor(req), target: s.name, serverId: s.id });
  return ok(res, { server: await svc.toClient(s, { detail: true }) }, 'Startup updated (container recreated)');
});
