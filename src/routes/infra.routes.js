import { Router } from 'express';
import * as infra from '../controllers/infraController.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/roles.js';

const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/audit', infra.getAudit);
router.get('/tunnel', infra.getTunnel);
router.get('/tunnel/services', infra.getServicesTunnel);
router.get('/tunnel/diff', infra.getDiff);
router.post('/routes', infra.addRoute);
router.post('/routes/validate', infra.validateRoutes);
router.delete('/routes/:hostname', infra.removeRoute);
router.post('/routes/:hostname/test', infra.testRoute);
router.post('/apply', infra.apply);

export default router;
