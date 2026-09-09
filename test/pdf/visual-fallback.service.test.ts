import { describe, expect, test } from 'bun:test'
import { environmentBoolean } from '../../src/config/env'
import type { EnhancedOcrPageMetadata } from '../../src/core/services/messages/pdf-utils/enhanced-ocr.types'
import {
  VisualFallbackService,
  type VisualTranscriptionProvider,
} from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

function page(
  overrides: Partial<EnhancedOcrPageMetadata> & {
    text?: string
    sourceRange?: { start: number; end: number }
  } = {}
) {
  return {
    pageNumber: 1,
    text: 'Matrícula nº 12.345\nR.22\nÁrea 408.737 m²',
    meanConfidence: 98,
    wordCount: 12,
    selectedAttempt: { label: 'orig', psm: 4 },
    legalSignals: {
      registryMarkers: 2,
      legalMarkers: 0,
      cpfCnpj: 0,
      dates: 0,
      currency: 0,
      fractions: 0,
      squareMeters: 1,
      corruptedSymbols: 0,
      fragmentedNumbersOrMeasures: 0,
      duplicateLabels: 0,
      garbledSpans: 0,
    },
    warnings: [],
    ...overrides,
  }
}

function createService(
  provider: VisualTranscriptionProvider,
  options: Partial<ConstructorParameters<typeof VisualFallbackService>[2]> = {}
) {
  const renderedPages: number[][] = []
  const service = new VisualFallbackService(
    {
      async renderPages(_buffer, pageNumbers) {
        renderedPages.push(pageNumbers)
        return pageNumbers.map(pageNumber => ({
          pageNumber,
          image: Buffer.from(`page-${pageNumber}`),
        }))
      },
    },
    provider,
    {
      enabled: true,
      shadowMode: false,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 1,
      concurrency: 1,
      maxPagesPerPdf: 2,
      ...options,
    }
  )

  return { service, renderedPages }
}

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
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        timeoutMs: 20,
        maxRetries: 0,
        concurrency: 1,
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

  test('selects the R.22/408.737 m² regression page from fragmented measure signals, not confidence', async () => {
    let calls = 0
    const { service, renderedPages } = createService({
      async transcribe() {
        calls++
        return { status: 'transcribed', transcription: 'R.22\nÁrea 408.737 m²' }
      },
    })

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula-12345.pdf',
      pages: [
        page({
          text: 'Matrícula nº 12.345\nR.22\nÁrea 4 0 8 . 7 3 7 m ²',
          meanConfidence: 99,
          legalSignals: {
            ...page().legalSignals,
            squareMeters: 0,
            fragmentedNumbersOrMeasures: 2,
          },
        }),
      ],
    })

    expect(renderedPages).toEqual([[1]])
    expect(calls).toBe(1)
    expect(result.byPage.get(1)).toMatchObject({
      state: 'conflict',
      reasons: ['fragmented-number-or-measure', 'missing-measure', 'missing-legal-marker'],
      offsetEncoding: 'utf16_code_units',
      provenance: {
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      },
    })
    expect(result.byPage.get(1)?.provenance?.imageSha256).toHaveLength(64)
    expect(result.byPage.get(1)?.provenance?.candidateSha256).toHaveLength(64)
  })

  test('records DeepSeek provenance without persisting candidate text', async () => {
    const { service } = createService(
      {
        async transcribe() {
          return { status: 'transcribed', transcription: 'visual candidate' }
        },
      },
      { provider: 'deepseek' }
    )

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
    })

    expect(result.byPage.get(1)).toMatchObject({
      provenance: { provider: 'deepseek', model: 'gemini-2.5-flash' },
    })
    expect(result.byPage.get(1)).not.toHaveProperty('candidateText')
  })

  test('does not select non-matrícula PDFs or pages based on average confidence alone', async () => {
    let calls = 0
    const { service, renderedPages } = createService({
      async transcribe() {
        calls++
        return { status: 'transcribed', transcription: 'ignored' }
      },
    })

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'contrato.pdf',
      pages: [page({ meanConfidence: 1 })],
    })

    expect(renderedPages).toEqual([])
    expect(calls).toBe(0)
    expect(result.byPage.get(1)).toEqual({
      state: 'ocr_only',
      reasons: [],
      offsetEncoding: 'utf16_code_units',
    })
  })

  test('bounds selected pages, keeps OCR unchanged in shadow mode, and never uses provider confidence', async () => {
    const providerCalls: Array<{ pageNumber: number; model: string }> = []
    const { service, renderedPages } = createService(
      {
        async transcribe({ pageNumber, model }) {
          providerCalls.push({ pageNumber, model })
          return {
            status: 'transcribed',
            transcription: `visual ${pageNumber}`,
            confidence: 100,
          }
        },
      },
      { shadowMode: true, maxPagesPerPdf: 1 }
    )
    const first = page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })
    const originalFirstText = first.text
    const originalFirstLegalSignals = { ...first.legalSignals }
    const second = page({
      pageNumber: 2,
      legalSignals: { ...page().legalSignals, garbledSpans: 1 },
    })

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matrícula.pdf',
      pages: [first, second],
    })

    expect(renderedPages).toEqual([[1]])
    expect(providerCalls).toEqual([{ pageNumber: 1, model: 'gemini-2.5-flash' }])
    expect(result.byPage.get(1)).toMatchObject({ state: 'ocr_plus_visual_candidate' })
    expect(result.byPage.get(2)).toEqual({
      state: 'ocr_only',
      reasons: [],
      offsetEncoding: 'utf16_code_units',
    })
    expect(first.text).toBe(originalFirstText)
    expect(first.legalSignals).toEqual(originalFirstLegalSignals)
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
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        timeoutMs: 20,
        maxRetries: 0,
        concurrency: 1,
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

  test('keeps UTF-16 source ranges and unresolved coverage without candidate text', async () => {
    const { service } = createService({
      async transcribe() {
        return { status: 'transcribed', transcription: 'different visual text' }
      },
    })
    const text = 'Matrícula 🧾\nR.22'
    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [
        page({
          text,
          sourceRange: { start: 0, end: text.length },
          legalSignals: { ...page().legalSignals, corruptedSymbols: 1 },
        }),
      ],
    })

    expect(result.byPage.get(1)).toMatchObject({
      state: 'conflict',
      offsetEncoding: 'utf16_code_units',
      sourceRange: { start: 0, end: text.length },
      riskySpans: [{ start: 0, end: text.length }],
    })
    expect(result.byPage.get(1)).not.toHaveProperty('candidateText')
  })
})
