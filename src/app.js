import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';

import config, { ROOT_DIR } from './config/index.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { notFound, errorHandler } from './middleware/error.js';
import apiRouter from './routes/index.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  // Security headers. CSP is relaxed for the CDN-based front-end (Tailwind,
  // Chart.js, Lucide, Socket.IO). Tighten these for a hardened deployment.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(cors({ origin: config.appUrl, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  if (!config.isProd) app.use(morgan('dev'));

  // ── API ───────────────────────────────────────────────────────────
  app.use('/api', apiLimiter, apiRouter);

  // ── Static front-end ──────────────────────────────────────────────
  const publicDir = path.join(ROOT_DIR, 'public');
  app.use(express.static(publicDir));

  // Pretty routes: /dashboard -> public/pages/dashboard.html
  app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'pages', 'login.html')));

  // Service-instance detail: /service/:id and /service/:id/:tab all serve the
  // single service shell; the client router renders the correct tab + sidebar.
  app.get(['/service/:id', '/service/:id/:tab'], (_req, res) =>
    res.sendFile(path.join(publicDir, 'pages', 'service.html'))
  );

  app.get('/:page', (req, res, next) => {
    const file = path.join(publicDir, 'pages', `${req.params.page}.html`);
    res.sendFile(file, (err) => (err ? next() : undefined));
  });

  // ── Errors ────────────────────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
