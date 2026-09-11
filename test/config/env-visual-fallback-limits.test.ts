import { describe, expect, test } from 'bun:test'
import { envSchema } from '../../src/config/env'
import { createVisualFallbackConfig } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

const requiredEnvironment = {
  BASE_URL: 'https://api.example.com',
  OPENAI_API_KEY: 'test-openai-key',
  OPENAI_MODEL_TEXT: 'test-model',
  JOBS_TOKEN: 'test-jobs-token',
  TOKEN: 'test-token',
}

describe('visual fallback environment limits', () => {
  test.each([
    ['false', false],
    ['0', false],
  ] as const)('parses REQUEST_LOGS_ENABLED=%s as %s', (value, expected) => {
    const parsed = envSchema.parse({
      ...requiredEnvironment,
      REQUEST_LOGS_ENABLED: value,
    })

    expect(parsed.REQUEST_LOGS_ENABLED).toBe(expected)
  })

  test('preserves the existing defaults', () => {
    const parsed = envSchema.parse(requiredEnvironment)

    expect(parsed.VISUAL_FALLBACK_PROVIDER).toBe('gemini')
    expect(parsed.VISUAL_FALLBACK_MODEL).toBeUndefined()
    expect(createVisualFallbackConfig(parsed).model).toBe('gemini-2.5-flash')
    expect(parsed.VISUAL_FALLBACK_TIMEOUT_MS).toBe(15_000)
    expect(parsed.VISUAL_FALLBACK_MAX_RETRIES).toBe(1)
    expect(parsed.VISUAL_FALLBACK_CONCURRENCY).toBe(1)
    expect(parsed.VISUAL_FALLBACK_MAX_PAGES_PER_PDF).toBe(2)
    expect(parsed.MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB).toBe(4)
    expect(parsed.VISUAL_RECONCILIATION_POLICY_VERSION).toBe('safe-visual-v1')
  })

  test('selects the DeepSeek default model only when the DeepSeek provider is selected', () => {
    const parsed = envSchema.parse({
      ...requiredEnvironment,
      VISUAL_FALLBACK_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'test-deepseek-key',
    })

    expect(parsed.VISUAL_FALLBACK_PROVIDER).toBe('deepseek')
    expect(parsed.VISUAL_FALLBACK_MODEL).toBeUndefined()
    expect(parsed.DEEPSEEK_API_KEY).toBe('test-deepseek-key')
    expect(createVisualFallbackConfig(parsed)).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v4-flash-vision-exp',
      enabled: false,
    })
  })

  test('requires the selected provider key before enabling visual fallback', () => {
    const parsed = envSchema.parse({
      ...requiredEnvironment,
      VISUAL_FALLBACK_ENABLED: 'true',
      VISUAL_FALLBACK_PROVIDER: 'deepseek',
    })

    expect(createVisualFallbackConfig(parsed).enabled).toBe(false)
  })

  test('rejects unsupported visual fallback providers', () => {
    expect(
      envSchema.safeParse({ ...requiredEnvironment, VISUAL_FALLBACK_PROVIDER: 'other' }).success
    ).toBe(false)
  })

  test.each(['safe-visual-v1', 'gemini-whole-page-critical-v2'] as const)(
    'accepts reconciliation policy %s',
    policyVersion => {
      const parsed = envSchema.parse({
        ...requiredEnvironment,
        VISUAL_RECONCILIATION_POLICY_VERSION: policyVersion,
      })

      expect(parsed.VISUAL_RECONCILIATION_POLICY_VERSION).toBe(policyVersion)
    }
  )

  test('rejects unsupported reconciliation policies', () => {
    expect(
      envSchema.safeParse({
        ...requiredEnvironment,
        VISUAL_RECONCILIATION_POLICY_VERSION: 'unsafe-v3',
      }).success
    ).toBe(false)
  })

  test('disables active V2 configuration for a non-Gemini provider', () => {
    const parsed = envSchema.parse({
      ...requiredEnvironment,
      VISUAL_FALLBACK_ENABLED: 'true',
      VISUAL_FALLBACK_PROVIDER: 'deepseek',
      VISUAL_RECONCILIATION_POLICY_VERSION: 'gemini-whole-page-critical-v2',
      DEEPSEEK_API_KEY: 'test-deepseek-key',
    })

    expect(createVisualFallbackConfig(parsed).enabled).toBe(false)
  })

  test.each([
    'VISUAL_FALLBACK_TIMEOUT_MS',
    'VISUAL_FALLBACK_MAX_RETRIES',
    'VISUAL_FALLBACK_CONCURRENCY',
    'VISUAL_FALLBACK_MAX_PAGES_PER_PDF',
    'MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB',
  ] as const)('rejects an unsafe %s value', setting => {
    const parsed = envSchema.safeParse({
      ...requiredEnvironment,
      [setting]: Number.MAX_SAFE_INTEGER,
    })

    expect(parsed.success).toBe(false)
  })

  test.each([
    'PROCESSING_CONCURRENCY',
    'JOBS_MAX_CONCURRENCY',
    'JOBS_MAX_QUEUE_SIZE',
    'JOBS_RETENTION_HOURS',
    'JOB_STALE_AFTER_MS',
    'EXTRACTION_MAX_FILE_BYTES',
    'MAX_FILES_PER_JOB',
    'MAX_PDF_PAGES',
    'MAX_OCR_PAGES_PER_PDF',
    'MAX_TOTAL_OCR_PAGES_PER_JOB',
    'OCR_MAX_PAGES_PER_CHUNK',
    'MIXED_PAGE_OCR_DIRECT_MAX_PAGES',
  ] as const)('rejects excessive operational value for %s', setting => {
    const parsed = envSchema.safeParse({
      ...requiredEnvironment,
      [setting]: Number.MAX_SAFE_INTEGER,
    })

    expect(parsed.success).toBe(false)
  })
})
