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

// POST /transcribe - Transcribe audio to text
router.post('/transcribe', upload.single('audio'), (req, res) =>
  transcribeController.transcribe(req, res)
);

// Error handler for multer errors
router.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

  if (err) {
    res.status(400).json({
      error: err.message,
      code: 'VALIDATION_ERROR',
    });
    return;
  }

  next();
});

export default router;
