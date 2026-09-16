import {
  type CandidatePositionedAnchor,
  preprocessCandidateRegions,
} from './gemini-candidate-region-preprocessing'
import { analyzeContextualCriticalCardinality } from './gemini-contextual-critical-cardinality'
import type { Region, RegionPair } from './gemini-critical-regions'
import type { AlignmentLedger } from './gemini-critical-tokenization'
import type { FurnitureAlignmentSection } from './gemini-page-furniture'

export type CandidateRegionPairingInput = Readonly<{
  section: FurnitureAlignmentSection
  ocrRegions: readonly Region[]
  geminiRegions: readonly Region[]
  ledger: AlignmentLedger
}>

export type CandidateRegionPairingResult =
  | Readonly<{ status: 'budget_exceeded' }>
  | Readonly<{
      status: 'paired'
      pairs: readonly RegionPair[]
      ambiguous: boolean
    }>

type ResidualSlotsInput = Readonly<{
  ocrRegions: readonly Region[]
  geminiRegions: readonly Region[]
  anchors: readonly CandidatePositionedAnchor[]
}>

function residualPairForSlot(
  ocrGap: readonly Region[],
  geminiGap: readonly Region[],
  prefix: boolean
): RegionPair | 'empty' | 'unsafe' {
  if (ocrGap.length === 0 && geminiGap.length === 0) return 'empty'
  const ocr = ocrGap[0]
  const gemini = geminiGap[0]
  if (ocrGap.length !== 1 || geminiGap.length !== 1 || !ocr || !gemini) return 'unsafe'
  const bothMarked = ocr.marker !== undefined && gemini.marker !== undefined
  const supportedUnmarkedPrefix =
    prefix &&
    ocr.marker === undefined &&
    gemini.marker === undefined &&
    ocr.index === 0 &&
    gemini.index === 0
  if (!bothMarked && !supportedUnmarkedPrefix) return 'unsafe'
  return { ocr, gemini, structurallyUnique: false }
}

function residualPairsForSlots(input: ResidualSlotsInput): readonly RegionPair[] | undefined {
  const residualPairs: RegionPair[] = []
  let ocrStart = 0
  let geminiStart = 0
  for (const anchor of input.anchors) {
    const residual = residualPairForSlot(
      input.ocrRegions.slice(ocrStart, anchor.ocrPosition),
      input.geminiRegions.slice(geminiStart, anchor.geminiPosition),
      ocrStart === 0 && geminiStart === 0
    )
    if (residual === 'unsafe') return undefined
    if (residual !== 'empty') residualPairs.push(residual)
    ocrStart = anchor.ocrPosition + 1
    geminiStart = anchor.geminiPosition + 1
  }
  const residual = residualPairForSlot(
    input.ocrRegions.slice(ocrStart),
    input.geminiRegions.slice(geminiStart),
    input.anchors.length === 0
  )
  if (residual === 'unsafe') return undefined
  if (residual !== 'empty') residualPairs.push(residual)
  return residualPairs
}

export function pairCandidateRegions(
  input: CandidateRegionPairingInput
): CandidateRegionPairingResult {
  const prepared = preprocessCandidateRegions(input)
  if (prepared.status === 'budget_exceeded') return prepared
  const { ocr, gemini, anchors, positionedAnchors, residualSignatureOccurrences } =
    prepared.preprocessing
  const analysis = analyzeContextualCriticalCardinality({
    ledger: input.ledger,
    sections: [
      {
        section: input.section,
        ocrRegions: ocr.regions,
        geminiRegions: gemini.regions,
        anchors,
        preprocessing: { ocr, gemini, positionedAnchors, residualSignatureOccurrences },
      },
    ],
  })
  if (analysis.status === 'budget_exceeded') return analysis
  if (anchors.length === 0 || analysis.status === 'ambiguous') {
    return { status: 'paired', pairs: anchors, ambiguous: true }
  }
  const residualPairs = residualPairsForSlots({
    ocrRegions: ocr.regions,
    geminiRegions: gemini.regions,
    anchors: positionedAnchors,
  })
  if (residualPairs === undefined) return { status: 'paired', pairs: anchors, ambiguous: true }
  return { status: 'paired', pairs: [...anchors, ...residualPairs], ambiguous: false }
}
