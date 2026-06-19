import { verifyToken } from '../services/token.service.js';
import config from '../config/index.js';
import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';

/** Extract a JWT from the Authorization header or the auth cookie. */
function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.[config.jwt.cookieName]) return req.cookies[config.jwt.cookieName];
  return null;
}

/** Require a valid session; attaches `req.user` (without the password hash). */
export function authenticate(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized('Authentication required');

    const payload = verifyToken(token);
    const user = db.data.users.find((u) => u.id === payload.sub);
    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (user.banned) throw ApiError.forbidden('Your account has been suspended');

    const { password, ...safe } = user;
    req.user = safe;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(ApiError.unauthorized('Invalid or expired session'));
  }
}

export default authenticate;
