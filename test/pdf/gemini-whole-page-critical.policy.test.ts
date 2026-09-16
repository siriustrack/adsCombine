import { describe, expect, test } from 'bun:test'
import {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
  reconcileGeminiWholePageCandidate,
  VISUAL_FALLBACK_V2_SCHEMA_VERSION,
} from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import { reconcileGeminiWholePage } from './gemini-whole-page-critical.policy.test-support'

describe('gemini-whole-page-critical-v2 reconciliation policy', () => {
  test.each([1_000, 1_150, 1_500])(
    'aligns a complete %i-word legal page within the production budget',
    wordCount => {
      const text = Array.from({ length: wordCount }, () => 'clausula.').join(' ')

      expect(
        reconcileGeminiWholePage({
          ocrText: text,
          visualText: text,
          maxAlignmentCells: 10_000_000,
        })
      ).toMatchObject({ status: 'selected', text })
    }
  )

  test('rejects a 1,600-word page that exceeds the production alignment budget', () => {
    const text = Array.from({ length: 1_600 }, () => 'clausula.').join(' ')

    expect(
      reconcileGeminiWholePage({
        ocrText: text,
        visualText: text,
        maxAlignmentCells: 10_000_000,
      })
    ).toMatchObject({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })

  test.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed for invalid alignment budget %s',
    maxAlignmentCells => {
      expect(
        reconcileGeminiWholePage({
          ocrText: 'Matrícula nº 12.345.',
          visualText: 'Matrícula nº 12.345.',
          maxAlignmentCells,
        })
      ).toMatchObject({ status: 'rejected', reason: 'alignment_budget_exceeded' })
    }
  )

  test('selects the complete sanitized Gemini page and maps changed critical values exactly', () => {
    const visualText = '🧾 Matrícula nº 12.346, lavrada em 11/09/2026 por R$ 408.737,00.'
    const result = reconcileGeminiWholePage({
      ocrText: '🧾 Matrícula nº 12.345, lavrada em 10/09/2026 por R$ 408.737,00.',
      visualText: `  ${visualText}\r\n`,
    })

    expect(result).toMatchObject({
      status: 'selected',
      text: visualText,
      metadata: {
        schemaVersion: VISUAL_FALLBACK_V2_SCHEMA_VERSION,
        policyVersion: GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
        alignmentVersion: CRITICAL_TOKEN_ALIGNMENT_VERSION,
      },
    })
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toEqual(['12.346', '11/09/2026'])
    expect(result.metadata.criticalUncertainties.map(range => range.categories)).toEqual([
      ['registry_identifier'],
      ['date'],
    ])
    expect(
      result.metadata.criticalUncertainties.every(range =>
        range.divergences.includes('different_value')
      )
    ).toBe(true)
    expect(result.metadata.criticalUncertainties.map(range => range.scope)).toEqual([
      'token',
      'token',
    ])
  })

  test.each([
    [32, 32],
    [33, 1],
  ])('keeps %i structural ranges granular up to the exact cap', (count, expectedRanges) => {
    const ocrText = Array.from(
      { length: count },
      (_, index) => `R.${index + 1} item${index} valor 100`
    ).join('; ')
    const visualText = Array.from(
      { length: count },
      (_, index) => `R.${index + 1} item${index} valor ${index + 200}`
    ).join('; ')
    const result = reconcileGeminiWholePage({ ocrText, visualText })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toHaveLength(expectedRanges)
    if (count === 33) {
      expect(result.metadata.criticalUncertainties[0]).toMatchObject({
        start: 0,
        end: visualText.length,
        scope: 'page',
      })
      expect(result.metadata.criticalUncertainties[0].categories).toContain('number')
      expect(result.metadata.criticalUncertainties[0].divergences).toContain('different_value')
    }
  })

  test('charges all structural subalignments to one page budget ledger', () => {
    const ocrText = 'R.1 alfa beta gama valor 10; AV.2 delta epsilon zeta valor 20.'
    const visualText = 'AV.2 delta epsilon zeta valor 20; R.1 alfa beta gama valor 11.'

    expect(reconcileGeminiWholePage({ ocrText, visualText, maxAlignmentCells: 80 })).toMatchObject({
      status: 'rejected',
      reason: 'alignment_budget_exceeded',
    })
  })

  test('propagates candidate region preprocessing exhaustion through whole-page reconciliation', () => {
    // Given
    const ocrText = 'R.1 base valor 10; AV.2 fim valor 20.'
    const visualText = 'R.1 base valor 11; AV.2 fim valor 20.'
    const maxAlignmentCells = ocrText.length + visualText.length + 29

    // When
    const result = reconcileGeminiWholePageCandidate({
      ocrText,
      visualText,
      maxAlignmentCells,
    })

    // Then
    expect(result).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })

  test.each([
    ['', 'candidate_empty_after_sanitization'],
    ['Desculpe, não posso ajudar com essa solicitação.', 'candidate_empty_after_sanitization'],
    ['Matrícula nº 12.345…', 'candidate_truncated'],
    ['texto \ud800 inválido', 'candidate_invalid_utf16'],
  ] as const)('rejects invalid candidate %s', (visualText, reason) => {
    const result = reconcileGeminiWholePage({
      ocrText: 'Matrícula nº 12.345 com descrição integral e encerramento do registro.',
      visualText,
    })

    expect(result).toMatchObject({ status: 'rejected', reason })
  })

  test('does not reject low similarity or V1 sentinel evidence as a V2 catastrophe', () => {
    const result = reconcileGeminiWholePage({
      ocrText: 'R.22 imóvel sem ônus, valor R$ 10,00.',
      visualText: 'AV.91 propriedade não livre, preço R$ 999.999,00 e área 20 m².',
    })

    expect(result.status).toBe('selected')
  })

  test('fails closed when the deterministic alignment budget is exceeded', () => {
    const result = reconcileGeminiWholePage({
      ocrText: Array.from({ length: 800 }, (_, index) => `ocr${index}`).join(' '),
      visualText: Array.from({ length: 800 }, (_, index) => `gemini${index}`).join(' '),
      maxAlignmentCells: 250_000,
    })

    expect(result).toMatchObject({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })

  test.each([
    [
      'clean middle omission',
      `Cabeçalho ${'conteúdo registral '.repeat(12)}encerramento integral.`,
      'Cabeçalho conteúdo registral encerramento integral.',
    ],
    [
      'clean suffix omission',
      `Matrícula nº 12.345. ${'Cláusula integral extensa. '.repeat(10)}Fim do registro.`,
      'Matrícula nº 12.345.',
    ],
  ])('rejects %s below the 80 percent completeness floor', (_label, ocrText, visualText) => {
    expect(reconcileGeminiWholePage({ ocrText, visualText })).toMatchObject({
      status: 'rejected',
      reason: 'candidate_truncated',
    })
  })
})
