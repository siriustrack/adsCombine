import { randomUUID } from 'node:crypto';
import { env } from '@config/env';
import { messagesController } from 'api/controllers';
import express, { type RequestHandler } from 'express';
import logger from 'lib/logger';

const router = express.Router();

const summarizeProcessMessageBody = (body: any) => {
  try {
    const arr = Array.isArray(body) ? body : [body];
    const summary = arr.map((m) => ({
      conversationId: m?.conversationId,
      contentLength: m?.body?.content ? String(m.body.content).length : 0,
      filesCount: Array.isArray(m?.body?.files) ? m.body.files.length : 0,
      fileTypes: Array.isArray(m?.body?.files)
        ? [...new Set(m.body.files.map((f: any) => f?.fileType))]
        : [],
    }));
    return { messageCount: arr.length, details: summary.slice(0, 5) };
  } catch {
    return { rawType: typeof body };
  }
};

const routeLogger =
  (name: string): RequestHandler =>
  (req, res, next) => {
    if (!env.REQUEST_LOGS_ENABLED) {
      return next();
    }
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    res.locals.requestId = requestId;
    const start = process.hrtime.bigint();

    // Pre-log with safe summary
    const contentLength = req.headers['content-length'];
    const bodySummary = name.includes('process-message')
      ? summarizeProcessMessageBody(req.body)
      : { keys: Object.keys(req.body || {}) };

    logger.info(`[${name}] start`, {
      requestId,
      method: req.method,
      path: req.originalUrl,
      contentLength,
      body: bodySummary,
    });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(`[${name}] end`, {
        requestId,
        statusCode: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      });
    });

    next();
  };

/**
 * @openapi
 * /api/process-message:
 *   post:
 *     tags:
 *       - Mensagens
 *     summary: Processa mensagens com anexos de arquivos
 *     description: |
 *       Recebe uma lista de mensagens, cada uma contendo um conversationId e uma lista de arquivos
 *       (PDFs, imagens, áudio, DOCX, XLSX, TXT). Extrai o texto de cada arquivo via OCR/Whisper,
 *       salva em disco e retorna a URL de download.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               required:
 *                 - conversationId
 *                 - body
 *               properties:
 *                 conversationId:
 *                   type: string
 *                   description: Identificador único da conversa
 *                   example: "conv-123"
 *                 body:
 *                   type: object
 *                   properties:
 *                     files:
 *                       type: array
 *                       description: Lista de arquivos para processamento
 *                       items:
 *                         type: object
 *                         required:
 *                           - fileId
 *                           - url
 *                           - mimeType
 *                         properties:
 *                           fileId:
 *                             type: string
 *                             example: "file-001"
 *                           url:
 *                             type: string
 *                             format: uri
 *                             example: "https://example.com/document.pdf"
 *                           mimeType:
 *                             type: string
 *                             description: "MIME type do arquivo. Suportados: application/pdf, image/jpeg, image/png, audio/webm, audio/mpeg, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/plain"
 *                             example: "application/pdf"
 *     responses:
 *       200:
 *         description: Arquivos processados com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversationId:
 *                   type: string
 *                   example: "conv-123"
 *                 processedFiles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["file-001", "file-002"]
 *                 failedFiles:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       fileId:
 *                         type: string
 *                       error:
 *                         type: string
 *                 filename:
 *                   type: string
 *                   example: "conv-123-1712345678901.txt"
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *                   example: "http://localhost:3000/texts/conv-123/conv-123-1712345678901.txt"
 *       400:
 *         description: Body inválido (falha na validação Zod)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error400'
 *       401:
 *         description: Token de autenticação ausente ou inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error401'
 *       500:
 *         description: Erro interno do servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error500'
 */
router.post(
  '/process-message',
  routeLogger('messages.process-message'),
  messagesController.processMessagesHandler
);

/**
 * @openapi
 * /api/delete-texts:
 *   delete:
 *     tags:
 *       - Mensagens
 *     summary: Remove textos extraídos de uma conversa
 *     description: Deleta todos os arquivos de texto extraídos associados a um conversationId.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: string
 *                 description: Identificador da conversa cujos textos serão removidos
 *                 example: "conv-123"
 *     responses:
 *       200:
 *         description: Textos removidos com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: boolean
 *                   example: false
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Successfully deleted 3 file(s)"
 *                 deletedFiles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: ["conv-123-1712345678901.txt", "conv-123-1712345678902.txt"]
 *                 deletedCount:
 *                   type: integer
 *                   example: 3
 *       400:
 *         description: Body inválido (falha na validação Zod)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error400'
 *       401:
 *         description: Token de autenticação ausente ou inválido
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error401'
 *       500:
 *         description: Erro ao ler ou deletar diretório de textos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 500
 *                 message:
 *                   type: string
 *                   example: "Failed to read texts directory"
 *                 deletedFiles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   example: []
 *                 deletedCount:
 *                   type: integer
 *                   example: 0
 */
router.delete(
  '/delete-texts',
  routeLogger('messages.delete-texts'),
  messagesController.deleteTextsHandler
);

export default router;
