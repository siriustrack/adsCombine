import type { ProcessMessage } from 'api/controllers/messages.controllers'
import type { VisualFallbackMetadata } from '../messages/pdf-utils/visual-fallback.types'

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired'

export type ProcessMessageJobResult = {
  conversationId: string
  processedFiles: string[]
  failedFiles: Array<{ fileId: string; error: string }>
  filename: string
  downloadUrl: string
}

export type EnhancedOcrPageQuality = {
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
  visualFallback?: VisualFallbackMetadata
}

export type EnhancedOcrFileResult = {
  fileId: string
  summary?: string
  pageQuality?: EnhancedOcrPageQuality[]
}

export type EnhancedOcrJobResult = {
  profile: 'enhanced-ocr'
  summary?: {
    fileCount: number
    pageCount: number
    averageConfidence?: number
    totalWordCount: number
    warningCount: number
  }
  files: EnhancedOcrFileResult[]
}

export type ProcessMessageJobRecord = {
  id: string
  type: 'process-message'
  status: JobStatus
  request: ProcessMessage
  host: string
  protocol: string
  result?: ProcessMessageJobResult
  profile?: 'enhanced-ocr'
  enhancedResult?: EnhancedOcrJobResult
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

export type CreateProcessMessageJobInput = {
  messages: ProcessMessage
  host: string
  protocol: string
  profile?: 'enhanced-ocr'
}
