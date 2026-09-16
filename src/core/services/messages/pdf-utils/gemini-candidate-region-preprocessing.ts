import type { Region, RegionPair } from './gemini-critical-regions'
import type { AlignmentLedger } from './gemini-critical-tokenization'

export type RegionOccurrence = Readonly<{
  count: number
  first: Region
}>

export type CandidateRegionIndex = Readonly<{
  regions: readonly Region[]
  positions: ReadonlyMap<Region, number>
  markerOccurrences: ReadonlyMap<string, RegionOccurrence>
  signatureOccurrences: ReadonlyMap<string, RegionOccurrence>
}>

export type CandidateResidualSignatureOccurrences = Readonly<{
  ocr: ReadonlyMap<string, RegionOccurrence>
  gemini: ReadonlyMap<string, RegionOccurrence>
}>

export type CandidatePositionedAnchor = Readonly<{
  pair: RegionPair
  ocrPosition: number
  geminiPosition: number
}>

export type CandidateRegionPreprocessing = Readonly<{
  ocr: CandidateRegionIndex
  gemini: CandidateRegionIndex
  anchors: readonly RegionPair[]
  positionedAnchors: readonly CandidatePositionedAnchor[]
  residualSignatureOccurrences: CandidateResidualSignatureOccurrences
}>

export type CandidateRegionPreprocessingResult =
  | Readonly<{ status: 'budget_exceeded' }>
  | Readonly<{ status: 'prepared'; preprocessing: CandidateRegionPreprocessing }>

function safeProduct(left: number, right: number): number | undefined {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) {
    return undefined
  }
  if (left !== 0 && right > Number.MAX_SAFE_INTEGER / left) return undefined
  return left * right
}

function safeSum(values: readonly number[]): number | undefined {
  let total = 0
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) {
      return undefined
    }
    total += value
  }
  return total
}

function sortWork(count: number): number | undefined {
  if (count < 2) return 0
  let exponent = 0
  let capacity = 1
  while (capacity < count) {
    capacity *= 2
    exponent++
  }
  return safeProduct(count, exponent)
}

export function candidateRegionPreprocessingWork(
  ocrCount: number,
  geminiCount: number
): number | undefined {
  const regionCount = safeSum([ocrCount, geminiCount])
  if (regionCount === undefined) return undefined
  const linearWork = safeProduct(6, regionCount)
  const ocrSortWork = sortWork(ocrCount)
  const geminiSortWork = sortWork(geminiCount)
  const anchorSortWork = sortWork(Math.min(ocrCount, geminiCount))
  if (
    linearWork === undefined ||
    ocrSortWork === undefined ||
    geminiSortWork === undefined ||
    anchorSortWork === undefined
  ) {
    return undefined
  }
  return safeSum([linearWork, ocrSortWork, geminiSortWork, anchorSortWork])
}

function addOccurrence(
  occurrences: Map<string, RegionOccurrence>,
  key: string | undefined,
  region: Region
): void {
  if (key === undefined || key.length === 0) return
  const current = occurrences.get(key)
  occurrences.set(key, { count: (current?.count ?? 0) + 1, first: current?.first ?? region })
}

export function indexCandidateRegions(regions: readonly Region[]): CandidateRegionIndex {
  const positions = new Map<Region, number>()
  const markerOccurrences = new Map<string, RegionOccurrence>()
  const signatureOccurrences = new Map<string, RegionOccurrence>()
  for (const [position, region] of regions.entries()) {
    positions.set(region, position)
    addOccurrence(markerOccurrences, region.markerKey, region)
    addOccurrence(signatureOccurrences, region.signature || undefined, region)
  }
  return { regions, positions, markerOccurrences, signatureOccurrences }
}

function uniquePairs(
  ocr: CandidateRegionIndex,
  gemini: CandidateRegionIndex,
  occurrenceFor: (index: CandidateRegionIndex) => ReadonlyMap<string, RegionOccurrence>
): RegionPair[] {
  const pairs: RegionPair[] = []
  for (const [key, ocrOccurrence] of occurrenceFor(ocr)) {
    const geminiOccurrence = occurrenceFor(gemini).get(key)
    if (ocrOccurrence.count === 1 && geminiOccurrence?.count === 1) {
      pairs.push({
        ocr: ocrOccurrence.first,
        gemini: geminiOccurrence.first,
        structurallyUnique: true,
      })
    }
  }
  return pairs
}

function discoverAnchors(
  ocr: CandidateRegionIndex,
  gemini: CandidateRegionIndex
): Readonly<{
  anchors: readonly RegionPair[]
  residualSignatureOccurrences: CandidateResidualSignatureOccurrences
}> {
  const markerPairs = uniquePairs(ocr, gemini, index => index.markerOccurrences)
  const pairedOcr = new Set(markerPairs.map(pair => pair.ocr))
  const pairedGemini = new Set(markerPairs.map(pair => pair.gemini))
  const residualOcr = indexCandidateRegions(ocr.regions.filter(region => !pairedOcr.has(region)))
  const residualGemini = indexCandidateRegions(
    gemini.regions.filter(region => !pairedGemini.has(region))
  )
  return {
    anchors: [
      ...markerPairs,
      ...uniquePairs(residualOcr, residualGemini, index => index.signatureOccurrences),
    ],
    residualSignatureOccurrences: {
      ocr: residualOcr.signatureOccurrences,
      gemini: residualGemini.signatureOccurrences,
    },
  }
}

export function preprocessCandidateRegions(input: {
  readonly ocrRegions: readonly Region[]
  readonly geminiRegions: readonly Region[]
  readonly ledger: AlignmentLedger
}): CandidateRegionPreprocessingResult {
  const work = candidateRegionPreprocessingWork(input.ocrRegions.length, input.geminiRegions.length)
  if (work === undefined || !input.ledger.consume(work)) return { status: 'budget_exceeded' }
  const ocr = indexCandidateRegions(
    [...input.ocrRegions].sort((left, right) => left.index - right.index)
  )
  const gemini = indexCandidateRegions(
    [...input.geminiRegions].sort((left, right) => left.index - right.index)
  )
  const { anchors, residualSignatureOccurrences } = discoverAnchors(ocr, gemini)
  const positionedAnchors = anchors
    .map(pair => ({
      pair,
      ocrPosition: ocr.positions.get(pair.ocr) ?? -1,
      geminiPosition: gemini.positions.get(pair.gemini) ?? -1,
    }))
    .sort((left, right) => left.ocrPosition - right.ocrPosition)
  return {
    status: 'prepared',
    preprocessing: { ocr, gemini, anchors, positionedAnchors, residualSignatureOccurrences },
  }
}
