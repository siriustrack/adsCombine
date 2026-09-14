import logger from '@lib/logger'

export type VisualFallbackV2DiagnosticTrigger =
  | 'localized'
  | 'region_pairing_ambiguous'
  | 'critical_order_ambiguous'
  | 'critical_cardinality_mismatch'
  | 'unsafe_hunk_projection'
  | 'range_limit_exceeded'
  | 'preprocessing_budget_exceeded'
  | 'alignment_budget_exceeded'
  | 'furniture_profile_unavailable_or_ambiguous'
  | 'candidate_rejected'
  | 'alignment_invariant_failed'

export type VisualFallbackV2Diagnostic = Readonly<{
  trigger: VisualFallbackV2DiagnosticTrigger
  pageNumber: number
  section: 'top' | 'body' | 'bottom' | 'page'
  ocrRegionCount: number
  geminiRegionCount: number
  pairedRegionCount: number
  unpairedOcrRegionCount: number
  unpairedGeminiRegionCount: number
  ocrCriticalTokenCount: number
  geminiCriticalTokenCount: number
  hunkCount: number
  rangesBeforeAggregation: number
  rangesAfterAggregation: number
  furnitureActive: boolean
  confirmedTopCount: number
  confirmedBottomCount: number
}>

export type VisualFallbackV2DiagnosticObserver = (diagnostic: VisualFallbackV2Diagnostic) => void

type DiagnosticCountFields = Omit<
  VisualFallbackV2Diagnostic,
  'trigger' | 'pageNumber' | 'section' | 'furnitureActive'
>
type DiagnosticCounts = {
  -readonly [Key in keyof DiagnosticCountFields]: DiagnosticCountFields[Key]
}

const TRIGGER_PRIORITY: Record<VisualFallbackV2DiagnosticTrigger, number> = {
  localized: 0,
  furniture_profile_unavailable_or_ambiguous: 10,
  unsafe_hunk_projection: 40,
  critical_cardinality_mismatch: 50,
  critical_order_ambiguous: 60,
  region_pairing_ambiguous: 70,
  range_limit_exceeded: 80,
  candidate_rejected: 90,
  alignment_invariant_failed: 90,
  preprocessing_budget_exceeded: 100,
  alignment_budget_exceeded: 100,
}

export class V2DiagnosticRecorder {
  private trigger: VisualFallbackV2DiagnosticTrigger = 'localized'
  private section: VisualFallbackV2Diagnostic['section'] = 'page'
  private furnitureActive = false
  private counts: DiagnosticCounts = {
    ocrRegionCount: 0,
    geminiRegionCount: 0,
    pairedRegionCount: 0,
    unpairedOcrRegionCount: 0,
    unpairedGeminiRegionCount: 0,
    ocrCriticalTokenCount: 0,
    geminiCriticalTokenCount: 0,
    hunkCount: 0,
    rangesBeforeAggregation: 0,
    rangesAfterAggregation: 0,
    confirmedTopCount: 0,
    confirmedBottomCount: 0,
  }

  record(
    trigger: VisualFallbackV2DiagnosticTrigger,
    section: VisualFallbackV2Diagnostic['section'] = 'page'
  ): void {
    if (TRIGGER_PRIORITY[trigger] < TRIGGER_PRIORITY[this.trigger]) return
    this.trigger = trigger
    this.section = section
  }

  addRegionCounts(input: {
    ocr: number
    gemini: number
    paired: number
    unpairedOcr: number
    unpairedGemini: number
  }): void {
    this.counts.ocrRegionCount += input.ocr
    this.counts.geminiRegionCount += input.gemini
    this.counts.pairedRegionCount += input.paired
    this.counts.unpairedOcrRegionCount += input.unpairedOcr
    this.counts.unpairedGeminiRegionCount += input.unpairedGemini
  }

  setCriticalTokenCounts(ocr: number, gemini: number): void {
    this.counts.ocrCriticalTokenCount = ocr
    this.counts.geminiCriticalTokenCount = gemini
  }

  addHunks(count: number): void {
    this.counts.hunkCount += count
  }

  noteRanges(before: number, after: number): void {
    this.counts.rangesBeforeAggregation = Math.max(this.counts.rangesBeforeAggregation, before)
    this.counts.rangesAfterAggregation = Math.max(this.counts.rangesAfterAggregation, after)
  }

  setFurniture(active: boolean, confirmedTopCount: number, confirmedBottomCount: number): void {
    this.furnitureActive = active
    this.counts.confirmedTopCount = confirmedTopCount
    this.counts.confirmedBottomCount = confirmedBottomCount
  }

  snapshot(pageNumber: number): VisualFallbackV2Diagnostic {
    return Object.freeze({
      trigger: this.trigger,
      pageNumber,
      section: this.section,
      ...this.counts,
      furnitureActive: this.furnitureActive,
    })
  }
}

export function notifyV2Diagnostic(
  observer: VisualFallbackV2DiagnosticObserver | undefined,
  diagnostic: VisualFallbackV2Diagnostic
): void {
  if (!observer) return
  try {
    observer(diagnostic)
  } catch {
    logger.warn('Visual fallback V2 diagnostic observer failed', {
      pageNumber: diagnostic.pageNumber,
      trigger: diagnostic.trigger,
    })
  }
}

export const logV2Diagnostic: VisualFallbackV2DiagnosticObserver = diagnostic => {
  logger.info('Visual fallback V2 reconciliation evaluated', diagnostic)
}
