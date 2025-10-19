import { editalProcessService } from '@core/services/editais';
import { wrapPromiseResult } from '@lib/result.types';
import type { Request, Response } from 'express';
import { type ZodError, z } from 'zod';
import logger from '../../lib/logger';

// Schema simplificado - Edge function v26 envia APENAS edital_file_id
const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  edital_file_id: z.string().uuid(), // ID do registro edital_file
  url: z.string().url(),
  edital_bucket_path: z.string().min(1).optional(), // Opcional agora
  file_name: z.string().optional(),
  file_size: z.number().int().positive().optional(),
  mime_type: z.string().optional(),
  options: z.object({
    saveJson: z.boolean().optional(),
    outputDir: z.string().optional(),
  }).optional(),
});

export type EditalProcessBody = z.infer<typeof EditalProcessBodySchema>;

export class EditaisController {
  processEditalHandler = async (req: Request, res: Response) => {
    const requestId = res.locals.requestId || 'no-request-id';
    
    logger.info('[EDITAL-PROCESS] 📥 Request received', {
      requestId,
      hasBody: !!req.body,
      bodyKeys: Object.keys(req.body || {}),
    });

    const { value: body, error } = await wrapPromiseResult<EditalProcessBody, ZodError>(
      EditalProcessBodySchema.parseAsync(req.body)
    );

    if (error) {
      logger.error('[EDITAL-PROCESS] ❌ Validation error', { 
        requestId,
        errors: error.issues 
      });
      return res.status(400).json({ error: 'Invalid request body', details: error.issues });
    }

    logger.info('[EDITAL-PROCESS] ✅ Validation passed', {
      requestId,
      user_id: body.user_id,
      edital_file_id: body.edital_file_id,
      url: body.url,
      urlDomain: new URL(body.url).hostname,
    });

    try {
      logger.info('[EDITAL-PROCESS] 🚀 Starting edital processing service', { requestId });
      
      const result = await editalProcessService.execute(body);

      logger.info('[EDITAL-PROCESS] ✅ Processing initiated successfully', {
        requestId,
        jobId: result.jobId,
        filePath: result.filePath,
        status: result.status,
      });

      return res.status(200).json(result);
    } catch (error) {
      logger.error('[EDITAL-PROCESS] ❌ Critical error', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        user_id: body.user_id,
        edital_file_id: body.edital_file_id,
        url: body.url,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const editaisController = new EditaisController();
