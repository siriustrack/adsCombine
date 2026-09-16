import { describe, expect, test } from 'bun:test'
import { SYNTHETIC_CASES } from '../../benchmark/visual-fallback-v2/cases'
import { runVisualFallbackV2Benchmark } from '../../benchmark/visual-fallback-v2/runner'
import { DiagnosticCountsSchema } from '../../benchmark/visual-fallback-v2/schema'

const EXPECTED_MATRIX = [
  [
    'synthetic-v2-critical-cardinality-gemini-insertion',
    'selected',
    'critical_cardinality_mismatch',
    'body',
    0,
    1,
    undefined,
  ],
  [
    'synthetic-v2-critical-cardinality-gemini-removal',
    'selected',
    'critical_cardinality_mismatch',
    'body',
    1,
    0,
    undefined,
  ],
  [
    'synthetic-v2-region-pairing-repeated-marker-tie',
    'selected',
    'region_pairing_ambiguous',
    'body',
    0,
    0,
    undefined,
  ],
  [
    'synthetic-v2-region-pairing-crossed-residual-slot',
    'selected',
    'region_pairing_ambiguous',
    'body',
    2,
    2,
    undefined,
  ],
  [
    'synthetic-v2-region-pairing-multiple-residuals',
    'selected',
    'region_pairing_ambiguous',
    'body',
    4,
    4,
    undefined,
  ],
  [
    'synthetic-v2-region-pairing-no-shared-anchor',
    'selected',
    'region_pairing_ambiguous',
    'body',
    2,
    2,
    undefined,
  ],
  ['synthetic-v2-localized-number', 'selected', 'localized', 'page', 1, 1, undefined],
  [
    'synthetic-v2-alignment-budget-rejection',
    'rejected',
    'alignment_budget_exceeded',
    'page',
    0,
    0,
    'alignment_budget_exceeded',
  ],
] as const

const VALID_DIAGNOSTICS = {
  ocrRegionCount: 0,
  geminiRegionCount: 0,
  pairedRegionCount: 0,
  unpairedOcrRegionCount: 0,
  unpairedGeminiRegionCount: 0,
  ocrCriticalTokenCount: 0,
  geminiCriticalTokenCount: 0,
  ocrOnlyCriticalTokenCount: 0,
  geminiOnlyCriticalTokenCount: 0,
  hunkCount: 0,
  rangesBeforeAggregation: 0,
  rangesAfterAggregation: 0,
  confirmedTopCount: 0,
  confirmedBottomCount: 0,
} as const

describe('visual fallback V2 benchmark directional cardinality', () => {
  test('reports the exact ordered eight-case matrix without changing decisions', () => {
    // Given
    const report = runVisualFallbackV2Benchmark()

    // When
    const matrix = report.results.map(result => [
      String(result.syntheticId),
      result.status,
      result.terminalTrigger,
      result.terminalSection,
      Reflect.get(result.diagnostics, 'ocrOnlyCriticalTokenCount'),
      Reflect.get(result.diagnostics, 'geminiOnlyCriticalTokenCount'),
      result.status === 'rejected' ? result.reason : undefined,
    ])

    // Then
    expect(matrix).toEqual(EXPECTED_MATRIX.map(row => [...row]))
  })

  test('requires safe nonnegative integer directional fields', () => {
    // Given
    const { ocrOnlyCriticalTokenCount, ...missingOcrOnly } = VALID_DIAGNOSTICS
    const { geminiOnlyCriticalTokenCount, ...missingGeminiOnly } = VALID_DIAGNOSTICS
    void ocrOnlyCriticalTokenCount
    void geminiOnlyCriticalTokenCount

    // When
    const valid = DiagnosticCountsSchema.safeParse(VALID_DIAGNOSTICS)

    // Then
    expect(valid.success).toBe(true)
    expect(DiagnosticCountsSchema.safeParse(missingOcrOnly).success).toBe(false)
    expect(DiagnosticCountsSchema.safeParse(missingGeminiOnly).success).toBe(false)
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(
        DiagnosticCountsSchema.safeParse({
          ...VALID_DIAGNOSTICS,
          ocrOnlyCriticalTokenCount: invalid,
        }).success
      ).toBe(false)
      expect(
        DiagnosticCountsSchema.safeParse({
          ...VALID_DIAGNOSTICS,
          geminiOnlyCriticalTokenCount: invalid,
        }).success
      ).toBe(false)
    }
  })

  test('projects only safe counts without token identities or input sentinels', () => {
    // Given
    const cases = SYNTHETIC_CASES.map((fixture, index) => ({
      ...fixture,
      ocrText: `${fixture.ocrText} PRIVATE_OCR_${index} 731947`,
      visualText: `${fixture.visualText} PRIVATE_GEMINI_${index} 831947`,
    }))

    // When
    const report = runVisualFallbackV2Benchmark({ cases })
    const serialized = JSON.stringify(report)

    // Then
    for (const result of report.results) {
      for (const key of ['ocrOnlyCriticalTokenCount', 'geminiOnlyCriticalTokenCount'] as const) {
        const count = Reflect.get(result.diagnostics, key)
        expect(Number.isSafeInteger(count)).toBe(true)
        expect(typeof count === 'number' && count >= 0).toBe(true)
      }
    }
    for (const forbidden of [
      'PRIVATE_OCR_',
      'PRIVATE_GEMINI_',
      '731947',
      '831947',
      'normalized',
      'ocrText',
      'visualText',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('keeps directional diagnostics invariant when durations are enabled', () => {
    // Given
    const baseline = runVisualFallbackV2Benchmark()
    let reading = 0

    // When
    const timed = runVisualFallbackV2Benchmark({
      includeDuration: true,
      clock: () => reading++,
    })

    // Then
    expect(timed.results).toEqual(baseline.results)
    expect(timed.aggregateUncertaintyScopes).toEqual(baseline.aggregateUncertaintyScopes)
    expect(timed.durations?.totalMs).toBe(8)
  })
})
