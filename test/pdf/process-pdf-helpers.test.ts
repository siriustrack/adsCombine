import { describe, expect, test } from 'bun:test'
import { env } from '../../src/config/env'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import {
  shouldBypassOcr,
  shouldUseFileSizeOcrHeuristic,
} from '../../src/core/services/messages/pdf-utils/process-pdf-helpers'
import {
  type TextQualityAnalysis,
  TextQualityAnalyzer,
} from '../../src/core/services/messages/pdf-utils/text-quality-analyzer.service'
import { okResult } from '../../src/lib/result.types'

const strongQualityWithOcrIndicators: TextQualityAnalysis = {
  shouldSkipOcr: true,
  isHighQuality: true,
  isRepetitive: false,
  hasOcrIndicators: true,
  hasSubstantialContent: true,
  qualityScore: 90,
}

describe('PDF OCR bypass policy', () => {
  test('does not let file size override strong native document text', () => {
    const bypass = shouldBypassOcr({
      extractedText: 'Texto normativo nativo preservado. '.repeat(35_000),
      totalPages: 400,
      qualityAnalysis: strongQualityWithOcrIndicators,
    })

    expect(bypass.hasStrongDirectText).toBe(true)
    expect(bypass.shouldSkipOcr).toBe(true)
    expect(
      shouldUseFileSizeOcrHeuristic({
        hasStrongDirectText: bypass.hasStrongDirectText,
        qualityAnalysis: strongQualityWithOcrIndicators,
      })
    ).toBe(false)
  })

  test('retains the file-size check for borderline text with OCR indicators', () => {
    expect(
      shouldUseFileSizeOcrHeuristic({
        hasStrongDirectText: false,
        qualityAnalysis: strongQualityWithOcrIndicators,
      })
    ).toBe(true)
  })

  test('skips the file-size check when borderline text has no OCR indicators', () => {
    expect(
      shouldUseFileSizeOcrHeuristic({
        hasStrongDirectText: false,
        qualityAnalysis: { ...strongQualityWithOcrIndicators, hasOcrIndicators: false },
      })
    ).toBe(false)
  })

  test('preserves strong native text in a large legacy PDF without calling OCR', async () => {
    const totalPages = env.PDF_OCR_ALWAYS_THRESHOLD + 1
    const nativeText = 'Texto normativo nativo preservado.\n'.repeat(Math.max(300, totalPages * 30))
    const buffer = Buffer.alloc(
      Math.ceil(Math.max(0, env.PDF_BYTES_PER_PAGE_THRESHOLD) + 1) * totalPages
    )
    let ocrCalls = 0
    class FixedQualityAnalyzer extends TextQualityAnalyzer {
      override analyze(): TextQualityAnalysis {
        return { ...strongQualityWithOcrIndicators, shouldSkipOcr: false }
      }
    }
    const service = new ProcessPdfService(
      {
        async downloadFile() {
          return okResult({ buffer })
        },
      },
      {
        async extractTextFromPdf() {
          return okResult({ text: nativeText, totalPages, pages: [] })
        },
      },
      new FixedQualityAnalyzer(),
      {
        async processWithOcr() {
          ocrCalls++
          return okResult({
            ocrText: 'Texto OCR alternativo',
            chunksProcessed: 1,
            processingTime: 0,
          })
        },
        async processPagesWithOcr() {
          throw new Error('Unexpected mixed-page OCR')
        },
        async processWithEnhancedOcr() {
          throw new Error('Unexpected enhanced OCR')
        },
      }
    )

    const result = await service.execute({
      fileId: 'strong-native-pdf',
      url: 'https://example.com/synthetic.pdf',
      mimeType: 'application/pdf',
    })

    expect(result.error).toBeNull()
    expect(result.value).toBe(nativeText.trim())
    expect(ocrCalls).toBe(0)
  })
})
