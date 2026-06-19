import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as mc from '../services/minecraft.service.js';
import { typeOf, feature } from '../services/service-registry.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

function authorizedServer(req, id) {
  const server = db.data.servers.find((s) => s.id === id);
  if (!server) throw ApiError.notFound('Server not found');
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');
  if (!feature(typeOf(server), 'plugins')) throw ApiError.badRequest('Plugin management is not supported for this service type');
  return server;
}

const pluginsDir = (uuid) => path.join(mc.volumePath(uuid), 'plugins');

/** List real plugin jars in the server's plugins folder. */
export const listPlugins = asyncHandler(async (req, res) => {
  const server = authorizedServer(req, req.query.serverId);
  const dir = pluginsDir(server.uuid);
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { /* none yet */ }

  const plugins = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const enabled = e.name.endsWith('.jar');
    if (!enabled && !e.name.endsWith('.jar.disabled')) continue;
    const stat = await fsp.stat(path.join(dir, e.name));
    plugins.push({
      id: Buffer.from(e.name).toString('base64url'),
      name: e.name.replace(/\.jar(\.disabled)?$/, ''),
      file: e.name,
      enabled,
      size: +(stat.size / 1e6).toFixed(2),
      modified: stat.mtime.toISOString(),
    });
  }
  plugins.sort((a, b) => a.name.localeCompare(b.name));
  return ok(res, { plugins }, 'Plugins');
});

const decodeId = (id) => Buffer.from(id, 'base64url').toString('utf8');

function safePluginPath(uuid, file) {
  const dir = pluginsDir(uuid);
  const target = path.resolve(dir, path.basename(file)); // basename blocks traversal
  if (!target.startsWith(dir)) throw ApiError.forbidden('Invalid plugin path');
  return target;
}

export const togglePlugin = asyncHandler(async (req, res) => {
  const server = authorizedServer(req, req.body.serverId);
  const file = decodeId(req.params.id);
  const from = safePluginPath(server.uuid, file);
  const enable = file.endsWith('.disabled');
  const to = enable ? from.replace(/\.disabled$/, '') : `${from}.disabled`;
  await fsp.rename(from, to);
  logActivity('plugin.toggle', { actor: { id: req.user.id, username: req.user.username }, target: file, serverId: server.id });
  return ok(res, {}, enable ? 'Plugin enabled' : 'Plugin disabled');
});

export const removePlugin = asyncHandler(async (req, res) => {
  const server = authorizedServer(req, req.query.serverId);
  const target = safePluginPath(server.uuid, decodeId(req.params.id));
  await fsp.rm(target, { force: true });
  logActivity('plugin.remove', { actor: { id: req.user.id, username: req.user.username }, target: path.basename(target), serverId: server.id });
  return ok(res, {}, 'Plugin removed');
});

/** Install a plugin jar from a direct URL into the plugins folder. */
export const installFromUrl = asyncHandler(async (req, res) => {
  const server = authorizedServer(req, req.body.serverId);
  const { url, filename } = req.body;
  if (!/^https:\/\//.test(url || '')) throw ApiError.badRequest('A valid https URL is required');

  const name = (filename || url.split('/').pop().split('?')[0] || 'plugin.jar').replace(/[^A-Za-z0-9._-]/g, '_');
  if (!name.endsWith('.jar')) throw ApiError.badRequest('URL must point to a .jar file');

  const dir = pluginsDir(server.uuid);
  fs.mkdirSync(dir, { recursive: true });
  const dest = safePluginPath(server.uuid, name);

  const resp = await fetch(url, { headers: { 'User-Agent': 'CraftPanel' } });
  if (!resp.ok) throw new ApiError(502, `Download failed (${resp.status})`);
  await pipeline(Readable.fromWeb(resp.body), fs.createWriteStream(dest));

  logActivity('plugin.install', { actor: { id: req.user.id, username: req.user.username }, target: name, serverId: server.id });
  return created(res, { name }, 'Plugin installed (restart server to load)');
});

/** Search Modrinth (real, official) for installable plugins. */
export const searchMarketplace = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const facets = encodeURIComponent('[["project_type:plugin"]]');
  const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(q)}&facets=${facets}&limit=20`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'CraftPanel' } });
    const data = await resp.json();
    const results = (data.hits || []).map((h) => ({
      slug: h.slug, title: h.title, description: h.description,
      author: h.author, downloads: h.downloads, icon: h.icon_url,
      page: `https://modrinth.com/plugin/${h.slug}`,
    }));
    return ok(res, { results }, 'Marketplace results');
  } catch (err) {
    throw new ApiError(502, 'Marketplace is unavailable: ' + err.message);
  }
});

/** Resolve a Modrinth project's latest downloadable jar URL. */
export const resolveMarketplace = asyncHandler(async (req, res) => {
  const slug = req.params.slug.replace(/[^a-z0-9-]/gi, '');
  const resp = await fetch(`https://api.modrinth.com/v2/project/${slug}/version`, { headers: { 'User-Agent': 'CraftPanel' } });
  if (!resp.ok) throw new ApiError(404, 'Project not found');
  const versions = await resp.json();
  const file = versions?.[0]?.files?.find((f) => f.filename.endsWith('.jar')) || versions?.[0]?.files?.[0];
  if (!file) throw ApiError.notFound('No downloadable file found');
  return ok(res, { url: file.url, filename: file.filename }, 'Resolved');
});
