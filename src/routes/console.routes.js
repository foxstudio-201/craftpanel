import { Router } from 'express';
import * as console_ from '../controllers/consoleController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/:id/logs', console_.getLogs);
router.post('/:id/command', console_.sendCommand);

export default router;
