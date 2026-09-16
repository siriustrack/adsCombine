import { z } from 'zod'

export const SYNTHETIC_CASE_ID_PATTERN = /^synthetic-v2-[a-z0-9-]+$/

const SyntheticIdSchema = z
  .string()
  .max(128)
  .regex(SYNTHETIC_CASE_ID_PATTERN)
  .brand<'SyntheticV2Id'>()
const CountSchema = z.number().int().nonnegative().safe()
const DurationSchema = z.number().nonnegative().finite()

export const BenchmarkCaseSchema = z
  .object({
    syntheticId: SyntheticIdSchema,
    ocrText: z.string().min(1).max(32_768),
    visualText: z.string().min(1).max(32_768),
    maxAlignmentCells: z.number().int().min(1).max(16_000_000),
  })
  .strict()

export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>

export const DiagnosticCountsSchema = z
  .object({
    ocrRegionCount: CountSchema,
    geminiRegionCount: CountSchema,
    pairedRegionCount: CountSchema,
    unpairedOcrRegionCount: CountSchema,
    unpairedGeminiRegionCount: CountSchema,
    ocrCriticalTokenCount: CountSchema,
    geminiCriticalTokenCount: CountSchema,
    ocrOnlyCriticalTokenCount: CountSchema,
    geminiOnlyCriticalTokenCount: CountSchema,
    hunkCount: CountSchema,
    rangesBeforeAggregation: CountSchema,
    rangesAfterAggregation: CountSchema,
    confirmedTopCount: CountSchema,
    confirmedBottomCount: CountSchema,
  })
  .strict()

export const UncertaintyScopeCountsSchema = z
  .object({ token: CountSchema, clause: CountSchema, page: CountSchema })
  .strict()

const TriggerSchema = z.enum([
  'localized',
  'region_pairing_ambiguous',
  'critical_order_ambiguous',
  'critical_cardinality_mismatch',
  'unsafe_hunk_projection',
  'range_limit_exceeded',
  'preprocessing_budget_exceeded',
  'alignment_budget_exceeded',
  'furniture_profile_unavailable_or_ambiguous',
  'candidate_rejected',
  'alignment_invariant_failed',
])

const ResultBase = {
  syntheticId: SyntheticIdSchema,
  terminalTrigger: TriggerSchema,
  terminalSection: z.enum(['top', 'body', 'bottom', 'page']),
  diagnostics: DiagnosticCountsSchema,
  visualUncertaintyScopes: UncertaintyScopeCountsSchema,
  ocrUncertaintyScopes: UncertaintyScopeCountsSchema,
} as const

const SelectedResultSchema = z.object({ ...ResultBase, status: z.literal('selected') }).strict()
const RejectedResultSchema = z
  .object({
    ...ResultBase,
    status: z.literal('rejected'),
    reason: z.enum([
      'candidate_empty_after_sanitization',
      'candidate_invalid_utf16',
      'candidate_truncated',
      'alignment_budget_exceeded',
      'alignment_invariant_failed',
    ]),
  })
  .strict()

export const BenchmarkResultSchema = z.discriminatedUnion('status', [
  SelectedResultSchema,
  RejectedResultSchema,
])

export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>
export type UncertaintyScopeCounts = z.infer<typeof UncertaintyScopeCountsSchema>

const AggregateScopesSchema = z
  .object({ visual: UncertaintyScopeCountsSchema, ocr: UncertaintyScopeCountsSchema })
  .strict()

const DurationsSchema = z
  .object({
    totalMs: DurationSchema,
    cases: z
      .array(z.object({ syntheticId: SyntheticIdSchema, durationMs: DurationSchema }).strict())
      .length(8),
  })
  .strict()

function scopesEqual(left: UncertaintyScopeCounts, right: UncertaintyScopeCounts): boolean {
  return left.token === right.token && left.clause === right.clause && left.page === right.page
}

function sumScopes(
  results: readonly BenchmarkResult[],
  source: 'visualUncertaintyScopes' | 'ocrUncertaintyScopes'
): UncertaintyScopeCounts {
  return results.reduce<UncertaintyScopeCounts>(
    (total, result) => ({
      token: total.token + result[source].token,
      clause: total.clause + result[source].clause,
      page: total.page + result[source].page,
    }),
    { token: 0, clause: 0, page: 0 }
  )
}

export const BenchmarkReportSchema = z
  .object({
    results: z.array(BenchmarkResultSchema).length(8),
    aggregateUncertaintyScopes: AggregateScopesSchema,
    durations: DurationsSchema.optional(),
  })
  .strict()
  .superRefine((report, context) => {
    const ids = report.results.map(result => result.syntheticId)
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'result IDs must be unique' })
    }
    if (
      !scopesEqual(
        sumScopes(report.results, 'visualUncertaintyScopes'),
        report.aggregateUncertaintyScopes.visual
      )
    ) {
      context.addIssue({ code: 'custom', message: 'visual aggregate must match results' })
    }
    if (
      !scopesEqual(
        sumScopes(report.results, 'ocrUncertaintyScopes'),
        report.aggregateUncertaintyScopes.ocr
      )
    ) {
      context.addIssue({ code: 'custom', message: 'OCR aggregate must match results' })
    }
    if (report.durations) {
      const durationIds = report.durations.cases.map(duration => duration.syntheticId)
      if (durationIds.some((id, index) => id !== ids[index])) {
        context.addIssue({ code: 'custom', message: 'duration IDs must correspond to results' })
      }
      const durationTotal = report.durations.cases.reduce(
        (total, duration) => total + duration.durationMs,
        0
      )
      if (durationTotal !== report.durations.totalMs) {
        context.addIssue({ code: 'custom', message: 'duration total must match cases' })
      }
    }
  })

export type BenchmarkReport = z.infer<typeof BenchmarkReportSchema>

const BenchmarkCasesSchema = z
  .array(BenchmarkCaseSchema)
  .length(8)
  .superRefine((cases, context) => {
    if (new Set(cases.map(item => item.syntheticId)).size !== cases.length) {
      context.addIssue({ code: 'custom', message: 'case IDs must be unique' })
    }
  })

export class BenchmarkBoundaryError extends Error {
  readonly name = 'BenchmarkBoundaryError'
  readonly issueCount: number

  constructor(
    readonly code: 'INVALID_CASES' | 'INVALID_REPORT',
    zodError: z.ZodError
  ) {
    super(
      code === 'INVALID_CASES' ? 'Invalid synthetic benchmark cases' : 'Invalid benchmark report'
    )
    this.issueCount = zodError.issues.length
    this.stack = `${this.name}: ${this.message}`
  }
}

export function parseBenchmarkCases(input: unknown): readonly BenchmarkCase[] {
  const parsed = BenchmarkCasesSchema.safeParse(input)
  if (!parsed.success) throw new BenchmarkBoundaryError('INVALID_CASES', parsed.error)
  return parsed.data
}

export function parseBenchmarkReport(input: unknown): BenchmarkReport {
  const parsed = BenchmarkReportSchema.safeParse(input)
  if (!parsed.success) throw new BenchmarkBoundaryError('INVALID_REPORT', parsed.error)
  return parsed.data
}
