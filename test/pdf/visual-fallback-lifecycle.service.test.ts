import { describe, expect, test } from 'bun:test'
import { environmentBoolean } from '../../src/config/env'
import { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'
import { VisualTranscriptionTerminalError } from '../../src/core/services/messages/pdf-utils/visual-fallback.types'
import {
  createVisualFallbackService as createService,
  visualFallbackPage as page,
} from './visual-fallback.test-support'

describe('VisualFallbackService', () => {
  test('parses explicit environment false values as disabled', () => {
    expect(environmentBoolean.parse('false')).toBe(false)
    expect(environmentBoolean.parse('true')).toBe(true)
  })

  test('does not render or call a provider while the kill switch is off', async () => {
    let rendered = 0
    let calls = 0
    const service = new VisualFallbackService(
      {
        async renderPages() {
          rendered++
          return []
        },
      },
      {
        async transcribe() {
          calls++
          return { status: 'transcribed', transcription: 'ignored' }
        },
      },
      {
        enabled: false,
        shadowMode: true,
        contextualPairingShadowEnabled: false,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        timeoutMs: 20,
        maxRetries: 0,
        concurrency: 1,
        maxAlignmentCells: 10_000_000,
        maxPagesPerPdf: 1,
      }
    )
    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
    })
    expect(rendered).toBe(0)
    expect(calls).toBe(0)
    expect(result).toMatchObject({ enabled: false, selectedPageCount: 0 })
    expect(result.byPage.get(1)).toEqual({
      state: 'ocr_only',
      reasons: [],
      offsetEncoding: 'utf16_code_units',
    })
  })

  test('records provider abstention and failures without exposing source content', async () => {
    const { service } = createService({
      async transcribe({ pageNumber }) {
        if (pageNumber === 1) return { status: 'abstain' }
        throw new Error('provider unavailable')
      },
    })
    const first = page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })
    const second = page({
      pageNumber: 2,
      legalSignals: { ...page().legalSignals, garbledSpans: 1 },
    })
    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [first, second],
    })
    expect(result.byPage.get(1)).toEqual({
      state: 'fallback_failed',
      reasons: ['corrupted-symbols'],
      offsetEncoding: 'utf16_code_units',
    })
    expect(result.byPage.get(2)).toEqual({
      state: 'fallback_failed',
      reasons: ['garbled-spans'],
      offsetEncoding: 'utf16_code_units',
    })
  })

  test('aborts active provider work without starting retries after external cancellation', async () => {
    const controller = new AbortController()
    let calls = 0
    let providerStarted!: () => void
    const started = new Promise<void>(resolve => {
      providerStarted = resolve
    })
    const { service } = createService(
      {
        async transcribe({ signal }) {
          calls++
          providerStarted()
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        },
      },
      { maxRetries: 1 }
    )
    const resultPromise = service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
      signal: controller.signal,
    })
    await started
    controller.abort(new Error('global processing timeout'))
    const result = await resultPromise
    expect(calls).toBe(1)
    expect(result.byPage.get(1)).toMatchObject({ state: 'fallback_failed' })
  })

  test('passes the external cancellation signal to the renderer', async () => {
    const controller = new AbortController()
    let rendererSignal: AbortSignal | undefined
    const service = new VisualFallbackService(
      {
        async renderPages(_buffer, pageNumbers, signal) {
          rendererSignal = signal
          return pageNumbers.map(pageNumber => ({
            pageNumber,
            image: Buffer.from(`page-${pageNumber}`),
          }))
        },
      },
      {
        async transcribe() {
          return { status: 'abstain' }
        },
      },
      {
        enabled: true,
        shadowMode: true,
        contextualPairingShadowEnabled: false,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        timeoutMs: 20,
        maxRetries: 0,
        concurrency: 1,
        maxAlignmentCells: 10_000_000,
        maxPagesPerPdf: 1,
      }
    )
    await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
      signal: controller.signal,
    })
    expect(rendererSignal).toBe(controller.signal)
  })

  test('does not retry a deterministic abnormal Gemini completion', async () => {
    let calls = 0
    const { service } = createService(
      {
        async transcribe() {
          calls++
          throw new VisualTranscriptionTerminalError('Gemini abnormal completion: MAX_TOKENS')
        },
      },
      { reconciliationPolicyVersion: 'gemini-whole-page-critical-v2', maxRetries: 3 }
    )
    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
    })
    expect(calls).toBe(1)
    expect(result.byPage.get(1)).toMatchObject({
      outcome: 'unavailable',
      decisionReason: 'provider_failed',
    })
  })
})
