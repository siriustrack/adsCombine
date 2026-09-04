import { jobsController } from 'api/controllers'
import express from 'express'

const router = express.Router()

router.post('/process-message', jobsController.createProcessMessageJobHandler)

/**
 * @openapi
 * /api/jobs/process-message/enhanced:
 *   post:
 *     tags: [Jobs]
 *     summary: Cria um job assíncrono com OCR aprimorado
 *     description: Usa o pipeline OCR integral, sem ativar mixed-page ou executar OCR duplicado.
 *     security:
 *       - JobsBearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required: [conversationId, body]
 *               properties:
 *                 conversationId: { type: string }
 *                 body:
 *                   type: object
 *                   properties:
 *                     files:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [fileId, url, mimeType]
 *                         properties:
 *                           fileId: { type: string }
 *                           url: { type: string, format: uri }
 *                           mimeType: { type: string }
 *     responses:
 *       202:
 *         description: Job enfileirado
 *       400:
 *         description: Corpo inválido
 *       401:
 *         description: Token ausente
 *       403:
 *         description: Token inválido
 *       503:
 *         description: Fila indisponível
 */
router.post('/process-message/enhanced', jobsController.createEnhancedProcessMessageJobHandler)
router.get('/:jobId/status', jobsController.getJobStatusHandler)
router.get('/:jobId/result', jobsController.getJobResultHandler)

/**
 * @openapi
 * /api/jobs/{jobId}/result/enhanced:
 *   get:
 *     tags: [Jobs]
 *     summary: Obtém o resultado final de um job OCR aprimorado
 *     security:
 *       - JobsBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Resultado concluído ou estado terminal do job
 *       202:
 *         description: Job ainda enfileirado ou processando
 *       401:
 *         description: Token ausente
 *       403:
 *         description: Token inválido
 *       404:
 *         description: Job não encontrado
 *       409:
 *         description: O job solicitado não usa o perfil enhanced-ocr
 */
router.get('/:jobId/result/enhanced', jobsController.getEnhancedJobResultHandler)

export default router
