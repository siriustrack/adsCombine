import { describe, expect, test } from 'bun:test'
import {
  BenchmarkBoundaryError,
  BenchmarkCaseSchema,
  parseBenchmarkCases,
  parseBenchmarkReport,
} from '../../benchmark/visual-fallback-v2/schema'

const ID_PREFIX = 'synthetic-v2-'
const validCase = {
  syntheticId: 'synthetic-v2-generic-case-42',
  ocrText: 'synthetic source',
  visualText: 'synthetic candidate',
  maxAlignmentCells: 10_000,
} as const

function captureBoundaryError(runBoundary: () => unknown): BenchmarkBoundaryError {
  try {
    runBoundary()
    throw new TypeError('expected boundary rejection')
  } catch (error) {
    if (error instanceof BenchmarkBoundaryError) return error
    throw error
  }
}

describe('visual fallback V2 benchmark boundary limits', () => {
  test('accepts generic synthetic IDs at 128 UTF-16 code units and rejects 129', () => {
    const idAtLimit = `${ID_PREFIX}${'a'.repeat(128 - ID_PREFIX.length)}`
    const idAboveLimit = `${idAtLimit}a`

    expect(idAtLimit.length).toBe(128)
    expect(BenchmarkCaseSchema.safeParse({ ...validCase, syntheticId: idAtLimit }).success).toBe(
      true
    )
    expect(idAboveLimit.length).toBe(129)
    expect(BenchmarkCaseSchema.safeParse({ ...validCase, syntheticId: idAboveLimit }).success).toBe(
      false
    )
  })

  test('accepts each text at 32,768 UTF-16 code units and rejects 32,769', () => {
    const textAtLimit = 'a'.repeat(32_768)
    const textAboveLimit = `${textAtLimit}a`

    expect(BenchmarkCaseSchema.safeParse({ ...validCase, ocrText: textAtLimit }).success).toBe(true)
    expect(BenchmarkCaseSchema.safeParse({ ...validCase, ocrText: textAboveLimit }).success).toBe(
      false
    )
    expect(BenchmarkCaseSchema.safeParse({ ...validCase, visualText: textAtLimit }).success).toBe(
      true
    )
    expect(
      BenchmarkCaseSchema.safeParse({ ...validCase, visualText: textAboveLimit }).success
    ).toBe(false)
  })

  test('counts astral text limits by JavaScript UTF-16 code units', () => {
    const astralAtLimit = '😀'.repeat(16_384)
    const astralAboveLimit = `${astralAtLimit}a`

    expect(astralAtLimit.length).toBe(32_768)
    expect(
      BenchmarkCaseSchema.safeParse({
        ...validCase,
        ocrText: astralAtLimit,
        visualText: astralAtLimit,
      }).success
    ).toBe(true)
    expect(astralAboveLimit.length).toBe(32_769)
    expect(BenchmarkCaseSchema.safeParse({ ...validCase, ocrText: astralAboveLimit }).success).toBe(
      false
    )
  })

  test('uses deterministic path-free stacks for both boundary codes', () => {
    const casesError = captureBoundaryError(() => parseBenchmarkCases('PRIVATE_CASES_PATH'))
    const reportError = captureBoundaryError(() => parseBenchmarkReport('PRIVATE_REPORT_PATH'))

    expect(casesError.stack).toBe('BenchmarkBoundaryError: Invalid synthetic benchmark cases')
    expect(reportError.stack).toBe('BenchmarkBoundaryError: Invalid benchmark report')
    expect(casesError.stack).not.toContain(process.cwd())
    expect(reportError.stack).not.toContain(process.cwd())
  })
})
