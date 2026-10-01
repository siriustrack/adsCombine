import type { ProcessMessage } from 'api/controllers/messages.controllers'
import type { EnhancedTextSelection } from '../messages/pdf-utils/enhanced-text-selection'
import type { VisualFallbackMetadata } from '../messages/pdf-utils/visual-fallback.types'
import type { VisualFallbackFileSummary } from '../messages/process-messages.types'

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'expired'

export type ProcessMessageJobResult = {
  conversationId: string
  processedFiles: string[]
  failedFiles: Array<{ fileId: string; error: string }>
  filename: string
  downloadUrl?: string
  downloadExpiresAt?: string
  transcriptionText?: string
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
  pageCount?: number
  metricsSource?: 'ocr'
  textSelection?: EnhancedTextSelection
  visualFallbackSummary?: VisualFallbackFileSummary
  pageQuality?: EnhancedOcrPageQuality[]
}

export type EnhancedOcrJobResult = {
  schemaVersion?: 'enhanced-ocr/v2'
  profile: 'enhanced-ocr'
  summary?: {
    fileCount: number
    pageCount: number
    averageConfidence?: number
    totalWordCount: number
    warningCount: number
    metricsSource?: 'ocr'
    warningPageCount?: number
    warningsByType?: Record<string, number>
    textSelection?: {
      nativeFileCount: number
      enhancedFileCount: number
      byReason: Record<EnhancedTextSelection['reason'], number>
    }
    visual?: Omit<VisualFallbackFileSummary, 'status'> & {
      filesByStatus: Record<VisualFallbackFileSummary['status'], number>
    }
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
