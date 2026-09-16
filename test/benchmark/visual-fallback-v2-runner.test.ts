import { describe, expect, test } from 'bun:test'
import { SYNTHETIC_CASE_IDS, SYNTHETIC_CASES } from '../../benchmark/visual-fallback-v2/cases'
import { runVisualFallbackV2Benchmark } from '../../benchmark/visual-fallback-v2/runner'
import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'
import type { CriticalUncertaintyRange } from '../../src/core/services/messages/pdf-utils/visual-fallback.types'

const EXPECTED_MATRIX = [
  [
    'synthetic-v2-critical-cardinality-gemini-insertion',
    'selected',
    'critical_cardinality_mismatch',
    'body',
  ],
  [
    'synthetic-v2-critical-cardinality-gemini-removal',
    'selected',
    'critical_cardinality_mismatch',
    'body',
  ],
  [
    'synthetic-v2-region-pairing-repeated-marker-tie',
    'selected',
    'region_pairing_ambiguous',
    'body',
  ],
  [
    'synthetic-v2-region-pairing-crossed-residual-slot',
    'selected',
    'region_pairing_ambiguous',
    'body',
  ],
  [
    'synthetic-v2-region-pairing-multiple-residuals',
    'selected',
    'region_pairing_ambiguous',
    'body',
  ],
  ['synthetic-v2-region-pairing-no-shared-anchor', 'selected', 'region_pairing_ambiguous', 'body'],
  ['synthetic-v2-localized-number', 'selected', 'localized', 'page'],
  ['synthetic-v2-alignment-budget-rejection', 'rejected', 'alignment_budget_exceeded', 'page'],
] as const

function countScopes(ranges: readonly CriticalUncertaintyRange[]) {
  return {
    token: ranges.filter(range => range.scope === 'token').length,
    clause: ranges.filter(range => range.scope === 'clause').length,
    page: ranges.filter(range => range.scope === 'page').length,
  }
}

