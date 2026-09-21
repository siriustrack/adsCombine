import { createHash } from 'node:crypto'
import logger from '@lib/logger'
import type { PageFurnitureProfile } from './gemini-page-furniture'
import { logV2Diagnostic, type VisualFallbackV2Diagnostic } from './visual-fallback.diagnostics'
import {
  createV1Metadata,
  createV2FullPageMetadata,
  reconcileV2Candidate,
} from './visual-fallback.metadata'
import type {
  RenderedPdfPage,
  VisualDocumentProfile,
  VisualFallbackConfig,
  VisualFallbackMetadata,
  VisualTranscriptionProvider,
} from './visual-fallback.types'
import { GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION } from './visual-fallback.types'
import {
  evaluateContextualPairingShadow,
  logContextualPairingShadowDiagnostic,
} from './visual-fallback-contextual-shadow'
import type { SelectedVisualFallbackPage } from './visual-fallback-page-state'
import { reconcileVisualText } from './visual-reconciliation.policy'
import { transcribeWithRetries } from './visual-transcription-retry'

type ProcessSelectedPageInput = {
  readonly fileId?: string
  readonly selection: SelectedVisualFallbackPage
  readonly renderedPage?: RenderedPdfPage
  readonly byPage: Map<number, VisualFallbackMetadata>
  readonly acceptedVisualTextByPage: Map<number, string>
  readonly signal?: AbortSignal
  readonly documentProfile?: VisualDocumentProfile
  readonly furnitureProfile?: PageFurnitureProfile
  readonly config: VisualFallbackConfig
  readonly provider: VisualTranscriptionProvider
}

type V2CandidateContext = Readonly<{
  selection: SelectedVisualFallbackPage
  renderedPage: RenderedPdfPage
  candidate: string
  furnitureProfile?: PageFurnitureProfile
  config: VisualFallbackConfig
}>

type V2PageState = Readonly<{
  byPage: Map<number, VisualFallbackMetadata>
  acceptedVisualTextByPage: Map<number, string>
}>

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function applyV2Candidate(context: V2CandidateContext, state: V2PageState): void {
  const { page, reasons } = context.selection
  const contextualShadowEnabled =
    context.config.contextualPairingShadowEnabled && context.config.provider === 'gemini'
  let incumbentDiagnostic: VisualFallbackV2Diagnostic | undefined
  const reconciliation = reconcileV2Candidate({
    page,
    reasons,
    candidate: context.candidate,
    maxAlignmentCells: context.config.maxAlignmentCells,
    shadowMode: context.config.shadowMode,
    provenance: {
      provider: context.config.provider,
      model: context.config.model,
      imageSha256: hash(context.renderedPage.image),
      candidateSha256: hash(context.candidate),
    },
    furnitureProfile: context.furnitureProfile,
    diagnosticObserver: contextualShadowEnabled
      ? diagnostic => {
          incumbentDiagnostic = diagnostic
          logV2Diagnostic(diagnostic)
        }
      : logV2Diagnostic,
  })
  state.byPage.set(page.pageNumber, reconciliation.metadata)
  if (reconciliation.acceptedText !== undefined) {
    state.acceptedVisualTextByPage.set(page.pageNumber, reconciliation.acceptedText)
  }
  if (!contextualShadowEnabled || incumbentDiagnostic === undefined) return
  evaluateContextualPairingShadow({
    pageNumber: page.pageNumber,
    ocrText: page.text,
    candidateText: context.candidate,
    maxAlignmentCells: context.config.maxAlignmentCells,
    furnitureProfile: context.furnitureProfile,
    incumbent: {
      reconciliation: reconciliation.reconciliation,
      diagnostic: incumbentDiagnostic,
    },
    observer: logContextualPairingShadowDiagnostic,
  })
}

