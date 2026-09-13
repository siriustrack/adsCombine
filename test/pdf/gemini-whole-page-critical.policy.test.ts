import { describe, expect, test } from 'bun:test'
import {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
  reconcileGeminiWholePage as reconcileGeminiWholePagePolicy,
  VISUAL_FALLBACK_V2_SCHEMA_VERSION,
} from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'

type ReconciliationInput = Parameters<typeof reconcileGeminiWholePagePolicy>[0]

function reconcileGeminiWholePage(input: ReconciliationInput) {
  return reconcileGeminiWholePagePolicy({ maxAlignmentCells: 10_000_000, ...input })
}

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
    const visualText = 'R.22 ato comum valor 20; R.22 ato comum valor 10; AV.3 baixa.'
    const result = reconcileGeminiWholePage({
      ocrText: 'R.22 ato comum valor 10; AV.3 baixa; R.22 ato comum valor 20.',
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

  test('localizes a changed legal marker without splitting its punctuation', () => {
    const visualText = 'R.23 compra formalizada; AV.3 baixa confirmada.'
    const result = reconcileGeminiWholePage({
      ocrText: 'R.22 compra formalizada; AV.3 baixa confirmada.',
      visualText,
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      result.metadata.criticalUncertainties.map(range => ({
        text: visualText.slice(range.start, range.end),
        scope: range.scope,
        categories: range.categories,
      }))
    ).toEqual([{ text: 'R.23', scope: 'token', categories: ['registry_marker'] }])
  })

  test('keeps punctuation-bearing critical values atomic', () => {
    const ocrText =
      'R.22 dado 000.000.000-00 em 10/09/2026 por R$ 1.234,50, área 12,5 m² e livro 12.345.'
    const visualText =
      'R.22 dado 000.000.000-00 em 11/09/2026 por R$ 1.235,50, área 13,5 m² e livro 12.346.'
    const result = reconcileGeminiWholePage({ ocrText, visualText })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toEqual(['11/09/2026', 'R$ 1.235,50', '13,5 m²', '12.346'])
    expect(result.metadata.criticalUncertainties.every(range => range.scope === 'token')).toBe(true)
  })

  test('falls back to the page for an OCR-only negation with ambiguous repeated enclosures', () => {
    const visualText = 'R.8 o bem possui ônus; R.8 o bem possui ônus.'
    const result = reconcileGeminiWholePage({
      ocrText: 'R.8 o bem não possui ônus; R.8 o bem não possui ônus.',
      visualText,
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ start: 0, end: visualText.length, scope: 'page' }),
    ])
  })

  test('falls back to the page when repeated anchors do not prove critical occurrence identity', () => {
    const ocrText = 'valor 10; valor 10.'
    const visualText = 'valor 11; valor 10.'
    const result = reconcileGeminiWholePage({ ocrText, visualText })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      {
        start: 0,
        end: visualText.length,
        scope: 'page',
        categories: ['number'],
        divergences: ['duplicate_or_reordered'],
      },
    ])
    expect(result.ocrCriticalUncertainties).toEqual([
      {
        start: 0,
        end: ocrText.length,
        scope: 'page',
        categories: ['number'],
        divergences: ['duplicate_or_reordered'],
      },
    ])
  })

  test('preserves every critical category when a mixed hunk cannot project each item', () => {
    const ocrText = 'início não existe saldo 10 fim.'
    const visualText = 'início consta valor 20 fim.'
    const result = reconcileGeminiWholePage({ ocrText, visualText })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      {
        start: 0,
        end: visualText.length,
        scope: 'page',
        categories: ['negation', 'number'],
        divergences: ['different_value'],
      },
    ])
    expect(result.ocrCriticalUncertainties).toEqual([
      {
        start: 0,
        end: ocrText.length,
        scope: 'page',
        categories: ['negation', 'number'],
        divergences: ['different_value'],
      },
    ])
  })

  test('localizes uniquely identified legal acts when their order changes', () => {
    const visualText = 'AV.3 baixa confirmada; R.22 compra formalizada.'
    const result = reconcileGeminiWholePage({
      ocrText: 'R.22 compra formalizada; AV.3 baixa confirmada.',
      visualText,
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    const moved = result.metadata.criticalUncertainties.filter(range =>
      range.divergences.includes('duplicate_or_reordered')
    )
    expect(moved.length).toBe(2)
    expect(moved.every(range => range.scope !== 'page')).toBe(true)
    expect(moved.map(range => visualText.slice(range.start, range.end))).toEqual(['AV.3', 'R.22'])
  })

  test('pairs repeated markers by unique non-critical signatures but preserves unresolved ties', () => {
    const resolvedText = 'R.22 cessão alfa valor 20; R.22 compra beta valor 10.'
    const resolved = reconcileGeminiWholePage({
      ocrText: 'R.22 compra beta valor 10; R.22 cessão alfa valor 20.',
      visualText: resolvedText,
    })
    expect(resolved.status).toBe('selected')
    if (resolved.status !== 'selected') throw new Error('expected selected candidate')
    expect(resolved.metadata.criticalUncertainties.every(range => range.scope !== 'page')).toBe(
      true
    )

    const ambiguousText = 'R.22 ato comum valor 10; R.22 ato comum valor 10.'
    const ambiguous = reconcileGeminiWholePage({
      ocrText: 'R.22 ato comum valor 10; R.22 ato comum valor 10.',
      visualText: ambiguousText,
    })
    expect(ambiguous.status).toBe('selected')
    if (ambiguous.status !== 'selected') throw new Error('expected selected candidate')
    expect(ambiguous.metadata.criticalUncertainties).toEqual([])
  })

  test('keeps UTF-16 occurrence identity in Gemini and mirrored OCR ranges', () => {
    const ocrText = '🧾 R.22 valor 10; AV.3 valor 20.'
    const visualText = '🧾 AV.3 valor 20; R.22 valor 11.'
    const result = reconcileGeminiWholePage({ ocrText, visualText })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toContain('11')
    expect(
      result.ocrCriticalUncertainties.map(range => ocrText.slice(range.start, range.end))
    ).toContain('10')
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
