import { PUBLIC_DIR, TEXTS_DIR } from 'config/dirs';
import express, { type Request, type Response } from 'express';
import path from 'node:path';
import serveIndex from 'serve-index';
import processRouter from './messages.routes';
import imagesRouter from './images.routes';
import videosRouter from './videos.routes';

const router = express.Router();

router.use('/texts', express.static(TEXTS_DIR));
router.use(
  '/files',
  express.static(PUBLIC_DIR, {
    setHeaders: (res, filePath) => {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }),
  serveIndex(PUBLIC_DIR, { icons: true }) as any
);
router.use('/videos', videosRouter)
router.use('/images', imagesRouter)
router.use('/api', processRouter);
router.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});



export default router;