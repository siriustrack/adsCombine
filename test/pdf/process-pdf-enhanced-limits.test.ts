import { describe, expect, test } from 'bun:test'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import {
  validateEnhancedOcrLimits,
  type EnhancedOcrLimits,
} from '../../src/core/services/messages/pdf-utils/ocr-orchestrator.service'
import { PdfLimitError } from '../../src/core/services/messages/pdf-utils/process-pdf.types'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'

function createEnhancedPdfService(totalPages: number, extractedText = '') {
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
      async processWithEnhancedOcr({
        maxOcrPagesPerPdf,
        ocrPageBudget,
      }: EnhancedOcrLimits = {}) {
        const limits = { maxOcrPagesPerPdf, ocrPageBudget }
        const limitError = validateEnhancedOcrLimits(totalPages, limits)
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
    }
  )

  return { service, getEnhancedCalls: () => enhancedCalls }
}

const file = { fileId: 'file-1', url: 'https://example.com/file.pdf', mimeType: 'application/pdf' }

describe('ProcessPdfService enhanced OCR limits', () => {
  test('rejects enhanced all-page OCR above maxOcrPagesPerPdf before OCR begins', async () => {
    const { service, getEnhancedCalls } = createEnhancedPdfService(3)

    const result = await service.executeEnhanced(file, { maxOcrPagesPerPdf: 2 })

    expect(result.error).toBeInstanceOf(PdfLimitError)
    expect(result.error).toMatchObject({ code: 'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED' })
    expect(getEnhancedCalls()).toBe(0)
  })

  test('reserves every enhanced page against the job budget before OCR begins', async () => {
    const { service, getEnhancedCalls } = createEnhancedPdfService(3)
    const reserved: number[] = []
    const budget = {
      reserve(pageCount: number) {
        reserved.push(pageCount)
        return false
      },
      remaining() {
        return 2
      },
    }

    const result = await service.executeEnhanced(file, { ocrPageBudget: budget })

    expect(reserved).toEqual([3])
    expect(result.error).toBeInstanceOf(PdfLimitError)
    expect(result.error).toMatchObject({ code: 'OCR_PAGES_PER_JOB_LIMIT_EXCEEDED' })
    expect(getEnhancedCalls()).toBe(0)
  })

  test('enforces limits against the effective pdfinfo page count', () => {
    const error = validateEnhancedOcrLimits(5, { maxOcrPagesPerPdf: 3 })

    expect(error).toBeInstanceOf(PdfLimitError)
    expect(error).toMatchObject({ code: 'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED' })
  })

  test('does not bypass an enhanced OCR limit by falling back to native text', async () => {
    const { service } = createEnhancedPdfService(3, 'texto nativo disponível')

    const result = await service.executeEnhanced(file, { maxOcrPagesPerPdf: 2 })

    expect(result.error).toBeInstanceOf(PdfLimitError)
    expect(result.error).toMatchObject({ code: 'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED' })
  })

  test('uses the effective OCR page count for enhanced metadata', async () => {
    const { service } = createEnhancedPdfService(3)
    let metadataPages = 0

    const result = await service.executeEnhanced(file, {
      onEnhancedMetadata: metadata => {
        metadataPages = metadata.pageQuality?.length ?? 0
      },
    })

    expect(result.error).toBeNull()
    expect(metadataPages).toBe(3)
  })
})
