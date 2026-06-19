import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import logger from '../utils/logger.js';
import * as svc from '../services/server.service.js';
import * as infra from '../services/infra.service.js';
import * as queue from '../services/queue.service.js';
import { logActivity } from '../services/activity.service.js';
import { pushNotification, getIO } from '../sockets/index.js';

const sanitize = (u) => { const { password, ...safe } = u; return safe; };
const actor = (req) => ({ id: req.user.id, username: req.user.username });

// ── Overview ───────────────────────────────────────────────────────────
export const overview = asyncHandler(async (req, res) => {
  const node = infra.getNodeStatus();
  const servers = await Promise.all(db.data.servers.map((s) => svc.toClient(s)));
  return ok(res, {
    counts: {
      users: db.data.users.length,
      admins: db.data.users.filter((u) => u.role === 'admin').length,
      servers: servers.length,
      running: servers.filter((s) => s.state === 'running').length,
      suspended: servers.filter((s) => s.suspended).length,
      banned: db.data.users.filter((u) => u.banned).length,
    },
    node,
    recentActivity: db.data.activityLogs.slice(0, 8),
  }, 'Admin overview');
});

// ── Users ────────────────────────────────────────────────────────────────
export const listUsers = asyncHandler(async (_req, res) => {
  const users = db.data.users.map((u) => ({
    ...sanitize(u),
    serverCount: db.data.servers.filter((s) => s.ownerId === u.id).length,
  }));
  return ok(res, { users }, 'Users');
});

export const createUser = asyncHandler(async (req, res) => {
  const { username, email, password, role = 'user' } = req.body;
  if (!username || !email || !password) throw ApiError.badRequest('username, email and password are required');
  if (password.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');
  if (!['admin', 'moderator', 'user'].includes(role)) throw ApiError.badRequest('Invalid role');
  if (db.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === username.toLowerCase())) {
    throw ApiError.conflict('A user with that email or username already exists');
  }
  const user = {
    id: nanoid(12), username, email,
    password: await bcrypt.hash(password, config.bcryptRounds),
    role, avatar: null, bio: '', banned: false,
    createdAt: new Date().toISOString(), lastLogin: null, twoFactor: false,
  };
  db.data.users.push(user);
  db.save();
  logActivity('user.create', { actor: actor(req), target: username, meta: { role } });
  return created(res, { user: sanitize(user) }, 'User created');
});

export const setUserBanned = asyncHandler(async (req, res) => {
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (user.id === req.user.id) throw ApiError.badRequest('You cannot ban yourself');
  user.banned = req.body.banned !== false;
  db.save();
  logActivity(user.banned ? 'user.ban' : 'user.unban', { actor: actor(req), target: user.username });
  return ok(res, { user: sanitize(user) }, user.banned ? 'User banned' : 'User unbanned');
});

export const updateRole = asyncHandler(async (req, res) => {
  if (!['admin', 'moderator', 'user'].includes(req.body.role)) throw ApiError.badRequest('Invalid role');
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  user.role = req.body.role;
  db.save();
  logActivity('user.role', { actor: actor(req), target: user.username, meta: { role: req.body.role } });
  return ok(res, { user: sanitize(user) }, 'Role updated');
});

export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot delete your own account');
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (db.data.servers.some((s) => s.ownerId === user.id)) {
    throw ApiError.badRequest('Reassign or delete this user’s servers first');
  }
  db.data.users = db.data.users.filter((u) => u.id !== user.id);
  db.save();
  logActivity('user.delete', { actor: actor(req), target: user.username });
  return ok(res, {}, 'User deleted');
});

// ── Servers (all) ─────────────────────────────────────────────────────────
export const listAllServers = asyncHandler(async (_req, res) => {
  const servers = await Promise.all(db.data.servers.map((s) => svc.toClient(s)));
  return ok(res, { servers }, 'All servers');
});

export const transferServer = asyncHandler(async (req, res) => {
  const server = db.data.servers.find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  const owner = db.data.users.find((u) => u.id === req.body.ownerId);
  if (!owner) throw ApiError.badRequest('Target owner not found');
  const previous = server.ownerId;
  server.ownerId = owner.id;
  db.save();
  logActivity('server.transfer', { actor: actor(req), target: server.name, serverId: server.id, meta: { from: previous, to: owner.username } });
  return ok(res, { server: await svc.toClient(server) }, `Ownership transferred to ${owner.username}`);
});

// ── Logs & infrastructure ──────────────────────────────────────────────────
export const activityLogs = asyncHandler(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  return ok(res, { logs: db.data.activityLogs.slice(0, limit) }, 'Activity logs');
});

export const systemLogs = asyncHandler(async (req, res) =>
  ok(res, { logs: logger.recent(Math.min(500, Number(req.query.limit) || 200)) }, 'System logs')
);

export const queueStatus = asyncHandler(async (_req, res) =>
  ok(res, { stats: queue.stats(), jobs: queue.listJobs(50) }, 'Queue status')
);

export const nodeStatus = asyncHandler(async (_req, res) => ok(res, infra.getNodeStatus(), 'Node status'));
export const dockerStatus = asyncHandler(async (_req, res) => ok(res, await infra.getDockerStatus(), 'Docker status'));
export const infraStatus = asyncHandler(async (_req, res) => ok(res, await infra.getOverview(), 'Infrastructure'));

// ── Announcements ───────────────────────────────────────────────────────────
export const listAnnouncements = asyncHandler(async (_req, res) =>
  ok(res, { announcements: db.data.announcements }, 'Announcements')
);

export const createAnnouncement = asyncHandler(async (req, res) => {
  const { title, message, type = 'info' } = req.body;
  if (!title || !message) throw ApiError.badRequest('title and message are required');
  const announcement = { id: nanoid(10), title, message, type, author: req.user.username, createdAt: new Date().toISOString() };
  db.data.announcements.unshift(announcement);
  db.data.announcements = db.data.announcements.slice(0, 50);
  db.save();
  getIO()?.emit('announcement', announcement);
  pushNotification({ type, title: `📢 ${title}`, message });
  logActivity('announcement.create', { actor: actor(req), target: title });
  return created(res, { announcement }, 'Announcement broadcast');
});

export const deleteAnnouncement = asyncHandler(async (req, res) => {
  db.data.announcements = db.data.announcements.filter((a) => a.id !== req.params.id);
  db.save();
  return ok(res, {}, 'Announcement deleted');
});
