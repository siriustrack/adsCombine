import { OcrOrchestrator } from '@core/services/messages/pdf-utils/ocr-orchestrator.service';
import { TEXTS_DIR } from 'config/dirs';
import express, { type Request, type Response } from 'express';
import jobsRouter from './jobs.routes';
import processRouter from './messages.routes';
import transcribeRouter from './transcribe.routes';

const router = express.Router();

router.use('/texts', express.static(TEXTS_DIR));
router.use('/api/jobs', jobsRouter);
router.use('/api', processRouter);
router.use('/api', transcribeRouter);
/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Sistema
 *     summary: Verifica o status do serviço
 *     description: Retorna o status de saúde da API, timestamp atual e disponibilidade do pdfinfo (poppler).
 *     responses:
 *       200:
 *         description: Serviço funcionando normalmente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "OK"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2025-04-05T12:00:00.000Z"
 *                 dependencies:
 *                   type: object
 *                   properties:
 *                     pdfinfo:
 *                       type: object
 *                       properties:
 *                         available:
 *                           type: boolean
 *                         version:
 *                           type: string
 */
router.get('/api/health', async (_req: Request, _res: Response) => {
  const pdfinfo = await OcrOrchestrator.checkPdfinfo();
  _res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    dependencies: { pdfinfo },
  });
});

export default router;
