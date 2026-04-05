import { TEXTS_DIR } from 'config/dirs';
import express, { type Request, type Response } from 'express';
import processRouter from './messages.routes';
import transcribeRouter from './transcribe.routes';

const router = express.Router();

router.use('/texts', express.static(TEXTS_DIR));
router.use('/api', processRouter);
router.use('/api', transcribeRouter);
/**
 * @openapi
 * /api/health:
 *   get:
 *     tags:
 *       - Sistema
 *     summary: Verifica o status do serviço
 *     description: Retorna o status de saúde da API e o timestamp atual.
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
 */
router.get('/api/health', (_req: Request, _res: Response) => {
  _res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

export default router;
