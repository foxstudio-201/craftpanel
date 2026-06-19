import { Router } from 'express';
import * as admin from '../controllers/adminController.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/roles.js';

const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/overview', admin.overview);

// Users
router.get('/users', admin.listUsers);
router.post('/users', admin.createUser);
router.post('/users/:id/ban', admin.setUserBanned);
router.put('/users/:id/role', admin.updateRole);
router.delete('/users/:id', admin.deleteUser);

// Queue
router.get('/queue', admin.queueStatus);

// Servers
router.get('/servers', admin.listAllServers);
router.post('/servers/:id/transfer', admin.transferServer);

// Logs & infra
router.get('/activity', admin.activityLogs);
router.get('/system-logs', admin.systemLogs);
router.get('/node', admin.nodeStatus);
router.get('/docker', admin.dockerStatus);
router.get('/infra', admin.infraStatus);

// Announcements
router.get('/announcements', admin.listAnnouncements);
router.post('/announcements', admin.createAnnouncement);
router.delete('/announcements/:id', admin.deleteAnnouncement);

export default router;
