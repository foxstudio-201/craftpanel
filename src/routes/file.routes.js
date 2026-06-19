import { Router } from 'express';
import multer from 'multer';
import * as files from '../controllers/fileController.js';
import { authenticate } from '../middleware/auth.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 512 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

router.get('/:id/list', files.listFiles);
router.get('/:id/read', files.readFile);
router.get('/:id/download', files.downloadFile);
router.get('/:id/search', files.searchFiles);

router.put('/:id/write', files.writeFile);
router.post('/:id/create', files.createEntry);
router.post('/:id/rename', files.renameEntry);
router.post('/:id/upload', upload.array('files', 40), files.uploadFiles);
router.post('/:id/zip', files.zipEntries);
router.post('/:id/unzip', files.unzipEntry);
router.delete('/:id/delete', files.deleteEntry);

export default router;
