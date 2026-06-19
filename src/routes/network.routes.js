import { Router } from 'express';
import * as net from '../controllers/networkController.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/roles.js';

const router = Router();
router.use(authenticate);

router.get('/', net.overview);
router.post('/ips', authorize('admin'), net.addIp);
router.delete('/ips/:id', authorize('admin'), net.removeIp);
router.post('/reassign', authorize('admin'), net.reassignPort);

export default router;
