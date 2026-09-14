import {
  aggregateRanges,
  buildClauseIndex,
  type ClauseIndex,
  criticalTokens,
  pageRange,
  projectDivergences,
  rangesForHunk,
} from './gemini-critical-ranges'
import {
  createRegions,
  filterIgnoredTokens,
  movedPairs,
  pairRegions,
  type RegionPair,
} from './gemini-critical-regions'
import {
  AlignmentLedger,
  alignTokens,
  analyzeCriticalOrder,
  createHunks,
  type Token,
  tokenize,
  uniqueSorted,
} from './gemini-critical-tokenization'
import type { FurnitureAlignmentPlan, FurnitureAlignmentSection } from './gemini-page-furniture'
import type { V2DiagnosticRecorder } from './visual-fallback.diagnostics'
import type { CriticalUncertaintyRange } from './visual-fallback.types'

type LocalizationResult =
  | { status: 'budget_exceeded' }
  | {
      status: 'localized'
      geminiRanges: CriticalUncertaintyRange[]
      ocrRanges: CriticalUncertaintyRange[]
    }
type SectionPairing = {
  section: FurnitureAlignmentSection
  pairing: ReturnType<typeof pairRegions>
}

function recordOrderAmbiguity(
  diagnostics: V2DiagnosticRecorder | undefined,
  order: ReturnType<typeof analyzeCriticalOrder>,
  section: FurnitureAlignmentSection['kind']
): void {
  const trigger = order.cardinalityMismatch
    ? 'critical_cardinality_mismatch'
    : 'critical_order_ambiguous'
  diagnostics?.record(trigger, section)
}

function failClosedResult(input: {
  ocrText: string
  geminiText: string
  ocrTokens: Token[]
  geminiTokens: Token[]
  divergences?: CriticalUncertaintyRange['divergences']
}): LocalizationResult {
  const categories = uniqueSorted(
    [...criticalTokens(input.ocrTokens), ...criticalTokens(input.geminiTokens)].map(
      token => token.category
    )
  )
  const divergences = input.divergences ?? ['duplicate_or_reordered']
  return {
    status: 'localized',
    geminiRanges: categories.length ? [pageRange(input.geminiText, categories, divergences)] : [],
    ocrRanges: categories.length
      ? [pageRange(input.ocrText, categories, projectDivergences(divergences, 'ocr'))]
      : [],
  }
}

function appendMovedMarkerRanges(input: {
  pair: RegionPair
  moved: Set<RegionPair>
  geminiRanges: CriticalUncertaintyRange[]
  ocrRanges: CriticalUncertaintyRange[]
}) {
  if (!input.moved.has(input.pair) || !input.pair.ocr.marker || !input.pair.gemini.marker) return
  input.geminiRanges.push({
    start: input.pair.gemini.marker.start,
    end: input.pair.gemini.marker.end,
    scope: 'token',
    categories: ['registry_marker'],
    divergences: ['duplicate_or_reordered'],
  })
  input.ocrRanges.push({
    start: input.pair.ocr.marker.start,
    end: input.pair.ocr.marker.end,
    scope: 'token',
    categories: ['registry_marker'],
    divergences: ['duplicate_or_reordered'],
  })
}

function localizePairings(input: {
  ocrText: string
  geminiText: string
  ocrTokens: Token[]
  geminiTokens: Token[]
  pairings: SectionPairing[]
  ledger: AlignmentLedger
  ocrClauseIndex: ClauseIndex
  geminiClauseIndex: ClauseIndex
  diagnostics?: V2DiagnosticRecorder
}): LocalizationResult {
  const geminiRanges: CriticalUncertaintyRange[] = []
  const ocrRanges: CriticalUncertaintyRange[] = []
  for (const { section, pairing } of input.pairings) {
    const moved = movedPairs(pairing.pairs)
    for (const pair of pairing.pairs) {
      const matches = alignTokens(pair.ocr.tokens, pair.gemini.tokens, input.ledger)
      if (!matches) {
        input.diagnostics?.record('alignment_budget_exceeded', section.kind)
        return { status: 'budget_exceeded' }
      }
      const order = analyzeCriticalOrder(pair.ocr.tokens, pair.gemini.tokens)
      if (order.ambiguous) {
        recordOrderAmbiguity(input.diagnostics, order, section.kind)
        return failClosedResult({ ...input, divergences: order.divergences })
      }
      const hunks = createHunks(pair.ocr.tokens, pair.gemini.tokens, matches)
      input.diagnostics?.addHunks(hunks.length)
      for (const hunk of hunks) {
        if (!input.ledger.consume(input.ocrText.length + input.geminiText.length)) {
          input.diagnostics?.record('alignment_budget_exceeded', section.kind)
          return { status: 'budget_exceeded' }
        }
        const structurallyUnique = (pair.structurallyUnique || section.structurallyUnique) ?? false
        geminiRanges.push(
          ...rangesForHunk({
            text: input.geminiText,
            clauseIndex: input.geminiClauseIndex,
            hunk,
            target: 'gemini',
            structurallyUnique,
            section: section.kind,
            diagnostics: input.diagnostics,
          })
        )
        ocrRanges.push(
          ...rangesForHunk({
            text: input.ocrText,
            clauseIndex: input.ocrClauseIndex,
            hunk,
            target: 'ocr',
            structurallyUnique,
            section: section.kind,
            diagnostics: input.diagnostics,
          })
        )
      }
      appendMovedMarkerRanges({ pair, moved, geminiRanges, ocrRanges })
    }
  }
  return { status: 'localized', geminiRanges, ocrRanges }
}

