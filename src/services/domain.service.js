/**
 * Domain manager — domain records, real DNS verification (node dns) and live
 * reverse-proxy wiring through Caddy. Every mutation reconciles Caddy so the
 * proxy + ACME issuance reflect the current records; SSL status/expiry are read
 * from the real served certificate (never fabricated).
 */
import dns from 'node:dns/promises';
import { nanoid } from 'nanoid';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import { logActivity } from './activity.service.js';
import * as caddy from './caddy.service.js';

export const TYPES = ['proxy', 'A', 'CNAME'];

const DOMAIN_RE = /^(\*\.)?([a-z0-9-]+\.)+[a-z]{2,}$/i;

export const forServer = (serverId) => db.data.domains.filter((d) => d.serverId === serverId);

export async function create({ domain, serverId, type = 'proxy', target, ownerId }, actor) {
  domain = String(domain || '').trim().toLowerCase();
  if (!DOMAIN_RE.test(domain)) throw ApiError.badRequest('Invalid domain or subdomain');
  if (!TYPES.includes(type)) throw ApiError.badRequest('Invalid record type');
  if (db.data.domains.find((d) => d.domain === domain)) throw ApiError.conflict('Domain already exists');

  const server = serverId ? db.data.servers.find((s) => s.id === serverId) : null;
  if (serverId && !server) throw ApiError.badRequest('Service does not exist');

  const record = {
    id: nanoid(10),
    domain,
    type,
    serverId: server?.id || null,
    target: target || (server ? `${server.allocation.ip}:${server.allocation.port}` : ''),
    ownerId,
    verified: false,
    ssl: 'pending',
    sslIssuer: null,
    sslExpiry: null,
    createdAt: new Date().toISOString(),
  };
  db.data.domains.push(record);
  db.save();
  logActivity('domain.add', { actor, target: domain, serverId: record.serverId });
  await caddy.reconcile();
  return record;
}

/** Verify DNS points here AND refresh the real SSL certificate state. */
export async function verify(record) {
  try {
    const addrs = await dns.resolve(record.domain).catch(async () => {
      const r = await dns.lookup(record.domain); return r?.address ? [r.address] : [];
    });
    const expectedIp = (config.network.publicIp || config.network.internalIp || '').trim();
    record.resolved = Array.isArray(addrs) ? addrs : [addrs];
    record.verified = expectedIp ? record.resolved.includes(expectedIp) : record.resolved.length > 0;
  } catch (err) {
    record.verified = false;
    record.resolved = [];
    record.verifyError = err.code || err.message;
  }
  await refreshSsl(record);
  db.save();
  return record;
}

/** Pull the real served certificate (issuer + expiry) for a domain. */
export async function refreshSsl(record) {
  const info = await caddy.certInfo(record.domain).catch(() => null);
  if (info) {
    record.ssl = 'active';
    record.sslIssuer = info.issuer;
    record.sslExpiry = info.validTo;
  } else {
    record.ssl = 'pending';
    record.sslIssuer = null;
    record.sslExpiry = null;
  }
  db.save();
  return record;
}

export async function remove(record) {
  db.data.domains = db.data.domains.filter((d) => d.id !== record.id);
  db.save();
  await caddy.reconcile();
}

/** Generate a Caddyfile reverse-proxy block (reference/export only). */
export function caddyfile(record) {
  const server = record.serverId ? db.data.servers.find((s) => s.id === record.serverId) : null;
  const upstream = record.target || (server ? `${server.uuid}:${server.allocation.port}` : 'CHANGE_ME:PORT');
  return `${record.domain} {\n\treverse_proxy ${upstream}\n\tencode gzip\n}\n`;
}
