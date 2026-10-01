import { describe, expect, test } from 'bun:test'
import { createV2Service, legalSignals } from './visual-fallback-reconciliation.test-support'

describe('VisualFallbackService reconciliation', () => {
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
    const result = await createV2Service(
      'valor 20; valor 10; valor 30. contexto registral preservado',
      { shadowMode: true }
    ).execute({
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

  test('emits the exact skipped shape for exhausted V2 budget', async () => {
    const text = 'Matrícula nº 12.345'
    const result = await createV2Service('unused').execute({
      buffer: Buffer.from('pdf'),
      fileName: 'matricula.pdf',
      pages: [{ pageNumber: 1, text, legalSignals: { ...legalSignals, corruptedSymbols: 1 } }],
      pageBudget: { reserve: () => false, remaining: () => 0 },
    })
    expect(result.byPage.get(1)).toEqual({
      schemaVersion: 'visual-fallback/v2',
      policyVersion: 'gemini-whole-page-critical-v2',
      outcome: 'skipped',
      state: 'fallback_skipped',
      reasons: ['corrupted-symbols', 'fragmented-number-or-measure'],
      offsetEncoding: 'utf16_code_units',
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
