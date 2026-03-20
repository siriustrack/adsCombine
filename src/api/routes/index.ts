import { TEXTS_DIR } from 'config/dirs';
import express, { type Request, type Response } from 'express';
import processRouter from './messages.routes';
import transcribeRouter from './transcribe.routes';

const router = express.Router();

router.use('/texts', express.static(TEXTS_DIR));
router.use('/api', processRouter);
router.use('/api', transcribeRouter);
router.get('/api/health', (_req: Request, _res: Response) => {
  _res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

export default router;
