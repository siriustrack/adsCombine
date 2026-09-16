import { createV1Metadata, createV2FullPageMetadata } from './visual-fallback.metadata'
import type {
  VisualFallbackMetadata,
  VisualFallbackOcrPage,
  VisualFallbackReason,
} from './visual-fallback.types'

export type SelectedVisualFallbackPage = {
  readonly page: VisualFallbackOcrPage
  readonly reasons: VisualFallbackReason[]
}

export type VisualFallbackPageBudget = {
  reserve(pageCount: number): boolean
  remaining(): number
}

function selectRiskReasons(page: VisualFallbackOcrPage): VisualFallbackReason[] {
  const signals = page.legalSignals
  if (!signals) return []

  const reasons: VisualFallbackReason[] = []
  if (signals.corruptedSymbols > 0) reasons.push('corrupted-symbols')
  if (signals.fragmentedNumbersOrMeasures > 0) reasons.push('fragmented-number-or-measure')
  if (signals.garbledSpans > 0) reasons.push('garbled-spans')

  const hasAreaReference = /(?:área|area|superf[ií]cie)/iu.test(page.text)
  if (hasAreaReference && signals.squareMeters === 0) reasons.push('missing-measure')

  const hasFragmentedMeasure = reasons.includes('fragmented-number-or-measure')
  if (hasFragmentedMeasure && signals.registryMarkers > 0 && signals.legalMarkers === 0) {
    reasons.push('missing-legal-marker')
  }

  return reasons
}

export function selectRiskyPages(pages: VisualFallbackOcrPage[]): SelectedVisualFallbackPage[] {
  return pages
    .map(page => ({ page, reasons: selectRiskReasons(page) }))
    .filter(({ reasons }) => reasons.length > 0)
}

export function markV2UnavailablePages(
  byPage: Map<number, VisualFallbackMetadata>,
  pages: SelectedVisualFallbackPage[],
  reason: 'aborted' | 'budget_exhausted'
): void {
  for (const { page, reasons } of pages) {
    byPage.set(
      page.pageNumber,
      createV2FullPageMetadata({ page, reasons, outcome: { kind: 'unavailable', reason } })
    )
  }
}

export function applyPageBudget({
  pages,
  pageBudget,
  byPage,
  isV2Policy,
}: {
  readonly pages: SelectedVisualFallbackPage[]
  readonly pageBudget: VisualFallbackPageBudget
  readonly byPage: Map<number, VisualFallbackMetadata>
  readonly isV2Policy: boolean
}): SelectedVisualFallbackPage[] {
  let selectedPages = pages.slice(0, pageBudget.remaining())
  if (selectedPages.length > 0 && !pageBudget.reserve(selectedPages.length)) selectedPages = []
  const selectedNumbers = new Set(selectedPages.map(({ page }) => page.pageNumber))

  for (const { page, reasons } of pages) {
    if (selectedNumbers.has(page.pageNumber)) continue
    byPage.set(
      page.pageNumber,
      isV2Policy
        ? createV2FullPageMetadata({
            page,
            reasons,
            outcome: { kind: 'unavailable', reason: 'budget_exhausted' },
          })
        : createV1Metadata({
            page,
            state: 'fallback_failed',
            reasons,
            decisionReason: 'budget_exhausted',
          })
    )
  }
  return selectedPages
}

export function markPendingPages(
  byPage: Map<number, VisualFallbackMetadata>,
  pages: SelectedVisualFallbackPage[]
): void {
  for (const { page, reasons } of pages) {
    byPage.set(page.pageNumber, createV1Metadata({ page, state: 'fallback_pending', reasons }))
  }
}

export function markFailedPages({
  byPage,
  pages,
  isV2Policy,
  reason,
}: {
  readonly byPage: Map<number, VisualFallbackMetadata>
  readonly pages: SelectedVisualFallbackPage[]
  readonly isV2Policy: boolean
  readonly reason: 'render_failed' | 'aborted'
}): void {
  for (const { page, reasons } of pages) {
    if (reason === 'aborted' && byPage.get(page.pageNumber)?.state !== 'fallback_pending') continue
    byPage.set(
      page.pageNumber,
      isV2Policy
        ? createV2FullPageMetadata({
            page,
            reasons,
            outcome: { kind: 'unavailable', reason },
          })
        : createV1Metadata({ page, state: 'fallback_failed', reasons })
    )
  }
}
