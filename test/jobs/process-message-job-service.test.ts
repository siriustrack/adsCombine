import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { env } from '../../src/config/env'
import type { ProcessMessagesResponse } from '../../src/core/services/messages/process-messages.service'
import { ProcessMessageJobService } from '../../src/core/services/jobs/process-message-job.service'
import type { ProcessMessageJobRecord } from '../../src/core/services/jobs/job.types'
import type { JsonJobStoreService } from '../../src/core/services/jobs/json-job-store.service'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'
process.env.JOBS_MAX_CONCURRENCY = '1'
process.env.JOBS_MAX_QUEUE_SIZE = '10'
process.env.JOB_STALE_AFTER_MS = '10000'

type MockProcessOptions = {
  signal?: AbortSignal
  includeReadableErrorBlocks?: boolean
  pdfMode?: 'legacy' | 'mixed-page'
  enhancedOcr?: boolean
  limits?: Record<string, number | undefined>
}

type ProcessorCall = [
  {
    messages: ProcessMessageJobRecord['request']
    host: string
    protocol: string
  },
  MockProcessOptions?,
]

class MockJobStore {
  private readonly records = new Map<string, ProcessMessageJobRecord>()
  private readonly statusWaiters = new Map<
    string,
    Array<{
      status: ProcessMessageJobRecord['status']
      resolve: (record: ProcessMessageJobRecord) => void
    }>
  >()
  private nextId = 1

  createJobId(): string {
    return `job-${this.nextId++}`
  }

  async save(record: ProcessMessageJobRecord): Promise<ProcessMessageJobRecord> {
    this.records.set(record.id, { ...record })
    return record
  }

  async get(jobId: string): Promise<ProcessMessageJobRecord> {
    const record = this.records.get(jobId)
    if (!record) throw new Error('Job not found')
    return record
  }

  async update(
    jobId: string,
    patch: Partial<ProcessMessageJobRecord>
  ): Promise<ProcessMessageJobRecord> {
    const record = await this.get(jobId)
    const updated = { ...record, ...patch, updatedAt: new Date().toISOString() }
    this.records.set(jobId, updated)
    const waiters = this.statusWaiters.get(jobId) ?? []
    const pending = waiters.filter(({ status, resolve }) => {
      if (status !== updated.status) return true
      resolve(updated)
      return false
    })
    if (pending.length > 0) this.statusWaiters.set(jobId, pending)
    else this.statusWaiters.delete(jobId)
    return updated
  }

  waitForStatus(
    jobId: string,
    status: ProcessMessageJobRecord['status']
  ): Promise<ProcessMessageJobRecord> {
    const record = this.records.get(jobId)
    if (record?.status === status) return Promise.resolve(record)
    return new Promise(resolve => {
      const waiters = this.statusWaiters.get(jobId) ?? []
      waiters.push({ status, resolve })
      this.statusWaiters.set(jobId, waiters)
    })
  }

  async expireStaleJobs(): Promise<number> {
    return 0
  }

  async deleteFinishedOlderThan(): Promise<number> {
    return 0
  }
}

class MockProcessor {
  calls: ProcessorCall[] = []

  async execute(...args: ProcessorCall): Promise<ProcessMessagesResponse> {
    this.calls.push(args)
    return {
      conversationId: 'conv-1',
      processedFiles: ['file-1'],
      failedFiles: [],
      filename: 'conv-1.txt',
      downloadUrl: 'http://localhost:3000/conv-1.txt',
      downloadExpiresAt: '2026-09-03T00:15:00.000Z',
    }
  }
}

const originalJobTimeout = env.JOB_STALE_AFTER_MS

afterEach(() => {
  Object.defineProperty(env, 'JOB_STALE_AFTER_MS', {
    value: originalJobTimeout,
    configurable: true,
  })
})

