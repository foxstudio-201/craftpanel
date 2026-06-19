import { Router } from 'express';
import * as monitoring from '../controllers/monitoringController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/overview', monitoring.overview);
router.get('/history', monitoring.aggregateHistory);
router.get('/:id', monitoring.serverMetrics);
router.get('/:id/history', monitoring.serverHistory);

export default router;
