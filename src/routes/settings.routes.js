import { Router } from 'express';
import * as settings from '../controllers/settingsController.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/roles.js';

const router = Router();
router.use(authenticate);

router.get('/', settings.getSettings);
router.put('/:section', authorize('admin'), settings.updateSettings);
router.post('/api/regenerate', authorize('admin'), settings.regenerateApiKey);

export default router;
