import { describe, expect, test } from 'bun:test'
import { envSchema } from '../../src/config/env'
import { validatePdfPageLimit } from '../../src/core/services/messages/pdf-utils/process-pdf-helpers'
import { PdfLimitError } from '../../src/core/services/messages/pdf-utils/process-pdf.types'

const requiredEnvironment = {
  BASE_URL: 'https://api.example.com',
  OPENAI_API_KEY: 'test-openai-key',
  OPENAI_MODEL_TEXT: 'test-model',
  JOBS_TOKEN: 'test-jobs-token',
  TOKEN: 'test-token',
}

describe('PDF page policy', () => {
  test('keeps the default at 300 PDF pages when the setting is omitted', () => {
    // Given
    const input = requiredEnvironment
    // When
    const parsed = envSchema.parse(input)
    // Then
    expect(parsed.MAX_PDF_PAGES).toBe(300)
  })

  test('accepts 500 PDF pages without increasing OCR or file-size limits', () => {
    // Given
    const input = {
      ...requiredEnvironment,
      MAX_PDF_PAGES: '500',
      MAX_OCR_PAGES_PER_PDF: '150',
      MAX_TOTAL_OCR_PAGES_PER_JOB: '300',
    }
    // When
    const parsed = envSchema.parse(input)
    // Then
    expect(parsed).toMatchObject({
      MAX_PDF_PAGES: 500,
      MAX_OCR_PAGES_PER_PDF: 150,
      MAX_TOTAL_OCR_PAGES_PER_JOB: 300,
      EXTRACTION_MAX_FILE_BYTES: 104_857_600,
    })
  })

  test('rejects a configured PDF cap above 500', () => {
    // Given
    const input = { ...requiredEnvironment, MAX_PDF_PAGES: '501' }
    // When
    const parsed = envSchema.safeParse(input)
    // Then
    expect(parsed.success).toBe(false)
  })

  test.each([350, 500])('passes the page-count gate for %i pages under 500', totalPages => {
    // Given
    const maxPdfPages = 500
    // When
    const error = validatePdfPageLimit(totalPages, maxPdfPages)
    // Then
    expect(error).toBeNull()
  })

  test('rejects 501 pages with the PDF page-limit error under 500', () => {
    // Given
    const maxPdfPages = 500
    // When
    const error = validatePdfPageLimit(501, maxPdfPages)
    // Then
    expect(error).toBeInstanceOf(PdfLimitError)
    expect(error).toMatchObject({ code: 'PDF_PAGE_LIMIT_EXCEEDED' })
  })
})
