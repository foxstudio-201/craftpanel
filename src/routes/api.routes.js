import { Router } from 'express';
import * as ctrl from '../controllers/apiController.js';
import { authenticate } from '../middleware/auth.js';
import { apiKeyAuth } from '../middleware/apiKey.js';

// ── Key management (session auth, used by the dashboard) ──────────────
export const keyRouter = Router();
keyRouter.use(authenticate);
keyRouter.get('/scopes', ctrl.listScopes);
keyRouter.get('/', ctrl.listKeys);
keyRouter.post('/', ctrl.createKey);
keyRouter.patch('/:id', ctrl.renameKey);
keyRouter.get('/:id/usage', ctrl.keyUsage);
keyRouter.delete('/:id', ctrl.revokeKey);

// ── External API v1 (API-key auth) ────────────────────────────────────
export const v1Router = Router();
v1Router.get('/', ctrl.v1Docs);
v1Router.get('/servers', apiKeyAuth('servers.read'), ctrl.v1ListServers);
v1Router.get('/servers/:id', apiKeyAuth('servers.read'), ctrl.v1GetServer);
v1Router.get('/servers/:id/metrics', apiKeyAuth('servers.read'), ctrl.v1Metrics);
v1Router.post('/servers/:id/power', apiKeyAuth('servers.control'), ctrl.v1Power);
v1Router.post('/servers/:id/command', apiKeyAuth('servers.control'), ctrl.v1Command);
