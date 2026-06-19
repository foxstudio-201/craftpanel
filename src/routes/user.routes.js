import { Router } from 'express';
import * as users from '../controllers/userController.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/roles.js';

const router = Router();
router.use(authenticate);

router.put('/profile', users.updateProfile);
router.put('/password', users.changePassword);

// Admin-only user management
router.get('/', authorize('admin'), users.listUsers);
router.put('/:id/role', authorize('admin'), users.updateRole);
router.delete('/:id', authorize('admin'), users.deleteUser);

export default router;
