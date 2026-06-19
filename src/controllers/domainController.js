import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import * as svc from '../services/domain.service.js';

const actor = (req) => ({ id: req.user.id, username: req.user.username });
const find = (req) => {
  const d = db.data.domains.find((x) => x.id === req.params.id);
  if (!d) throw ApiError.notFound('Domain not found');
  return d;
};

export const list = asyncHandler(async (_req, res) =>
  ok(res, { domains: db.data.domains, types: svc.TYPES }, 'Domains')
);

export const create = asyncHandler(async (req, res) => {
  const record = svc.create({ ...req.body, ownerId: req.user.id }, actor(req));
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
  svc.remove(find(req));
  return ok(res, {}, 'Domain removed');
});
