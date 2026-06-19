/**
 * Domain manager — domain records, real DNS verification (node dns), and
 * reverse-proxy config generation (Caddy, which provides automatic HTTPS).
 *
 * Actual proxy serving + ACME issuance happens in Caddy using the generated
 * config; the panel manages records, verifies DNS and produces the config.
 */
import dns from 'node:dns/promises';
import { nanoid } from 'nanoid';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import { logActivity } from './activity.service.js';

export const TYPES = ['proxy', 'A', 'CNAME'];

export function create({ domain, serverId, type = 'proxy', target, ownerId }, actor) {
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain || '')) throw ApiError.badRequest('Invalid domain');
  if (!TYPES.includes(type)) throw ApiError.badRequest('Invalid record type');
  if (db.data.domains.find((d) => d.domain === domain)) throw ApiError.conflict('Domain already exists');

  const server = serverId ? db.data.servers.find((s) => s.id === serverId) : null;
  const record = {
    id: nanoid(10),
    domain,
    type,
    serverId: server?.id || null,
    target: target || (server ? `${server.allocation.ip}:${server.allocation.port}` : ''),
    ownerId,
    verified: false,
    ssl: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.data.domains.push(record);
  db.save();
  logActivity('domain.add', { actor, target: domain });
  return record;
}

export async function verify(record) {
  try {
    const addrs = await dns.resolve(record.domain).catch(async () => (await dns.lookup(record.domain)).address ? [(await dns.lookup(record.domain)).address] : []);
    const expectedIp = (config.network.publicIp || config.network.internalIp || '').trim();
    record.resolved = Array.isArray(addrs) ? addrs : [addrs];
    record.verified = expectedIp ? record.resolved.includes(expectedIp) : record.resolved.length > 0;
    record.ssl = record.verified ? 'ready (Caddy auto-HTTPS)' : 'pending';
  } catch (err) {
    record.verified = false;
    record.resolved = [];
    record.ssl = 'pending';
    record.verifyError = err.code || err.message;
  }
  db.save();
  return record;
}

export function remove(record) {
  db.data.domains = db.data.domains.filter((d) => d.id !== record.id);
  db.save();
}

/** Generate a Caddyfile reverse-proxy block (Caddy issues SSL automatically). */
export function caddyfile(record) {
  const server = record.serverId ? db.data.servers.find((s) => s.id === record.serverId) : null;
  const upstream = record.target || (server ? `${config.network.internalIp || '127.0.0.1'}:${server.allocation.port}` : 'CHANGE_ME:PORT');
  return `${record.domain} {
\treverse_proxy ${upstream}
\tencode gzip
}\n`;
}