function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('ProcessMessageJobService', () => {
  let store: MockJobStore
  let processor: MockProcessor
  let service: ProcessMessageJobService

  beforeEach(() => {
    store = new MockJobStore()
    processor = new MockProcessor()
    service = new ProcessMessageJobService(
      store as unknown as JsonJobStoreService,
      processor as unknown as ConstructorParameters<typeof ProcessMessageJobService>[1]
    )
  })

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
    })

    await store.waitForStatus(job.id, 'completed')

    const [, options] = processor.calls[0]
    expect(options).toMatchObject({
      includeReadableErrorBlocks: true,
      limits: expect.objectContaining({ maxFiles: expect.any(Number) }),
    })
    expect(options?.pdfMode).toBeUndefined()
  })

  test('persists the enhanced OCR profile and preserves the base result', async () => {
    const job = await service.create({
      host: 'localhost:3000',
      protocol: 'http',
      profile: 'enhanced-ocr',
      messages: [{ conversationId: 'conv-1', body: { files: [] } }],
    })

    await store.waitForStatus(job.id, 'completed')

    const completed = await store.get(job.id)
    expect(completed.profile).toBe('enhanced-ocr')
    expect(completed.result).toEqual({
      conversationId: 'conv-1',
      processedFiles: ['file-1'],
      failedFiles: [],
      filename: 'conv-1.txt',
    })
    expect(completed.enhancedResult).toEqual({
      schemaVersion: 'enhanced-ocr/v2',
      profile: 'enhanced-ocr',
      summary: {
        fileCount: 0,
        pageCount: 0,
        averageConfidence: undefined,
        totalWordCount: 0,
        warningCount: 0,
        metricsSource: 'ocr',
        warningPageCount: 0,
        warningsByType: {},
        textSelection: {
          nativeFileCount: 0,
          enhancedFileCount: 0,
          byReason: {
            ocr_empty: 0,
            ocr_failed: 0,
            ocr_materially_less_complete: 0,
            ocr_lost_legal_marker: 0,
            enhanced_selected: 0,
          },
        },
        visual: {
          eligiblePageCount: 0,
          admittedPageCount: 0,
          renderAttemptedPageCount: 0,
          providerAttemptedPageCount: 0,
          selectedVisualPageCount: 0,
          reconciledPageCount: 0,
          shadowPageCount: 0,
          conflictPageCount: 0,
          unavailablePageCount: 0,
          budgetSkippedPageCount: 0,
          budgetSkippedByScope: { pdf: 0, job: 0 },
          filesByStatus: {
            evaluated: 0,
            disabled: 0,
            native_preserved: 0,
            aborted: 0,
          },
        },
      },
      files: [],
    })
    expect(processor.calls[0][1]).toMatchObject({ enhancedOcr: true })
    expect(processor.calls[0][1]?.pdfMode).toBeUndefined()
  })

  test('summarizes text selection, warnings, and visual outcomes', async () => {
    const detailedProcessor = {
      async execute(): Promise<ProcessMessagesResponse> {
        return {
          conversationId: 'conv-1',
          processedFiles: ['file-native', 'file-enhanced'],
          failedFiles: [],
          filename: 'conv-1.txt',
          downloadUrl: 'http://localhost:3000/texts/conv-1/conv-1.txt?v=1&exp=1&sig=x',
          downloadExpiresAt: '2026-09-03T00:15:00.000Z',
          enhancedResult: {
            files: [
              {
                fileId: 'file-native',
                pageCount: 2,
                metricsSource: 'ocr',
                textSelection: {
                  source: 'native',
                  reason: 'ocr_lost_legal_marker',
                  nativeLength: 2_000,
                  enhancedLength: 1_900,
                  pageMapping: 'unavailable',
                },
                visualFallbackSummary: {
                  status: 'native_preserved',
                  eligiblePageCount: 0,
                  admittedPageCount: 0,
                  renderAttemptedPageCount: 0,
                  providerAttemptedPageCount: 0,
                  selectedVisualPageCount: 0,
                  reconciledPageCount: 0,
                  shadowPageCount: 0,
                  conflictPageCount: 0,
                  unavailablePageCount: 0,
                  budgetSkippedPageCount: 0,
                  budgetSkippedByScope: { pdf: 0, job: 0 },
                },
                pageQuality: [
                  { pageNumber: 1, confidence: 90, wordCount: 10 },
                  {
                    pageNumber: 2,
                    confidence: 70,
                    wordCount: 5,
                    warnings: ['garbled-spans'],
                  },
                ],
              },
              {
                fileId: 'file-enhanced',
                pageCount: 1,
                metricsSource: 'ocr',
                textSelection: {
                  source: 'enhanced',
                  reason: 'enhanced_selected',
                  nativeLength: 20,
                  enhancedLength: 200,
                  pageMapping: 'complete',
                },
                visualFallbackSummary: {
                  status: 'evaluated',
                  eligiblePageCount: 2,
                  admittedPageCount: 1,
                  renderAttemptedPageCount: 1,
                  providerAttemptedPageCount: 1,
                  selectedVisualPageCount: 1,
                  reconciledPageCount: 1,
                  shadowPageCount: 0,
                  conflictPageCount: 0,
                  unavailablePageCount: 0,
                  budgetSkippedPageCount: 1,
                  budgetSkippedByScope: { pdf: 1, job: 0 },
                },
                pageQuality: [
                  {
                    pageNumber: 1,
                    confidence: 80,
                    wordCount: 20,
                    warnings: ['garbled-spans', 'fragmented-number-or-measure'],
                  },
                ],
              },
            ],
          },
        }
      },
    }
    const detailedService = new ProcessMessageJobService(
      store as unknown as JsonJobStoreService,
      detailedProcessor as unknown as ConstructorParameters<typeof ProcessMessageJobService>[1]
    )
    const job = await detailedService.create({
      host: 'localhost:3000',
      protocol: 'http',
      profile: 'enhanced-ocr',
      messages: [{ conversationId: 'conv-1', body: { files: [] } }],
    })

    const completed = await store.waitForStatus(job.id, 'completed')

    expect(completed.enhancedResult?.summary).toEqual({
      fileCount: 2,
      pageCount: 3,
      averageConfidence: 80,
      totalWordCount: 35,
      warningCount: 3,
      metricsSource: 'ocr',
      warningPageCount: 2,
      warningsByType: {
        'garbled-spans': 2,
        'fragmented-number-or-measure': 1,
      },
      textSelection: {
        nativeFileCount: 1,
        enhancedFileCount: 1,
        byReason: {
          ocr_empty: 0,
          ocr_failed: 0,
          ocr_materially_less_complete: 0,
          ocr_lost_legal_marker: 1,
          enhanced_selected: 1,
        },
      },
      visual: {
        eligiblePageCount: 2,
        admittedPageCount: 1,
        renderAttemptedPageCount: 1,
        providerAttemptedPageCount: 1,
        selectedVisualPageCount: 1,
        reconciledPageCount: 1,
        shadowPageCount: 0,
        conflictPageCount: 0,
        unavailablePageCount: 0,
        budgetSkippedPageCount: 1,
        budgetSkippedByScope: { pdf: 1, job: 0 },
        filesByStatus: {
          evaluated: 1,
          disabled: 0,
          native_preserved: 1,
          aborted: 0,
        },
      },
    })
  })

  test('aborts processing when the job timeout expires', async () => {
    Object.defineProperty(env, 'JOB_STALE_AFTER_MS', { value: 5, configurable: true })
    const processingStarted = createDeferred<AbortSignal>()
    const abortingProcessor = {
      async execute(
        _input: ProcessorCall[0],
        options?: MockProcessOptions
      ): Promise<ProcessMessagesResponse> {
        const signal = options?.signal
        if (!signal) throw new Error('Expected job abort signal')
        processingStarted.resolve(signal)
        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
        })
      },
    }
    const abortingService = new ProcessMessageJobService(
      store as unknown as JsonJobStoreService,
      abortingProcessor as unknown as ConstructorParameters<typeof ProcessMessageJobService>[1]
    )

    const job = await abortingService.create({
      host: 'localhost:3000',
      protocol: 'http',
      messages: [{ conversationId: 'conv-1', body: { files: [] } }],
    })

    const signal = await processingStarted.promise
    await store.waitForStatus(job.id, 'expired')
    expect(signal.aborted).toBe(true)
  })
})
