import type { EnhancedPdfMetadata } from '../process-messages.types'
import type { PdfPageText } from './pdf-text-extractor.service'
import type { PageTextClassification, PageTextDiagnostics } from './text-quality-analyzer.service'

export type ProcessPdfOptions = {
  maxFileBytes?: number
  mode?: 'legacy' | 'mixed-page' | 'enhanced'
  maxPdfPages?: number
  maxOcrPagesPerPdf?: number
  ocrPageBudget?: {
    reserve(pageCount: number): boolean
    remaining(): number
  }
  onEnhancedMetadata?: (metadata: EnhancedPdfMetadata) => void
}

export type PageOcrDecisionReason =
  | 'visual-content'
  | 'ocr-indicators'
  | 'insufficient-native-text'
  | 'quality-analysis-skip'
  | 'native-text-sufficient'

export type MixedPageDiagnostics = {
  pageNumber: number
  embeddedImageCount: number
  tableCount: number
  hasVisualContent: boolean
  shouldOcr: boolean
  ocrDecisionReason: PageOcrDecisionReason
  textDiagnostics: PageTextDiagnostics
}

export type PageClassificationCounts = Record<PageTextClassification, number>

export type PdfTextData = {
  text: string
  totalPages: number
  pages: PdfPageText[]
}

export class PdfLimitError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'PdfLimitError'
  }
}
