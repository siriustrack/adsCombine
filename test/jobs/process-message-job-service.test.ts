import { beforeEach, describe, expect, test } from 'bun:test';
import type { ProcessMessagesResponse } from '../../src/core/services/messages/process-messages.service';
import { ProcessMessageJobService } from '../../src/core/services/jobs/process-message-job.service';
import type { ProcessMessageJobRecord } from '../../src/core/services/jobs/job.types';
import type { JsonJobStoreService } from '../../src/core/services/jobs/json-job-store.service';

process.env.BASE_URL = 'http://localhost:3000';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_MODEL_TEXT = 'gpt-test';
process.env.JOBS_MAX_CONCURRENCY = '1';
process.env.JOBS_MAX_QUEUE_SIZE = '10';
process.env.JOB_STALE_AFTER_MS = '10000';

type MockProcessOptions = {
  includeReadableErrorBlocks?: boolean;
  pdfMode?: 'legacy' | 'mixed-page';
  limits?: Record<string, number | undefined>;
};

type ProcessorCall = [
  {
    messages: ProcessMessageJobRecord['request'];
    host: string;
    protocol: string;
  },
  MockProcessOptions?,
];

class MockJobStore {
  private readonly records = new Map<string, ProcessMessageJobRecord>();
  private nextId = 1;

  createJobId(): string {
    return `job-${this.nextId++}`;
  }

  async save(record: ProcessMessageJobRecord): Promise<ProcessMessageJobRecord> {
    this.records.set(record.id, { ...record });
    return record;
  }

  async get(jobId: string): Promise<ProcessMessageJobRecord> {
    const record = this.records.get(jobId);
    if (!record) throw new Error('Job not found');
    return record;
  }

  async update(
    jobId: string,
    patch: Partial<ProcessMessageJobRecord>
  ): Promise<ProcessMessageJobRecord> {
    const record = await this.get(jobId);
    const updated = { ...record, ...patch, updatedAt: new Date().toISOString() };
    this.records.set(jobId, updated);
    return updated;
  }

  async expireStaleJobs(): Promise<number> {
    return 0;
  }

  async deleteFinishedOlderThan(): Promise<number> {
    return 0;
  }
}

class MockProcessor {
  calls: ProcessorCall[] = [];

  async execute(...args: ProcessorCall): Promise<ProcessMessagesResponse> {
    this.calls.push(args);
    return {
      conversationId: 'conv-1',
      processedFiles: ['file-1'],
      failedFiles: [],
      filename: 'conv-1.txt',
      downloadUrl: 'http://localhost:3000/conv-1.txt',
    };
  }
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }

      if (Date.now() - startedAt > 1000) {
        clearInterval(timer);
        reject(new Error('Timed out waiting for predicate'));
      }
    }, 5);
  });
}

function waitForAsync(predicate: () => Promise<boolean>): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      void predicate()
        .then((matched) => {
          if (matched) {
            clearInterval(timer);
            resolve();
            return;
          }

          if (Date.now() - startedAt > 1000) {
            clearInterval(timer);
            reject(new Error('Timed out waiting for async predicate'));
          }
        })
        .catch((error: unknown) => {
          clearInterval(timer);
          reject(error);
        });
    }, 5);
  });
}

describe('ProcessMessageJobService', () => {
  let store: MockJobStore;
  let processor: MockProcessor;
  let service: ProcessMessageJobService;

  beforeEach(() => {
    store = new MockJobStore();
    processor = new MockProcessor();
    service = new ProcessMessageJobService(
      store as unknown as JsonJobStoreService,
      processor as unknown as ConstructorParameters<typeof ProcessMessageJobService>[1]
    );
  });

  test('uses the default PDF processing mode for jobs', async () => {
    const job = await service.create({
      host: 'localhost:3000',
      protocol: 'http',
      messages: [
        {
          conversationId: 'conv-1',
          body: {
            files: [
              {
                fileId: 'file-1',
                url: 'https://example.com/file.pdf',
                mimeType: 'application/pdf',
              },
            ],
          },
        },
      ],
    });

    await waitFor(() => processor.calls.length === 1);

    const [, options] = processor.calls[0];
    expect(options).toMatchObject({
      includeReadableErrorBlocks: true,
      limits: expect.objectContaining({ maxFiles: expect.any(Number) }),
    });
    expect(options?.pdfMode).toBeUndefined();

    await waitForAsync(async () => (await store.get(job.id)).status === 'completed');
  });
});
