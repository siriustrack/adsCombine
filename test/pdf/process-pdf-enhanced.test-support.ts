import {
  type EnhancedOcrLimits,
  validateEnhancedOcrLimits,
} from '../../src/core/services/messages/pdf-utils/ocr-orchestrator.service'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import type { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'

export const enhancedPdfFile = {
  fileId: 'file-1',
  url: 'https://example.com/file.pdf',
  mimeType: 'application/pdf',
}

export function createEnhancedPdfService(
  totalPages: number,
  extractedText = '',
  visualFallbackService?: Pick<VisualFallbackService, 'execute'>
) {
  let enhancedCalls = 0
  const service = new ProcessPdfService(
    {
      async downloadFile() {
        return { value: { buffer: Buffer.from('pdf'), contentLength: 3 }, error: undefined }
      },
    },
    {
      async extractTextFromPdf(_buffer, _fileId, _options = {}) {
        return {
          value: {
            text: extractedText,
            totalPages,
            pages: Array.from({ length: totalPages }, (_, index) => ({
              pageNumber: index + 1,
              text: '',
              embeddedImageCount: 0,
              tableCount: 0,
              hasVisualContent: false,
            })),
          },
          error: undefined,
        }
      },
    },
    undefined,
    {
      async processWithOcr() {
        throw new Error('legacy OCR must not run')
      },
      async processPagesWithOcr() {
        throw new Error('selected-page OCR must not run')
      },
      async processWithEnhancedOcr({ maxOcrPagesPerPdf, ocrPageBudget }: EnhancedOcrLimits = {}) {
        const limitError = validateEnhancedOcrLimits(totalPages, {
          maxOcrPagesPerPdf,
          ocrPageBudget,
        })
        if (limitError) return { value: undefined, error: limitError }
        enhancedCalls++
        return {
          value: {
            ocrText: 'enhanced text',
            totalPages,
            pages: Array.from({ length: totalPages }, (_, index) => ({
              pageNumber: index + 1,
              text: 'enhanced text',
              meanConfidence: 90,
              wordCount: 2,
              warnings: [],
            })),
            chunksProcessed: 1,
            processingTime: 1,
          },
          error: undefined,
        }
      },
    },
    visualFallbackService
  )

  return { service, getEnhancedCalls: () => enhancedCalls }
}
