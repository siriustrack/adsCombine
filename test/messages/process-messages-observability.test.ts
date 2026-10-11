import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { Writable } from 'node:stream'
import winston from 'winston'
import { TEXTS_DIR } from '../../src/config/dirs'
import { ProcessMessagesService } from '../../src/core/services/messages/process-messages.service'
import logger from '../../src/lib/logger'
import { processingContext } from '../../src/lib/processing-context'
import { okResult } from '../../src/lib/result.types'

test('correlates actual file and page metrics without source content', async () => {
  // Given: the real dispatcher receives page metadata from its PDF boundary.
  const conversationId = `metrics-${randomUUID()}`
  const jobId = randomUUID()
  const fileId = randomUUID()
  const content = 'synthetic-private-content-marker'
  const events: Record<string, unknown>[] = []
  const observed = Promise.withResolvers<void>()
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const value = JSON.parse(String(chunk))
      if (
        value.jobId === jobId &&
        value.fileId === fileId &&
        (typeof value.pageNumber === 'number' || typeof value.processingMs === 'number')
      ) {
        events.push(value)
        if (events.length === 2) observed.resolve()
      }
      callback()
    },
  })
  const transport = new winston.transports.Stream({ stream, level: 'debug' })
  const previousLevel = logger.level
  logger.level = 'debug'
  logger.add(transport)
  const service = new ProcessMessagesService({
    async execute() {
      throw new Error('Expected enhanced path')
    },
    async executeEnhanced(_file, options) {
      options?.onEnhancedMetadata?.({
        fileId,
        pageQuality: [
          {
            pageNumber: 1,
            confidence: 95,
            wordCount: 10,
            selectedAttempt: { label: 'orig', psm: 6 },
          },
        ],
      })
      return okResult(content)
    },
  })
  try {
    // When: dispatch runs within an actual job correlation scope.
    const result = await processingContext.run({ jobId }, () =>
      service.execute(
        {
          host: 'localhost:3000',
          protocol: 'http',
          messages: [
            {
              conversationId,
              body: {
                files: [
                  {
                    fileId,
                    mimeType: 'application/pdf',
                    url: 'https://example.com/document.pdf?signature=synthetic-secret',
                  },
                ],
              },
            },
          ],
        },
        { enhancedOcr: true }
      )
    )
    await observed.promise
    // Then: joinable metrics report counts/duration, never raw document or credential.
    expect(result.processedFiles).toEqual([fileId])
    expect(events.find(event => event.pageNumber === 1)).toMatchObject({
      jobId,
      fileId,
      confidence: 95,
      wordCount: 10,
    })
    const file = events.find(event => typeof event.processingMs === 'number')
    expect(file).toMatchObject({ jobId, fileId, outcome: 'completed' })
    expect(Number(file?.processingMs)).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(events)).not.toContain(content)
    expect(JSON.stringify(events)).not.toContain('synthetic-secret')
    expect(processingContext.getStore()).toBeUndefined()
  } finally {
    logger.remove(transport)
    logger.level = previousLevel
    stream.destroy()
    await rm(path.join(TEXTS_DIR, conversationId), { recursive: true, force: true })
  }
})
