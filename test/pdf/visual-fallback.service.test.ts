import { describe, expect, test } from 'bun:test'
import {
  createVisualFallbackService as createService,
  visualFallbackPage as page,
} from './visual-fallback.test-support'

describe('VisualFallbackService', () => {
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

  test('selects risky generic PDFs but not pages based on average confidence alone', async () => {
    let calls = 0
    const { service, renderedPages } = createService({
      async transcribe() {
        calls++
        return { status: 'transcribed', transcription: 'ignored' }
      },
    })

    const genericRisk = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'contrato.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
    })

    expect(renderedPages).toEqual([[1]])
    expect(calls).toBe(1)
    expect(genericRisk.byPage.get(1)).toMatchObject({
      state: 'conflict',
      reasons: ['corrupted-symbols'],
    })

    const confidenceOnly = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'generic.pdf',
      pages: [page({ meanConfidence: 85.12 }), page({ pageNumber: 2, meanConfidence: 87.47 })],
    })
    expect(calls).toBe(1)
    expect(confidenceOnly.selectedPageCount).toBe(0)
  })

  test('keeps matrícula as an optional transcription profile without gating eligibility', async () => {
    let profileKind: string | undefined
    const { service } = createService({
      async transcribe({ documentProfile }) {
        profileKind = documentProfile?.kind
        return { status: 'abstain' }
      },
    })

    await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matrícula-123.pdf',
      pages: [page({ legalSignals: { ...page().legalSignals, corruptedSymbols: 1 } })],
    })

    expect(profileKind).toBe('matricula')
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
    expect(result.byPage.get(1)).toMatchObject({
      policyVersion: 'safe-visual-v1',
      selectedTextSource: 'ocr',
      shadowDecision: 'conflict',
    })
    expect(result.acceptedVisualTextByPage.size).toBe(0)
    expect(result.byPage.get(2)).toEqual({
      state: 'ocr_only',
      reasons: [],
      offsetEncoding: 'utf16_code_units',
    })
    expect(first.text).toBe(originalFirstText)
    expect(first.legalSignals).toEqual(originalFirstLegalSignals)
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
    expect(result.acceptedVisualTextByPage.size).toBe(0)
  })
})
