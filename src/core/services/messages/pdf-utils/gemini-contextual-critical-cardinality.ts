import type { CandidateRegionPreprocessing } from './gemini-candidate-region-preprocessing'
import { positionContextualAnchors } from './gemini-contextual-anchor-positioning'
import { contextualCriticalCardinalityWork } from './gemini-contextual-critical-cardinality-budget'
import {
  analyzeCriticalOrder,
  type CriticalCardinalityCounts,
  countCriticalCardinality,
} from './gemini-critical-cardinality'
import type { Region, RegionPair } from './gemini-critical-regions'
import type { AlignmentLedger, Token } from './gemini-critical-tokenization'
import type { FurnitureAlignmentSection } from './gemini-page-furniture'

export type ContextualCriticalCardinalitySection = Readonly<{
  section: FurnitureAlignmentSection
  ocrRegions: readonly Region[]
  geminiRegions: readonly Region[]
  anchors: readonly RegionPair[]
  preprocessing?: Pick<
    CandidateRegionPreprocessing,
    'ocr' | 'gemini' | 'positionedAnchors' | 'residualSignatureOccurrences'
  >
}>

export type ContextualCriticalCardinalityInput = Readonly<{
  sections: readonly ContextualCriticalCardinalitySection[]
  ledger: AlignmentLedger
}>

export type ContextualCriticalCardinalitySlot = Readonly<{
  section: FurnitureAlignmentSection['kind']
  slot: number
  counts: CriticalCardinalityCounts
}>

export type ContextualCriticalCardinalityAmbiguity =
  | 'no_shared_anchor'
  | 'anchor_not_unique'
  | 'crossed_anchors'
  | 'slot_not_unique'
  | 'critical_order_ambiguous'

export type ContextualCriticalCardinalityAnalysis =
  | Readonly<{ status: 'budget_exceeded' }>
  | Readonly<{
      status: 'analyzed'
      aggregate: CriticalCardinalityCounts
      slots: readonly ContextualCriticalCardinalitySlot[]
    }>
  | Readonly<{
      status: 'ambiguous'
      aggregate: CriticalCardinalityCounts
      reason: ContextualCriticalCardinalityAmbiguity
    }>

type RegionComparison = Readonly<{
  ocr: Region
  gemini: Region
}>

type SectionAnalysis =
  | Readonly<{ status: 'analyzed'; comparisons: readonly RegionComparison[] }>
  | Readonly<{ status: 'ambiguous'; reason: ContextualCriticalCardinalityAmbiguity }>

const SECTION_ORDER: Readonly<Record<FurnitureAlignmentSection['kind'], number>> = {
  top: 0,
  body: 1,
  bottom: 2,
}

function tokensFromRegions(regions: readonly Region[]): Token[] {
  return regions.flatMap(region => region.tokens)
}

function aggregateCounts(
  sections: readonly ContextualCriticalCardinalitySection[]
): CriticalCardinalityCounts {
  return countCriticalCardinality(
    sections.flatMap(section => tokensFromRegions(section.ocrRegions)),
    sections.flatMap(section => tokensFromRegions(section.geminiRegions))
  )
}

function addGapComparison(
  comparisons: RegionComparison[],
  ocrGap: readonly Region[],
  geminiGap: readonly Region[]
): boolean {
  if (ocrGap.length === 0 && geminiGap.length === 0) return true
  const ocr = ocrGap[0]
  const gemini = geminiGap[0]
  if (ocrGap.length !== 1 || geminiGap.length !== 1 || !ocr || !gemini) return false
  comparisons.push({ ocr, gemini })
  return true
}

function comparisonsForSection(input: ContextualCriticalCardinalitySection): SectionAnalysis {
  if (input.anchors.length === 0) {
    if (!input.section.structurallyUnique) {
      return { status: 'ambiguous', reason: 'no_shared_anchor' }
    }
    const comparisons: RegionComparison[] = []
    if (!addGapComparison(comparisons, input.ocrRegions, input.geminiRegions)) {
      return { status: 'ambiguous', reason: 'slot_not_unique' }
    }
    return { status: 'analyzed', comparisons }
  }

  const anchors = positionContextualAnchors(input)
  if (!anchors) return { status: 'ambiguous', reason: 'anchor_not_unique' }
  if (
    anchors.some(
      (anchor, index) => index > 0 && anchor.geminiPosition <= anchors[index - 1].geminiPosition
    )
  ) {
    return { status: 'ambiguous', reason: 'crossed_anchors' }
  }

  const comparisons: RegionComparison[] = []
  let ocrStart = 0
  let geminiStart = 0
  for (const anchor of anchors) {
    if (
      !addGapComparison(
        comparisons,
        input.ocrRegions.slice(ocrStart, anchor.ocrPosition),
        input.geminiRegions.slice(geminiStart, anchor.geminiPosition)
      )
    ) {
      return { status: 'ambiguous', reason: 'slot_not_unique' }
    }
    comparisons.push({ ocr: anchor.pair.ocr, gemini: anchor.pair.gemini })
    ocrStart = anchor.ocrPosition + 1
    geminiStart = anchor.geminiPosition + 1
  }
  if (
    !addGapComparison(
      comparisons,
      input.ocrRegions.slice(ocrStart),
      input.geminiRegions.slice(geminiStart)
    )
  ) {
    return { status: 'ambiguous', reason: 'slot_not_unique' }
  }
  return { status: 'analyzed', comparisons }
}

export function analyzeContextualCriticalCardinality(
  input: ContextualCriticalCardinalityInput
): ContextualCriticalCardinalityAnalysis {
  const work = contextualCriticalCardinalityWork(
    input.sections.map(section => ({
      ocrTokenCount: section.ocrRegions.reduce((total, region) => total + region.tokens.length, 0),
      geminiTokenCount: section.geminiRegions.reduce(
        (total, region) => total + region.tokens.length,
        0
      ),
      anchorCount: section.anchors.length,
    }))
  )
  if (work === undefined || !input.ledger.consume(work)) return { status: 'budget_exceeded' }
  const aggregate = aggregateCounts(input.sections)
  const sections = [...input.sections].sort(
    (left, right) => SECTION_ORDER[left.section.kind] - SECTION_ORDER[right.section.kind]
  )
  const slots: ContextualCriticalCardinalitySlot[] = []
  for (const section of sections) {
    const analysis = comparisonsForSection(section)
    switch (analysis.status) {
      case 'ambiguous':
        return { status: 'ambiguous', aggregate, reason: analysis.reason }
      case 'analyzed':
        for (const [slot, comparison] of analysis.comparisons.entries()) {
          if (analyzeCriticalOrder(comparison.ocr.tokens, comparison.gemini.tokens).ambiguous) {
            return { status: 'ambiguous', aggregate, reason: 'critical_order_ambiguous' }
          }
          slots.push({
            section: section.section.kind,
            slot,
            counts: countCriticalCardinality(comparison.ocr.tokens, comparison.gemini.tokens),
          })
        }
        break
      default: {
        const exhaustive: never = analysis
        return exhaustive
      }
    }
  }
  return { status: 'analyzed', aggregate, slots }
}
