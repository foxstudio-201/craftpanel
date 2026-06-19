import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as svc from '../services/database.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (u) => (ROLE_LEVEL[u.role] || 0) >= ROLE_LEVEL.moderator;
const actor = (req) => ({ id: req.user.id, username: req.user.username });

function authorized(req) {
  const d = db.data.databases.find((x) => x.id === req.params.id);
  if (!d) throw ApiError.notFound('Database not found');
  if (d.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this database');
  return d;
}

export const engines = asyncHandler(async (_req, res) =>
  ok(res, { engines: Object.entries(svc.ENGINES).map(([k, v]) => ({ key: k, label: v.label, image: v.image, port: v.port })) }, 'Engines')
);

export const listDatabases = asyncHandler(async (req, res) => {
  let rows = db.data.databases;
  if (!isStaff(req.user)) rows = rows.filter((d) => d.ownerId === req.user.id);
  const databases = [];
  for (const d of rows) { await svc.syncStatus(d); databases.push({ ...svc.publicRecord(d), connection: svc.connectionString(d) }); }
  db.save();
  const stats = {
    total: rows.length,
    running: databases.filter((d) => d.status === 'running').length,
    byEngine: databases.reduce((a, d) => ({ ...a, [d.engine]: (a[d.engine] || 0) + 1 }), {}),
  };
  return ok(res, { databases, stats }, 'Databases');
});

export const getDatabase = asyncHandler(async (req, res) => {
  const d = authorized(req);
  await svc.syncStatus(d);
  return ok(res, { database: { ...svc.publicRecord(d), connection: svc.connectionString(d) } }, 'Database');
});

export const createDatabase = asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') throw ApiError.forbidden('Only administrators can provision databases');
  const ownerId = req.body.ownerId && db.data.users.find((u) => u.id === req.body.ownerId) ? req.body.ownerId : req.user.id;
  const record = await svc.createDatabase({ engine: req.body.engine, name: req.body.name, ownerId }, actor(req));
  return created(res, { database: { ...svc.publicRecord(record), connection: svc.connectionString(record) } }, 'Database provisioned');
});

export const powerDatabase = asyncHandler(async (req, res) => {
  const d = authorized(req);
  await svc.power(d, req.body.action);
  return ok(res, { database: svc.publicRecord(d) }, `Database ${req.body.action} issued`);
});

export const deleteDatabase = asyncHandler(async (req, res) => {
  const d = authorized(req);
  await svc.deleteDatabase(d);
  return ok(res, {}, 'Database deleted');
});
