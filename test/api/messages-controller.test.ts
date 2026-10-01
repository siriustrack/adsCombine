import { describe, expect, test } from 'bun:test'
import type { ProcessMessagesService } from '../../src/core/services/messages/process-messages.service'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'

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

describe('MessagesController legacy processing', () => {
  test('applies job-safe limits to the public legacy process endpoint', async () => {
    const { MessagesController } = await import('../../src/api/controllers/messages.controllers')
    const calls: Parameters<ProcessMessagesService['execute']>[] = []
    const controller = new MessagesController({
      async execute(...args: Parameters<ProcessMessagesService['execute']>) {
        calls.push(args)
        return {
          conversationId: 'legacy-limit-test',
          processedFiles: [],
          failedFiles: [],
          filename: 'legacy-limit-test.txt',
          downloadUrl: 'http://localhost:3000/texts/legacy-limit-test/legacy-limit-test.txt',
          downloadExpiresAt: '2026-09-03T00:15:00.000Z',
        }
      },
    })
    const response = createResponse()

    await controller.processMessagesHandler(
      {
        body: { conversationId: 'legacy-limit-test', body: { files: [] } },
        protocol: 'http',
        get: (header: string) => (header === 'host' ? 'localhost:3000' : undefined),
      } as never,
      response as never
    )

    expect(response.statusCode).toBe(200)
    expect(calls[0][1]?.limits).toEqual({
      maxFileBytes: expect.any(Number),
      maxFiles: expect.any(Number),
      maxPdfPages: expect.any(Number),
      maxOcrPagesPerPdf: expect.any(Number),
      maxTotalOcrPagesPerJob: expect.any(Number),
      maxTotalVisualFallbackPagesPerJob: expect.any(Number),
    })
  })

  test('rejects conversation identifiers that can escape the text directory', async () => {
    const { MessagesController } = await import('../../src/api/controllers/messages.controllers')
    let calls = 0
    const controller = new MessagesController({
      async execute() {
        calls++
        throw new Error('processor must not run')
      },
    })
    const response = createResponse()

    await controller.processMessagesHandler(
      {
        body: { conversationId: '../../escape', body: { files: [] } },
        protocol: 'http',
        get: () => 'localhost:3000',
      } as never,
      response as never
    )

    expect(response.statusCode).toBe(400)
    expect(calls).toBe(0)
  })
})
