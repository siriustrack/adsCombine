import { z } from 'zod'
import {
  BenchmarkExecutionError,
  type BenchmarkRunnerOptions,
  runVisualFallbackV2Benchmark,
} from './runner'
import { BenchmarkBoundaryError, type BenchmarkReport } from './schema'

const CliArgumentsSchema = z.union([z.tuple([]), z.tuple([z.literal('--include-duration')])])
const INVALID_ARGUMENTS = '{"error":{"code":"INVALID_ARGUMENTS"}}\n'
const BENCHMARK_FAILED = '{"error":{"code":"BENCHMARK_FAILED"}}\n'

function serializeRuntimeError(error: unknown): string {
  if (error instanceof BenchmarkBoundaryError) {
    return `${JSON.stringify({ error: { code: error.code, issueCount: error.issueCount } })}\n`
  }
  if (error instanceof BenchmarkExecutionError) {
    return `${JSON.stringify({ error: { code: error.code } })}\n`
  }
  return BENCHMARK_FAILED
}

type CliDependencies = Readonly<{
  runBenchmark: (options?: BenchmarkRunnerOptions) => BenchmarkReport
  writeStdout: (value: string) => void
  writeStderr: (value: string) => void
}>

const DEFAULT_DEPENDENCIES: CliDependencies = {
  runBenchmark: runVisualFallbackV2Benchmark,
  writeStdout: value => process.stdout.write(value),
  writeStderr: value => process.stderr.write(value),
}

export function runVisualFallbackV2BenchmarkCli(
  args: unknown,
  dependencies: CliDependencies = DEFAULT_DEPENDENCIES
): 0 | 1 | 2 {
  const parsed = CliArgumentsSchema.safeParse(args)
  if (!parsed.success) {
    dependencies.writeStderr(INVALID_ARGUMENTS)
    return 2
  }
  try {
    const report = dependencies.runBenchmark({ includeDuration: parsed.data.length === 1 })
    const output = `${JSON.stringify(report)}\n`
    dependencies.writeStdout(output)
    return 0
  } catch (error) {
    dependencies.writeStderr(serializeRuntimeError(error))
    return 1
  }
}

if (process.argv[1]?.endsWith('benchmark/visual-fallback-v2/cli.ts')) {
  process.exitCode = runVisualFallbackV2BenchmarkCli(process.argv.slice(2))
}