function applyV1Candidate(context: V2CandidateContext, state: V2PageState): void {
  const { page, reasons } = context.selection
  const reconciliation = reconcileVisualText({
    ocrText: page.text,
    visualText: context.candidate,
    ocrConfidence: page.meanConfidence,
  })
  const selectedTextSource =
    !context.config.shadowMode && reconciliation.decision === 'promote_visual' ? 'visual' : 'ocr'
  if (selectedTextSource === 'visual') {
    state.acceptedVisualTextByPage.set(page.pageNumber, context.candidate)
  }
  const visualState = context.config.shadowMode
    ? 'ocr_plus_visual_candidate'
    : reconciliation.decision === 'conflict'
      ? 'conflict'
      : 'reconciled'
  state.byPage.set(
    page.pageNumber,
    createV1Metadata({
      page,
      state: visualState,
      reasons,
      provenance: {
        provider: context.config.provider,
        model: context.config.model,
        imageSha256: hash(context.renderedPage.image),
        candidateSha256: hash(context.candidate),
      },
      policyVersion: reconciliation.policyVersion,
      decisionReason: reconciliation.decisionReason,
      selectedTextSource,
      ...(context.config.shadowMode ? { shadowDecision: reconciliation.decision } : {}),
      comparison: reconciliation.comparison,
    })
  )
}

export async function processSelectedPage({
  fileId,
  selection: { page, reasons },
  renderedPage,
  byPage,
  acceptedVisualTextByPage,
  signal,
  documentProfile,
  furnitureProfile,
  config,
  provider,
}: ProcessSelectedPageInput): Promise<void> {
  if (signal?.aborted) return
  if (!renderedPage) {
    byPage.set(
      page.pageNumber,
      config.reconciliationPolicyVersion === GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION
        ? createV2FullPageMetadata({
            page,
            reasons,
            outcome: { kind: 'unavailable', reason: 'render_failed' },
          })
        : createV1Metadata({ page, state: 'fallback_failed', reasons })
    )
    return
  }

  const processingStartedAt = Date.now()
  const transcriptionStartedAt = Date.now()
  const transcription = await transcribeWithRetries({
    image: renderedPage.image,
    pageNumber: page.pageNumber,
    signal,
    documentProfile,
    model: config.model,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    provider,
  })
  const transcriptionDurationMs = Date.now() - transcriptionStartedAt
  if (signal?.aborted) return
  if (transcription.status === 'unavailable') {
    byPage.set(
      page.pageNumber,
      config.reconciliationPolicyVersion === GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION
        ? createV2FullPageMetadata({
            page,
            reasons,
            outcome: { kind: 'unavailable', reason: transcription.reason },
          })
        : createV1Metadata({ page, state: 'fallback_failed', reasons })
    )
    logger.debug('Visual fallback page processing completed', {
      ...(fileId !== undefined ? { fileId } : {}),
      pageNumber: page.pageNumber,
      provider: config.provider,
      model: config.model,
      transcriptionOutcome: 'unavailable',
      unavailableReason: transcription.reason,
      transcriptionDurationMs,
      reconciliationDurationMs: 0,
      totalDurationMs: Date.now() - processingStartedAt,
    })
    return
  }
  const candidate = transcription.text
  const reconciliationStartedAt = Date.now()

  if (config.reconciliationPolicyVersion === GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION) {
    applyV2Candidate(
      {
        selection: { page, reasons },
        renderedPage,
        candidate,
        furnitureProfile,
        config,
      },
      {
        byPage,
        acceptedVisualTextByPage,
      }
    )
  } else {
    applyV1Candidate(
      {
        selection: { page, reasons },
        renderedPage,
        candidate,
        furnitureProfile,
        config,
      },
      {
        byPage,
        acceptedVisualTextByPage,
      }
    )
  }

  const metadata = byPage.get(page.pageNumber)
  const visualOutcome = metadata && 'outcome' in metadata ? metadata.outcome : undefined
  logger.debug('Visual fallback page processing completed', {
    ...(fileId !== undefined ? { fileId } : {}),
    pageNumber: page.pageNumber,
    provider: config.provider,
    model: config.model,
    transcriptionOutcome: 'transcribed',
    ...(visualOutcome !== undefined ? { visualOutcome } : {}),
    decisionReason: metadata?.decisionReason,
    transcriptionDurationMs,
    reconciliationDurationMs: Date.now() - reconciliationStartedAt,
    totalDurationMs: Date.now() - processingStartedAt,
  })
}
