import { describe, expect, test } from 'bun:test'
import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'

const MAX_ALIGNMENT_CELLS = 10_000_000

function reconcileWithDiagnostic(input: {
  ocrText: string
  visualText: string
  maxAlignmentCells?: number
}) {
  const diagnostics: VisualFallbackV2Diagnostic[] = []
  const result = reconcileGeminiWholePage({
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
    pageNumber: 4,
    ...input,
    diagnosticObserver: diagnostic => diagnostics.push(diagnostic),
  })
  expect(diagnostics).toHaveLength(1)
  const diagnostic = diagnostics[0]
  if (!diagnostic) throw new TypeError('missing terminal diagnostic')
  return { result, diagnostic }
}

describe('V2 directional critical-cardinality diagnostics', () => {
  test.each([
    {
      label: 'Gemini insertion',
      ocrText: 'valor 10; valor 20.',
      visualText: 'valor 20; valor 10; valor 30.',
      counts: { ocrOnlyCriticalTokenCount: 0, geminiOnlyCriticalTokenCount: 1 },
    },
    {
      label: 'Gemini removal',
      ocrText: 'contexto preservado valor 20; valor 10; valor 30. final comum',
      visualText: 'contexto preservado valor 10; valor 20. final comum',
      counts: { ocrOnlyCriticalTokenCount: 1, geminiOnlyCriticalTokenCount: 0 },
    },
  ] as const)('keeps the page fallback contract for a $label', fixture => {
    // Given
    const input = { ocrText: fixture.ocrText, visualText: fixture.visualText }

    // When
    const { result, diagnostic } = reconcileWithDiagnostic(input)

    // Then
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new TypeError('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'page' }),
    ])
    expect(diagnostic).toMatchObject({
      trigger: 'critical_cardinality_mismatch',
      section: 'body',
      ...fixture.counts,
    })
  })

  test('records bidirectional replacement counts on the hunk-producing path', () => {
    // Given
    const input = {
      ocrText: 'registro valor 10 confirmado.',
      visualText: 'registro valor 11 confirmado.',
    }

    // When
    const { result, diagnostic } = reconcileWithDiagnostic(input)

    // Then
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new TypeError('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'token' }),
    ])
    expect(diagnostic).toMatchObject({
      trigger: 'localized',
      section: 'page',
      hunkCount: 1,
      ocrOnlyCriticalTokenCount: 1,
      geminiOnlyCriticalTokenCount: 1,
    })
  })

  test('retains nonzero counts when higher-priority region pairing ambiguity wins', () => {
    // Given
    const input = {
      ocrText:
        'R.1 synthetic alpha anchor value 10; R.22 old residual value 20; AV.3 synthetic omega anchor value 30.',
      visualText:
        'R.23 revised residual value 21; R.1 synthetic alpha anchor value 10; AV.3 synthetic omega anchor value 30.',
    }

    // When
    const { result, diagnostic } = reconcileWithDiagnostic(input)

    // Then
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new TypeError('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'page' }),
    ])
    expect(diagnostic).toMatchObject({
      trigger: 'region_pairing_ambiguous',
      section: 'body',
      ocrOnlyCriticalTokenCount: 2,
      geminiOnlyCriticalTokenCount: 2,
    })
  })

  test('leaves both counts at zero when the raw page budget rejects before tokenization', () => {
    // Given
    const input = { ocrText: 'valor 10', visualText: 'valor 11', maxAlignmentCells: 4 }

    // When
    const { result, diagnostic } = reconcileWithDiagnostic(input)

    // Then
    expect(result).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
    expect(diagnostic).toMatchObject({
      trigger: 'alignment_budget_exceeded',
      section: 'page',
      ocrOnlyCriticalTokenCount: 0,
      geminiOnlyCriticalTokenCount: 0,
    })
  })

  test('serializes counts without raw or normalized token identities', () => {
    // Given
    const input = {
      ocrText: 'PRIVATE_OCR_SENTINEL valor 731947.',
      visualText: 'PRIVATE_GEMINI_SENTINEL valor 831947.',
    }

    // When
    const { result, diagnostic } = reconcileWithDiagnostic(input)
    const serialized = JSON.stringify(diagnostic)

    // Then
    expect(result.status).toBe('selected')
    expect(diagnostic).toMatchObject({
      trigger: 'localized',
      section: 'page',
      ocrOnlyCriticalTokenCount: 1,
      geminiOnlyCriticalTokenCount: 1,
    })
    for (const forbidden of [
      'PRIVATE_OCR_SENTINEL',
      'PRIVATE_GEMINI_SENTINEL',
      '731947',
      '831947',
      'normalized',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
