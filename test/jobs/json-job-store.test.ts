import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InvalidJobIdError, JsonJobStoreService, JobNotFoundError } from '../../src/core/services/jobs/json-job-store.service';
import type { ProcessMessageJobRecord } from '../../src/core/services/jobs/job.types';

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
});
