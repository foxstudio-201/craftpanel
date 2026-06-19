import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';
import { getOverview, getServerHistory, getServerMetrics } from '../services/metrics.service.js';
import db from '../data/store.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;
const visibleServers = (user) =>
  isStaff(user) ? db.data.servers : db.data.servers.filter((s) => s.ownerId === user.id);

export const overview = asyncHandler(async (_req, res) => {
  return ok(res, await getOverview(), 'Overview metrics');
});

export const serverMetrics = asyncHandler(async (req, res) => {
  const m = await getServerMetrics(req.params.id);
  if (!m) throw ApiError.notFound('Server not found');
  return ok(res, m, 'Server metrics');
});

export const serverHistory = asyncHandler(async (req, res) => {
  const history = await getServerHistory(req.params.id);
  if (!history) throw ApiError.notFound('Server not found');
  return ok(res, { history }, 'Metrics history');
});

/** Aggregate history across the caller's visible servers. */
export const aggregateHistory = asyncHandler(async (req, res) => {
  const servers = visibleServers(req.user);
  const histories = (await Promise.all(servers.map((s) => getServerHistory(s.id)))).filter(Boolean);
  const points = Math.max(0, ...histories.map((h) => h.length));

  const series = Array.from({ length: points }).map((_, i) => {
    const avg = (key) => {
      const vals = histories.map((h) => h[i]?.[key]).filter((v) => v != null);
      return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : 0;
    };
    return { t: i, cpu: avg('cpu'), ram: avg('ram'), disk: avg('disk'), net: avg('net'), tps: avg('tps') };
  });

  return ok(res, { history: series }, 'Aggregate history');
});
