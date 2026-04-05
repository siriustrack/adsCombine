import express from 'express';
import multer from 'multer';
import { transcribeController } from '../controllers';

const router = express.Router();

// Configure multer for memory storage with 50MB limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  },
  fileFilter: (_req, file, cb) => {
    // Accept audio files
    const allowedMimeTypes = [
      'audio/webm',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/m4a',
      'audio/mp4',
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato de áudio não suportado: ${file.mimetype}`));
    }
  },
});

/**
 * @openapi
 * /api/transcribe:
 *   post:
 *     tags:
 *       - Transcrição
 *     summary: Transcreve áudio para texto
 *     description: Recebe um arquivo de áudio e retorna a transcrição utilizando o modelo Whisper da OpenAI.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - audio
 *             properties:
 *               audio:
 *                 type: string
 *                 format: binary
 *                 description: Arquivo de áudio (webm, mpeg, mp3, wav, ogg, m4a, mp4). Máximo 50MB.
 *     responses:
 *       200:
 *         description: Transcrição realizada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 text:
 *                   type: string
 *                   description: Texto transcrito
 *                   example: "Olá, como vai você?"
 *                 duration:
 *                   type: number
 *                   description: Duração do áudio em segundos
 *                   example: 5.2
 *                 language:
 *                   type: string
 *                   description: Idioma detectado
 *                   example: "pt"
 *                 confidence:
 *                   type: number
 *                   description: Confiança da transcrição
 *                   example: 0.95
 *                 processingTime:
 *                   type: number
 *                   description: Tempo de processamento em ms
 *                   example: 1234
 *       400:
 *         description: Arquivo de áudio ausente ou formato inválido
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - $ref: '#/components/schemas/Error400'
 *                 - type: object
 *                   properties:
 *                     error:
 *                       type: string
 *                       example: "Arquivo de áudio não encontrado"
 *                     code:
 *                       type: string
 *                       example: "AUDIO_NOT_FOUND"
 *       413:
 *         description: Arquivo excede o limite de 50MB
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error413'
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
router.post('/transcribe', upload.single('audio'), (req, res) =>
  transcribeController.transcribe(req, res)
);

// Error handler for multer errors
router.use(
  (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: 'Arquivo muito grande',
          code: 'FILE_TOO_LARGE',
          details: {
            maxSize: '50MB',
          },
        });
        return;
      }
      res.status(400).json({
        error: err.message,
        code: 'UPLOAD_ERROR',
      });
      return;
    }

    if (err instanceof Error) {
      res.status(400).json({
        error: err.message,
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    next();
  }
);

export default router;
