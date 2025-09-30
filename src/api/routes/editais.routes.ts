import { editaisController } from 'api/controllers';
import express, { type RequestHandler } from 'express';
import logger from 'lib/logger';
import { randomUUID } from 'node:crypto';
import { env } from '@config/env';

const router = express.Router();

const routeLogger = (name: string): RequestHandler => (req, res, next) => {
  if (!env.REQUEST_LOGS_ENABLED) {
    return next();
  }
  const requestId = (req.headers['x-request-id'] as string) || randomUUID();
  res.locals.requestId = requestId;
  const start = process.hrtime.bigint();

  logger.info(`[${name}] start`, {
    requestId,
    method: req.method,
    path: req.originalUrl,
    contentLength: req.headers['content-length'],
    body: { keys: Object.keys(req.body || {}) },
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

router.post('/edital-process', routeLogger('editais.edital-process'), editaisController.processEditalHandler);

export default router;