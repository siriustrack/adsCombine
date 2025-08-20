export const PROCESSING_TIMEOUTS = {
  TXT: 10000, // 10 segundos
  IMAGE: 45000, // 45 segundos
  DOCX: 20000, // 20 segundos
  PDF_GLOBAL: 600000, // 10 minutos
  OPENAI: 30000, // 30 segundos
} as const;
