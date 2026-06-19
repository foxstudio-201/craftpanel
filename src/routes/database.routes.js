import { Router } from 'express';
import * as databases from '../controllers/databaseController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', databases.listDatabases);
router.get('/engines', databases.engines);
router.get('/:id', databases.getDatabase);
router.post('/', databases.createDatabase);
router.post('/:id/power', databases.powerDatabase);
router.delete('/:id', databases.deleteDatabase);

export default router;
