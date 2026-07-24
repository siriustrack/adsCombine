import type { FileInfo } from 'api/controllers/messages.controllers'

export type ProcessMessagesOptions = {
  includeReadableErrorBlocks?: boolean
  pdfMode?: 'legacy' | 'mixed-page'
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
