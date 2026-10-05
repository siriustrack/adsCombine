import { sanitizePdfText } from 'utils/sanitize'
import { hasTabularAreaReference, isLikelyTabularText } from './visual-document-profile'
import {
  createV1Metadata,
  createV2BudgetSkippedMetadata,
  createV2FullPageMetadata,
} from './visual-fallback.metadata'
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
  const weakEvidenceReason = selectWeakEvidenceReason(page)
  const signals = page.legalSignals

  const reasons: VisualFallbackReason[] = []
  if (weakEvidenceReason) reasons.push(weakEvidenceReason)
  const hasTabularLayout = (page.tableCount ?? 0) > 0 || isLikelyTabularText(page.text)
  if (hasTabularLayout) reasons.push('tabular-layout')
  if (!signals) return reasons

  if (signals.corruptedSymbols > 0) reasons.push('corrupted-symbols')
  if (signals.fragmentedNumbersOrMeasures > 0) reasons.push('fragmented-number-or-measure')
  if (signals.garbledSpans > 0) reasons.push('garbled-spans')

  const textWithoutOrganizationalAreas = page.text.replace(
    /(?:^|\s)(?:área|area)\s+de\s+(?:atua[cç][aã]o|compet[eê]ncia|conhecimento|jurisdi[cç][aã]o)\b/giu,
    ' '
  )
  const hasAreaReference = /(?:área|area|superf[ií]cie)/iu.test(textWithoutOrganizationalAreas)
  const areaReferenceIsTabular = hasTabularAreaReference(page.text, page.tableCount)
  if (hasAreaReference && signals.squareMeters === 0 && !areaReferenceIsTabular) {
    reasons.push('missing-measure')
  }

  const hasFragmentedMeasure = reasons.includes('fragmented-number-or-measure')
  if (hasFragmentedMeasure && signals.registryMarkers > 0 && signals.legalMarkers === 0) {
    reasons.push('missing-legal-marker')
  }

  return reasons
}

function selectWeakEvidenceReason(page: VisualFallbackOcrPage): 'weak-ocr-evidence' | undefined {
  const sanitizedText = sanitizePdfText(page.text).trim()
  if (!sanitizedText || page.warnings?.includes('no-text-detected')) {
    return 'weak-ocr-evidence'
  }

  const weakSignals = [
    page.meanConfidence !== undefined && page.meanConfidence <= 50,
    page.wordCount !== undefined && page.wordCount <= 5,
    sanitizedText.length <= 30,
  ].filter(Boolean).length

  return weakSignals >= 2 ? 'weak-ocr-evidence' : undefined
}

function getRiskSeverity(reasons: VisualFallbackReason[]): number {
  if (reasons.includes('weak-ocr-evidence')) return 3
  if (
    reasons.includes('corrupted-symbols') ||
    reasons.includes('garbled-spans') ||
    reasons.includes('fragmented-number-or-measure') ||
    reasons.includes('tabular-layout')
  ) {
    return 2
  }
  if (reasons.includes('missing-legal-marker') || reasons.includes('missing-measure')) return 1
  return 0
}

function getRiskIntensity(page: VisualFallbackOcrPage, reasons: VisualFallbackReason[]): number {
  const signals = page.legalSignals
  const confidenceDeficit =
    page.meanConfidence === undefined ? 0 : Math.max(0, 100 - page.meanConfidence)
  return (
    (signals?.garbledSpans ?? 0) * 50 +
    (signals?.fragmentedNumbersOrMeasures ?? 0) * 40 +
    (signals?.corruptedSymbols ?? 0) * 30 +
    (reasons.includes('tabular-layout') ? 25 : 0) +
    (reasons.includes('missing-measure') ? 20 : 0) +
    (reasons.includes('missing-legal-marker') ? 10 : 0) +
    confidenceDeficit
  )
}

export function selectRiskyPages(pages: VisualFallbackOcrPage[]): SelectedVisualFallbackPage[] {
  return pages
    .map(page => ({ page, reasons: selectRiskReasons(page) }))
    .filter(({ reasons }) => reasons.length > 0)
    .sort((left, right) => {
      const severityDifference = getRiskSeverity(right.reasons) - getRiskSeverity(left.reasons)
      if (severityDifference !== 0) return severityDifference
      const intensityDifference =
        getRiskIntensity(right.page, right.reasons) - getRiskIntensity(left.page, left.reasons)
      return intensityDifference === 0
        ? left.page.pageNumber - right.page.pageNumber
        : intensityDifference
    })
}

export function markBudgetExhaustedPages(
  byPage: Map<number, VisualFallbackMetadata>,
  pages: SelectedVisualFallbackPage[],
  isV2Policy: boolean
): void {
  for (const { page, reasons } of pages) {
    byPage.set(
      page.pageNumber,
      isV2Policy
        ? createV2BudgetSkippedMetadata({ reasons })
        : createV1Metadata({
            page,
            state: 'fallback_skipped',
            reasons,
            decisionReason: 'budget_exhausted',
          })
    )
  }
}

export function markV2UnavailablePages(
  byPage: Map<number, VisualFallbackMetadata>,
  pages: SelectedVisualFallbackPage[],
  reason: 'aborted'
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

  markBudgetExhaustedPages(
    byPage,
    pages.filter(({ page }) => !selectedNumbers.has(page.pageNumber)),
    isV2Policy
  )
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
