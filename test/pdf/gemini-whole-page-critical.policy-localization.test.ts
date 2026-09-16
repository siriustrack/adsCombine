import { describe, expect, test } from 'bun:test'
import { reconcileGeminiWholePage } from './gemini-whole-page-critical.policy.test-support'

describe('gemini-whole-page-critical-v2 reconciliation policy', () => {
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
