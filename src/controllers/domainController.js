import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as svc from '../services/domain.service.js';
import * as cloudflared from '../services/cloudflared.service.js';
import { typeOf, feature } from '../services/service-registry.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (u) => (ROLE_LEVEL[u.role] || 0) >= ROLE_LEVEL.moderator;
const actor = (req) => ({ id: req.user.id, username: req.user.username });

const find = (req) => {
  const d = db.data.domains.find((x) => x.id === req.params.id);
  if (!d) throw ApiError.notFound('Domain not found');
  return d;
};

// ── Global admin domain management ──────────────────────────────────────
export const list = asyncHandler(async (_req, res) =>
  ok(res, { domains: db.data.domains, types: svc.TYPES }, 'Domains')
);

export const create = asyncHandler(async (req, res) => {
  const record = await svc.create({ ...req.body, ownerId: req.user.id }, actor(req));
  return created(res, { domain: record }, 'Domain added');
});

export const verify = asyncHandler(async (req, res) => {
  const record = await svc.verify(find(req));
  return ok(res, { domain: record }, record.verified ? 'Domain verified' : 'Domain not pointing here yet');
});

export const config = asyncHandler(async (req, res) =>
  ok(res, { caddyfile: svc.caddyfile(find(req)) }, 'Reverse-proxy config')
);

export const remove = asyncHandler(async (req, res) => {
  await svc.remove(find(req));
  return ok(res, {}, 'Domain removed');
});

// ── Per-service domain + SSL management ─────────────────────────────────
// Per-service domains are Cloudflare Tunnel ingress routes: hostname → the
// service's local port. TLS is terminated at the Cloudflare edge (no host
// 80/443). Routes are proposed + validated; they go live when applied (see the
// Infrastructure page / apply mode). Status/expiry are read from the real cert.
function authorizedService(req, featureName) {
  const server = db.data.servers.find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Service not found');
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this service');
  if (featureName && !feature(typeOf(server), featureName)) throw ApiError.badRequest(`${featureName} is not supported for this service type`);
  return server;
}

const routesForServer = (serverId) => cloudflared.projectRoutes().filter((r) => r.serverId === serverId);

/** Shape a cloudflared route like the domain records the UI expects. */
async function routeView(route, { withCert = false } = {}) {
  const live = cloudflared.existingHostnames().includes(route.hostname);
  const view = { id: route.hostname, domain: route.hostname, type: 'proxy', service: route.service, live, createdAt: route.createdAt, verified: live, ssl: 'pending', sslIssuer: null, sslExpiry: null };
  if (withCert) {
    const cert = await cloudflared.certInfo(route.hostname).catch(() => null);
    if (cert) { view.ssl = 'active'; view.sslIssuer = cert.issuer; view.sslExpiry = cert.validTo; view.verified = true; }
  } else if (live) {
    view.ssl = 'active'; // edge TLS once the route is live
  }
  return view;
}

export const listForServer = asyncHandler(async (req, res) => {
  const server = authorizedService(req, 'domains');
  const domains = await Promise.all(routesForServer(server.id).map((r) => routeView(r)));
  return ok(res, { domains, applyMode: (await import('../config/index.js')).default.cloudflared.applyMode }, 'Service domains');
});

export const createForServer = asyncHandler(async (req, res) => {
  const server = authorizedService(req, 'domains');
  if (!server.allocation?.port) throw ApiError.badRequest('Service has no allocated port to route to');
  const service = `http://localhost:${server.allocation.port}`;
  const r = await cloudflared.addRoute({ hostname: req.body.domain, service, serverId: server.id, purpose: typeOf(server) }, actor(req));
  return created(res, { domain: { id: r.hostname, domain: r.hostname, service, validation: r.validation } }, 'Route proposed (apply on the Infrastructure page to go live)');
});

export const verifyForServer = asyncHandler(async (req, res) => {
  authorizedService(req, 'domains');
  const result = await cloudflared.testReachability(req.params.domainId);
  return ok(res, { domain: { id: req.params.domainId, ...result } }, result.reachable ? 'Reachable via the tunnel' : 'Not reachable yet');
});

export const removeForServer = asyncHandler(async (req, res) => {
  authorizedService(req, 'domains');
  await cloudflared.removeRoute(req.params.domainId);
  return ok(res, {}, 'Route removed from proposal');
});

/** SSL view: real edge-certificate state per route. */
export const sslForServer = asyncHandler(async (req, res) => {
  const server = authorizedService(req, 'ssl');
  const domains = await Promise.all(routesForServer(server.id).map((r) => routeView(r, { withCert: true })));
  return ok(res, { domains }, 'SSL status');
});

/** Re-check a single route's certificate (real TLS read). */
export const renewSsl = asyncHandler(async (req, res) => {
  authorizedService(req, 'ssl');
  const route = routesForServer(req.params.id).find((r) => r.hostname === req.params.domainId)
    || cloudflared.projectRoutes().find((r) => r.hostname === req.params.domainId);
  if (!route) throw ApiError.notFound('Route not found');
  const cert = await cloudflared.certInfo(route.hostname).catch(() => null);
  return ok(res, { domain: { id: route.hostname, domain: route.hostname, ssl: cert ? 'active' : 'pending', sslIssuer: cert?.issuer || null, sslExpiry: cert?.validTo || null } }, cert ? 'Certificate present' : 'No certificate yet');
});
