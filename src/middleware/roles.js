import ApiError from '../utils/ApiError.js';

/** Role hierarchy — higher number grants everything below it. */
export const ROLE_LEVEL = { user: 1, moderator: 2, admin: 3 };

/**
 * Guard a route by minimum role. Usage: `authorize('moderator')`.
 * Admins always pass; moderators pass moderator/user routes; etc.
 */
export function authorize(minRole = 'user') {
  const required = ROLE_LEVEL[minRole] ?? 1;
  return (req, _res, next) => {
    const level = ROLE_LEVEL[req.user?.role] ?? 0;
    if (level < required) {
      return next(ApiError.forbidden(`Requires ${minRole} role or higher`));
    }
    next();
  };
}

export default authorize;
