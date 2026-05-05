import { env } from '@config/env';
import { processMessagesService } from '@core/services/messages/pdf-utils';
import logger from '@lib/logger';
import type { CreateProcessMessageJobInput, ProcessMessageJobRecord } from './job.types';
import { JsonJobStoreService } from './json-job-store.service';

const MAINTENANCE_INTERVAL_MS = 60_000;

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
  private maintenanceRunning = false;

  constructor(
    private readonly store = new JsonJobStoreService(),
    private readonly processor = processMessagesService
  ) {
    void this.runMaintenance();

    const timer = setInterval(() => {
      void this.runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);
    timer.unref?.();
  }

  async create(input: CreateProcessMessageJobInput): Promise<ProcessMessageJobRecord> {
    await this.runMaintenance();

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
    await this.pruneExpiredQueuedJobs();

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

      const result = await this.runWithJobTimeout(
        this.processor.execute(
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
        )
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
        status: message.includes('excedeu o tempo limite') ? 'expired' : 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
    }
  }

  private async runWithJobTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer!: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Job excedeu o tempo limite de ${env.JOB_STALE_AFTER_MS}ms`));
      }, env.JOB_STALE_AFTER_MS);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async runMaintenance(): Promise<void> {
    if (this.maintenanceRunning) {
      return;
    }

    this.maintenanceRunning = true;
    try {
      const expired = await this.store.expireStaleJobs(env.JOB_STALE_AFTER_MS);
      const deleted = await this.store.deleteFinishedOlderThan(
        env.JOBS_RETENTION_HOURS * 60 * 60 * 1000
      );

      if (expired > 0 || deleted > 0) {
        logger.info('Job maintenance completed', { expired, deleted });
      }
    } catch (error) {
      logger.warn('Job maintenance failed', { error: (error as Error).message }, error);
    } finally {
      this.maintenanceRunning = false;
    }
  }

  private async pruneExpiredQueuedJobs(): Promise<void> {
    const now = Date.now();
    const keptJobs: QueuedJob[] = [];

    for (const queuedJob of this.queue) {
      try {
        const job = await this.store.get(queuedJob.jobId);
        const ageMs = now - Date.parse(job.createdAt);

        if (job.status === 'queued' && ageMs > env.JOB_STALE_AFTER_MS) {
          await this.store.update(job.id, {
            status: 'expired',
            error: `Job expirado na fila apos ${env.JOB_STALE_AFTER_MS}ms`,
            finishedAt: new Date().toISOString(),
          });
          continue;
        }

        if (job.status === 'queued') {
          keptJobs.push(queuedJob);
        }
      } catch (error) {
        logger.warn('Dropping unreadable queued job', {
          jobId: queuedJob.jobId,
          error: (error as Error).message,
        });
      }
    }

    this.queue.splice(0, this.queue.length, ...keptJobs);
  }
}

export const processMessageJobService = new ProcessMessageJobService();
