import { Router } from 'express';
import * as players from '../controllers/playerController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', players.listPlayers);
// action ∈ ban | unban | kick | op | deop | whitelist-add | whitelist-remove
router.post('/:serverId/:action', players.playerAction);

export default router;
