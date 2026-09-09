import { describe, expect, test } from 'bun:test'
import { envSchema } from '../../src/config/env'

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

    expect(parsed.VISUAL_FALLBACK_TIMEOUT_MS).toBe(15_000)
    expect(parsed.VISUAL_FALLBACK_MAX_RETRIES).toBe(1)
    expect(parsed.VISUAL_FALLBACK_CONCURRENCY).toBe(1)
    expect(parsed.VISUAL_FALLBACK_MAX_PAGES_PER_PDF).toBe(2)
    expect(parsed.MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB).toBe(4)
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
