import { env } from '@config/env';
import cors from 'cors';
import express from 'express';
import logger from 'lib/logger';
import morgan from 'morgan';
import { handleAuthMiddleware, handleGlobalRequestExceptions } from './middlewares';
import router from './routes';

const app = express();

// CORS must be BEFORE auth middleware to handle OPTIONS preflight
app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));

app.use(handleGlobalRequestExceptions);
app.use(handleAuthMiddleware);
app.use(router);

function serializeError(reason: unknown) {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack
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
    promise: String(promise)
  });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', serializeError(err));
  process.exit(1);
});
app.listen(env.PORT, () => {
  logger.info(`Server running on port ${env.PORT} `);
});
