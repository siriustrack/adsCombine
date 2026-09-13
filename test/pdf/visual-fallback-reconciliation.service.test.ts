import { describe, expect, test } from 'bun:test'
import { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

const legalSignals = {
  registryMarkers: 1,
  legalMarkers: 1,
  cpfCnpj: 0,
  dates: 0,
  currency: 0,
  fractions: 0,
  squareMeters: 1,
  corruptedSymbols: 0,
  fragmentedNumbersOrMeasures: 1,
  duplicateLabels: 0,
  garbledSpans: 0,
}

function createService(transcription: string) {
  return new VisualFallbackService(
    {
      async renderPages(_buffer, pageNumbers) {
        return pageNumbers.map(pageNumber => ({ pageNumber, image: Buffer.from('page') }))
      },
    },
    {
      async transcribe() {
        return { status: 'transcribed', transcription }
      },
    },
    {
      enabled: true,
      shadowMode: false,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 0,
      concurrency: 1,
      maxAlignmentCells: 10_000_000,
      maxPagesPerPdf: 2,
    }
  )
}

function createV2Service(
  transcription: string,
  options: { shadowMode?: boolean; provider?: 'gemini' | 'deepseek' } = {}
) {
  return new VisualFallbackService(
    {
      async renderPages(_buffer, pageNumbers) {
        return pageNumbers.map(pageNumber => ({ pageNumber, image: Buffer.from('page') }))
      },
    },
    {
      async transcribe() {
        return { status: 'transcribed', transcription }
      },
    },
    {
      enabled: true,
      shadowMode: options.shadowMode ?? false,
      provider: options.provider ?? 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 0,
      concurrency: 1,
      maxAlignmentCells: 10_000_000,
      maxPagesPerPdf: 2,
      reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
    }
  )
}

describe('VisualFallbackService reconciliation', () => {
  test('returns promoted visual text only through the internal accepted-page map', async () => {
    const prefix = 'Registro descritivo do imóvel urbano localizado nesta comarca. '
    const visualText = `${prefix}Matrícula nº 12.345, área 408.737 m².`
    const result = await createService(visualText).execute({
      buffer: Buffer.from('pdf'),
      fileName: 'documento-generico.pdf',
      pages: [
        {
          pageNumber: 1,
          text: `${prefix}Matrícula nº 12.345, área 408.737 m ².`,
          meanConfidence: 85.12,
          legalSignals,
        },
      ],
    })

    expect(result.acceptedVisualTextByPage.get(1)).toBe(visualText)
    expect(result.byPage.get(1)).toMatchObject({
      state: 'reconciled',
      policyVersion: 'safe-visual-v1',
      decisionReason: 'safe_structural_repair',
      selectedTextSource: 'visual',
      comparison: { protectedFieldsMatch: true },
    })
    expect(result.byPage.get(1)).not.toHaveProperty('candidateText')
  })

  test('marks risky pages skipped by the shared budget as unresolved', async () => {
    const result = await createService('unused').execute({
      buffer: Buffer.from('pdf'),
      fileName: 'generic.pdf',
      pages: [{ pageNumber: 1, text: 'texto', legalSignals: { ...legalSignals, garbledSpans: 1 } }],
      pageBudget: { reserve: () => false, remaining: () => 0 },
    })

    expect(result.byPage.get(1)).toMatchObject({
      state: 'fallback_failed',
      decisionReason: 'budget_exhausted',
      reasons: ['fragmented-number-or-measure', 'garbled-spans'],
    })
  })

  test('selects a complete sanitized Gemini page with strict V2 metadata and no V1 comparison fields', async () => {
    const visualText = '🧾 Matrícula nº 12.346, área 408.737 m².'
    const result = await createV2Service(`  ${visualText}\r\n`).execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [
        {
          pageNumber: 1,
          text: '🧾 Matrícula nº 12.345, área 408.737 m².',
          sourceRange: { start: 0, end: 43 },
          legalSignals,
        },
      ],
    })

    expect(result.acceptedVisualTextByPage.get(1)).toBe(visualText)
    expect(result.byPage.get(1)).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      policyVersion: 'gemini-whole-page-critical-v2',
      alignmentVersion: 'critical-token-alignment-v1',
      outcome: 'selected',
      selectedTextSource: 'visual',
      decisionReason: 'gemini_whole_page_selected',
      criticalUncertainties: [{ scope: 'token' }],
    })
    expect(result.byPage.get(1)).not.toHaveProperty('comparison')
    expect(result.byPage.get(1)).not.toHaveProperty('shadowDecision')
  })

  test('projects shadow ranges onto persisted OCR without retaining candidate text', async () => {
    const text = '🧾 Matrícula nº 12.345'
    const result = await createV2Service('🧾 Matrícula nº 99.999', { shadowMode: true }).execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [
        {
          pageNumber: 1,
          text,
          sourceRange: { start: 0, end: text.length },
          legalSignals: { ...legalSignals, corruptedSymbols: 1 },
        },
      ],
    })

    expect(result.acceptedVisualTextByPage.size).toBe(0)
    expect(result.byPage.get(1)).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'shadow',
      selectedTextSource: 'ocr',
      decisionReason: 'shadow_gemini_whole_page',
      alignmentVersion: 'critical-token-alignment-v1',
      provenance: { provider: 'gemini' },
      criticalUncertainties: [
        {
          start: text.indexOf('12.345'),
          end: text.indexOf('12.345') + '12.345'.length,
          scope: 'token',
          divergences: ['different_value'],
        },
      ],
    })
    expect(result.byPage.get(1)).not.toHaveProperty('candidateText')
  })

  test('inverts one-sided fail-closed divergences in shadow OCR metadata', async () => {
    const text = 'valor 10; valor 20. contexto registral preservado'
    const visualText = 'valor 20; valor 10; valor 30. contexto registral preservado'
    const result = await createV2Service(visualText, { shadowMode: true }).execute({
      buffer: Buffer.from('pdf'),
      fileName: 'registro.pdf',
      pages: [
        {
          pageNumber: 1,
          text,
          sourceRange: { start: 0, end: text.length },
          legalSignals: { ...legalSignals, corruptedSymbols: 1 },
        },
      ],
    })

    expect(result.byPage.get(1)).toMatchObject({
      outcome: 'shadow',
      selectedTextSource: 'ocr',
      criticalUncertainties: [
        {
          start: 0,
          end: text.length,
          scope: 'page',
          categories: ['number'],
          divergences: ['duplicate_or_reordered', 'ocr_only'],
        },
      ],
    })
  })

  test('disables active V2 when the configured provider is not Gemini', async () => {
    const result = await createV2Service('unused', { provider: 'deepseek' }).execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [
        { pageNumber: 1, text: 'texto', legalSignals: { ...legalSignals, corruptedSymbols: 1 } },
      ],
    })

    expect(result).toMatchObject({ enabled: false, selectedPageCount: 0 })
    expect(result.byPage.get(1)?.state).toBe('ocr_only')
  })

  test('emits the exact unavailable shape for exhausted V2 budget', async () => {
    const text = 'Matrícula nº 12.345'
    const result = await createV2Service('unused').execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [
        {
          pageNumber: 1,
          text,
          legalSignals: { ...legalSignals, corruptedSymbols: 1 },
        },
      ],
      pageBudget: { reserve: () => false, remaining: () => 0 },
    })

    expect(result.byPage.get(1)).toEqual({
      schemaVersion: 'visual-fallback/v2',
      policyVersion: 'gemini-whole-page-critical-v2',
      outcome: 'unavailable',
      state: 'fallback_failed',
      reasons: ['corrupted-symbols', 'fragmented-number-or-measure'],
      offsetEncoding: 'utf16_code_units',
      sourceRange: { start: 0, end: text.length },
      riskySpans: [{ start: 0, end: text.length }],
      selectedTextSource: 'ocr',
      decisionReason: 'budget_exhausted',
    })
  })

  test('preserves OCR and marks a rejected candidate as full-page unresolved', async () => {
    const text = 'Matrícula nº 12.345 com descrição completa'
    const result = await createV2Service('Desculpe, não posso ajudar.').execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [
        {
          pageNumber: 1,
          text,
          sourceRange: { start: 5, end: 5 + text.length },
          legalSignals: { ...legalSignals, corruptedSymbols: 1 },
        },
      ],
    })

    expect(result.acceptedVisualTextByPage.size).toBe(0)
    expect(result.byPage.get(1)).toMatchObject({
      outcome: 'rejected',
      selectedTextSource: 'ocr',
      decisionReason: 'candidate_empty_after_sanitization',
      criticalUncertainties: [{ start: 0, end: text.length, scope: 'page' }],
    })
  })
})
