import type { EnhancedOcrPageMetadata } from '../../src/core/services/messages/pdf-utils/enhanced-ocr.types'
import {
  VisualFallbackService,
  type VisualTranscriptionProvider,
} from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

export function visualFallbackPage(
  overrides: Partial<EnhancedOcrPageMetadata> & {
    text?: string
    sourceRange?: { start: number; end: number }
  } = {}
) {
  return {
    pageNumber: 1,
    text: 'Matrícula nº 12.345\nR.22\nÁrea 408.737 m²',
    meanConfidence: 98,
    wordCount: 12,
    selectedAttempt: { label: 'orig', psm: 4 },
    legalSignals: {
      registryMarkers: 2,
      legalMarkers: 0,
      cpfCnpj: 0,
      dates: 0,
      currency: 0,
      fractions: 0,
      squareMeters: 1,
      corruptedSymbols: 0,
      fragmentedNumbersOrMeasures: 0,
      duplicateLabels: 0,
      garbledSpans: 0,
    },
    warnings: [],
    ...overrides,
  }
}

export function createVisualFallbackService(
  provider: VisualTranscriptionProvider,
  options: Partial<ConstructorParameters<typeof VisualFallbackService>[2]> = {}
) {
  const renderedPages: number[][] = []
  const service = new VisualFallbackService(
    {
      async renderPages(_buffer, pageNumbers) {
        renderedPages.push(pageNumbers)
        return pageNumbers.map(pageNumber => ({
          pageNumber,
          image: Buffer.from(`page-${pageNumber}`),
        }))
      },
    },
    provider,
    {
      enabled: true,
      shadowMode: false,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 1,
      concurrency: 1,
      maxPagesPerPdf: 2,
      ...options,
    }
  )

  return { service, renderedPages }
}
