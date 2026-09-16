import {
  type CandidatePositionedAnchor,
  type CandidateRegionIndex,
  type CandidateRegionPreprocessing,
  type CandidateResidualSignatureOccurrences,
  indexCandidateRegions,
} from './gemini-candidate-region-preprocessing'
import type { Region, RegionPair } from './gemini-critical-regions'

type ContextualAnchorPositioningInput = Readonly<{
  ocrRegions: readonly Region[]
  geminiRegions: readonly Region[]
  anchors: readonly RegionPair[]
  preprocessing?: Pick<
    CandidateRegionPreprocessing,
    'ocr' | 'gemini' | 'positionedAnchors' | 'residualSignatureOccurrences'
  >
}>

type AnchorProofDomain = Readonly<{
  ocr: CandidateRegionIndex
  gemini: CandidateRegionIndex
  residualSignatures: CandidateResidualSignatureOccurrences
}>

function provesUniqueMarkerAnchor(
  pair: RegionPair,
  ocrIndex: CandidateRegionIndex,
  geminiIndex: CandidateRegionIndex
): boolean {
  if (!pair.structurallyUnique) return false
  const markerKey = pair.ocr.markerKey
  return (
    markerKey !== undefined &&
    markerKey === pair.gemini.markerKey &&
    ocrIndex.markerOccurrences.get(markerKey)?.count === 1 &&
    geminiIndex.markerOccurrences.get(markerKey)?.count === 1
  )
}

function provesUniqueAnchor(pair: RegionPair, domain: AnchorProofDomain): boolean {
  if (!pair.structurallyUnique) return false
  if (provesUniqueMarkerAnchor(pair, domain.ocr, domain.gemini)) return true
  const signature = pair.ocr.signature
  if (!signature || signature !== pair.gemini.signature) return false
  return (
    domain.residualSignatures.ocr.get(signature)?.count === 1 &&
    domain.residualSignatures.gemini.get(signature)?.count === 1
  )
}

function residualSignatureOccurrences(
  anchors: readonly RegionPair[],
  ocr: CandidateRegionIndex,
  gemini: CandidateRegionIndex
): CandidateResidualSignatureOccurrences {
  const markerAnchors = anchors.filter(pair => provesUniqueMarkerAnchor(pair, ocr, gemini))
  const pairedOcr = new Set(markerAnchors.map(pair => pair.ocr))
  const pairedGemini = new Set(markerAnchors.map(pair => pair.gemini))
  return {
    ocr: indexCandidateRegions(ocr.regions.filter(region => !pairedOcr.has(region)))
      .signatureOccurrences,
    gemini: indexCandidateRegions(gemini.regions.filter(region => !pairedGemini.has(region)))
      .signatureOccurrences,
  }
}

export function positionContextualAnchors(
  input: ContextualAnchorPositioningInput
): readonly CandidatePositionedAnchor[] | undefined {
  const ocrIndex = input.preprocessing?.ocr ?? indexCandidateRegions(input.ocrRegions)
  const geminiIndex = input.preprocessing?.gemini ?? indexCandidateRegions(input.geminiRegions)
  const residualSignatures =
    input.preprocessing?.residualSignatureOccurrences ??
    residualSignatureOccurrences(input.anchors, ocrIndex, geminiIndex)
  const proofDomain = { ocr: ocrIndex, gemini: geminiIndex, residualSignatures }
  const suppliedPositions = input.preprocessing?.positionedAnchors
  const positioned: CandidatePositionedAnchor[] = []
  const occupiedOcr = new Set<number>()
  const occupiedGemini = new Set<number>()
  const candidates =
    suppliedPositions ??
    input.anchors.map(pair => ({
      pair,
      ocrPosition: ocrIndex.positions.get(pair.ocr) ?? -1,
      geminiPosition: geminiIndex.positions.get(pair.gemini) ?? -1,
    }))
  for (const { pair, ocrPosition, geminiPosition } of candidates) {
    if (
      ocrPosition < 0 ||
      geminiPosition < 0 ||
      occupiedOcr.has(ocrPosition) ||
      occupiedGemini.has(geminiPosition) ||
      !provesUniqueAnchor(pair, proofDomain)
    ) {
      return undefined
    }
    occupiedOcr.add(ocrPosition)
    occupiedGemini.add(geminiPosition)
    positioned.push({ pair, ocrPosition, geminiPosition })
  }
  return suppliedPositions === undefined
    ? positioned.sort((left, right) => left.ocrPosition - right.ocrPosition)
    : positioned
}
