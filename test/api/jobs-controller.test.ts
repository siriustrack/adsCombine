import { describe, expect, test } from 'bun:test'
import type { ProcessMessageJobService } from '../../src/core/services/jobs/process-message-job.service'
import { JobNotFoundError } from '../../src/core/services/jobs/json-job-store.service'
import type { ProcessMessageJobRecord } from '../../src/core/services/jobs/job.types'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'

const jobId = '00000000-0000-4000-8000-000000000000'
const now = '2026-09-03T00:00:00.000Z'

function createJob(overrides: Partial<ProcessMessageJobRecord> = {}): ProcessMessageJobRecord {
  return {
    id: jobId,
    type: 'process-message',
    status: 'completed',
    request: [{ conversationId: 'conv-1', body: { files: [] } }],
    host: 'localhost:3000',
    protocol: 'http',
    createdAt: now,
    updatedAt: now,
    result: {
      conversationId: 'conv-1',
      processedFiles: ['file-1'],
      failedFiles: [],
      filename: 'conv-1.txt',
      downloadUrl: 'http://localhost:3000/texts/conv-1/conv-1.txt',
    },
    ...overrides,
  }
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
}

function createRequest(body: unknown = undefined) {
  return {
    body,
    params: { jobId },
    protocol: 'http',
    get: (header: string) => (header === 'host' ? 'localhost:3000' : undefined),
  }
}

async function createController(job: ProcessMessageJobRecord | Error) {
  const { JobsController } = await import('../../src/api/controllers/jobs.controllers')
  const createCalls: Parameters<Pick<ProcessMessageJobService, 'create'>['create']>[] = []
  const controller = new JobsController({
    create: async input => {
      createCalls.push([input])
      return job instanceof Error ? Promise.reject(job) : { ...job, ...input, request: input.messages }
    },
    get: async () => {
      if (job instanceof Error) throw job
      return job
    },
  })

  return { controller, createCalls }
}

describe('JobsController', () => {
  test('keeps the standard create contract unchanged', async () => {
    const { controller, createCalls } = await createController(createJob({ status: 'queued' }))
    const response = createResponse()

    await controller.createProcessMessageJobHandler(
      createRequest({ conversationId: 'conv-1', body: { files: [] } }) as never,
      response as never
    )

    expect(response.statusCode).toBe(202)
    expect(response.body).toEqual({
      jobId,
      status: 'queued',
      statusUrl: `http://localhost:3000/api/jobs/${jobId}/status`,
      resultUrl: `http://localhost:3000/api/jobs/${jobId}/result`,
      createdAt: now,
    })
    expect(createCalls[0][0].profile).toBeUndefined()
  })

  test('creates enhanced jobs with an enhanced result URL', async () => {
    const { controller, createCalls } = await createController(createJob({ status: 'queued' }))
    const response = createResponse()

    await controller.createEnhancedProcessMessageJobHandler(
      createRequest({ conversationId: 'conv-1', body: { files: [] } }) as never,
      response as never
    )

    expect(response.statusCode).toBe(202)
    expect(response.body).toEqual({
      jobId,
      status: 'queued',
      statusUrl: `http://localhost:3000/api/jobs/${jobId}/status`,
      resultUrl: `http://localhost:3000/api/jobs/${jobId}/result/enhanced`,
      createdAt: now,
    })
    expect(createCalls[0][0].profile).toBe('enhanced-ocr')
  })

  test('returns queued and failed enhanced result semantics', async () => {
    const { controller: queuedController } = await createController(
      createJob({ status: 'queued', profile: 'enhanced-ocr' })
    )
    const queuedResponse = createResponse()
    await queuedController.getEnhancedJobResultHandler(createRequest() as never, queuedResponse as never)
    expect(queuedResponse.statusCode).toBe(202)
    expect(queuedResponse.body).toEqual({ jobId, status: 'queued' })

    const { controller: failedController } = await createController(
      createJob({ status: 'failed', profile: 'enhanced-ocr', error: 'OCR failed' })
    )
    const failedResponse = createResponse()
    await failedController.getEnhancedJobResultHandler(createRequest() as never, failedResponse as never)
    expect(failedResponse.statusCode).toBe(200)
    expect(failedResponse.body).toEqual({ jobId, status: 'failed', error: 'OCR failed' })
  })

  test('uses the enhanced result URL in enhanced job status while preserving the standard URL', async () => {
    const { controller: enhancedController } = await createController(
      createJob({ profile: 'enhanced-ocr' })
    )
    const enhancedResponse = createResponse()
    await enhancedController.getJobStatusHandler(createRequest() as never, enhancedResponse as never)
    expect(enhancedResponse.body).toMatchObject({
      resultUrl: `http://localhost:3000/api/jobs/${jobId}/result/enhanced`,
    })

    const { controller: standardController } = await createController(createJob())
    const standardResponse = createResponse()
    await standardController.getJobStatusHandler(createRequest() as never, standardResponse as never)
    expect(standardResponse.body).toMatchObject({
      resultUrl: `http://localhost:3000/api/jobs/${jobId}/result`,
    })
  })

  test('returns the base and enhanced payload for completed enhanced jobs', async () => {
    const { controller } = await createController(
      createJob({
        profile: 'enhanced-ocr',
        enhancedResult: {
          profile: 'enhanced-ocr',
          summary: {
            fileCount: 1,
            pageCount: 1,
            averageConfidence: 0.95,
            totalWordCount: 0,
            warningCount: 0,
          },
          files: [{ fileId: 'file-1', pageQuality: [{ pageNumber: 1, qualityScore: 0.95 }] }],
        },
      })
    )
    const response = createResponse()

    await controller.getEnhancedJobResultHandler(createRequest() as never, response as never)

    expect(response.statusCode).toBe(200)
    expect(response.body).toMatchObject({
      jobId,
      status: 'completed',
      result: {
        conversationId: 'conv-1',
        downloadUrl: 'http://localhost:3000/texts/conv-1/conv-1.txt',
        profile: 'enhanced-ocr',
        summary: expect.objectContaining({ fileCount: 1, pageCount: 1 }),
        files: [{ fileId: 'file-1' }],
      },
    })
  })

  test('rejects standard jobs and reports missing enhanced jobs', async () => {
    const { controller: standardController } = await createController(createJob())
    const standardResponse = createResponse()
    await standardController.getEnhancedJobResultHandler(createRequest() as never, standardResponse as never)
    expect(standardResponse.statusCode).toBe(409)
    expect(standardResponse.body).toEqual({ error: 'Job is not an enhanced OCR job' })

    const { controller: missingController } = await createController(new JobNotFoundError(jobId))
    const missingResponse = createResponse()
    await missingController.getEnhancedJobResultHandler(createRequest() as never, missingResponse as never)
    expect(missingResponse.statusCode).toBe(404)
    expect(missingResponse.body).toEqual({ error: 'Job not found' })
  })
})
