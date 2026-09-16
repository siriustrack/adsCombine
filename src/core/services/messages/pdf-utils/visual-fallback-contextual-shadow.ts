import logger from '@lib/logger'
import type { PageFurnitureProfile } from './gemini-page-furniture'
import {
  type GeminiWholePageReconciliation,
  type GeminiWholePageReconciliationInput,
  reconcileGeminiWholePageCandidate,
} from './gemini-whole-page-critical.policy'
import type {
  VisualFallbackV2Diagnostic,
  VisualFallbackV2DiagnosticTrigger,
} from './visual-fallback.diagnostics'

export type ContextualPairingShadowStatus =
  | 'equivalent'
  | 'narrower'
  | 'broader'
  | 'ambiguous'
  | 'budget_exceeded'
  | 'failed'

type UncertaintyScopeCounts = Readonly<{
  token: number
  clause: number
  page: number
}>

type ContextualPairingSide = Readonly<{
  trigger: VisualFallbackV2DiagnosticTrigger | 'failed'
  section: VisualFallbackV2Diagnostic['section']
  regions: Readonly<{
    ocr: number
    gemini: number
    paired: number
    unpairedOcr: number
    unpairedGemini: number
  }>
  uncertaintyScopes: UncertaintyScopeCounts
}>

export type ContextualPairingShadowDiagnostic = Readonly<{
  pageNumber: number
  incumbent: ContextualPairingSide
  candidate: ContextualPairingSide
  status: ContextualPairingShadowStatus
}>

type CandidateReconciler = (
  input: GeminiWholePageReconciliationInput
) => GeminiWholePageReconciliation

type ContextualPairingShadowInput = Readonly<{
  pageNumber: number
  ocrText: string
  candidateText: string
  maxAlignmentCells: number
  furnitureProfile?: PageFurnitureProfile
  incumbent: Readonly<{
    reconciliation: GeminiWholePageReconciliation
    diagnostic: VisualFallbackV2Diagnostic
  }>
  candidateReconciler?: CandidateReconciler
  observer?: (diagnostic: ContextualPairingShadowDiagnostic) => void
}>

const EMPTY_SCOPES: UncertaintyScopeCounts = { token: 0, clause: 0, page: 0 }
const EMPTY_REGIONS = { ocr: 0, gemini: 0, paired: 0, unpairedOcr: 0, unpairedGemini: 0 }
const UNCERTAINTY_SCOPES: readonly (keyof UncertaintyScopeCounts)[] = ['page', 'clause', 'token']

function countUncertaintyScopes(
  reconciliation: GeminiWholePageReconciliation
): UncertaintyScopeCounts {
  if (reconciliation.status === 'rejected') return EMPTY_SCOPES
  const counts = { token: 0, clause: 0, page: 0 }
  for (const uncertainty of reconciliation.metadata.criticalUncertainties) {
    counts[uncertainty.scope]++
  }
  return counts
}

function summarize(
  diagnostic: VisualFallbackV2Diagnostic,
  reconciliation: GeminiWholePageReconciliation
): ContextualPairingSide {
  return {
    trigger: diagnostic.trigger,
    section: diagnostic.section,
    regions: {
      ocr: diagnostic.ocrRegionCount,
      gemini: diagnostic.geminiRegionCount,
      paired: diagnostic.pairedRegionCount,
      unpairedOcr: diagnostic.unpairedOcrRegionCount,
      unpairedGemini: diagnostic.unpairedGeminiRegionCount,
    },
    uncertaintyScopes: countUncertaintyScopes(reconciliation),
  }
}

function summariesMatch(left: ContextualPairingSide, right: ContextualPairingSide): boolean {
  return (
    left.trigger === right.trigger &&
    left.section === right.section &&
    left.regions.ocr === right.regions.ocr &&
    left.regions.gemini === right.regions.gemini &&
    left.regions.paired === right.regions.paired &&
    left.regions.unpairedOcr === right.regions.unpairedOcr &&
    left.regions.unpairedGemini === right.regions.unpairedGemini &&
    left.uncertaintyScopes.page === right.uncertaintyScopes.page &&
    left.uncertaintyScopes.clause === right.uncertaintyScopes.clause &&
    left.uncertaintyScopes.token === right.uncertaintyScopes.token
  )
}

