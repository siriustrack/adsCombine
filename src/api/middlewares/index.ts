import { env } from '@config/env';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import logger from 'lib/logger';

export const handleGlobalRequestExceptions: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error('Express error:', err);
  res.status(500).json({ error: err.message });
};

const authorizedPaths = ['/texts', '/api/process-message', '/api-docs', '/favicon.ico'];

export const handleAuthMiddleware: RequestHandler = (req, res, next) => {
  if (req.path.startsWith('/api/jobs')) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      logger.error('Unauthorized job route access attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = auth.split(' ')[1];
    if (token !== env.JOBS_TOKEN) {
      logger.error('Forbidden: Invalid jobs token');
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  }

  if (authorizedPaths.some((path) => req.path.startsWith(path))) {
    return next();
  }

  logger.debug(`Skipping auth for path: ${req.path}`);

  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    logger.error(`Unauthorized access attempt`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.split(' ')[1];
  if (token !== env.TOKEN) {
    logger.error(`Forbidden: Invalid token`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
};
