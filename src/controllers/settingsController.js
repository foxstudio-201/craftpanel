import { nanoid } from 'nanoid';

import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

const SECTIONS = ['general', 'security', 'appearance', 'notifications', 'api'];

export const getSettings = asyncHandler(async (_req, res) => {
  return ok(res, { settings: db.data.settings }, 'Settings');
});

export const updateSettings = asyncHandler(async (req, res) => {
  const { section } = req.params;
  if (!SECTIONS.includes(section)) throw ApiError.badRequest('Unknown settings section');

  db.data.settings[section] = { ...db.data.settings[section], ...req.body };
  db.save();
  return ok(res, { settings: db.data.settings }, `${section} settings saved`);
});

export const regenerateApiKey = asyncHandler(async (_req, res) => {
  db.data.settings.api.key = 'cp_' + nanoid(32);
  db.save();
  return ok(res, { key: db.data.settings.api.key }, 'API key regenerated');
});
