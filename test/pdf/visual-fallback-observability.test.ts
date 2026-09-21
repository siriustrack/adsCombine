import { describe, expect, test } from 'bun:test'
import logger from '../../src/lib/logger'
import { createVisualFallbackService, visualFallbackPage } from './visual-fallback.test-support'

const RENDERING_MESSAGE = 'Visual fallback rendering completed'
const PAGE_PROCESSING_MESSAGE = 'Visual fallback page processing completed'

function captureTimingLogs(): Readonly<{
  events: unknown[]
  stop: () => void
}> {
  const events: unknown[] = []
  const capture = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || !('message' in value)) return
    if (value.message === RENDERING_MESSAGE || value.message === PAGE_PROCESSING_MESSAGE) {
      events.push(value)
    }
  }
  logger.on('data', capture)
  return { events, stop: () => logger.off('data', capture) }
}

function eventByMessage(events: unknown[], message: string): Record<string, unknown> | undefined {
  return events.find(
    (event): event is Record<string, unknown> =>
      typeof event === 'object' && event !== null && 'message' in event && event.message === message
  )
}

describe('visual fallback observability', () => {
  test('emits correlated rendering and page phase timings without document content', async () => {
    const { service } = createVisualFallbackService(
      {
        async transcribe() {
          return {
            status: 'transcribed',
            transcription: 'Matrícula nº 12.346\nR.22\nÁrea 408.737 m²',
          }
        },
      },
      { reconciliationPolicyVersion: 'gemini-whole-page-critical-v2' }
    )
    const capture = captureTimingLogs()

    try {
      await service.execute({
        buffer: Buffer.from('pdf'),
        fileId: 'file-observability',
        fileName: 'private-document.pdf',
        pages: [
          visualFallbackPage({
            legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
          }),
        ],
      })
    } finally {
      capture.stop()
    }

    const rendering = eventByMessage(capture.events, RENDERING_MESSAGE)
    expect(rendering).toMatchObject({
      fileId: 'file-observability',
      selectedPageCount: 1,
      renderedPageCount: 1,
    })
    expect(rendering?.durationMs).toBeNumber()

    const pageProcessing = eventByMessage(capture.events, PAGE_PROCESSING_MESSAGE)
    expect(pageProcessing).toMatchObject({
      fileId: 'file-observability',
      pageNumber: 1,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      transcriptionOutcome: 'transcribed',
      visualOutcome: 'selected',
      decisionReason: 'gemini_whole_page_selected',
    })
    expect(pageProcessing?.transcriptionDurationMs).toBeNumber()
    expect(pageProcessing?.reconciliationDurationMs).toBeNumber()
    expect(pageProcessing?.totalDurationMs).toBeNumber()
    expect(pageProcessing).not.toHaveProperty('fileName')
    expect(pageProcessing).not.toHaveProperty('text')
    expect(pageProcessing).not.toHaveProperty('transcription')
  })
})
