import { describe, expect, test } from 'bun:test'
import {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
  reconcileGeminiWholePage,
  VISUAL_FALLBACK_V2_SCHEMA_VERSION,
} from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'

describe('gemini-whole-page-critical-v2 reconciliation policy', () => {
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

  test('maps OCR-only critical omissions to a containing Gemini clause', () => {
    const visualText = 'O imóvel possui ônus. A matrícula está ativa.'
    const result = reconcileGeminiWholePage({
      ocrText: 'O imóvel não possui ônus. A matrícula está ativa.',
      visualText,
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      {
        start: 0,
        end: 'O imóvel possui ônus.'.length,
        scope: 'clause',
        categories: ['negation'],
        divergences: ['ocr_only'],
      },
    ])
  })

  test('expands ambiguous duplicate or reordered critical tokens across impacted occurrences', () => {
    const visualText = 'R.22 venda; R.22 compra; AV.3 baixa.'
    const result = reconcileGeminiWholePage({
      ocrText: 'R.22 compra; AV.3 baixa; R.22 venda.',
      visualText,
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    const duplicateRange = result.metadata.criticalUncertainties.find(range =>
      range.divergences.includes('duplicate_or_reordered')
    )
    expect(duplicateRange).toBeDefined()
    expect(duplicateRange).toMatchObject({ start: 0, end: visualText.length, scope: 'page' })
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

  test('projects shadow uncertainties onto OCR and inverts source-only divergence labels', () => {
    const ocrText = '🧾 O imóvel não possui ônus. Matrícula ativa.'
    const result = reconcileGeminiWholePage({
      ocrText,
      visualText: '🧾 O imóvel possui ônus. Matrícula ativa em 11/09/2026.',
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.ocrCriticalUncertainties).toEqual([
      {
        start: ocrText.indexOf('não'),
        end: ocrText.indexOf('não') + 'não'.length,
        scope: 'token',
        categories: ['negation'],
        divergences: ['gemini_only'],
      },
      {
        start: ocrText.indexOf('Matrícula'),
        end: ocrText.length,
        scope: 'clause',
        categories: ['date'],
        divergences: ['ocr_only'],
      },
    ])
    expect(result.ocrCriticalUncertainties.every(range => range.end <= ocrText.length)).toBe(true)
  })
})
