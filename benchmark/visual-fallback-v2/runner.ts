import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'
import type { CriticalUncertaintyRange } from '../../src/core/services/messages/pdf-utils/visual-fallback.types'
import { SYNTHETIC_CASES } from './cases'
import {
  type BenchmarkCase,
  type BenchmarkReport,
  type BenchmarkResult,
  parseBenchmarkCases,
  parseBenchmarkReport,
  type UncertaintyScopeCounts,
} from './schema'

export type BenchmarkClock = () => number

export type BenchmarkRunnerOptions = Readonly<{
  cases?: unknown
  includeDuration?: boolean
  clock?: BenchmarkClock
}>

export class BenchmarkExecutionError extends Error {
  readonly name = 'BenchmarkExecutionError'

  constructor(readonly code: 'DIAGNOSTIC_CARDINALITY' | 'INVALID_CLOCK' | 'UNSUPPORTED_SCOPE') {
    super('Synthetic benchmark execution failed')
    this.stack = `${this.name}: ${this.message}`
  }
}

function assertNever(_value: never): never {
  throw new BenchmarkExecutionError('UNSUPPORTED_SCOPE')
}

function countScopes(ranges: readonly CriticalUncertaintyRange[]): UncertaintyScopeCounts {
  const counts = { token: 0, clause: 0, page: 0 }
  for (const range of ranges) {
    switch (range.scope) {
      case 'token':
        counts.token++
        break
      case 'clause':
        counts.clause++
        break
      case 'page':
        counts.page++
        break
      default:
        return assertNever(range.scope)
    }
  }
  return counts
}

function diagnosticCounts(diagnostic: VisualFallbackV2Diagnostic) {
  return {
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
  }
}

function executeCase(fixture: BenchmarkCase): BenchmarkResult {
  const diagnostics: VisualFallbackV2Diagnostic[] = []
  const reconciliation = reconcileGeminiWholePage({
    ocrText: fixture.ocrText,
    visualText: fixture.visualText,
    maxAlignmentCells: fixture.maxAlignmentCells,
    diagnosticObserver: diagnostic => diagnostics.push(diagnostic),
  })
  const diagnostic = diagnostics[0]
  if (diagnostics.length !== 1 || !diagnostic) {
    throw new BenchmarkExecutionError('DIAGNOSTIC_CARDINALITY')
  }
  const common = {
    syntheticId: fixture.syntheticId,
    terminalTrigger: diagnostic.trigger,
    terminalSection: diagnostic.section,
    diagnostics: diagnosticCounts(diagnostic),
  }
  switch (reconciliation.status) {
    case 'selected':
      return {
        ...common,
        status: 'selected',
        visualUncertaintyScopes: countScopes(reconciliation.metadata.criticalUncertainties),
        ocrUncertaintyScopes: countScopes(reconciliation.ocrCriticalUncertainties),
      }
    case 'rejected':
      return {
        ...common,
        status: 'rejected',
        reason: reconciliation.reason,
        visualUncertaintyScopes: { token: 0, clause: 0, page: 0 },
        ocrUncertaintyScopes: { token: 0, clause: 0, page: 0 },
      }
    default:
      return assertNever(reconciliation)
  }
}

function aggregate(results: readonly BenchmarkResult[], source: 'visual' | 'ocr') {
  const key = source === 'visual' ? 'visualUncertaintyScopes' : 'ocrUncertaintyScopes'
  return results.reduce<UncertaintyScopeCounts>(
    (total, result) => ({
      token: total.token + result[key].token,
      clause: total.clause + result[key].clause,
      page: total.page + result[key].page,
    }),
    { token: 0, clause: 0, page: 0 }
  )
}

export function runVisualFallbackV2Benchmark(
  options: BenchmarkRunnerOptions = {}
): BenchmarkReport {
  const cases = options.cases === undefined ? SYNTHETIC_CASES : parseBenchmarkCases(options.cases)
  const results: BenchmarkResult[] = []
  const durations: Array<{ syntheticId: BenchmarkCase['syntheticId']; durationMs: number }> = []
  const clock = options.clock ?? (() => performance.now())
  for (const fixture of cases) {
    const startedAt = options.includeDuration ? clock() : 0
    results.push(executeCase(fixture))
    if (options.includeDuration) {
      const durationMs = clock() - startedAt
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new BenchmarkExecutionError('INVALID_CLOCK')
      }
      durations.push({ syntheticId: fixture.syntheticId, durationMs })
    }
  }
  return parseBenchmarkReport({
    results,
    aggregateUncertaintyScopes: {
      visual: aggregate(results, 'visual'),
      ocr: aggregate(results, 'ocr'),
    },
    ...(options.includeDuration
      ? {
          durations: {
            totalMs: durations.reduce((total, item) => total + item.durationMs, 0),
            cases: durations,
          },
        }
      : {}),
  })
}
