import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as scheduleSvc from '../services/schedule.service.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (u) => (ROLE_LEVEL[u.role] || 0) >= ROLE_LEVEL.moderator;

function server(req, id) {
  const s = db.data.servers.find((x) => x.id === id);
  if (!s) throw ApiError.notFound('Server not found');
  if (s.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');
  return s;
}
function schedule(req) {
  const sc = db.data.schedules.find((s) => s.id === req.params.id);
  if (!sc) throw ApiError.notFound('Schedule not found');
  server(req, sc.serverId); // access check
  return sc;
}
const actor = (req) => ({ id: req.user.id, username: req.user.username });

export const list = asyncHandler(async (req, res) => {
  const serverId = req.query.serverId;
  if (serverId) server(req, serverId);
  let schedules = db.data.schedules;
  if (serverId) schedules = schedules.filter((s) => s.serverId === serverId);
  else if (!isStaff(req.user)) {
    const mine = new Set(db.data.servers.filter((s) => s.ownerId === req.user.id).map((s) => s.id));
    schedules = schedules.filter((s) => mine.has(s.serverId));
  }
  return ok(res, { schedules, actions: scheduleSvc.ACTIONS }, 'Schedules');
});

export const create = asyncHandler(async (req, res) => {
  const s = server(req, req.body.serverId);
  const sc = scheduleSvc.create({ ...req.body, ownerId: s.ownerId });
  logActivity('schedule.create', { actor: actor(req), target: s.name, serverId: s.id, meta: { cron: sc.cron, action: sc.action } });
  return created(res, { schedule: sc }, 'Schedule created');
});

export const update = asyncHandler(async (req, res) => {
  const sc = schedule(req);
  const patch = (({ name, cron, action, payload, enabled }) => ({ name, cron, action, payload, enabled }))(req.body);
  Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);
  scheduleSvc.update(sc, patch);
  return ok(res, { schedule: sc }, 'Schedule updated');
});

export const toggle = asyncHandler(async (req, res) => {
  const sc = schedule(req);
  scheduleSvc.update(sc, { enabled: !sc.enabled });
  return ok(res, { schedule: sc }, sc.enabled ? 'Schedule enabled' : 'Schedule disabled');
});

export const runNow = asyncHandler(async (req, res) => {
  const sc = schedule(req);
  const job = scheduleSvc.runNow(sc);
  return ok(res, { job }, 'Schedule queued');
});

export const remove = asyncHandler(async (req, res) => {
  const sc = schedule(req);
  scheduleSvc.remove(sc);
  logActivity('schedule.delete', { actor: actor(req), serverId: sc.serverId });
  return ok(res, {}, 'Schedule deleted');
});
