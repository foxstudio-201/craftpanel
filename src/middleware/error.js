import ApiError from '../utils/ApiError.js';
import logger from '../utils/logger.js';
import config from '../config/index.js';

export function notFound(req, res, _next) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err instanceof ApiError ? err.statusCode : err.status || 500;

  if (status >= 500) {
    logger.error(`${req.method} ${req.originalUrl} →`, err.stack || err.message);
  }

  res.status(status).json({
    success: false,
    message: err.message || 'Internal server error',
    details: err.details,
    ...(config.isProd ? {} : { stack: status >= 500 ? err.stack : undefined }),
  });
}
