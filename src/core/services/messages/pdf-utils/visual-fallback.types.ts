import type { EnhancedOcrSignals } from './enhanced-ocr.types'
import type { VisualComparison, VisualReconciliationDecision } from './visual-reconciliation.policy'

export const VISUAL_FALLBACK_V2_SCHEMA_VERSION = 'visual-fallback/v2' as const
export const GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION = 'gemini-whole-page-critical-v2' as const
export const CRITICAL_TOKEN_ALIGNMENT_VERSION = 'critical-token-alignment-v1' as const

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
  provider: VisualFallbackProvider
  model: string
  imageSha256: string
  candidateSha256: string
}

export type VisualFallbackProvider = 'gemini' | 'deepseek'

type VisualFallbackMetadataBase = {
  state: VisualFallbackState
  reasons: VisualFallbackReason[]
  offsetEncoding: 'utf16_code_units'
  sourceRange?: { start: number; end: number }
  riskySpans?: Array<{ start: number; end: number }>
  provenance?: VisualFallbackProvenance
}

export type VisualFallbackV1Metadata = VisualFallbackMetadataBase & {
  schemaVersion?: never
  policyVersion?: 'safe-visual-v1'
  alignmentVersion?: never
  outcome?: never
  decisionReason?: string
  selectedTextSource?: 'ocr' | 'visual'
  shadowDecision?: VisualReconciliationDecision
  comparison?: VisualComparison
}

export type CriticalCategory =
  | 'date'
  | 'cpf_cnpj'
  | 'currency'
  | 'fraction'
  | 'measurement'
  | 'registry_identifier'
  | 'registry_marker'
  | 'negation'
  | 'number'

export type CriticalDivergence =
  | 'different_value'
  | 'gemini_only'
  | 'ocr_only'
  | 'duplicate_or_reordered'

export type CriticalUncertaintyRange = {
  start: number
  end: number
  scope: 'token' | 'clause' | 'page'
  categories: CriticalCategory[]
  divergences: CriticalDivergence[]
}

type VisualFallbackV2Base = VisualFallbackMetadataBase & {
  schemaVersion: typeof VISUAL_FALLBACK_V2_SCHEMA_VERSION
  policyVersion: typeof GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION
  comparison?: never
  shadowDecision?: never
}

export type VisualFallbackV2Metadata =
  | (VisualFallbackV2Base & {
      outcome: 'selected'
      state: 'reconciled'
      selectedTextSource: 'visual'
      decisionReason: 'gemini_whole_page_selected'
      alignmentVersion: typeof CRITICAL_TOKEN_ALIGNMENT_VERSION
      criticalUncertainties: CriticalUncertaintyRange[]
      provenance: VisualFallbackProvenance
    })
  | (VisualFallbackV2Base & {
      outcome: 'shadow'
      state: 'ocr_plus_visual_candidate'
      selectedTextSource: 'ocr'
      decisionReason: 'shadow_gemini_whole_page'
      alignmentVersion: typeof CRITICAL_TOKEN_ALIGNMENT_VERSION
      criticalUncertainties: CriticalUncertaintyRange[]
      provenance: VisualFallbackProvenance
    })
  | (VisualFallbackV2Base & {
      outcome: 'unavailable'
      state: 'fallback_failed'
      selectedTextSource: 'ocr'
      decisionReason:
        | 'budget_exhausted'
        | 'render_failed'
        | 'provider_abstained'
        | 'provider_failed'
        | 'aborted'
      alignmentVersion?: never
      criticalUncertainties?: never
      provenance?: never
    })
  | (VisualFallbackV2Base & {
      outcome: 'rejected'
      state: 'conflict'
      selectedTextSource: 'ocr'
      provenance: VisualFallbackProvenance
      alignmentVersion?: typeof CRITICAL_TOKEN_ALIGNMENT_VERSION
      criticalUncertainties?: CriticalUncertaintyRange[]
      decisionReason:
        | 'candidate_empty_after_sanitization'
        | 'candidate_invalid_utf16'
        | 'candidate_truncated'
        | 'alignment_budget_exceeded'
        | 'alignment_invariant_failed'
    })

export type VisualFallbackMetadata = VisualFallbackV1Metadata | VisualFallbackV2Metadata

export type VisualFallbackOcrPage = {
  pageNumber: number
  text: string
  sourceRange?: { start: number; end: number }
  legalSignals?: EnhancedOcrSignals
  meanConfidence?: number
}

export type VisualDocumentProfile = {
  kind: 'matricula'
  transcriptionHints: readonly string[]
}

export type RenderedPdfPage = {
  pageNumber: number
  image: Buffer
}

export type VisualTranscriptionResponse =
  | { status: 'transcribed'; transcription: string; confidence?: number }
  | { status: 'abstain' }

export class VisualTranscriptionTerminalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VisualTranscriptionTerminalError'
  }
}

export interface VisualTranscriptionProvider {
  transcribe(input: {
    image: Buffer
    pageNumber: number
    model: string
    signal: AbortSignal
    documentProfile?: VisualDocumentProfile
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
  provider: VisualFallbackProvider
  model: string
  timeoutMs: number
  maxRetries: number
  concurrency: number
  maxAlignmentCells: number
  maxPagesPerPdf: number
  reconciliationPolicyVersion?: 'safe-visual-v1' | 'gemini-whole-page-critical-v2'
}
