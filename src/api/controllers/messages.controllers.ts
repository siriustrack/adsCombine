import { env } from '@config/env'
import { DeleteTextsService } from '@core/services/messages/delete-texts.services'
import { ProcessMessagesService } from '@core/services/messages/process-messages.service'
import { wrapPromiseResult } from '@lib/result.types'
import type { Request, Response } from 'express'
import { type ZodError, z } from 'zod'
import logger from '../../lib/logger'

const FileInfoSchema = z
  .object({
    fileId: z.string(),
    url: z.url(),
    mimeType: z.string(),
    fileName: z.string().optional(),
  })
  .loose()

export type FileInfo = z.infer<typeof FileInfoSchema>

const BodySchema = z.object({
  files: z.array(FileInfoSchema).optional(),
})

const MessageSchema = z
  .object({
    conversationId: z.string(),
    body: BodySchema,
  })
  .loose()

export const ProcessMessageSchema = z.array(MessageSchema)
export type ProcessMessage = z.infer<typeof ProcessMessageSchema>

const DeleteTextsBodySchema = z
  .object({
    conversationId: z.string().optional(),
  })
  .strict()
export type DeleteTextsBody = z.infer<typeof DeleteTextsBodySchema>

export class MessagesController {
  constructor(
    private processor?: Pick<ProcessMessagesService, 'execute'>,
    private readonly deleteTextsProcessor = new DeleteTextsService()
  ) {}

  processMessagesHandler = async (req: Request, res: Response) => {
    const rawMessages = Array.isArray(req.body) ? req.body : [req.body]

    const { value: messages, error } = await wrapPromiseResult<ProcessMessage, ZodError>(
      ProcessMessageSchema.parseAsync(rawMessages)
    )

    if (error) {
      logger.error('Validation error for /process-message', { errors: error.issues })
      return res.status(400).json({ error: 'Invalid request body', details: error.issues })
    }

    logger.info('Received /process-message request', { messageCount: messages.length })

    const messageContext = { messages, host: req.get('host')!, protocol: req.protocol }

    const response = await this.getProcessor().execute(messageContext, {
      limits: {
        maxFileBytes: env.EXTRACTION_MAX_FILE_BYTES,
        maxFiles: env.MAX_FILES_PER_JOB,
        maxPdfPages: env.MAX_PDF_PAGES,
        maxOcrPagesPerPdf: env.MAX_OCR_PAGES_PER_PDF,
        maxTotalOcrPagesPerJob: env.MAX_TOTAL_OCR_PAGES_PER_JOB,
        maxTotalVisualFallbackPagesPerJob: env.MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB,
      },
    })

    return res.status(200).json(response)
  }

  deleteTextsHandler = async (req: Request, res: Response) => {
    const body = DeleteTextsBodySchema.parse(req.body)

    logger.info('Received /delete-texts request', body)

    const response = await this.deleteTextsProcessor.execute(body)

    return res.status(response.status).json(response)
  }

  private getProcessor(): Pick<ProcessMessagesService, 'execute'> {
    this.processor ??= new ProcessMessagesService()
    return this.processor
  }
}
