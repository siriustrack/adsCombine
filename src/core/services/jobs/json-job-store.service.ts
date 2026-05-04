import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JOBS_DIR } from '@config/dirs';
import logger from '@lib/logger';
import type { ProcessMessageJobRecord } from './job.types';

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found: ${jobId}`);
    this.name = 'JobNotFoundError';
  }
}

export class InvalidJobIdError extends Error {
  constructor(jobId: string) {
    super(`Invalid job id: ${jobId}`);
    this.name = 'InvalidJobIdError';
  }
}

export class JsonJobStoreService {
  constructor(private readonly jobsDir = JOBS_DIR) {}

  createJobId(): string {
    return randomUUID();
  }

  async save(record: ProcessMessageJobRecord): Promise<void> {
    this.assertValidJobId(record.id);
    await fs.mkdir(this.jobsDir, { recursive: true });

    const filePath = this.getJobPath(record.id);
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    const serialized = `${JSON.stringify(record, null, 2)}\n`;

    await fs.writeFile(tempPath, serialized, 'utf8');
    await fs.rename(tempPath, filePath);
  }

  async get(jobId: string): Promise<ProcessMessageJobRecord> {
    this.assertValidJobId(jobId);

    try {
      const content = await fs.readFile(this.getJobPath(jobId), 'utf8');
      return JSON.parse(content) as ProcessMessageJobRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new JobNotFoundError(jobId);
      }

      logger.error('Failed to read job file', { jobId, error: (error as Error).message });
      throw error;
    }
  }

  async update(
    jobId: string,
    changes: Partial<Omit<ProcessMessageJobRecord, 'id' | 'type' | 'request' | 'host' | 'protocol'>>
  ): Promise<ProcessMessageJobRecord> {
    const current = await this.get(jobId);
    const updated: ProcessMessageJobRecord = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
    };

    await this.save(updated);
    return updated;
  }

  private getJobPath(jobId: string): string {
    this.assertValidJobId(jobId);
    return path.join(this.jobsDir, `${jobId}.json`);
  }

  private assertValidJobId(jobId: string): void {
    if (!JOB_ID_PATTERN.test(jobId)) {
      throw new InvalidJobIdError(jobId);
    }
  }
}
