import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export const signToken = (payload) =>
  jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

export const verifyToken = (token) => jwt.verify(token, config.jwt.secret);

/** Reset tokens are short-lived and scoped. */
export const signResetToken = (payload) =>
  jwt.sign({ ...payload, scope: 'reset' }, config.jwt.secret, { expiresIn: '15m' });
