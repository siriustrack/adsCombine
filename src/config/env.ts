import z from 'zod';

const envSchema = z.object({
  BASE_URL: z.string(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL_IMAGE: z.string().min(1),
  OPENAI_MODEL_TEXT: z.string().min(1),
  PORT: z.coerce.number().default(3000),
  PROCESSING_CONCURRENCY: z.coerce.number().default(5),
  STABILITY_API_KEY: z.string().min(1),
  TOKEN: z.string().min(1),
  // Toggle to enable/disable request/route logs ("true"/"false")
  REQUEST_LOGS_ENABLED: z.coerce.boolean().default(false),
});

export const env = envSchema.parse(process.env);
