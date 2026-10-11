import { expect, test } from 'bun:test'
import { Writable } from 'node:stream'
import winston from 'winston'
import logger from '../../src/lib/logger'
import { processingContext } from '../../src/lib/processing-context'

test('correlates concurrent file and page events without leaking job context', async () => {
  // Given: the actual logger receives two overlapping asynchronous job contexts.
  const events: Array<{ jobId?: string; fileId?: string; pageNumber?: number }> = []
  const firstEntered = Promise.withResolvers<void>()
  const releaseFirst = Promise.withResolvers<void>()
  const finished = Promise.withResolvers<void>()
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      const value = JSON.parse(String(chunk))
      if (value.event === 'processing-context-test') {
        events.push(value)
        if (events.length === 3) finished.resolve()
      }
      callback()
    },
  })
  const transport = new winston.transports.Stream({ stream })
  logger.add(transport)
  try {
    const first = processingContext.run({ jobId: 'first-job' }, async () => {
      firstEntered.resolve()
      await releaseFirst.promise
      logger.info('Page processed', {
        event: 'processing-context-test',
        fileId: 'first-file',
        pageNumber: 2,
      })
    })
    await firstEntered.promise
    // When: another job logs before the first job resumes, then a non-job event logs.
    processingContext.run({ jobId: 'second-job' }, () => {
      logger.info('File processed', { event: 'processing-context-test', fileId: 'second-file' })
    })
    releaseFirst.resolve()
    await first
    logger.info('Outside job', { event: 'processing-context-test' })
    await finished.promise
    // Then: correlation survives suspension and never crosses job boundaries.
    expect(events[0]).toMatchObject({ jobId: 'second-job', fileId: 'second-file' })
    expect(events[1]).toMatchObject({ jobId: 'first-job', fileId: 'first-file', pageNumber: 2 })
    expect(events[2]).not.toHaveProperty('jobId')
    expect(processingContext.getStore()).toBeUndefined()
  } finally {
    releaseFirst.resolve()
    logger.remove(transport)
    stream.destroy()
  }
})
