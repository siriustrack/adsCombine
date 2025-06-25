const express = require('express');
const router = express.Router();
const { z, ZodError } = require('zod');
const logger = require('../lib/logger');
const redis = require('../lib/redis');
const { sanitize } = require('../utils/sanitize');
const { processTxt, processImage, processPdf, processDocx } = require('../services/fileProcessor');

// Zod schema for validation
const FileInfoSchema = z.object({
  fileId: z.string(),
  url: z.string().url(),
  mimeType: z.string(),
  fileType: z.enum(['txt', 'pdf', 'jpeg', 'png', 'jpg', 'docx', 'image']),
}).passthrough();

const BodySchema = z.object({
    content: z.string().optional(),
    files: z.array(FileInfoSchema).optional(),
});

const MessageSchema = z.object({
    conversationId: z.string(),
    body: BodySchema
}).passthrough();

const ProcessMessageSchema = z.array(MessageSchema);

/**
 * @openapi
 * /process-message:
 *   post:
 *     summary: Processa uma ou mais mensagens com texto e arquivos, enviando o conteúdo para o Redis
 *     tags:
 *       - Processamento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               type: object
 *               properties:
 *                 conversationId:
 *                   type: string
 *                   description: ID único para a conversa/sessão.
 *                 body:
 *                   type: object
 *                   properties:
 *                     content:
 *                       type: string
 *                       description: Conteúdo textual opcional a ser processado.
 *                     files:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           fileId:
 *                             type: string
 *                           url:
 *                             type: string
 *                             format: uri
 *                           mimeType:
 *                             type: string
 *                           fileType:
 *                             type: string
 *                             enum: ['txt', 'pdf', 'jpeg', 'png', 'jpg', 'docx', 'image']
 *                         required:
 *                           - fileId
 *                           - url
 *                           - mimeType
 *                           - fileType
 *     responses:
 *       '200':
 *         description: Processamento concluído.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 processedFiles:
 *                   type: array
 *                   items:
 *                     type: string
 *                 failedFiles:
 *                   type: array
 *                   items:
 *                     type: object
 *       '400':
 *         description: Erro de validação nos dados de entrada.
 *       '500':
 *         description: Erro interno do servidor.
 */
router.post('/process-message', async (req, res) => {
  try {
    const rawMessages = Array.isArray(req.body) ? req.body : [req.body];
    const messages = ProcessMessageSchema.parse(rawMessages);
    
    logger.info('Received /process-message request', { messageCount: messages.length });

    if (!redis) {
      throw new Error('Redis client is not available. Check REDIS_URL in .env file.');
    }

    const processedFiles = [];
    const failedFiles = [];

    for (const message of messages) {
      const { conversationId, body } = message;
      const { content, files } = body;

      if (content) {
        const sanitizedContent = sanitize(content);
        await redis.lpush(conversationId, sanitizedContent);
        logger.info('Pushed text content to Redis', { conversationId });
      }

      if (files && files.length > 0) {
        const processingPromises = files.map(async (file) => {
          let result;
          switch (file.fileType) {
            case 'txt':
              result = await processTxt(file, conversationId);
              break;
            case 'pdf':
              result = await processPdf(file, conversationId);
              break;
            case 'jpeg':
            case 'jpg':
            case 'png':
            case 'image':
              result = await processImage(file, conversationId);
              break;
            case 'docx':
              result = await processDocx(file, conversationId);
              break;
            default:
              logger.warn('Unsupported file type, skipping', { fileType: file.fileType });
              result = { status: 'error', fileId: file.fileId, error: 'Unsupported file type' };
              break;
          }
          return result;
        });

        const results = await Promise.all(processingPromises);
        results.forEach(r => {
          if (r.status === 'success') {
            processedFiles.push(r.fileId);
          } else {
            failedFiles.push({ fileId: r.fileId, error: r.error });
          }
        });
      }
    }

    res.status(200).json({
      status: 'ok',
      processedFiles,
      failedFiles,
    });

  } catch (error) {
    if (error instanceof ZodError) {
      logger.error('Validation error for /process-message', { errors: error.errors });
      return res.status(400).json({ error: 'Invalid request body', details: error.errors });
    }
    logger.error('Error in /process-message handler', { error: error.message });
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
