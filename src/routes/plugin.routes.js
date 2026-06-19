import { Router } from 'express';
import * as plugins from '../controllers/pluginController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', plugins.listPlugins);
router.get('/marketplace/search', plugins.searchMarketplace);
router.get('/marketplace/resolve/:slug', plugins.resolveMarketplace);
router.post('/install', plugins.installFromUrl);
router.put('/:id/toggle', plugins.togglePlugin);
router.delete('/:id', plugins.removePlugin);

export default router;
