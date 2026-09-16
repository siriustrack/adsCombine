import { describe, expect, test } from 'bun:test'
import { SYNTHETIC_CASE_IDS, SYNTHETIC_CASES } from '../../benchmark/visual-fallback-v2/cases'
import {
  type BenchmarkClock,
  BenchmarkExecutionError,
  runVisualFallbackV2Benchmark,
} from '../../benchmark/visual-fallback-v2/runner'

function captureClockError(clock: BenchmarkClock): BenchmarkExecutionError {
  try {
    runVisualFallbackV2Benchmark({ includeDuration: true, clock })
    throw new TypeError('expected invalid clock rejection')
  } catch (error) {
    if (error instanceof BenchmarkExecutionError) return error
    throw error
  }
}

describe('visual fallback V2 benchmark runner contracts', () => {
  test('deeply freezes the flat canonical fixtures and their ID projection', () => {
    expect(Object.isFrozen(SYNTHETIC_CASES)).toBe(true)
    expect(SYNTHETIC_CASES.every(fixture => Object.isFrozen(fixture))).toBe(true)
    expect(Object.isFrozen(SYNTHETIC_CASE_IDS)).toBe(true)
  })

  test('rejects non-finite and backward clock readings with INVALID_CLOCK', () => {
    for (const readings of [
      [0, Number.NaN],
      [0, Number.POSITIVE_INFINITY],
      [0, Number.NEGATIVE_INFINITY],
      [2, 1],
    ]) {
      let readingIndex = 0
      const error = captureClockError(() => readings[readingIndex++] ?? 0)

      expect(error.code).toBe('INVALID_CLOCK')
    }
  })

  test('uses a deterministic path-free execution error stack', () => {
    const error = new BenchmarkExecutionError('INVALID_CLOCK')

    expect(error.stack).toBe('BenchmarkExecutionError: Synthetic benchmark execution failed')
    expect(error.stack).not.toContain(process.cwd())
  })

  test('never calls an injected clock when duration reporting is false or absent', () => {
    let clockCalls = 0
    const clock = () => {
      clockCalls++
      return 0
    }

    const explicitFalse = runVisualFallbackV2Benchmark({ includeDuration: false, clock })
    const absent = runVisualFallbackV2Benchmark({ clock })

    expect(clockCalls).toBe(0)
    expect(explicitFalse).not.toHaveProperty('durations')
    expect(absent).not.toHaveProperty('durations')
  })
})
