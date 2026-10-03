import { describe, expect, test } from 'bun:test'
import { envSchema } from '../../src/config/env'
import { PdfLimitError } from '../../src/core/services/messages/pdf-utils/process-pdf.types'
import { validatePdfPageLimit } from '../../src/core/services/messages/pdf-utils/process-pdf-helpers'

const requiredEnvironment = {
  BASE_URL: 'https://api.example.com',
  OPENAI_API_KEY: 'test-openai-key',
  OPENAI_MODEL_TEXT: 'test-model',
  JOBS_TOKEN: 'test-jobs-token',
  TOKEN: 'test-token',
}

describe('PDF page policy', () => {
  test('keeps the default at 1000 PDF pages when the setting is omitted', () => {
    // Given
    const input = requiredEnvironment
    // When
    const parsed = envSchema.parse(input)
    // Then
    expect(parsed).toMatchObject({
      MAX_PDF_PAGES: 1_000,
      MAX_OCR_PAGES_PER_PDF: 1_000,
      MAX_TOTAL_OCR_PAGES_PER_JOB: 1_000,
    })
  })

  test('accepts a 1000-page configuration', () => {
    // Given
    const input = {
      ...requiredEnvironment,
      MAX_PDF_PAGES: '1000',
      MAX_OCR_PAGES_PER_PDF: '1000',
      MAX_TOTAL_OCR_PAGES_PER_JOB: '1000',
    }
    // When
    const parsed = envSchema.parse(input)
    // Then
    expect(parsed).toMatchObject({
      MAX_PDF_PAGES: 1_000,
      MAX_OCR_PAGES_PER_PDF: 1_000,
      MAX_TOTAL_OCR_PAGES_PER_JOB: 1_000,
      EXTRACTION_MAX_FILE_BYTES: 104_857_600,
    })
  })

  test('rejects a configured PDF cap above 1000', () => {
    // Given
    const input = { ...requiredEnvironment, MAX_PDF_PAGES: '1001' }
    // When
    const parsed = envSchema.safeParse(input)
    // Then
    expect(parsed.success).toBe(false)
  })

  test.each([500, 647, 1_000])('passes the page-count gate for %i pages under 1000', totalPages => {
    // Given
    const maxPdfPages = 1_000
    // When
    const error = validatePdfPageLimit(totalPages, maxPdfPages)
    // Then
    expect(error).toBeNull()
  })

  test('rejects 1001 pages with the PDF page-limit error under 1000', () => {
    // Given
    const maxPdfPages = 1_000
    // When
    const error = validatePdfPageLimit(1_001, maxPdfPages)
    // Then
    expect(error).toBeInstanceOf(PdfLimitError)
    expect(error).toMatchObject({ code: 'PDF_PAGE_LIMIT_EXCEEDED' })
  })
})
