import z from 'zod'

export const environmentBoolean = z.preprocess(value => {
  if (typeof value !== 'string') return value

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return value
}, z.boolean())

export const envSchema = z.object({
  BASE_URL: z.string(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_TEXT: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  PROCESSING_CONCURRENCY: z.coerce.number().int().positive().max(10).default(5),
  PDF_OCR_ALWAYS_THRESHOLD: z.coerce.number().int().positive().max(50).default(5),
  PDF_BYTES_PER_PAGE_THRESHOLD: z.coerce.number().default(50_000),
  JOBS_TOKEN: z.string().min(1),
  JOBS_MAX_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  JOBS_MAX_QUEUE_SIZE: z.coerce.number().int().positive().max(1_000).default(100),
  JOBS_RETENTION_HOURS: z.coerce.number().int().positive().max(168).default(24),
  JOB_STALE_AFTER_MS: z.coerce.number().int().positive().max(3_600_000).default(3_600_000),
  EXTRACTION_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(104_857_600)
    .default(104_857_600),
  MAX_FILES_PER_JOB: z.coerce.number().int().positive().max(10).default(10),
  MAX_PDF_PAGES: z.coerce.number().int().positive().max(300).default(300),
  MAX_OCR_PAGES_PER_PDF: z.coerce.number().int().positive().max(150).default(150),
  MAX_TOTAL_OCR_PAGES_PER_JOB: z.coerce.number().int().positive().max(1_000).default(200),
  OCR_MAX_PAGES_PER_CHUNK: z.coerce.number().int().positive().max(10).default(2),
  MIXED_PAGE_OCR_DIRECT_MAX_PAGES: z.coerce.number().int().positive().max(50).default(10),
  MIXED_PAGE_MIN_NATIVE_CHARS_PER_PAGE: z.coerce.number().int().positive().default(80),
  GEMINI_API_KEY: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_STORAGE_URL: z.url().optional(),
  STORAGE_URL: z.url().optional(),
  FILE_DOWNLOAD_ALLOWED_URL_PREFIXES: z.string().min(1).optional(),
  VISUAL_FALLBACK_ENABLED: environmentBoolean.default(false),
  VISUAL_FALLBACK_SHADOW_MODE: environmentBoolean.default(true),
  VISUAL_FALLBACK_MODEL: z.string().min(1).default('gemini-2.5-flash'),
  VISUAL_FALLBACK_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(15_000),
  VISUAL_FALLBACK_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  VISUAL_FALLBACK_CONCURRENCY: z.coerce.number().int().positive().max(4).default(1),
  VISUAL_FALLBACK_MAX_PAGES_PER_PDF: z.coerce.number().int().positive().max(10).default(2),
  MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB: z.coerce.number().int().positive().max(20).default(4),
  TOKEN: z.string().min(1),
  // Toggle to enable/disable request/route logs ("true"/"false")
  REQUEST_LOGS_ENABLED: environmentBoolean.default(false),
})

export const env = envSchema.parse(process.env)
