import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import StreamZip from 'node-stream-zip';

import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as mc from '../services/minecraft.service.js';
import { logActivity } from '../services/activity.service.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (user) => (ROLE_LEVEL[user.role] || 0) >= ROLE_LEVEL.moderator;

/** Resolve a path inside a server's data volume with access + traversal guards. */
function resolve(req, relPath = '') {
  const server = db.data.servers.find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Server not found');
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this server');

  const root = mc.volumePath(server.uuid);
  fs.mkdirSync(root, { recursive: true });
  const clean = path.normalize(relPath || '').replace(/^(\.\.(\/|\\|$))+/, '');
  const target = path.resolve(root, '.' + path.sep + clean);
  if (target !== root && !target.startsWith(root + path.sep)) throw ApiError.forbidden('Path escapes the sandbox');
  return { server, root, target };
}

const rel = (root, target) => path.relative(root, target).split(path.sep).join('/');
const actor = (req) => ({ id: req.user.id, username: req.user.username });

export const listFiles = asyncHandler(async (req, res) => {
  const { root, target } = resolve(req, req.query.path || '');
  const stat = await fsp.stat(target);
  if (!stat.isDirectory()) throw ApiError.badRequest('Not a directory');

  const entries = await fsp.readdir(target, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (e) => {
    const full = path.join(target, e.name);
    let s; try { s = await fsp.stat(full); } catch { s = { size: 0, mtime: new Date() }; }
    return {
      name: e.name,
      path: rel(root, full),
      type: e.isDirectory() ? 'directory' : 'file',
      size: s.size,
      modified: s.mtime.toISOString(),
    };
  }));
  files.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  return ok(res, { path: rel(root, target), files }, 'Files');
});

export const readFile = asyncHandler(async (req, res) => {
  const { target } = resolve(req, req.query.path || '');
  const stat = await fsp.stat(target);
  if (stat.isDirectory()) throw ApiError.badRequest('Cannot read a directory');
  if (stat.size > 4 * 1024 * 1024) throw ApiError.badRequest('File too large to edit (>4MB) — use download');
  return ok(res, { path: req.query.path, content: await fsp.readFile(target, 'utf8') }, 'File content');
});

export const writeFile = asyncHandler(async (req, res) => {
  const { target, server } = resolve(req, req.body.path || '');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, req.body.content ?? '', 'utf8');
  logActivity('file.write', { actor: actor(req), target: req.body.path, serverId: server.id });
  return ok(res, {}, 'File saved');
});

export const createEntry = asyncHandler(async (req, res) => {
  const { target } = resolve(req, req.body.path || '');
  if (req.body.type === 'directory') {
    await fsp.mkdir(target, { recursive: true });
  } else {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    try { await fsp.writeFile(target, req.body.content ?? '', { flag: 'wx' }); }
    catch { throw ApiError.conflict('File already exists'); }
  }
  return created(res, {}, `${req.body.type === 'directory' ? 'Folder' : 'File'} created`);
});

export const renameEntry = asyncHandler(async (req, res) => {
  const { target: from } = resolve(req, req.body.from);
  const { target: to } = resolve(req, req.body.to);
  await fsp.rename(from, to);
  return ok(res, {}, 'Renamed');
});

export const deleteEntry = asyncHandler(async (req, res) => {
  const { root, target, server } = resolve(req, req.query.path || req.body?.path);
  if (target === root) throw ApiError.badRequest('Cannot delete the server root');
  await fsp.rm(target, { recursive: true, force: true });
  logActivity('file.delete', { actor: actor(req), target: req.query.path, serverId: server.id });
  return ok(res, {}, 'Deleted');
});

export const downloadFile = asyncHandler(async (req, res) => {
  const { target } = resolve(req, req.query.path || '');
  const stat = await fsp.stat(target);
  if (stat.isDirectory()) {
    // Stream the directory as a zip on the fly.
    res.attachment(path.basename(target) + '.zip');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', () => res.destroy());
    archive.pipe(res);
    archive.directory(target, false);
    return archive.finalize();
  }
  return res.download(target, path.basename(target));
});

/** Accepts one or many files (multipart). Used by the drag-and-drop uploader. */
export const uploadFiles = asyncHandler(async (req, res) => {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) throw ApiError.badRequest('No files uploaded');
  const { root, server } = resolve(req, req.body.path || '');
  const destDir = path.resolve(root, '.' + path.sep + path.normalize(req.body.path || ''));
  if (destDir !== root && !destDir.startsWith(root + path.sep)) throw ApiError.forbidden('Bad path');
  await fsp.mkdir(destDir, { recursive: true });
  for (const f of files) await fsp.writeFile(path.join(destDir, path.basename(f.originalname)), f.buffer);
  logActivity('file.upload', { actor: actor(req), target: `${files.length} file(s)`, serverId: server.id });
  return created(res, { count: files.length }, `${files.length} file(s) uploaded`);
});

/** Compress one or more entries into a .zip within the same folder. */
export const zipEntries = asyncHandler(async (req, res) => {
  const { root } = resolve(req, '');
  const items = Array.isArray(req.body.paths) ? req.body.paths : [req.body.path];
  if (!items.length || !items[0]) throw ApiError.badRequest('paths is required');

  const outName = (req.body.name || `archive-${Date.now()}`).replace(/[^A-Za-z0-9._-]/g, '_') + '.zip';
  const { target: outPath } = resolve(req, path.posix.join(req.body.dest || '', outName));

  await new Promise((resolveP, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolveP);
    archive.on('error', reject);
    archive.pipe(output);
    for (const item of items) {
      const abs = path.resolve(root, '.' + path.sep + path.normalize(item));
      if (!abs.startsWith(root)) continue;
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) archive.directory(abs, path.basename(abs));
      else archive.file(abs, { name: path.basename(abs) });
    }
    archive.finalize();
  });
  return created(res, { name: outName }, 'Archive created');
});

/** Extract a .zip into a target folder. */
export const unzipEntry = asyncHandler(async (req, res) => {
  const { target: zipPath, root } = resolve(req, req.body.path);
  if (!zipPath.endsWith('.zip')) throw ApiError.badRequest('Not a .zip file');
  const destRel = req.body.dest ?? path.dirname(req.body.path);
  const { target: destDir } = resolve(req, destRel);
  await fsp.mkdir(destDir, { recursive: true });

  const zip = new StreamZip.async({ file: zipPath });
  try {
    // Guard against zip-slip: ensure every entry stays within destDir.
    const entries = await zip.entries();
    for (const name of Object.keys(entries)) {
      const resolved = path.resolve(destDir, name);
      if (!resolved.startsWith(root)) throw ApiError.badRequest('Unsafe zip entry detected');
    }
    await zip.extract(null, destDir);
  } finally {
    await zip.close();
  }
  return ok(res, {}, 'Archive extracted');
});

export const searchFiles = asyncHandler(async (req, res) => {
  const { root } = resolve(req, '');
  const query = String(req.query.q || '').toLowerCase();
  if (!query) throw ApiError.badRequest('Search query is required');

  const matches = [];
  async function walk(dir, depth = 0) {
    if (depth > 12 || matches.length >= 200) return;
    let entries; try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(query)) {
        let s; try { s = await fsp.stat(full); } catch { continue; }
        matches.push({ name: e.name, path: rel(root, full), type: e.isDirectory() ? 'directory' : 'file', size: s.size, modified: s.mtime.toISOString() });
      }
      if (e.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(root);
  return ok(res, { results: matches.slice(0, 200) }, 'Search results');
});
