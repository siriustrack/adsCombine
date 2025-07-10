import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z, ZodError } from 'zod';
import logger from '../lib/logger';
import { processDocx, processImage, processPdf, processTxt } from '../services/fileProcessor';
import { sanitizeText } from '../utils/textSanitizer';
const router = express.Router();


const FileInfoSchema = z.object({
  fileId: z.string(),
  url: z.string().url(),
  mimeType: z.string(),
  fileType: z.enum(['txt', 'pdf', 'jpeg', 'png', 'jpg', 'docx', 'image']),
}).loose();

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
 *         description: Processamento concluído e URL para download do texto concatenado.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 conversationId:
 *                   type: string
 *                   description: O ID da conversa da primeira mensagem processada.
 *                 downloadUrl:
 *                   type: string
 *                   format: uri
 *                   description: A URL pública para baixar o arquivo .txt com todo o conteúdo de texto extraído.
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
router.post('/process-message', async (req: Request, res: Response) => {
  try {
    const rawMessages = Array.isArray(req.body) ? req.body : [req.body];
    const messages = ProcessMessageSchema.parse(rawMessages);

    logger.info('Received /process-message request', { messageCount: messages.length });

    if (messages.length === 0) {
      return res.status(400).json({ error: 'Request body must contain at least one message.' });
    }

    let allExtractedText = '';
    const processedFiles: string[] = [];
    const failedFiles: { fileId: string; error: string }[] = [];

    for (const message of messages) {
      const { body } = message;
      const { files } = body;

      if (files && files.length > 0) {
        const processingPromises = files.map(async (file) => {
          try {
            let textContent = '';
            switch (file.fileType) {
              case 'txt':
                textContent = await processTxt(file);
                break;
              case 'pdf':
                textContent = await processPdf(file);
                break;
              case 'jpeg':
              case 'jpg':
              case 'png':
              case 'image':
                textContent = await processImage(file);
                break;
              case 'docx':
                textContent = await processDocx(file);
                break;
              default:
                logger.warn('Unsupported file type, skipping', { fileType: file.fileType, fileId: file.fileId });
                throw new Error('Unsupported file type');
            }
            processedFiles.push(file.fileId);
            const fileName = path.basename(new URL(file.url).pathname);
            const header = `## Transcricao do arquivo: ${fileName}:\n\n`;
            return header + textContent;
          } catch (error: any) {
            logger.error('Failed to process file', { fileId: file.fileId, error: error.message });
            failedFiles.push({ fileId: file.fileId, error: error.message });
            return null;
          }
        });

        const results = await Promise.all(processingPromises);
        results.forEach(text => {
          if (text) {
            allExtractedText += text + '\n\n---\n\n';
          }
        });
      }
    }

    const conversationId = messages[0].conversationId;
    const filename = `${conversationId}-${Date.now()}.txt`;
    const textsDir = path.join(__dirname, '..', '..', 'public', 'texts');

    fs.mkdirSync(textsDir, { recursive: true });

    const filePath = path.join(textsDir, filename);

    const sanitizedText = sanitizeText(allExtractedText.trim());
    fs.writeFileSync(filePath, sanitizedText);

    const downloadUrl = `${req.protocol}://${req.get('host')}/texts/${filename}`;

    logger.info('Successfully processed messages and created text file', { conversationId, downloadUrl });

    return res.status(200).json({
      conversationId,
      downloadUrl,
      processedFiles,
      failedFiles,
    });

  } catch (error: any) {
    if (error instanceof ZodError) {
      logger.error('Validation error for /process-message', { errors: error.issues });
      return res.status(400).json({ error: 'Invalid request body', details: error.issues });
    }
    logger.error('Error in /process-message handler', { error: error.message });
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

interface DeleteTextsBody {
  filename?: string;
  conversationId?: string;
}

interface FailedFile {
  file: string;
  error: string;
}

router.delete('/delete-texts', async (req: Request, res: Response) => {
  try {
    const { filename, conversationId }: DeleteTextsBody = req.body || {};

    logger.info('Received /delete-texts request', { filename, conversationId });

    const textsDir = path.join(__dirname, '..', '..', 'public', 'texts');

    if (!fs.existsSync(textsDir)) {
      logger.warn('Texts directory does not exist', { textsDir });
      return res.status(404).json({
        error: 'Texts directory not found',
        deletedFiles: [],
        deletedCount: 0
      });
    }

    const allFiles = fs.readdirSync(textsDir);
    const txtFiles = allFiles.filter(file => file.endsWith('.txt'));

    if (txtFiles.length === 0) {
      logger.info('No txt files found in texts directory');
      return res.status(404).json({
        message: 'No txt files found to delete',
        deletedFiles: [],
        deletedCount: 0
      });
    }

    let filesToDelete: string[] = [];

    if (filename) {

      if (txtFiles.includes(filename)) {
        filesToDelete = [filename];
      } else {
        logger.warn('Specific file not found', { filename });
        return res.status(404).json({
          error: `File ${filename} not found`,
          deletedFiles: [],
          deletedCount: 0
        });
      }
    } else if (conversationId) {

      filesToDelete = txtFiles.filter(file => file.startsWith(conversationId));
      if (filesToDelete.length === 0) {
        logger.warn('No files found for conversation', { conversationId });
        return res.status(404).json({
          message: `No files found for conversation ${conversationId}`,
          deletedFiles: [],
          deletedCount: 0
        });
      }
    } else {

      filesToDelete = txtFiles;
    }

    const deletedFiles: string[] = [];
    const failedFiles: FailedFile[] = [];

    for (const file of filesToDelete) {
      try {
        const filePath = path.join(textsDir, file);
        fs.unlinkSync(filePath);
        deletedFiles.push(file);
        logger.info('File deleted successfully', { file });
      } catch (error: any) {
        logger.error('Failed to delete file', { file, error: error.message });
        failedFiles.push({ file, error: error.message });
      }
    }

    const response: {
      message: string;
      deletedFiles: string[];
      deletedCount: number;
      failedFiles?: FailedFile[];
    } = {
      message: `Successfully deleted ${deletedFiles.length} file(s)`,
      deletedFiles,
      deletedCount: deletedFiles.length
    };

    if (failedFiles.length > 0) {
      response.failedFiles = failedFiles;
      response.message += `. Failed to delete ${failedFiles.length} file(s)`;
    }

    logger.info('Delete operation completed', response);
    return res.status(200).json(response);

  } catch (error: any) {
    logger.error('Error in /delete-texts handler', { error: error.message });
    return res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

export default router;
