import type { EnhancedOcrSignals } from './enhanced-ocr.types'

export type VisualFallbackState =
  | 'ocr_only'
  | 'fallback_pending'
  | 'fallback_failed'
  | 'ocr_plus_visual_candidate'
  | 'reconciled'
  | 'conflict'

export type VisualFallbackReason =
  | 'corrupted-symbols'
  | 'fragmented-number-or-measure'
  | 'garbled-spans'
  | 'missing-legal-marker'
  | 'missing-measure'

export type VisualFallbackProvenance = {
  provider: 'gemini'
  model: string
  imageSha256: string
  candidateSha256: string
}

export type VisualFallbackMetadata = {
  state: VisualFallbackState
  reasons: VisualFallbackReason[]
  offsetEncoding: 'utf16_code_units'
  sourceRange?: { start: number; end: number }
  riskySpans?: Array<{ start: number; end: number }>
  provenance?: VisualFallbackProvenance
}

export type VisualFallbackOcrPage = {
  pageNumber: number
  text: string
  sourceRange?: { start: number; end: number }
  legalSignals?: EnhancedOcrSignals
}

export type RenderedPdfPage = {
  pageNumber: number
  image: Buffer
}

export type VisualTranscriptionResponse =
  | { status: 'transcribed'; transcription: string; confidence?: number }
  | { status: 'abstain' }

export interface VisualTranscriptionProvider {
  transcribe(input: {
    image: Buffer
    pageNumber: number
    model: string
    signal: AbortSignal
  }): Promise<VisualTranscriptionResponse>
}

export interface PdfPageRenderer {
  renderPages(
    buffer: Buffer,
    pageNumbers: number[],
    signal?: AbortSignal
  ): Promise<RenderedPdfPage[]>
}

export type VisualFallbackConfig = {
  enabled: boolean
  shadowMode: boolean
  model: string
  timeoutMs: number
  maxRetries: number
  concurrency: number
  maxPagesPerPdf: number
}
