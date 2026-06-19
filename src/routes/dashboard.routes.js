import { Router } from 'express';
import * as dashboard from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', dashboard.dashboard);
router.get('/activity', dashboard.myActivity);
router.get('/notifications', dashboard.listNotifications);
router.put('/notifications/read-all', dashboard.markAllRead);
router.put('/notifications/:id/read', dashboard.markRead);
router.delete('/notifications', dashboard.clearNotifications);

export default router;
