import { env } from '@config/env';
import logger from '@lib/logger';
import { processMessagesService } from '@core/services/messages/pdf-utils';
import type { CreateProcessMessageJobInput, ProcessMessageJobRecord } from './job.types';
import { JsonJobStoreService } from './json-job-store.service';

type QueuedJob = {
  jobId: string;
};

export class JobQueueFullError extends Error {
  constructor() {
    super('Job queue is full. Try again later.');
    this.name = 'JobQueueFullError';
  }
}

export class ProcessMessageJobService {
  private readonly queue: QueuedJob[] = [];
  private activeJobs = 0;

  constructor(private readonly store = new JsonJobStoreService()) {}

  async create(input: CreateProcessMessageJobInput): Promise<ProcessMessageJobRecord> {
    if (this.queue.length >= env.JOBS_MAX_QUEUE_SIZE) {
      throw new JobQueueFullError();
    }

    const now = new Date().toISOString();
    const record: ProcessMessageJobRecord = {
      id: this.store.createJobId(),
      type: 'process-message',
      status: 'queued',
      request: input.messages,
      host: input.host,
      protocol: input.protocol,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(record);
    this.enqueue(record.id);

    return record;
  }

  get(jobId: string): Promise<ProcessMessageJobRecord> {
    return this.store.get(jobId);
  }

  private enqueue(jobId: string): void {
    this.queue.push({ jobId });
    void this.drainQueue();
  }

  private async drainQueue(): Promise<void> {
    while (this.activeJobs < env.JOBS_MAX_CONCURRENCY && this.queue.length > 0) {
      const nextJob = this.queue.shift();
      if (!nextJob) {
        return;
      }

      this.activeJobs++;
      void this.runJob(nextJob.jobId).finally(() => {
        this.activeJobs--;
        void this.drainQueue();
      });
    }
  }

  private async runJob(jobId: string): Promise<void> {
    const startedAt = new Date().toISOString();

    try {
      const job = await this.store.update(jobId, {
        status: 'processing',
        startedAt,
      });

      const result = await processMessagesService.execute(
        {
          messages: job.request,
          host: job.host,
          protocol: job.protocol,
        },
        {
          includeReadableErrorBlocks: true,
          pdfMode: 'mixed-page',
          limits: {
            maxFileBytes: env.EXTRACTION_MAX_FILE_BYTES,
            maxFiles: env.MAX_FILES_PER_JOB,
            maxPdfPages: env.MAX_PDF_PAGES,
            maxOcrPagesPerPdf: env.MAX_OCR_PAGES_PER_PDF,
            maxTotalOcrPagesPerJob: env.MAX_TOTAL_OCR_PAGES_PER_JOB,
          },
        }
      );

      await this.store.update(jobId, {
        status: 'completed',
        result,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Process-message job failed', { jobId, error: message });

      await this.store.update(jobId, {
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
    }
  }
}

export const processMessageJobService = new ProcessMessageJobService();
