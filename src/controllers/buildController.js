import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as build from '../services/build.service.js';
import { typeOf, feature } from '../services/service-registry.js';
import { ROLE_LEVEL } from '../middleware/roles.js';

const isStaff = (u) => (ROLE_LEVEL[u.role] || 0) >= ROLE_LEVEL.moderator;

/** Resolve a build-capable service the caller may manage, or throw. */
function authorizedServer(req) {
  const server = db.data.servers.find((s) => s.id === req.params.id);
  if (!server) throw ApiError.notFound('Service not found');
  if (server.ownerId !== req.user.id && !isStaff(req.user)) throw ApiError.forbidden('No access to this service');
  if (!feature(typeOf(server), 'build')) throw ApiError.badRequest('Builds are not supported for this service type');
  return server;
}

const actor = (req) => ({ id: req.user.id, username: req.user.username });
const slim = (b) => ({ ...b, logs: undefined, logCount: b.logs?.length || 0 });

export const listBuilds = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  return ok(res, {
    builds: build.buildsFor(server.id).map(slim),
    deployments: build.deploymentsFor(server.id),
  }, 'Builds');
});

export const getBuild = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const b = db.data.builds.find((x) => x.id === req.params.buildId && x.serverId === server.id);
  if (!b) throw ApiError.notFound('Build not found');
  return ok(res, { build: b }, 'Build');
});

export const createBuild = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const b = build.queueBuild(server, actor(req), { publish: req.body.publish !== false, trigger: 'manual' });
  return created(res, { build: slim(b) }, 'Build queued');
});

export const redeploy = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const b = build.queueBuild(server, actor(req), { publish: true, trigger: 'redeploy' });
  return created(res, { build: slim(b) }, 'Redeploy queued');
});

export const cancelBuild = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  build.cancelBuild(server, req.params.buildId, actor(req));
  return ok(res, {}, 'Build cancellation requested');
});

export const rollback = asyncHandler(async (req, res) => {
  const server = authorizedServer(req);
  const d = await build.rollback(server, req.params.deploymentId, actor(req));
  return ok(res, { deployment: d }, 'Rolled back');
});
