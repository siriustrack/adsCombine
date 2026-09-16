import { describe, expect, test } from 'bun:test'
import { runVisualFallbackV2BenchmarkCli } from '../../benchmark/visual-fallback-v2/cli'
import { BenchmarkExecutionError } from '../../benchmark/visual-fallback-v2/runner'
import {
  BenchmarkReportSchema,
  parseBenchmarkCases,
  parseBenchmarkReport,
} from '../../benchmark/visual-fallback-v2/schema'

const CLI_PATH = 'benchmark/visual-fallback-v2/cli.ts'

async function invokeCli(args: readonly string[], mode: 'direct' | 'package' = 'direct') {
  const command =
    mode === 'direct'
      ? [Bun.which('bun') ?? 'bun', CLI_PATH, ...args]
      : [Bun.which('bun') ?? 'bun', 'run', 'benchmark:v2-reconciliation', '--', ...args]
  const childProcess = Bun.spawn(command, {
    cwd: process.cwd(),
    env: {},
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    childProcess.exited,
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

function captureFailure(runBenchmark: () => never) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = runVisualFallbackV2BenchmarkCli([], {
    runBenchmark,
    writeStdout: value => stdout.push(value),
    writeStderr: value => stderr.push(value),
  })
  return { exitCode, stdout, stderr }
}

describe('visual fallback V2 benchmark CLI', () => {
  test('prints one compact deterministic JSON line without durations in an empty environment', async () => {
    const first = await invokeCli([])
    const second = await invokeCli([])

    expect(first).toEqual(second)
    expect(first.exitCode).toBe(0)
    expect(first.stderr).toBe('')
    expect(first.stdout.split('\n')).toHaveLength(2)
    expect(first.stdout.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(first.stdout)
    expect(BenchmarkReportSchema.safeParse(parsed).success).toBe(true)
    expect(parsed).not.toHaveProperty('durations')
  })

  test('accepts only the duration flag and reports corresponding timings', async () => {
    const result = await invokeCli(['--include-duration'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = BenchmarkReportSchema.parse(JSON.parse(result.stdout))
    expect(parsed.durations?.cases.map(item => item.syntheticId)).toEqual(
      parsed.results.map(item => item.syntheticId)
    )
  })

  test('runs duration reporting through the silent package script entry point', async () => {
    const result = await invokeCli(['--include-duration'], 'package')

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const parsed = BenchmarkReportSchema.parse(JSON.parse(result.stdout))
    expect(parsed.durations?.cases).toHaveLength(8)
  })

  test('rejects private package-mode arguments without launcher or sentinel output', async () => {
    for (const args of [
      ['--unknown-PRIVATE_PACKAGE_SENTINEL'],
      ['PRIVATE_POSITIONAL_SENTINEL'],
      ['--include-duration', '--include-duration'],
    ]) {
      const result = await invokeCli(args, 'package')

      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('{"error":{"code":"INVALID_ARGUMENTS"}}\n')
      expect(result.stderr).not.toContain('PRIVATE_')
    }
  })

  test('rejects unknown, repeated, and positional arguments with exit 2 without echoing them', async () => {
    for (const args of [
      ['--forbidden-PRIVATE_ARGUMENT', 'extra'],
      ['--include-duration', '--include-duration'],
      ['PRIVATE_POSITIONAL_ARGUMENT'],
    ]) {
      const result = await invokeCli(args)

      expect(result.exitCode).toBe(2)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('{"error":{"code":"INVALID_ARGUMENTS"}}\n')
      expect(result.stderr).not.toContain('PRIVATE_ARGUMENT')
    }
  })

  test('serializes typed boundary errors with only their code and issue count', () => {
    const failures = [
      {
        runBenchmark: () => {
          parseBenchmarkCases('CLI_CASES_PRIVATE_SENTINEL')
          throw new TypeError('expected cases boundary rejection')
        },
        code: 'INVALID_CASES',
        issueCount: 2,
      },
      {
        runBenchmark: () => {
          parseBenchmarkReport('CLI_REPORT_PRIVATE_SENTINEL')
          throw new TypeError('expected report boundary rejection')
        },
        code: 'INVALID_REPORT',
        issueCount: 1,
      },
    ] as const

    for (const failure of failures) {
      const result = captureFailure(failure.runBenchmark)
      expect(result).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [`{"error":{"code":"${failure.code}","issueCount":${failure.issueCount}}}\n`],
      })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL')
    }
  })

  test('serializes allowlisted execution error codes without details', () => {
    for (const code of ['DIAGNOSTIC_CARDINALITY', 'INVALID_CLOCK', 'UNSUPPORTED_SCOPE'] as const) {
      const result = captureFailure(() => {
        throw new BenchmarkExecutionError(code)
      })
      expect(result).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: [`{"error":{"code":"${code}"}}\n`],
      })
    }
  })

  test('maps unknown errors to the generic runtime failure without details', () => {
    for (const runBenchmark of [
      () => {
        throw new Error('PRIVATE_INTERNAL_FAILURE')
      },
      () => {
        throw { code: 'INVALID_REPORT', message: 'PRIVATE_OBJECT_FAILURE', issueCount: 99 }
      },
    ]) {
      const result = captureFailure(runBenchmark)
      expect(result).toEqual({
        exitCode: 1,
        stdout: [],
        stderr: ['{"error":{"code":"BENCHMARK_FAILED"}}\n'],
      })
      expect(JSON.stringify(result)).not.toContain('PRIVATE_')
    }
  })
})