export function localizeCriticalEvidence(input: {
  ocrText: string
  geminiText: string
  maxAlignmentCells: number
  furniturePlan?: FurnitureAlignmentPlan
  ledger?: AlignmentLedger
  diagnostics?: V2DiagnosticRecorder
}): LocalizationResult {
  if (!Number.isSafeInteger(input.maxAlignmentCells) || input.maxAlignmentCells <= 0) {
    input.diagnostics?.record('alignment_budget_exceeded')
    return { status: 'budget_exceeded' }
  }
  if (input.furniturePlan?.preprocessingExceeded) {
    input.diagnostics?.record('preprocessing_budget_exceeded')
    return { status: 'budget_exceeded' }
  }
  const ledger = input.ledger ?? new AlignmentLedger(input.maxAlignmentCells)
  if (!input.ledger && !ledger.consume(input.ocrText.length + input.geminiText.length)) {
    input.diagnostics?.record('alignment_budget_exceeded')
    return { status: 'budget_exceeded' }
  }
  if (!ledger.consume(input.furniturePlan?.preprocessingWork ?? 0)) {
    input.diagnostics?.record('preprocessing_budget_exceeded')
    return { status: 'budget_exceeded' }
  }
  const ocrTokens = filterIgnoredTokens(
    tokenize(input.ocrText),
    input.furniturePlan?.ignoredOcrSpans ?? []
  )
  const geminiTokens = filterIgnoredTokens(
    tokenize(input.geminiText),
    input.furniturePlan?.ignoredGeminiSpans ?? []
  )
  input.diagnostics?.setCriticalTokenCounts(
    criticalTokens(ocrTokens).length,
    criticalTokens(geminiTokens).length
  )
  const sections = input.furniturePlan?.sections ?? [
    {
      kind: 'body' as const,
      ocrStart: 0,
      ocrEnd: input.ocrText.length,
      geminiStart: 0,
      geminiEnd: input.geminiText.length,
    },
  ]
  const pairings = sections.map(section => {
    const ocrRegions = createRegions(
      input.ocrText,
      ocrTokens.filter(token => token.start >= section.ocrStart && token.end <= section.ocrEnd)
    )
    const geminiRegions = createRegions(
      input.geminiText,
      geminiTokens.filter(
        token => token.start >= section.geminiStart && token.end <= section.geminiEnd
      )
    )
    const pairing = pairRegions(ocrRegions, geminiRegions)
    input.diagnostics?.addRegionCounts({
      ocr: ocrRegions.length,
      gemini: geminiRegions.length,
      paired: pairing.pairs.length,
      unpairedOcr: ocrRegions.length - pairing.pairs.length,
      unpairedGemini: geminiRegions.length - pairing.pairs.length,
    })
    return { section, pairing }
  })
  const ambiguousPairing = pairings.find(({ pairing }) => pairing.ambiguous)
  if (ambiguousPairing) {
    input.diagnostics?.record('region_pairing_ambiguous', ambiguousPairing.section.kind)
    return failClosedResult({
      ocrText: input.ocrText,
      geminiText: input.geminiText,
      ocrTokens,
      geminiTokens,
    })
  }
  const localized = localizePairings({
    ocrText: input.ocrText,
    geminiText: input.geminiText,
    ocrTokens,
    geminiTokens,
    pairings,
    ledger,
    ocrClauseIndex: buildClauseIndex(input.ocrText, ocrTokens),
    geminiClauseIndex: buildClauseIndex(input.geminiText, geminiTokens),
    diagnostics: input.diagnostics,
  })
  if (localized.status === 'budget_exceeded') return localized
  return {
    status: 'localized',
    geminiRanges: aggregateRanges(input.geminiText, localized.geminiRanges, input.diagnostics),
    ocrRanges: aggregateRanges(input.ocrText, localized.ocrRanges, input.diagnostics),
  }
}
