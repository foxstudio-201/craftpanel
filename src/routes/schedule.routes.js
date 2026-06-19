import { Router } from 'express';
import * as s from '../controllers/scheduleController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', s.list);
router.post('/', s.create);
router.put('/:id', s.update);
router.post('/:id/toggle', s.toggle);
router.post('/:id/run', s.runNow);
router.delete('/:id', s.remove);

export default router;
