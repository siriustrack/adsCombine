import { JobNotFoundError } from '@core/services/jobs/json-job-store.service';
import { processMessageJobService } from '@core/services/jobs/process-message-job.service';
import type { Request, Response } from 'express';
import { z } from 'zod';
import logger from '../../lib/logger';
import { ProcessMessageSchema } from './messages.controllers';

const JobParamsSchema = z.object({
  jobId: z.uuid()
});

function buildJobUrl(req: Request, jobId: string, suffix: 'status' | 'result'): string {
  return `${req.protocol}://${req.get('host')}/api/jobs/${jobId}/${suffix}`;
}

export class JobsController {
  createProcessMessageJobHandler = async (req: Request, res: Response) => {
    const rawMessages = Array.isArray(req.body) ? req.body : [req.body];

    const validation = await ProcessMessageSchema.safeParseAsync(rawMessages);
    if (!validation.success) {
      const issues = validation.error.issues;
      logger.error('Validation error for /api/jobs/process-message', { errors: issues });
      return res.status(400).json({ error: 'Invalid request body', details: issues });
    }

    try {
      const job = await processMessageJobService.create({
        messages: validation.data,
        host: req.get('host')!,
        protocol: req.protocol
      });

      return res.status(202).json({
        jobId: job.id,
        status: job.status,
        statusUrl: buildJobUrl(req, job.id, 'status'),
        resultUrl: buildJobUrl(req, job.id, 'result'),
        createdAt: job.createdAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to create process-message job', { error: message });
      return res.status(503).json({ error: message });
    }
  };

  getJobStatusHandler = async (req: Request, res: Response) => {
    const params = JobParamsSchema.parse(req.params);
    try {
      const job = await processMessageJobService.get(params.jobId);

      return res.status(200).json({
        jobId: job.id,
        type: job.type,
        status: job.status,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.error,
        resultUrl: buildJobUrl(req, job.id, 'result')
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to read job status', { jobId: params.jobId, error: message });
      return res.status(500).json({ error: 'Failed to read job status' });
    }
  };

  getJobResultHandler = async (req: Request, res: Response) => {
    const params = JobParamsSchema.parse(req.params);
    try {
      const job = await processMessageJobService.get(params.jobId);

      if (job.status === 'queued' || job.status === 'processing') {
        return res.status(202).json({ jobId: job.id, status: job.status });
      }

      if (job.status === 'failed' || job.status === 'expired') {
        return res.status(200).json({ jobId: job.id, status: job.status, error: job.error });
      }

      return res.status(200).json({
        jobId: job.id,
        status: job.status,
        result: job.result
      });
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return res.status(404).json({ error: 'Job not found' });
      }

      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to read job result', { jobId: params.jobId, error: message });
      return res.status(500).json({ error: 'Failed to read job result' });
    }
  };
}
