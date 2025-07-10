import { MessagesService } from 'core/services/messages.services';
import { Request, Response } from 'express';
import { z, ZodError } from 'zod';
import logger from '../../lib/logger';

const FileInfoSchema = z.object({
  fileId: z.string(),
  url: z.url(),
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
}).loose();

const ProcessMessageSchema = z.array(MessageSchema);
export type ProcessMessage = z.infer<typeof ProcessMessageSchema>;

const DeleteTextsBodySchema = z.object({
  filename: z.string().optional(),
  conversationId: z.string().optional(),
}).strict();
export type DeleteTextsBody = z.infer<typeof DeleteTextsBodySchema>;

export class MessagesController {

  constructor(private readonly messagesService: MessagesService) { }

  async processMessagesHandler(req: Request, res: Response) {
    try {
      const rawMessages = Array.isArray(req.body) ? req.body : [req.body];

      const messages = ProcessMessageSchema.parse(rawMessages);

      logger.info('Received /process-message request', { messageCount: messages.length });

      const response = await this.messagesService.processMessages({ messages, host: req.get('host')!, protocol: req.protocol });
      
      return res.status(200).json(response);
    } catch (error: any) {
      if (error instanceof ZodError) {
        logger.error('Validation error for /process-message', { errors: error.issues });
        return res.status(400).json({ error: 'Invalid request body', details: error.issues });
      }
      logger.error('Error in /process-message handler', { error: error.message });
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }

  async deleteTextsHandler(req: Request, res: Response) {
    try {
      const body = DeleteTextsBodySchema.parse(req.body);

      logger.info('Received /delete-texts request', body);

      const response = await this.messagesService.deleteTexts(body);

      return res.status(response.status).json(response);

    } catch (error: any) {
      logger.error('Error in /delete-texts handler', { error: error.message });
      return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }
}