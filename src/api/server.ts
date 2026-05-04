import { env } from '@config/env';
import { swaggerSpec } from '@config/swagger';
import cors from 'cors';
import express from 'express';
import logger from 'lib/logger';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { OcrOrchestrator } from '@core/services/messages/pdf-utils/ocr-orchestrator.service';
import { handleAuthMiddleware, handleGlobalRequestExceptions } from './middlewares';
import router from './routes';

const app = express();

app.set('trust proxy', 1);

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(
  morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } })
);

app.use(handleGlobalRequestExceptions);
app.use(handleAuthMiddleware);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use(router);

function serializeError(reason: unknown) {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack,
    };
  }
  if (typeof reason === 'object' && reason !== null) {
    try {
      return JSON.parse(JSON.stringify(reason));
    } catch {
      return { value: String(reason) };
    }
  }
  return { value: String(reason) };
}

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    reason: serializeError(reason),
    promise: String(promise),
  });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', serializeError(err));
  process.exit(1);
});
app.listen(env.PORT, async () => {
  logger.info(`Server running on port ${env.PORT}`);

  const pdfinfo = await OcrOrchestrator.checkPdfinfo();
  if (!pdfinfo.available) {
    logger.warn('pdfinfo not found in PATH — PDF OCR will be skipped for all documents');
  } else {
    logger.info(`pdfinfo available (version ${pdfinfo.version})`);
  }
});
