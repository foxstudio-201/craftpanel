import { Router } from 'express';

import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import serverRoutes from './server.routes.js';
import fileRoutes from './file.routes.js';
import consoleRoutes from './console.routes.js';
import playerRoutes from './player.routes.js';
import pluginRoutes from './plugin.routes.js';
import databaseRoutes from './database.routes.js';
import monitoringRoutes from './monitoring.routes.js';
import settingsRoutes from './settings.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import adminRoutes from './admin.routes.js';
import { keyRouter, v1Router } from './api.routes.js';
import scheduleRoutes from './schedule.routes.js';
import networkRoutes from './network.routes.js';
import domainRoutes from './domain.routes.js';

const router = Router();

router.get('/health', (_req, res) =>
  res.json({ success: true, status: 'ok', uptime: process.uptime(), timestamp: Date.now() })
);

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/servers', serverRoutes);
router.use('/files', fileRoutes);
router.use('/console', consoleRoutes);
router.use('/players', playerRoutes);
router.use('/plugins', pluginRoutes);
router.use('/databases', databaseRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/settings', settingsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin', adminRoutes);
router.use('/apikeys', keyRouter);
router.use('/v1', v1Router);
router.use('/schedules', scheduleRoutes);
router.use('/network', networkRoutes);
router.use('/domains', domainRoutes);

export default router;
