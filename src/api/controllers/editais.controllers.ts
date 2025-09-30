import { editalProcessService } from '@core/services/editais';
import { wrapPromiseResult } from '@lib/result.types';
import type { Request, Response } from 'express';
import { type ZodError, z } from 'zod';
import logger from '../../lib/logger';

const EditalProcessBodySchema = z.object({
  user_id: z.string().uuid(),
  schedule_plan_id: z.string().uuid(),
  url: z.string().url(),
});

export type EditalProcessBody = z.infer<typeof EditalProcessBodySchema>;

export class EditaisController {
  processEditalHandler = async (req: Request, res: Response) => {
    const { value: body, error } = await wrapPromiseResult<EditalProcessBody, ZodError>(
      EditalProcessBodySchema.parseAsync(req.body)
    );

    if (error) {
      logger.error('Validation error for /edital-process', { errors: error.issues });
      return res.status(400).json({ error: 'Invalid request body', details: error.issues });
    }

    logger.info('Received /edital-process request', {
      user_id: body.user_id,
      schedule_plan_id: body.schedule_plan_id,
      url: body.url,
    });

    try {
      const result = await editalProcessService.execute(body);

      return res.status(200).json(result);
    } catch (error) {
      logger.error('Error processing edital request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        body,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export const editaisController = new EditaisController();