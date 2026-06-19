import db from '../data/store.js';
import ApiError from '../utils/ApiError.js';
import * as keys from '../services/apikey.service.js';

/**
 * Authenticate an external request via the `X-API-Key` header (or
 * `Authorization: ApiKey <key>`). Attaches req.user (the key owner) and
 * req.apiKey. Enforces the key's scopes and per-key rate limit.
 */
export function apiKeyAuth(requiredScope) {
  return (req, _res, next) => {
    const raw = req.headers['x-api-key'] ||
      (req.headers.authorization?.startsWith('ApiKey ') ? req.headers.authorization.slice(7) : null);
    if (!raw) return next(ApiError.unauthorized('API key required (X-API-Key header)'));

    const record = keys.verify(raw);
    if (!record) return next(ApiError.unauthorized('Invalid API key'));
    if (keys.isExpired(record)) return next(ApiError.unauthorized('API key has expired'));

    if (!keys.checkRate(record)) return next(new ApiError(429, 'API rate limit exceeded for this key'));

    if (requiredScope && !record.scopes.includes(requiredScope) && !record.scopes.includes('admin')) {
      return next(ApiError.forbidden(`API key missing scope: ${requiredScope}`));
    }

    const owner = db.data.users.find((u) => u.id === record.ownerId);
    if (!owner || owner.banned) return next(ApiError.unauthorized('Key owner is inactive'));

    keys.recordUsage(record, req);
    const { password, ...safe } = owner;
    req.user = safe;
    req.apiKey = record;
    next();
  };
}
