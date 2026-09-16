import { describe, expect, test } from 'bun:test'
import {
  BenchmarkBoundaryError,
  BenchmarkCaseSchema,
  BenchmarkReportSchema,
  parseBenchmarkCases,
  parseBenchmarkReport,
} from '../../benchmark/visual-fallback-v2/schema'

const IDS = [
  'synthetic-v2-critical-cardinality-gemini-insertion',
  'synthetic-v2-critical-cardinality-gemini-removal',
  'synthetic-v2-region-pairing-repeated-marker-tie',
  'synthetic-v2-region-pairing-crossed-residual-slot',
  'synthetic-v2-region-pairing-multiple-residuals',
  'synthetic-v2-region-pairing-no-shared-anchor',
  'synthetic-v2-localized-number',
  'synthetic-v2-alignment-budget-rejection',
] as const

const zeroScopes = { token: 0, clause: 0, page: 0 } as const
const zeroDiagnostics = {
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

function validCases() {
  return IDS.map(syntheticId => ({
    syntheticId,
    ocrText: 'synthetic source 10',
    visualText: 'synthetic candidate 11',
    maxAlignmentCells: 10_000,
  }))
}

function validReport() {
  return {
    results: IDS.map(syntheticId => ({
      syntheticId,
      status: 'selected' as const,
      terminalTrigger: 'localized' as const,
      terminalSection: 'page' as const,
      diagnostics: zeroDiagnostics,
      visualUncertaintyScopes: zeroScopes,
      ocrUncertaintyScopes: zeroScopes,
    })),
    aggregateUncertaintyScopes: { visual: zeroScopes, ocr: zeroScopes },
  }
}

describe('visual fallback V2 benchmark boundary schemas', () => {
  test('accepts only a strict synthetic case with a valid branded ID', () => {
    const candidate = validCases()[0]

    expect(BenchmarkCaseSchema.safeParse(candidate).success).toBe(true)
    expect(BenchmarkCaseSchema.safeParse({ ...candidate, privateText: 'forbidden' }).success).toBe(
      false
    )
    expect(
      BenchmarkCaseSchema.safeParse({ ...candidate, syntheticId: 'real-derived-1' }).success
    ).toBe(false)
  })

  test('requires non-empty OCR and visual text', () => {
    const candidate = validCases()[0]

    expect(BenchmarkCaseSchema.safeParse({ ...candidate, ocrText: '' }).success).toBe(false)
    expect(BenchmarkCaseSchema.safeParse({ ...candidate, visualText: '' }).success).toBe(false)
  })

  test('accepts only integer alignment budgets from one through sixteen million', () => {
    const candidate = validCases()[0]

    expect(BenchmarkCaseSchema.safeParse({ ...candidate, maxAlignmentCells: 1 }).success).toBe(true)
    expect(
      BenchmarkCaseSchema.safeParse({ ...candidate, maxAlignmentCells: 16_000_000 }).success
    ).toBe(true)
    for (const maxAlignmentCells of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 16_000_001]) {
      expect(BenchmarkCaseSchema.safeParse({ ...candidate, maxAlignmentCells }).success).toBe(false)
    }
  })

  test('reports only the malformed issue count at the cases boundary', () => {
    const malformed = validCases()
    malformed[0] = { ...malformed[0], ocrText: '', visualText: '', maxAlignmentCells: 0 }

    try {
      parseBenchmarkCases(malformed)
      throw new TypeError('expected boundary rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(BenchmarkBoundaryError)
      if (!(error instanceof BenchmarkBoundaryError)) throw error
      expect(error.code).toBe('INVALID_CASES')
      expect(error.issueCount).toBe(3)
      expect(Object.keys(error).sort()).toEqual(['code', 'issueCount', 'name'])
    }
  })

  test('rejects malformed matrices and duplicate IDs with a privacy-safe typed error', () => {
    const duplicate = validCases()
    duplicate[1] = { ...duplicate[1], syntheticId: duplicate[0].syntheticId }

    for (const malformed of [
      validCases().slice(0, 7),
      duplicate,
      [{ ocrText: 'PRIVATE_OCR_SENTINEL', private: 'SECRET_INPUT' }],
    ]) {
      expect(() => parseBenchmarkCases(malformed)).toThrow(BenchmarkBoundaryError)
      try {
        parseBenchmarkCases(malformed)
      } catch (error) {
        expect(error).toBeInstanceOf(BenchmarkBoundaryError)
        if (!(error instanceof BenchmarkBoundaryError)) throw error
        expect(error.code).toBe('INVALID_CASES')
        expect(error.issueCount).toBeGreaterThan(0)
        expect(JSON.stringify(error)).not.toContain('SECRET_INPUT')
        expect(JSON.stringify(error)).not.toContain('PRIVATE_OCR_SENTINEL')
        expect(error).not.toHaveProperty('cause')
        expect(error).not.toHaveProperty('issues')
        expect(error).not.toHaveProperty('input')
      }
    }
  })

  test('enforces strict selected and rejected result variants', () => {
    const selected = validReport().results[0]
    const rejected = {
      ...selected,
      status: 'rejected' as const,
      reason: 'alignment_budget_exceeded' as const,
    }

    expect(BenchmarkReportSchema.safeParse(validReport()).success).toBe(true)
    expect(
      BenchmarkReportSchema.safeParse({
        ...validReport(),
        results: [rejected, ...validReport().results.slice(1)],
      }).success
    ).toBe(true)
    expect(
      BenchmarkReportSchema.safeParse({
        ...validReport(),
        results: [
          { ...selected, reason: 'alignment_budget_exceeded' },
          ...validReport().results.slice(1),
        ],
      }).success
    ).toBe(false)
    expect(
      BenchmarkReportSchema.safeParse({
        ...validReport(),
        results: [{ ...rejected, reason: undefined }, ...validReport().results.slice(1)],
      }).success
    ).toBe(false)
  })

  test('rejects extra report fields and timing entries that do not correspond to results', () => {
    const report = validReport()
    const mismatchedDurations = {
      totalMs: 8,
      cases: [...IDS].reverse().map(syntheticId => ({ syntheticId, durationMs: 1 })),
    }

    expect(BenchmarkReportSchema.safeParse({ ...report, rawText: 'forbidden' }).success).toBe(false)
    expect(
      BenchmarkReportSchema.safeParse({
        ...report,
        results: [
          {
            ...report.results[0],
            diagnostics: { ...zeroDiagnostics, pageNumber: 0 },
          },
          ...report.results.slice(1),
        ],
      }).success
    ).toBe(false)
    expect(
      BenchmarkReportSchema.safeParse({ ...report, durations: mismatchedDurations }).success
    ).toBe(false)
    expect(
      BenchmarkReportSchema.safeParse({
        ...report,
        durations: {
          totalMs: 9,
          cases: IDS.map(syntheticId => ({ syntheticId, durationMs: 1 })),
        },
      }).success
    ).toBe(false)
    try {
      parseBenchmarkReport({ ...report, durations: mismatchedDurations })
      throw new TypeError('expected boundary rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(BenchmarkBoundaryError)
      if (!(error instanceof BenchmarkBoundaryError)) throw error
      expect(error.code).toBe('INVALID_REPORT')
      expect(error.issueCount).toBe(1)
    }
  })
})
