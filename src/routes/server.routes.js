import { Router } from 'express';
import * as servers from '../controllers/serverController.js';
import * as startup from '../controllers/startupController.js';
import * as env from '../controllers/envController.js';
import * as build from '../controllers/buildController.js';
import * as domains from '../controllers/domainController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Installer metadata (real upstream versions)
router.get('/meta/software', servers.listSoftware);
router.get('/meta/services', servers.listServices);
router.get('/meta/registry', servers.getRegistry);
router.get('/meta/versions/:software', servers.listVersions);

// Access is ownership-based: owners manage their own servers, staff manage all.
router.get('/', servers.listServers);
router.post('/', servers.createServer);
router.get('/:id', servers.getServer);
router.put('/:id', servers.updateServer);
router.post('/:id/power', servers.powerAction);
router.post('/:id/reinstall', servers.reinstallServer);
router.post('/:id/clone', servers.cloneServer);
router.post('/:id/suspend', servers.setSuspended);
router.get('/:id/sftp', servers.sftpInfo);
router.get('/:id/startup', startup.getStartup);
router.put('/:id/startup', startup.updateStartup);
router.get('/:id/env', env.getEnv);
router.put('/:id/env', env.updateEnv);
router.delete('/:id', servers.deleteServer);

// Build & Publish (static services)
router.get('/:id/builds', build.listBuilds);
router.post('/:id/builds', build.createBuild);
router.get('/:id/builds/:buildId', build.getBuild);
router.post('/:id/builds/:buildId/cancel', build.cancelBuild);
router.post('/:id/redeploy', build.redeploy);
router.post('/:id/deployments/:deploymentId/rollback', build.rollback);

// Per-service domains + SSL (static services)
router.get('/:id/domains', domains.listForServer);
router.post('/:id/domains', domains.createForServer);
router.post('/:id/domains/:domainId/verify', domains.verifyForServer);
router.delete('/:id/domains/:domainId', domains.removeForServer);
router.get('/:id/ssl', domains.sslForServer);
router.post('/:id/domains/:domainId/ssl/renew', domains.renewSsl);

// Backups
router.get('/:id/backups', servers.listBackups);
router.post('/:id/backups', servers.createBackup);
router.post('/:id/backups/:backupId/restore', servers.restoreBackup);
router.get('/:id/backups/:backupId/download', servers.downloadBackup);
router.delete('/:id/backups/:backupId', servers.deleteBackup);

export default router;
