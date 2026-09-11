import type { envSchema } from '@config/env'
import type z from 'zod'
import type { VisualFallbackConfig } from './visual-fallback.types'

type VisualFallbackEnvironment = Pick<
  z.infer<typeof envSchema>,
  | 'DEEPSEEK_API_KEY'
  | 'GEMINI_API_KEY'
  | 'MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB'
  | 'VISUAL_FALLBACK_CONCURRENCY'
  | 'VISUAL_FALLBACK_ENABLED'
  | 'VISUAL_FALLBACK_MAX_ALIGNMENT_CELLS'
  | 'VISUAL_FALLBACK_MAX_PAGES_PER_PDF'
  | 'VISUAL_FALLBACK_MAX_RETRIES'
  | 'VISUAL_FALLBACK_MODEL'
  | 'VISUAL_FALLBACK_PROVIDER'
  | 'VISUAL_RECONCILIATION_POLICY_VERSION'
  | 'VISUAL_FALLBACK_SHADOW_MODE'
  | 'VISUAL_FALLBACK_TIMEOUT_MS'
>

export function createVisualFallbackConfig(
  environment: VisualFallbackEnvironment
): VisualFallbackConfig {
  const provider = environment.VISUAL_FALLBACK_PROVIDER
  const policyAllowsProvider =
    environment.VISUAL_RECONCILIATION_POLICY_VERSION !== 'gemini-whole-page-critical-v2' ||
    provider === 'gemini'
  return {
    enabled:
      environment.VISUAL_FALLBACK_ENABLED &&
      policyAllowsProvider &&
      Boolean(provider === 'gemini' ? environment.GEMINI_API_KEY : environment.DEEPSEEK_API_KEY),
    shadowMode: environment.VISUAL_FALLBACK_SHADOW_MODE,
    provider,
    model:
      environment.VISUAL_FALLBACK_MODEL ??
      (provider === 'deepseek' ? 'deepseek-v4-flash-vision-exp' : 'gemini-2.5-flash'),
    timeoutMs: environment.VISUAL_FALLBACK_TIMEOUT_MS,
    maxRetries: environment.VISUAL_FALLBACK_MAX_RETRIES,
    concurrency: environment.VISUAL_FALLBACK_CONCURRENCY,
    maxAlignmentCells: environment.VISUAL_FALLBACK_MAX_ALIGNMENT_CELLS,
    maxPagesPerPdf: environment.VISUAL_FALLBACK_MAX_PAGES_PER_PDF,
    reconciliationPolicyVersion: environment.VISUAL_RECONCILIATION_POLICY_VERSION,
  }
}
