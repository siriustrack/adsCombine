import z from 'zod';

const envSchema = z.object({
  BASE_URL: z.string(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_TEXT: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  PROCESSING_CONCURRENCY: z.coerce.number().default(5),
  PDF_OCR_ALWAYS_THRESHOLD: z.coerce.number().default(5),
  PDF_BYTES_PER_PAGE_THRESHOLD: z.coerce.number().default(50_000),
  JOBS_TOKEN: z.string().min(1),
  JOBS_MAX_CONCURRENCY: z.coerce.number().int().positive().default(1),
  JOBS_MAX_QUEUE_SIZE: z.coerce.number().int().positive().default(100),
  JOBS_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  JOB_STALE_AFTER_MS: z.coerce.number().int().positive().default(3_600_000),
  EXTRACTION_MAX_FILE_BYTES: z.coerce.number().int().positive().default(104_857_600),
  MAX_FILES_PER_JOB: z.coerce.number().int().positive().default(10),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(300),
  MAX_OCR_PAGES_PER_PDF: z.coerce.number().int().positive().default(150),
  MAX_TOTAL_OCR_PAGES_PER_JOB: z.coerce.number().int().positive().default(200),
  TOKEN: z.string().min(1),
  // Toggle to enable/disable request/route logs ("true"/"false")
  REQUEST_LOGS_ENABLED: z.coerce.boolean().default(false),
});

export const env = envSchema.parse(process.env);