describe('visual fallback V2 synthetic benchmark runner', () => {
  test('executes exactly the ordered eight-case matrix with one terminal diagnostic each', () => {
    const report = runVisualFallbackV2Benchmark()

    expect(SYNTHETIC_CASE_IDS.map(String)).toEqual(EXPECTED_MATRIX.map(row => row[0]))
    expect(
      report.results.map(result => [
        String(result.syntheticId),
        result.status,
        result.terminalTrigger,
        result.terminalSection,
      ])
    ).toEqual(EXPECTED_MATRIX.map(row => [...row]))
    expect(report.results[7]).toMatchObject({
      status: 'rejected',
      reason: 'alignment_budget_exceeded',
    })
  })

  test('is observationally equivalent to direct policy calls', () => {
    const report = runVisualFallbackV2Benchmark()

    for (const [index, fixture] of SYNTHETIC_CASES.entries()) {
      const diagnostics: VisualFallbackV2Diagnostic[] = []
      const direct = reconcileGeminiWholePage({
        ocrText: fixture.ocrText,
        visualText: fixture.visualText,
        maxAlignmentCells: fixture.maxAlignmentCells,
        diagnosticObserver: diagnostic => diagnostics.push(diagnostic),
      })
      const benchmark = report.results[index]
      expect(diagnostics).toHaveLength(1)
      const diagnostic = diagnostics[0]
      if (!benchmark || !diagnostic) throw new TypeError('missing benchmark projection')
      expect(benchmark.status).toBe(direct.status)
      expect(benchmark.terminalTrigger).toBe(diagnostic.trigger)
      expect(benchmark.terminalSection).toBe(diagnostic.section)
      expect(benchmark.diagnostics).toEqual({
        ocrRegionCount: diagnostic.ocrRegionCount,
        geminiRegionCount: diagnostic.geminiRegionCount,
        pairedRegionCount: diagnostic.pairedRegionCount,
        unpairedOcrRegionCount: diagnostic.unpairedOcrRegionCount,
        unpairedGeminiRegionCount: diagnostic.unpairedGeminiRegionCount,
        ocrCriticalTokenCount: diagnostic.ocrCriticalTokenCount,
        geminiCriticalTokenCount: diagnostic.geminiCriticalTokenCount,
        ocrOnlyCriticalTokenCount: diagnostic.ocrOnlyCriticalTokenCount,
        geminiOnlyCriticalTokenCount: diagnostic.geminiOnlyCriticalTokenCount,
        hunkCount: diagnostic.hunkCount,
        rangesBeforeAggregation: diagnostic.rangesBeforeAggregation,
        rangesAfterAggregation: diagnostic.rangesAfterAggregation,
        confirmedTopCount: diagnostic.confirmedTopCount,
        confirmedBottomCount: diagnostic.confirmedBottomCount,
      })
      if (direct.status === 'rejected') {
        expect(benchmark).toMatchObject({
          reason: direct.reason,
          visualUncertaintyScopes: { token: 0, clause: 0, page: 0 },
          ocrUncertaintyScopes: { token: 0, clause: 0, page: 0 },
        })
      } else {
        expect(benchmark.visualUncertaintyScopes).toEqual(
          countScopes(direct.metadata.criticalUncertainties)
        )
        expect(benchmark.ocrUncertaintyScopes).toEqual(countScopes(direct.ocrCriticalUncertainties))
      }
    }
  })

  test('aggregates visual and OCR uncertainty scopes exhaustively', () => {
    const report = runVisualFallbackV2Benchmark()

    expect(report.results.map(result => result.visualUncertaintyScopes)).toEqual([
      { token: 0, clause: 0, page: 1 },
      { token: 0, clause: 0, page: 1 },
      { token: 0, clause: 0, page: 1 },
      { token: 0, clause: 0, page: 1 },
      { token: 0, clause: 0, page: 1 },
      { token: 0, clause: 0, page: 1 },
      { token: 1, clause: 0, page: 0 },
      { token: 0, clause: 0, page: 0 },
    ])
    expect(report.aggregateUncertaintyScopes).toEqual({
      visual: { token: 1, clause: 0, page: 6 },
      ocr: { token: 1, clause: 0, page: 6 },
    })
  })

  test('keeps default reports byte-stable and free of inputs and forbidden diagnostic fields', () => {
    const first = JSON.stringify(runVisualFallbackV2Benchmark())
    const second = JSON.stringify(runVisualFallbackV2Benchmark())

    expect(second).toBe(first)
    for (const sentinel of [
      'synthetic source insertion',
      'synthetic candidate insertion',
      'ocrText',
      'visualText',
      'pageNumber',
      'furnitureActive',
      'criticalUncertainties',
    ]) {
      expect(first).not.toContain(sentinel)
    }
    expect(first).not.toContain('duration')
  })

  test('never serializes distinctive text sentinels from a valid custom eight-case matrix', () => {
    const sentinels = SYNTHETIC_CASES.flatMap((_fixture, index) => [
      `PRIVATE_OCR_SENTINEL_${index}`,
      `PRIVATE_VISUAL_SENTINEL_${index}`,
    ])
    const customCases = SYNTHETIC_CASES.map((fixture, index) => ({
      ...fixture,
      ocrText: `${fixture.ocrText} PRIVATE_OCR_SENTINEL_${index}`,
      visualText: `${fixture.visualText} PRIVATE_VISUAL_SENTINEL_${index}`,
    }))

    const serialized = JSON.stringify(runVisualFallbackV2Benchmark({ cases: customCases }))

    for (const forbidden of [
      ...sentinels,
      'ocrText',
      'visualText',
      'pageNumber',
      'furnitureActive',
      'criticalUncertainties',
      'text',
      'input',
      'path',
      'value',
      'message',
      'stack',
      'cause',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('uses the injected monotonic clock only when duration reporting is requested', () => {
    const readings = Array.from({ length: 16 }, (_, index) => index * 2)
    let index = 0
    const clock = () => readings[index++] ?? 0

    const report = runVisualFallbackV2Benchmark({ includeDuration: true, clock })

    expect(index).toBe(16)
    expect(report.durations).toEqual({
      totalMs: 16,
      cases: SYNTHETIC_CASE_IDS.map(syntheticId => ({ syntheticId, durationMs: 2 })),
    })
  })
})
