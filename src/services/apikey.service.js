/**
 * API key service. Keys are shown once at creation; only a SHA-256 hash is
 * stored. Each key carries scopes, an owner, an optional per-key rate limit,
 * and live usage counters for the monitoring view.
 */
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';

export const SCOPES = ['servers.read', 'servers.control', 'servers.files', 'admin'];

const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

export function createKey({ name, ownerId, scopes = ['servers.read'], rateLimit = 120, expiresAt = null }) {
  const invalid = scopes.filter((s) => !SCOPES.includes(s));
  if (invalid.length) throw ApiError.badRequest(`Invalid scopes: ${invalid.join(', ')}`);
  if (expiresAt && Number.isNaN(Date.parse(expiresAt))) throw ApiError.badRequest('Invalid expiration date');

  const raw = 'cpk_' + crypto.randomBytes(28).toString('base64url');
  const record = {
    id: nanoid(12),
    name: name || 'API key',
    prefix: raw.slice(0, 12),
    hash: hash(raw),
    ownerId,
    scopes,
    rateLimit: Number(rateLimit) || 120,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    requests: 0,
    lastUsedAt: null,
    lastIp: null,
    usage: [], // recent request log
    createdAt: new Date().toISOString(),
  };
  db.data.apiKeys.push(record);
  db.save();
  return { record: publicKey(record), secret: raw };
}

export const isExpired = (record) => !!(record.expiresAt && Date.now() > new Date(record.expiresAt).getTime());

export function verify(raw) {
  if (!raw) return null;
  const h = hash(raw);
  return db.data.apiKeys.find((k) => k.hash === h) || null;
}

export function rename(record, name) {
  record.name = String(name).slice(0, 60);
  db.save();
}

export function recordUsage(record, req) {
  record.requests++;
  record.lastUsedAt = new Date().toISOString();
  record.lastIp = req?.ip || null;
  record.usage = record.usage || [];
  record.usage.unshift({ ts: record.lastUsedAt, ip: record.lastIp, method: req?.method, path: req?.originalUrl });
  record.usage = record.usage.slice(0, 50);
  db.save();
}

export function publicKey(k) {
  const { hash: _h, usage: _u, ...rest } = k;
  return { ...rest, expired: isExpired(k) };
}

export function getUsage(id, ownerId, isAdmin) {
  const key = db.data.apiKeys.find((k) => k.id === id);
  if (!key) throw ApiError.notFound('API key not found');
  if (key.ownerId !== ownerId && !isAdmin) throw ApiError.forbidden();
  return key.usage || [];
}

export function listForOwner(ownerId, all = false) {
  return db.data.apiKeys.filter((k) => all || k.ownerId === ownerId).map(publicKey);
}

export function revoke(id, ownerId, isAdmin) {
  const key = db.data.apiKeys.find((k) => k.id === id);
  if (!key) throw ApiError.notFound('API key not found');
  if (key.ownerId !== ownerId && !isAdmin) throw ApiError.forbidden();
  db.data.apiKeys = db.data.apiKeys.filter((k) => k.id !== id);
  db.save();
}

// Simple in-memory token bucket per key (per minute window).
const buckets = new Map();
export function checkRate(record) {
  const now = Date.now();
  const b = buckets.get(record.id) || { count: 0, reset: now + 60_000 };
  if (now > b.reset) { b.count = 0; b.reset = now + 60_000; }
  b.count++;
  buckets.set(record.id, b);
  return b.count <= record.rateLimit;
}