function compareScopeBreadth(
  incumbent: UncertaintyScopeCounts,
  candidate: UncertaintyScopeCounts
): 'narrower' | 'broader' | 'same' {
  for (const scope of UNCERTAINTY_SCOPES) {
    if (candidate[scope] < incumbent[scope]) return 'narrower'
    if (candidate[scope] > incumbent[scope]) return 'broader'
  }
  return 'same'
}

function classify(
  incumbent: ContextualPairingSide,
  candidate: ContextualPairingSide,
  reconciliation: GeminiWholePageReconciliation
): ContextualPairingShadowStatus {
  if (
    reconciliation.status === 'rejected' &&
    reconciliation.reason === 'alignment_budget_exceeded'
  ) {
    return 'budget_exceeded'
  }
  if (summariesMatch(incumbent, candidate)) return 'equivalent'
  if (
    candidate.trigger === 'region_pairing_ambiguous' ||
    candidate.trigger === 'critical_order_ambiguous' ||
    candidate.trigger === 'critical_cardinality_mismatch'
  ) {
    return 'ambiguous'
  }
  const breadth = compareScopeBreadth(incumbent.uncertaintyScopes, candidate.uncertaintyScopes)
  return breadth === 'same' ? 'ambiguous' : breadth
}

function failedSide(): ContextualPairingSide {
  return {
    trigger: 'failed',
    section: 'page',
    regions: EMPTY_REGIONS,
    uncertaintyScopes: EMPTY_SCOPES,
  }
}

function notify(
  observer: ContextualPairingShadowInput['observer'],
  diagnostic: ContextualPairingShadowDiagnostic
): void {
  if (observer === undefined) return
  try {
    observer(diagnostic)
  } catch {
    logger.warn('Visual fallback contextual pairing shadow observer failed', {
      pageNumber: diagnostic.pageNumber,
      status: diagnostic.status,
    })
  }
}

function failedDiagnostic(input: ContextualPairingShadowInput): ContextualPairingShadowDiagnostic {
  logger.warn('Visual fallback contextual pairing shadow evaluation failed', {
    pageNumber: input.pageNumber,
  })
  return {
    pageNumber: input.pageNumber,
    incumbent: summarize(input.incumbent.diagnostic, input.incumbent.reconciliation),
    candidate: failedSide(),
    status: 'failed',
  }
}

export function evaluateContextualPairingShadow(
  input: ContextualPairingShadowInput
): ContextualPairingShadowDiagnostic {
  const candidateDiagnostics: VisualFallbackV2Diagnostic[] = []
  let candidateReconciliation: GeminiWholePageReconciliation
  try {
    candidateReconciliation = (input.candidateReconciler ?? reconcileGeminiWholePageCandidate)({
      ocrText: input.ocrText,
      visualText: input.candidateText,
      maxAlignmentCells: input.maxAlignmentCells,
      furnitureProfile: input.furnitureProfile,
      pageNumber: input.pageNumber,
      diagnosticObserver: diagnostic => candidateDiagnostics.push(diagnostic),
    })
  } catch {
    const diagnostic = failedDiagnostic(input)
    notify(input.observer, diagnostic)
    return diagnostic
  }
  const candidateDiagnostic = candidateDiagnostics.at(0)
  if (candidateDiagnostics.length !== 1 || candidateDiagnostic === undefined) {
    const diagnostic = failedDiagnostic(input)
    notify(input.observer, diagnostic)
    return diagnostic
  }
  const incumbent = summarize(input.incumbent.diagnostic, input.incumbent.reconciliation)
  const candidate = summarize(candidateDiagnostic, candidateReconciliation)
  const diagnostic = {
    pageNumber: input.pageNumber,
    incumbent,
    candidate,
    status: classify(incumbent, candidate, candidateReconciliation),
  }
  notify(input.observer, diagnostic)
  return diagnostic
}

export const logContextualPairingShadowDiagnostic = (
  diagnostic: ContextualPairingShadowDiagnostic
): void => {
  logger.info('Visual fallback contextual pairing shadow evaluated', diagnostic)
}
