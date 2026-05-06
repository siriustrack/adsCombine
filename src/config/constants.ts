export const PROCESSING_TIMEOUTS = {
  DOWNLOAD: 60000, // 60 segundos para downloads HTTP compartilhados
  TXT: 10000, // 10 segundos
  IMAGE: 45000, // 45 segundos
  DOCX: 20000, // 20 segundos
  DOC: 20000, // 20 segundos
  PDF_GLOBAL: 600000, // 10 minutos
  PDF_NATIVE_TEXT: 120000, // 2 minutos para extração nativa via pdf-parse
  PDF_METADATA: 30000, // 30 segundos para metadados de imagem/tabela via pdf-parse
  PDF_PARSER_DESTROY: 5000, // 5 segundos para liberar recursos do parser
  OPENAI: 30000, // 30 segundos,
  AUDIO: 120000, // 2 minutos
  XLSX: 20000, // 20 segundos
} as const;
