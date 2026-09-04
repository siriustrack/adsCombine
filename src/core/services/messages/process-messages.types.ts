import type { FileInfo } from 'api/controllers/messages.controllers'

export type EnhancedPdfMetadata = {
  fileId: string
  pageQuality?: Array<{
    pageNumber: number
    qualityScore?: number
    classification?: string
    shouldOcr?: boolean
    ocrDecisionReason?: string
    confidence?: number
    wordCount?: number
    selectedAttempt?: {
      label: string
      psm: number
      rotation?: { angle: number; baselineLabel: string; scoreGain: number }
    }
    legalSignals?: {
      registryMarkers: number
      legalMarkers: number
      cpfCnpj: number
      dates: number
      currency: number
      fractions: number
      squareMeters: number
      corruptedSymbols: number
      fragmentedNumbersOrMeasures: number
      duplicateLabels: number
      garbledSpans: number
    }
    warnings?: string[]
  }>
}

export type ProcessMessagesOptions = {
  includeReadableErrorBlocks?: boolean
  pdfMode?: 'legacy' | 'mixed-page'
  enhancedOcr?: boolean
  limits?: {
    maxFileBytes?: number
    maxFiles?: number
    maxPdfPages?: number
    maxOcrPagesPerPdf?: number
    maxTotalOcrPagesPerJob?: number
  }
}

export type OcrPageBudget = {
  reserve(pageCount: number): boolean
  remaining(): number
}

export type ProcessAndHandleFileOptions = {
  file: FileInfo
  extractedTexts: string[]
  options: ProcessMessagesOptions
  ocrPageBudget?: OcrPageBudget
}

export type ProcessFileOptions = {
  file: FileInfo
  options: ProcessMessagesOptions
  ocrPageBudget?: OcrPageBudget
  enhancedPdfMetadata?: EnhancedPdfMetadata[]
}

export type ProcessWithTimeoutOptions<T> = {
  processor: () => Promise<T>
  timeout: number
  fileId: string
  fileType: string
}

export type SaveProcessedTextOptions = {
  allExtractedText: string
  conversationId: string
  protocol: string
  host: string
  processedFiles: string[]
  failedFiles: { fileId: string; error: string }[]
}
