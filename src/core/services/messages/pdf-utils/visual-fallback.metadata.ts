import { sanitizePdfText } from 'utils/sanitize'
import type { PageFurnitureProfile } from './gemini-page-furniture'
import { reconcileGeminiWholePage } from './gemini-whole-page-critical.policy'
import type { VisualFallbackV2DiagnosticObserver } from './visual-fallback.diagnostics'
import type {
  CriticalUncertaintyRange,
  VisualFallbackMetadata,
  VisualFallbackOcrPage,
  VisualFallbackReason,
  VisualFallbackV1Metadata,
  VisualFallbackV2Metadata,
} from './visual-fallback.types'
import {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
  VISUAL_FALLBACK_V2_SCHEMA_VERSION,
} from './visual-fallback.types'

export type CreateV1MetadataOptions = {
  page: VisualFallbackOcrPage
  state: VisualFallbackV1Metadata['state']
  reasons: VisualFallbackReason[]
  provenance?: VisualFallbackV1Metadata['provenance']
  decisionReason?: string
  selectedTextSource?: VisualFallbackV1Metadata['selectedTextSource']
  shadowDecision?: VisualFallbackV1Metadata['shadowDecision']
  comparison?: VisualFallbackV1Metadata['comparison']
  policyVersion?: VisualFallbackV1Metadata['policyVersion']
}

export type V2FullPageOutcome =
  | {
      kind: 'unavailable'
      reason: Extract<VisualFallbackV2Metadata, { outcome: 'unavailable' }>['decisionReason']
    }
  | {
      kind: 'rejected'
      reason: Extract<VisualFallbackV2Metadata, { outcome: 'rejected' }>['decisionReason']
    }

const ALL_CRITICAL_CATEGORIES = [
  'date',
  'cpf_cnpj',
  'currency',
  'fraction',
  'measurement',
  'registry_identifier',
  'registry_marker',
  'negation',
  'number',
] as const

export function createInitialMetadata(
  pages: VisualFallbackOcrPage[]
): Map<number, VisualFallbackMetadata> {
  return new Map(
    pages.map(page => [page.pageNumber, createV1Metadata({ page, state: 'ocr_only', reasons: [] })])
  )
}

export function createV1Metadata({
  page,
  state,
  reasons,
  provenance,
  decisionReason,
  selectedTextSource,
  shadowDecision,
  comparison,
  policyVersion,
}: CreateV1MetadataOptions): VisualFallbackV1Metadata {
  const unresolved =
    state === 'fallback_pending' || state === 'fallback_failed' || state === 'conflict'
  return {
    state,
    reasons,
    offsetEncoding: 'utf16_code_units',
    ...(page.sourceRange !== undefined ? { sourceRange: page.sourceRange } : {}),
    ...(unresolved && page.sourceRange !== undefined ? { riskySpans: [page.sourceRange] } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
    ...(policyVersion !== undefined ? { policyVersion } : {}),
    ...(decisionReason !== undefined ? { decisionReason } : {}),
    ...(selectedTextSource !== undefined ? { selectedTextSource } : {}),
    ...(shadowDecision !== undefined ? { shadowDecision } : {}),
    ...(comparison !== undefined ? { comparison } : {}),
  }
}

export function createV2FullPageMetadata({
  page,
  reasons,
  outcome,
  provenance,
}: {
  page: VisualFallbackOcrPage
  reasons: VisualFallbackReason[]
  outcome: V2FullPageOutcome
  provenance?: NonNullable<VisualFallbackV2Metadata['provenance']>
}): VisualFallbackV2Metadata {
  const sourceRange = { start: 0, end: sanitizePdfText(page.text).length }
  const criticalUncertainties: CriticalUncertaintyRange[] = [
    {
      ...sourceRange,
      scope: 'page',
      categories: [...ALL_CRITICAL_CATEGORIES],
      divergences: ['ocr_only'],
    },
  ]
  const common = {
    schemaVersion: VISUAL_FALLBACK_V2_SCHEMA_VERSION,
    policyVersion: GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
    reasons,
    offsetEncoding: 'utf16_code_units' as const,
    sourceRange,
    riskySpans: [sourceRange],
  }
  if (outcome.kind === 'unavailable') {
    return {
      ...common,
      outcome: 'unavailable',
      state: 'fallback_failed',
      selectedTextSource: 'ocr',
      decisionReason: outcome.reason,
    }
  }
  if (provenance === undefined) {
    throw new Error('Rejected V2 metadata requires candidate provenance')
  }
  return {
    ...common,
    provenance,
    criticalUncertainties,
    outcome: 'rejected',
    state: 'conflict',
    selectedTextSource: 'ocr',
    decisionReason: outcome.reason,
  }
}

export function reconcileV2Candidate({
  page,
  reasons,
  candidate,
  maxAlignmentCells,
  shadowMode,
  provenance,
  furnitureProfile,
  diagnosticObserver,
}: {
  page: VisualFallbackOcrPage
  reasons: VisualFallbackReason[]
  candidate: string
  maxAlignmentCells: number
  shadowMode: boolean
  provenance: NonNullable<VisualFallbackV2Metadata['provenance']>
  furnitureProfile?: PageFurnitureProfile
  diagnosticObserver?: VisualFallbackV2DiagnosticObserver
}): { metadata: VisualFallbackV2Metadata; acceptedText?: string } {
  const reconciliation = reconcileGeminiWholePage({
    ocrText: page.text,
    visualText: candidate,
    maxAlignmentCells,
    furnitureProfile,
    pageNumber: page.pageNumber,
    diagnosticObserver,
  })
  if (reconciliation.status === 'rejected') {
    return {
      metadata: createV2FullPageMetadata({
        page,
        reasons,
        outcome: { kind: 'rejected', reason: reconciliation.reason },
        provenance,
      }),
    }
  }
  if (shadowMode) {
    const sourceRange = { start: 0, end: reconciliation.ocrTextLength }
    return {
      metadata: {
        schemaVersion: VISUAL_FALLBACK_V2_SCHEMA_VERSION,
        policyVersion: GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
        alignmentVersion: CRITICAL_TOKEN_ALIGNMENT_VERSION,
        outcome: 'shadow',
        state: 'ocr_plus_visual_candidate',
        reasons,
        offsetEncoding: 'utf16_code_units',
        sourceRange,
        criticalUncertainties: reconciliation.ocrCriticalUncertainties,
        riskySpans: reconciliation.ocrCriticalUncertainties.map(({ start, end }) => ({
          start,
          end,
        })),
        provenance,
        selectedTextSource: 'ocr',
        decisionReason: 'shadow_gemini_whole_page',
      },
    }
  }

  const sourceRange = { start: 0, end: reconciliation.text.length }
  return {
    metadata: {
      ...reconciliation.metadata,
      outcome: 'selected',
      state: 'reconciled',
      reasons,
      offsetEncoding: 'utf16_code_units',
      sourceRange,
      riskySpans: reconciliation.metadata.criticalUncertainties.map(({ start, end }) => ({
        start,
        end,
      })),
      provenance,
      selectedTextSource: 'visual',
      decisionReason: 'gemini_whole_page_selected',
    },
    acceptedText: reconciliation.text,
  }
}
