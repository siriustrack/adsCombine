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
  AlignmentLedger,
  alignTokens,
  analyzeCriticalOrder,
  createHunks,
  type Token,
  tokenize,
  uniqueSorted,
} from './gemini-critical-tokenization'
import type { FurnitureAlignmentPlan, FurnitureAlignmentSection } from './gemini-page-furniture'
import type { CriticalUncertaintyRange } from './visual-fallback.types'

type Region = {
  index: number
  start: number
  end: number
  tokens: Token[]
  marker?: Token
  markerKey?: string
  signature: string
}

type RegionPair = { ocr: Region; gemini: Region; structurallyUnique: boolean }
type LocalizationResult =
  | { status: 'budget_exceeded' }
  | {
      status: 'localized'
      geminiRanges: CriticalUncertaintyRange[]
      ocrRanges: CriticalUncertaintyRange[]
    }
type SectionPairing = {
  section: FurnitureAlignmentSection
  pairing: { pairs: RegionPair[]; ambiguous: boolean }
}

function structuralSignature(tokens: Token[]): string {
  return tokens
    .filter(token => token.category === undefined && /[\p{L}\p{N}]/u.test(token.value))
    .map(token => token.normalized)
    .join('|')
}

function createRegions(text: string, tokens: Token[]): Region[] {
  if (!tokens.some(token => token.category === 'registry_marker')) {
    return [
      { index: 0, start: 0, end: text.length, tokens, signature: structuralSignature(tokens) },
    ]
  }
  const groups: Array<{ start: number; marker?: Token; tokens: Token[] }> = []
  for (const token of tokens) {
    if (token.category === 'registry_marker')
      groups.push({ start: token.start, marker: token, tokens: [] })
    if (groups.length === 0) groups.push({ start: 0, tokens: [] })
    groups.at(-1)?.tokens.push(token)
  }
  return groups.map((group, index) => ({
    index,
    start: group.start,
    end: groups[index + 1]?.start ?? text.length,
    tokens: group.tokens,
    ...(group.marker ? { marker: group.marker, markerKey: group.marker.normalized } : {}),
    signature: structuralSignature(group.tokens),
  }))
}

function uniquePairBy(
  ocrRegions: Region[],
  geminiRegions: Region[],
  keyFor: (region: Region) => string | undefined
): RegionPair[] {
  const pairs: RegionPair[] = []
  const indexByKey = (regions: Region[]) => {
    const index = new Map<string, Region[]>()
    for (const region of regions) {
      const key = keyFor(region)
      if (!key) continue
      const matches = index.get(key) ?? []
      matches.push(region)
      index.set(key, matches)
    }
    return index
  }
  const ocrByKey = indexByKey(ocrRegions)
  const geminiByKey = indexByKey(geminiRegions)
  for (const [key, ocrMatches] of ocrByKey) {
    const geminiMatches = geminiByKey.get(key) ?? []
    if (ocrMatches.length === 1 && geminiMatches.length === 1) {
      pairs.push({ ocr: ocrMatches[0], gemini: geminiMatches[0], structurallyUnique: true })
    }
  }
  return pairs
}

function pairRegions(ocr: Region[], gemini: Region[]): { pairs: RegionPair[]; ambiguous: boolean } {
  if (ocr.length === 1 && gemini.length === 1 && !ocr[0].marker && !gemini[0].marker) {
    return {
      pairs: [{ ocr: ocr[0], gemini: gemini[0], structurallyUnique: false }],
      ambiguous: false,
    }
  }
  const markerPairs = uniquePairBy(ocr, gemini, region => region.markerKey)
  const pairedOcr = new Set(markerPairs.map(pair => pair.ocr))
  const pairedGemini = new Set(markerPairs.map(pair => pair.gemini))
  const remainingOcr = ocr.filter(region => !pairedOcr.has(region))
  const remainingGemini = gemini.filter(region => !pairedGemini.has(region))
  const signaturePairs = uniquePairBy(
    remainingOcr,
    remainingGemini,
    region => region.signature || undefined
  )
  for (const pair of signaturePairs) {
    pairedOcr.add(pair.ocr)
    pairedGemini.add(pair.gemini)
  }
  const pairs = [...markerPairs, ...signaturePairs]
  const unmatchedOcr = ocr.filter(region => !pairedOcr.has(region))
  const unmatchedGemini = gemini.filter(region => !pairedGemini.has(region))
  const normalized = (regions: Region[]) =>
    regions.map(region => region.tokens.map(token => token.normalized).join(' '))
  const unmatchedEqual =
    JSON.stringify(normalized(unmatchedOcr)) === JSON.stringify(normalized(unmatchedGemini))
  return { pairs, ambiguous: !unmatchedEqual }
}

