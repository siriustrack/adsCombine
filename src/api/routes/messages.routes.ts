import { messagesController } from 'api/controllers';
import express, { type RequestHandler } from 'express';
import logger from 'lib/logger';
import { randomUUID } from 'node:crypto';
import { env } from '@config/env';

const router = express.Router();

const summarizeProcessMessageBody = (body: any) => {
	try {
		const arr = Array.isArray(body) ? body : [body];
		const summary = arr.map((m) => ({
			conversationId: m?.conversationId,
			contentLength: m?.body?.content ? String(m.body.content).length : 0,
			filesCount: Array.isArray(m?.body?.files) ? m.body.files.length : 0,
			fileTypes: Array.isArray(m?.body?.files) ? [...new Set(m.body.files.map((f: any) => f?.fileType))] : [],
		}));
		return { messageCount: arr.length, details: summary.slice(0, 5) };
	} catch {
		return { rawType: typeof body };
	}
};

const routeLogger = (name: string): RequestHandler => (req, res, next) => {
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

router.post('/process-message', routeLogger('messages.process-message'), messagesController.processMessagesHandler);
router.delete('/delete-texts', routeLogger('messages.delete-texts'), messagesController.deleteTextsHandler);

export default router;
