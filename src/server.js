import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import config from './config/index.js';
import { createApp } from './app.js';
import { initSockets } from './sockets/index.js';
import { seed } from './data/seed.js';
import { startSftpServer } from './sftp/server.js';
import * as docker from './services/docker.service.js';
import { initQueue } from './services/queue.service.js';
import { initScheduler } from './services/schedule.service.js';
import logger from './utils/logger.js';

async function bootstrap() {
  // Storage layout for volumes and backups.
  fs.mkdirSync(config.volumesRoot, { recursive: true });
  fs.mkdirSync(path.resolve(config.volumesRoot, '..', 'backups'), { recursive: true });
  fs.mkdirSync(config.filesRoot, { recursive: true });

  await seed();

  // Docker bring-up (non-fatal: the panel still serves if Docker is down).
  if (await docker.isAvailable()) {
    try {
      await docker.ensureNetwork();
      const info = await docker.engineInfo();
      logger.success(`Docker engine ${info.serverVersion} ready (${info.cpus} CPU / ${Math.round(info.memoryBytes / 1e9)}GB)`);
    } catch (err) {
      logger.warn('Docker setup warning: ' + err.message);
    }
  } else {
    logger.warn('Docker daemon not reachable — server lifecycle features will be unavailable until it is.');
  }

  const app = createApp();
  const server = http.createServer(app);
  initSockets(server);

  // Background job queue + cron scheduler.
  await initQueue();
  initScheduler();

  // Real SFTP server for FileZilla/WinSCP.
  let sftp = null;
  try { sftp = startSftpServer(); } catch (e) { logger.error('SFTP failed to start: ' + e.message); }

  server.listen(config.port, config.host, () => {
    logger.success(`CraftPanel running → ${config.appUrl}`);
    logger.info(`Environment: ${config.env}`);
    logger.info(`Login with: ${config.admin.email} / ${config.admin.password}`);
  });

  const shutdown = (signal) => {
    logger.warn(`${signal} received, shutting down…`);
    sftp?.close?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => logger.error('Unhandled rejection:', e));
}

bootstrap().catch((err) => {
  logger.error('Fatal boot error:', err);
  process.exit(1);
});
