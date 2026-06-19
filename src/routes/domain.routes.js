import { Router } from 'express';
import * as d from '../controllers/domainController.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/roles.js';

const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/', d.list);
router.post('/', d.create);
router.post('/:id/verify', d.verify);
router.get('/:id/config', d.config);
router.delete('/:id', d.remove);

export default router;