function movedPairs(pairs: RegionPair[]): Set<RegionPair> {
  const ocrSlots: Array<RegionPair | undefined> = []
  const geminiSlots: Array<RegionPair | undefined> = []
  for (const pair of pairs) {
    ocrSlots[pair.ocr.index] = pair
    geminiSlots[pair.gemini.index] = pair
  }
  const orderedByOcr = ocrSlots.filter(pair => pair !== undefined)
  const orderedByGemini = geminiSlots.filter(pair => pair !== undefined)
  return new Set(orderedByOcr.filter((pair, index) => orderedByGemini[index] !== pair))
}

function filterIgnoredTokens(
  tokens: Token[],
  spans: Array<{ start: number; end: number }>
): Token[] {
  const orderedSpans = [...spans].sort((left, right) => left.start - right.start)
  let spanIndex = 0
  return tokens.filter(token => {
    while ((orderedSpans[spanIndex]?.end ?? Number.POSITIVE_INFINITY) <= token.start) spanIndex++
    const span = orderedSpans[spanIndex]
    return !span || token.start < span.start || token.end > span.end
  })
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
}): LocalizationResult {
  const geminiRanges: CriticalUncertaintyRange[] = []
  const ocrRanges: CriticalUncertaintyRange[] = []
  for (const { section, pairing } of input.pairings) {
    const moved = movedPairs(pairing.pairs)
    for (const pair of pairing.pairs) {
      const matches = alignTokens(pair.ocr.tokens, pair.gemini.tokens, input.ledger)
      if (!matches) return { status: 'budget_exceeded' }
      const order = analyzeCriticalOrder(pair.ocr.tokens, pair.gemini.tokens)
      if (order.ambiguous) {
        return failClosedResult({ ...input, divergences: order.divergences })
      }
      const hunks = createHunks(pair.ocr.tokens, pair.gemini.tokens, matches)
      for (const hunk of hunks) {
        if (!input.ledger.consume(input.ocrText.length + input.geminiText.length)) {
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
          })
        )
        ocrRanges.push(
          ...rangesForHunk({
            text: input.ocrText,
            clauseIndex: input.ocrClauseIndex,
            hunk,
            target: 'ocr',
            structurallyUnique,
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
}): LocalizationResult {
  if (!Number.isSafeInteger(input.maxAlignmentCells) || input.maxAlignmentCells <= 0) {
    return { status: 'budget_exceeded' }
  }
  if (input.furniturePlan?.preprocessingExceeded) return { status: 'budget_exceeded' }
  const ledger = input.ledger ?? new AlignmentLedger(input.maxAlignmentCells)
  if (!input.ledger && !ledger.consume(input.ocrText.length + input.geminiText.length)) {
    return { status: 'budget_exceeded' }
  }
  if (!ledger.consume(input.furniturePlan?.preprocessingWork ?? 0))
    return { status: 'budget_exceeded' }
  const ocrTokens = filterIgnoredTokens(
    tokenize(input.ocrText),
    input.furniturePlan?.ignoredOcrSpans ?? []
  )
  const geminiTokens = filterIgnoredTokens(
    tokenize(input.geminiText),
    input.furniturePlan?.ignoredGeminiSpans ?? []
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
  const pairings = sections.map(section => ({
    section,
    pairing: pairRegions(
      createRegions(
        input.ocrText,
        ocrTokens.filter(token => token.start >= section.ocrStart && token.end <= section.ocrEnd)
      ),
      createRegions(
        input.geminiText,
        geminiTokens.filter(
          token => token.start >= section.geminiStart && token.end <= section.geminiEnd
        )
      )
    ),
  }))
  if (pairings.some(({ pairing }) => pairing.ambiguous)) {
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
  })
  if (localized.status === 'budget_exceeded') return localized
  return {
    status: 'localized',
    geminiRanges: aggregateRanges(input.geminiText, localized.geminiRanges),
    ocrRanges: aggregateRanges(input.ocrText, localized.ocrRanges),
  }
}
