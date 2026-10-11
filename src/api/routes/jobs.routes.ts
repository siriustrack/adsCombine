import { jobsController } from 'api/controllers'
import express from 'express'

const router = express.Router()

/**
 * @openapi
 * components:
 *   schemas:
 *     JobState:
 *       type: string
 *       enum: [queued, processing, completed, failed, expired]
 *     ProcessMessageJobResult:
 *       type: object
 *       required: [conversationId, processedFiles, failedFiles, filename, downloadUrl, downloadExpiresAt]
 *       properties:
 *         conversationId: { type: string }
 *         processedFiles: { type: array, items: { type: string } }
 *         failedFiles:
 *           type: array
 *           items:
 *             type: object
 *             required: [fileId, error]
 *             properties:
 *               fileId: { type: string }
 *               error: { type: string }
 *         filename: { type: string }
 *         downloadUrl: { type: string, format: uri }
 *         downloadExpiresAt: { type: string, format: date-time }
 * /api/jobs/process-message:
 *   post:
 *     tags: [Jobs]
 *     summary: Cria job de extração com o pipeline PDF padrão
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
 *                 conversationId: { type: string, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' }
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
 *                           fileName: { type: string }
 *     responses:
 *       202:
 *         description: Job aceito
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [jobId, status, statusUrl, resultUrl, createdAt]
 *               properties:
 *                 jobId: { type: string, format: uuid }
 *                 status: { $ref: '#/components/schemas/JobState' }
 *                 statusUrl: { type: string, format: uri }
 *                 resultUrl: { type: string, format: uri }
 *                 createdAt: { type: string, format: date-time }
 *       400: { description: Corpo inválido }
 *       401: { description: Token ausente }
 *       403: { description: Token inválido }
 *       503: { description: Inicialização ou fila indisponível }
 * /api/jobs/{jobId}/status:
 *   get:
 *     tags: [Jobs]
 *     summary: Consulta estado e timestamps do job
 *     security:
 *       - JobsBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Estado consultável; jobs interrompidos por restart são expired.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [jobId, type, status, createdAt, updatedAt, resultUrl]
 *               properties:
 *                 jobId: { type: string, format: uuid }
 *                 type: { type: string, enum: [process-message] }
 *                 status: { $ref: '#/components/schemas/JobState' }
 *                 createdAt: { type: string, format: date-time }
 *                 updatedAt: { type: string, format: date-time }
 *                 startedAt: { type: string, format: date-time }
 *                 finishedAt: { type: string, format: date-time }
 *                 error: { type: string }
 *                 resultUrl: { type: string, format: uri }
 *       401: { description: Token ausente }
 *       403: { description: Token inválido }
 *       404: { description: Job não encontrado }
 *       500: { description: Falha de leitura }
 * /api/jobs/{jobId}/result:
 *   get:
 *     tags: [Jobs]
 *     summary: Consulta resultado e renova o link assinado de download
 *     security:
 *       - JobsBearerAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Estado terminal; somente completed contém result.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [jobId, status]
 *               properties:
 *                 jobId: { type: string, format: uuid }
 *                 status: { type: string, enum: [completed, failed, expired] }
 *                 result: { $ref: '#/components/schemas/ProcessMessageJobResult' }
 *                 error: { type: string }
 *       202: { description: Job queued ou processing }
 *       401: { description: Token ausente }
 *       403: { description: Token inválido }
 *       404: { description: Job não encontrado }
 *       500: { description: Falha de leitura }
 */
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
 *         description: |
 *           Resultado concluído ou estado terminal do job. Resultados concluídos usam
 *           `schemaVersion: enhanced-ocr/v2`, renovam `downloadUrl` e `downloadExpiresAt`
 *           a cada leitura autenticada e agregam seleção nativo/OCR, warnings e desfechos
 *           visuais no objeto `summary`.
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
