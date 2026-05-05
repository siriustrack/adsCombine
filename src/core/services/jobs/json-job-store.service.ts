import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JOBS_DIR } from '@config/dirs';
import logger from '@lib/logger';
import type { JobStatus, ProcessMessageJobRecord } from './job.types';

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

  async list(): Promise<ProcessMessageJobRecord[]> {
    await fs.mkdir(this.jobsDir, { recursive: true });

    const entries = await fs.readdir(this.jobsDir, { withFileTypes: true });
    const jobs: ProcessMessageJobRecord[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const jobId = entry.name.replace(/\.json$/, '');
      if (!JOB_ID_PATTERN.test(jobId)) {
        continue;
      }

      try {
        jobs.push(await this.get(jobId));
      } catch (error) {
        logger.warn('Skipping unreadable job file', { jobId, error: (error as Error).message });
      }
    }

    return jobs;
  }

  async delete(jobId: string): Promise<void> {
    this.assertValidJobId(jobId);

    try {
      await fs.unlink(this.getJobPath(jobId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }

      throw error;
    }
  }

  async deleteFinishedOlderThan(retentionMs: number): Promise<number> {
    const cutoff = Date.now() - retentionMs;
    const removableStatuses = new Set<JobStatus>(['completed', 'failed', 'expired']);
    const jobs = await this.list();
    let deleted = 0;

    for (const job of jobs) {
      if (!removableStatuses.has(job.status)) {
        continue;
      }

      const referenceDate = job.finishedAt ?? job.updatedAt;
      if (Date.parse(referenceDate) >= cutoff) {
        continue;
      }

      await this.delete(job.id);
      deleted++;
    }

    return deleted;
  }

  async expireStaleJobs(staleAfterMs: number): Promise<number> {
    const cutoff = Date.now() - staleAfterMs;
    const jobs = await this.list();
    let expired = 0;

    for (const job of jobs) {
      if (job.status !== 'queued' && job.status !== 'processing') {
        continue;
      }

      const referenceDate = job.startedAt ?? job.updatedAt ?? job.createdAt;
      if (Date.parse(referenceDate) >= cutoff) {
        continue;
      }

      await this.update(job.id, {
        status: 'expired',
        error: `Job expirado apos ${staleAfterMs}ms sem conclusao`,
        finishedAt: new Date().toISOString(),
      });
      expired++;
    }

    return expired;
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
