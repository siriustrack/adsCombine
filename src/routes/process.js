const express = require('express');
const router = express.Router();
const { z, ZodError } = require('zod');
const logger = require('../lib/logger');
const { sanitize } = require('../utils/sanitize');
const { processTxt, processImage, processPdf, processDocx } = require('../services/fileProcessor');
const { sanitizeText } = require('../utils/textSanitizer');
const fs = require('fs');
const path = require('path');

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
router.post('/process-message', async (req, res) => {
  try {
    const rawMessages = Array.isArray(req.body) ? req.body : [req.body];
    const messages = ProcessMessageSchema.parse(rawMessages);
    
    logger.info('Received /process-message request', { messageCount: messages.length });

    if (messages.length === 0) {
      return res.status(400).json({ error: 'Request body must contain at least one message.' });
    }

    let allExtractedText = '';
    const processedFiles = [];
    const failedFiles = [];

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
          } catch (error) {
            logger.error('Failed to process file', { fileId: file.fileId, error: error.message });
            failedFiles.push({ fileId: file.fileId, error: error.message });
            return null; // Retorna nulo para arquivos que falharam
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
    
    // Garante que o diretório exista
    fs.mkdirSync(textsDir, { recursive: true });
    
    const filePath = path.join(textsDir, filename);
    
    // Sanitiza o texto antes de salvar para remover caracteres problemáticos
    const sanitizedText = sanitizeText(allExtractedText.trim());
    fs.writeFileSync(filePath, sanitizedText);

    const downloadUrl = `${req.protocol}://${req.get('host')}/texts/${filename}`;

    logger.info('Successfully processed messages and created text file', { conversationId, downloadUrl });

    res.status(200).json({
      conversationId,
      downloadUrl,
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

/**
 * @openapi
 * /delete-texts:
 *   delete:
 *     summary: Exclui arquivos de texto da pasta public/texts
 *     tags:
 *       - Processamento
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               filename:
 *                 type: string
 *                 description: Nome específico do arquivo a ser excluído (opcional). Se não fornecido, todos os arquivos .txt serão excluídos.
 *               conversationId:
 *                 type: string
 *                 description: ID da conversa para excluir apenas arquivos relacionados (opcional).
 *     responses:
 *       '200':
 *         description: Arquivos excluídos com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensagem de sucesso
 *                 deletedFiles:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Lista de arquivos excluídos
 *                 deletedCount:
 *                   type: number
 *                   description: Número de arquivos excluídos
 *       '404':
 *         description: Nenhum arquivo encontrado para exclusão.
 *       '500':
 *         description: Erro interno do servidor.
 */
router.delete('/delete-texts', async (req, res) => {
  try {
    const { filename, conversationId } = req.body || {};
    
    logger.info('Received /delete-texts request', { filename, conversationId });

    const textsDir = path.join(__dirname, '..', '..', 'public', 'texts');
    
    // Verifica se o diretório existe
    if (!fs.existsSync(textsDir)) {
      logger.warn('Texts directory does not exist', { textsDir });
      return res.status(404).json({ 
        error: 'Texts directory not found',
        deletedFiles: [],
        deletedCount: 0
      });
    }

    // Lê todos os arquivos do diretório
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

    let filesToDelete = [];

    if (filename) {
      // Excluir arquivo específico
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
      // Excluir arquivos de uma conversa específica
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
      // Excluir todos os arquivos txt
      filesToDelete = txtFiles;
    }

    const deletedFiles = [];
    const failedFiles = [];

    // Excluir os arquivos
    for (const file of filesToDelete) {
      try {
        const filePath = path.join(textsDir, file);
        fs.unlinkSync(filePath);
        deletedFiles.push(file);
        logger.info('File deleted successfully', { file });
      } catch (error) {
        logger.error('Failed to delete file', { file, error: error.message });
        failedFiles.push({ file, error: error.message });
      }
    }

    const response = {
      message: `Successfully deleted ${deletedFiles.length} file(s)`,
      deletedFiles,
      deletedCount: deletedFiles.length
    };

    if (failedFiles.length > 0) {
      response.failedFiles = failedFiles;
      response.message += `. Failed to delete ${failedFiles.length} file(s)`;
    }

    logger.info('Delete operation completed', response);
    res.status(200).json(response);

  } catch (error) {
    logger.error('Error in /delete-texts handler', { error: error.message });
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

module.exports = router;
