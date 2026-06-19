/**
 * Infrastructure controller — admin-only. Surfaces the live audit and the safe
 * cloudflared route management (propose/validate by default; apply only when the
 * operator enabled sudo mode). Never mutates Pterodactyl/Wings resources.
 */
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as audit from '../services/infra-audit.service.js';
import * as cloudflared from '../services/cloudflared.service.js';
import { logActivity } from '../services/activity.service.js';

const actor = (req) => ({ id: req.user.id, username: req.user.username });

export const getAudit = asyncHandler(async (_req, res) =>
  ok(res, await audit.fullAudit(), 'Infrastructure audit')
);

export const getTunnel = asyncHandler(async (_req, res) =>
  ok(res, { status: await cloudflared.status(), routes: cloudflared.parseIngress(), projectRoutes: cloudflared.projectRoutes() }, 'Tunnel status')
);

export const getDiff = asyncHandler(async (_req, res) =>
  ok(res, cloudflared.diff(), 'Proposed config diff')
);

export const addRoute = asyncHandler(async (req, res) => {
  const { hostname, service, serverId } = req.body;
  const r = await cloudflared.addRoute({ hostname, service, serverId }, actor(req));
  logActivity('infra.route.add', { actor: actor(req), target: hostname });
  return created(res, r, 'Route proposed');
});

export const removeRoute = asyncHandler(async (req, res) => {
  await cloudflared.removeRoute(req.params.hostname);
  logActivity('infra.route.remove', { actor: actor(req), target: req.params.hostname });
  return ok(res, {}, 'Route removed from proposal');
});

export const validateRoutes = asyncHandler(async (_req, res) =>
  ok(res, await cloudflared.writeProposed(), 'Validation result')
);

export const apply = asyncHandler(async (req, res) => {
  const result = await cloudflared.apply(actor(req));
  logActivity('infra.apply', { actor: actor(req), meta: { mode: result.mode, applied: result.applied } });
  return ok(res, result, result.applied ? 'Applied to tunnel' : 'Proposal ready — manual apply required');
});

/** Real connectivity test for a hostname (HTTP HEAD via the public edge). */
export const testRoute = asyncHandler(async (req, res) => {
  const hostname = req.params.hostname;
  if (!/^([a-z0-9_-]+\.)+[a-z]{2,}$/i.test(hostname)) throw ApiError.badRequest('Invalid hostname');
  const url = `https://${hostname}`;
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return ok(res, { hostname, reachable: true, httpStatus: r.status }, 'Connectivity test');
  } catch (e) {
    return ok(res, { hostname, reachable: false, error: e.message }, 'Connectivity test');
  }
});
