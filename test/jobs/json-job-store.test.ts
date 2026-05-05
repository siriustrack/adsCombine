import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProcessMessageJobRecord } from '../../src/core/services/jobs/job.types';
import {
  InvalidJobIdError,
  JobNotFoundError,
  JsonJobStoreService,
} from '../../src/core/services/jobs/json-job-store.service';

let tempDir: string | undefined;

async function createStore() {
  tempDir = await mkdtemp(path.join(tmpdir(), 'adscombine-jobs-'));
  return new JsonJobStoreService(tempDir);
}

function createRecord(id: string): ProcessMessageJobRecord {
  const now = new Date().toISOString();

  return {
    id,
    type: 'process-message',
    status: 'queued',
    request: [{ conversationId: 'conv-1', body: { files: [] } }],
    host: 'localhost:3000',
    protocol: 'http',
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('JsonJobStoreService', () => {
  test('saves and reads process-message jobs', async () => {
    const store = await createStore();
    const jobId = store.createJobId();
    const record = createRecord(jobId);

    await store.save(record);

    expect(await store.get(jobId)).toEqual(record);
  });

  test('updates status and completed result with downloadUrl', async () => {
    const store = await createStore();
    const jobId = store.createJobId();

    await store.save(createRecord(jobId));
    const updated = await store.update(jobId, {
      status: 'completed',
      result: {
        conversationId: 'conv-1',
        processedFiles: ['file-1'],
        failedFiles: [],
        filename: 'conv-1.txt',
        downloadUrl: 'http://localhost:3000/texts/conv-1/conv-1.txt',
      },
    });

    expect(updated.status).toBe('completed');
    expect(updated.result?.downloadUrl).toContain('/texts/conv-1/conv-1.txt');
  });

  test('rejects invalid job ids to prevent path traversal', async () => {
    const store = await createStore();

    await expect(store.get('../secret')).rejects.toBeInstanceOf(InvalidJobIdError);
  });

  test('returns a typed not found error for missing jobs', async () => {
    const store = await createStore();

    await expect(store.get(store.createJobId())).rejects.toBeInstanceOf(JobNotFoundError);
  });

  test('expires stale queued and processing jobs', async () => {
    const store = await createStore();
    const queuedJobId = store.createJobId();
    const processingJobId = store.createJobId();
    const oldDate = new Date(Date.now() - 60_000).toISOString();

    await store.save({ ...createRecord(queuedJobId), createdAt: oldDate, updatedAt: oldDate });
    await store.save({
      ...createRecord(processingJobId),
      status: 'processing',
      createdAt: oldDate,
      updatedAt: oldDate,
      startedAt: oldDate,
    });

    expect(await store.expireStaleJobs(1_000)).toBe(2);
    expect((await store.get(queuedJobId)).status).toBe('expired');
    expect((await store.get(processingJobId)).status).toBe('expired');
  });

  test('deletes finished jobs older than retention window', async () => {
    const store = await createStore();
    const oldCompletedJobId = store.createJobId();
    const recentCompletedJobId = store.createJobId();
    const activeJobId = store.createJobId();
    const oldDate = new Date(Date.now() - 60_000).toISOString();
    const recentDate = new Date().toISOString();

    await store.save({
      ...createRecord(oldCompletedJobId),
      status: 'completed',
      updatedAt: oldDate,
      finishedAt: oldDate,
    });
    await store.save({
      ...createRecord(recentCompletedJobId),
      status: 'completed',
      updatedAt: recentDate,
      finishedAt: recentDate,
    });
    await store.save({ ...createRecord(activeJobId), updatedAt: oldDate });

    expect(await store.deleteFinishedOlderThan(1_000)).toBe(1);
    await expect(store.get(oldCompletedJobId)).rejects.toBeInstanceOf(JobNotFoundError);
    expect((await store.get(recentCompletedJobId)).status).toBe('completed');
    expect((await store.get(activeJobId)).status).toBe('queued');
  });
});
