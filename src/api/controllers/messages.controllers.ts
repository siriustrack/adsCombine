import { deleteTextsService, processMessagesService } from '@core/services/messages';
import { wrapPromiseResult } from '@lib/result.types';
import type { Request, Response } from 'express';
import { type ZodError, z } from 'zod';
import logger from '../../lib/logger';

const FileInfoSchema = z
  .object({
    fileId: z.string(),
    url: z.url(),
    mimeType: z.string(),
    fileType: z.enum(['txt', 'pdf', 'jpeg', 'png', 'jpg', 'docx', 'image']),
  })
  .loose();

const BodySchema = z.object({
  content: z.string().optional(),
  files: z.array(FileInfoSchema).optional(),
});

const MessageSchema = z
  .object({
    conversationId: z.string(),
    body: BodySchema,
  })
  .loose();

const ProcessMessageSchema = z.array(MessageSchema);
export type ProcessMessage = z.infer<typeof ProcessMessageSchema>;

const DeleteTextsBodySchema = z
  .object({
    filename: z.string().optional(),
    conversationId: z.string().optional(),
  })
  .strict();
export type DeleteTextsBody = z.infer<typeof DeleteTextsBodySchema>;

export class MessagesController {
  processMessagesHandler = async (req: Request, res: Response) => {
    const rawMessages = Array.isArray(req.body) ? req.body : [req.body];

    const { value: messages, error } = await wrapPromiseResult<ProcessMessage, ZodError>(
      ProcessMessageSchema.parseAsync(rawMessages)
    );

    if (error) {
      logger.error('Validation error for /process-message', { errors: error.issues });
      return res.status(400).json({ error: 'Invalid request body', details: error.issues });
    }

    logger.info('Received /process-message request', { messageCount: messages.length });

    const messageContext = { messages, host: req.get('host')!, protocol: req.protocol };

    const response = await processMessagesService.execute(messageContext);

    return res.status(200).json(response);
  };

  deleteTextsHandler = async (req: Request, res: Response) => {
    const body = DeleteTextsBodySchema.parse(req.body);

    logger.info('Received /delete-texts request', body);

    const response = await deleteTextsService.execute(body);

    return res.status(response.status).json(response);
  };
}
