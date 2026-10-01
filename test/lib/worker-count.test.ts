import { describe, expect, test } from 'bun:test'
import { calculateWorkerCount, parseCgroupV2CpuQuota } from '../../src/lib/worker-count'

describe('OCR worker count', () => {
  test('parses cgroup v2 CPU quota', () => {
    expect(parseCgroupV2CpuQuota('200000 100000')).toBe(2)
    expect(parseCgroupV2CpuQuota('max 100000')).toBeUndefined()
  })

  test('caps an explicit worker override to the container CPU quota', () => {
    expect(
      calculateWorkerCount({
        availableCpus: 36,
        isContainer: true,
        cpuQuota: 2,
        configuredWorkers: 12,
      })
    ).toBe(2)
  })

  test('keeps the conservative container heuristic without a quota', () => {
    expect(
      calculateWorkerCount({
        availableCpus: 36,
        isContainer: true,
      })
    ).toBe(12)
  })
})
