import bcrypt from 'bcryptjs';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok } from '../utils/response.js';

const sanitize = (u) => {
  const { password, ...safe } = u;
  return safe;
};

/** Admin: list all users. */
export const listUsers = asyncHandler(async (_req, res) => {
  return ok(res, { users: db.data.users.map(sanitize) }, 'Users');
});

/** Update the current user's own profile. */
export const updateProfile = asyncHandler(async (req, res) => {
  const user = db.data.users.find((u) => u.id === req.user.id);
  if (!user) throw ApiError.notFound('User not found');

  const { username, email, bio, avatar, twoFactor } = req.body;
  if (username) user.username = username;
  if (email) user.email = email;
  if (bio !== undefined) user.bio = bio;
  if (avatar !== undefined) user.avatar = avatar;
  if (twoFactor !== undefined) user.twoFactor = !!twoFactor;
  db.save();

  return ok(res, { user: sanitize(user) }, 'Profile updated');
});

/** Change the current user's password. */
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw ApiError.badRequest('Both passwords are required');
  if (newPassword.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');

  const user = db.data.users.find((u) => u.id === req.user.id);
  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) throw ApiError.badRequest('Current password is incorrect');

  user.password = await bcrypt.hash(newPassword, config.bcryptRounds);
  db.save();
  return ok(res, {}, 'Password changed');
});

/** Admin: change a user's role. */
export const updateRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'moderator', 'user'].includes(role)) {
    throw ApiError.badRequest('Invalid role');
  }
  const user = db.data.users.find((u) => u.id === req.params.id);
  if (!user) throw ApiError.notFound('User not found');

  user.role = role;
  db.save();
  return ok(res, { user: sanitize(user) }, 'Role updated');
});

/** Admin: delete a user. */
export const deleteUser = asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw ApiError.badRequest('You cannot delete your own account');
  const idx = db.data.users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) throw ApiError.notFound('User not found');

  db.data.users.splice(idx, 1);
  db.save();
  return ok(res, {}, 'User deleted');
});
