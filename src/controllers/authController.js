import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

import db from '../data/store.js';
import config from '../config/index.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { ok, created } from '../utils/response.js';
import { signToken, signResetToken, verifyToken } from '../services/token.service.js';
import { logActivity } from '../services/activity.service.js';

const sanitize = (user) => {
  const { password, ...safe } = user;
  return safe;
};

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export const register = asyncHandler(async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    throw ApiError.badRequest('username, email and password are required');
  }
  if (!isEmail(email)) throw ApiError.badRequest('Invalid email address');
  if (password.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');

  const exists = db.data.users.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === username.toLowerCase()
  );
  if (exists) throw ApiError.conflict('A user with that email or username already exists');

  const hash = await bcrypt.hash(password, config.bcryptRounds);
  // The very first registered account becomes admin; everyone else is a user.
  const role = db.data.users.length === 0 ? 'admin' : 'user';

  const user = {
    id: nanoid(12),
    username,
    email,
    password: hash,
    role,
    avatar: null,
    bio: '',
    banned: false,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    twoFactor: false,
  };
  db.data.users.push(user);
  db.save();

  const token = signToken({ sub: user.id, role: user.role });
  res.cookie(config.jwt.cookieName, token, cookieOpts);
  logActivity('auth.register', { actor: { id: user.id, username: user.username }, ip: req.ip, meta: { role } });
  return created(res, { user: sanitize(user), token }, 'Account created');
});

export const login = asyncHandler(async (req, res) => {
  const { identifier, email, username, password } = req.body;
  const id = identifier || email || username;
  if (!id || !password) throw ApiError.badRequest('Credentials are required');

  const user = db.data.users.find(
    (u) => u.email.toLowerCase() === String(id).toLowerCase() || u.username.toLowerCase() === String(id).toLowerCase()
  );
  if (!user) throw ApiError.unauthorized('Invalid credentials');

  const match = await bcrypt.compare(password, user.password);
  if (!match) throw ApiError.unauthorized('Invalid credentials');
  if (user.banned) throw ApiError.forbidden('Your account has been suspended');

  user.lastLogin = new Date().toISOString();
  db.save();

  const token = signToken({ sub: user.id, role: user.role });
  res.cookie(config.jwt.cookieName, token, cookieOpts);
  logActivity('auth.login', { actor: { id: user.id, username: user.username }, ip: req.ip });
  return ok(res, { user: sanitize(user), token }, 'Signed in');
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie(config.jwt.cookieName);
  return ok(res, {}, 'Signed out');
});

export const me = asyncHandler(async (req, res) => {
  return ok(res, { user: req.user }, 'Current user');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isEmail(email)) throw ApiError.badRequest('A valid email is required');

  const user = db.data.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

  // Always respond success to avoid leaking which emails exist.
  // In production the token would be emailed; here we return it for testing.
  const payload = { success: true };
  if (user) {
    payload.resetToken = signResetToken({ sub: user.id });
    payload.note = 'In production this token is emailed. Returned here for demo/testing only.';
  }
  return ok(res, payload, 'If that email exists, a reset link has been sent');
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw ApiError.badRequest('token and password are required');
  if (password.length < 8) throw ApiError.badRequest('Password must be at least 8 characters');

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw ApiError.badRequest('Reset link is invalid or has expired');
  }
  if (payload.scope !== 'reset') throw ApiError.badRequest('Invalid reset token');

  const user = db.data.users.find((u) => u.id === payload.sub);
  if (!user) throw ApiError.notFound('Account not found');

  user.password = await bcrypt.hash(password, config.bcryptRounds);
  db.save();
  return ok(res, {}, 'Password updated — you can now sign in');
});
