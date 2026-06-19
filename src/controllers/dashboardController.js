import db from '../data/store.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { getOverview } from '../services/metrics.service.js';
import * as svc from '../services/server.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

export const dashboard = asyncHandler(async (req, res) => {
  const overview = await getOverview();

  let servers = db.data.servers;
  if (!isStaff(req.user)) servers = servers.filter((s) => s.ownerId === req.user.id);

  const recent = await Promise.all(
    servers.slice(0, 6).map(async (s) => {
      const client = await svc.toClient(s);
      const players = client.state === 'running' ? await svc.listPlayers(s) : { online: 0, max: s.maxPlayers };
      return { ...client, type: client.softwareLabel, status: client.state, players: players.online, maxPlayers: players.max };
    })
  );
  const onlinePlayers = recent.reduce((a, s) => a + (s.players || 0), 0);
  overview.players.online = onlinePlayers;

  return ok(
    res,
    {
      overview,
      recentServers: recent,
      notifications: db.data.notifications.slice(0, 6),
      counts: {
        servers: servers.length,
        players: onlinePlayers,
        plugins: 0,
        backups: db.data.backups.filter((b) => servers.some((s) => s.id === b.serverId)).length,
      },
    },
    'Dashboard'
  );
});

/** Activity scoped to the caller (own actions + actions on their servers). Staff see all. */
export const myActivity = asyncHandler(async (req, res) => {
  const limit = Math.min(300, Number(req.query.limit) || 100);
  let logs = db.data.activityLogs;
  if (!isStaff(req.user)) {
    const myServers = new Set(db.data.servers.filter((s) => s.ownerId === req.user.id).map((s) => s.id));
    logs = logs.filter((a) => a.actorId === req.user.id || (a.serverId && myServers.has(a.serverId)));
  }
  return ok(res, { logs: logs.slice(0, limit) }, 'Activity');
});

export const listNotifications = asyncHandler(async (_req, res) =>
  ok(res, { notifications: db.data.notifications }, 'Notifications')
);
export const markRead = asyncHandler(async (req, res) => {
  const n = db.data.notifications.find((x) => x.id === req.params.id);
  if (n) n.read = true;
  db.save();
  return ok(res, {}, 'Marked read');
});
export const markAllRead = asyncHandler(async (_req, res) => {
  db.data.notifications.forEach((n) => (n.read = true));
  db.save();
  return ok(res, {}, 'All marked read');
});
export const clearNotifications = asyncHandler(async (_req, res) => {
  db.data.notifications = [];
  db.save();
  return ok(res, {}, 'Cleared');
});
