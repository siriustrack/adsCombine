import { expect } from 'bun:test'
import {
  type CandidateRegionPairingInput,
  type CandidateRegionPairingResult,
  pairCandidateRegions,
} from '../../src/core/services/messages/pdf-utils/gemini-candidate-region-pairing'
import { candidateRegionPreprocessingWork } from '../../src/core/services/messages/pdf-utils/gemini-candidate-region-preprocessing'
import { contextualCriticalCardinalityWork } from '../../src/core/services/messages/pdf-utils/gemini-contextual-critical-cardinality-budget'
import type {
  Region,
  RegionPair,
} from '../../src/core/services/messages/pdf-utils/gemini-critical-regions'
import {
  AlignmentLedger,
  type Token,
} from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'
import type { FurnitureAlignmentSection } from '../../src/core/services/messages/pdf-utils/gemini-page-furniture'
import type { CriticalCategory } from '../../src/core/services/messages/pdf-utils/visual-fallback.types'

const bodySection: FurnitureAlignmentSection = {
  kind: 'body',
  ocrStart: 0,
  ocrEnd: 1_000,
  geminiStart: 0,
  geminiEnd: 1_000,
}

export function critical(normalized: string, category: CriticalCategory = 'number'): Token {
  return { value: normalized, normalized, start: 0, end: normalized.length, category }
}

export function region(input: {
  readonly index: number
  readonly markerKey?: string
  readonly signature?: string
  readonly critical?: readonly Token[]
}): Region {
  const marker =
    input.markerKey === undefined ? undefined : critical(input.markerKey, 'registry_marker')
  return {
    index: input.index,
    start: input.index * 10,
    end: input.index * 10 + 9,
    tokens: [...(marker === undefined ? [] : [marker]), ...(input.critical ?? [])],
    ...(marker === undefined ? {} : { marker, markerKey: input.markerKey }),
    signature: input.signature ?? `${input.markerKey ?? 'unmarked'}-${input.index}`,
  }
}

export function marked(
  index: number,
  markerKey: string,
  criticalTokens: readonly Token[] = []
): Region {
  return region({ index, markerKey, critical: criticalTokens })
}

export function pairKeys(pairs: readonly RegionPair[]) {
  return pairs.map(pair => [
    pair.ocr.markerKey ?? 'unmarked',
    pair.gemini.markerKey ?? 'unmarked',
    pair.structurallyUnique,
  ])
}

export function input(
  ocrRegions: readonly Region[],
  geminiRegions: readonly Region[],
  maxCells = Number.MAX_SAFE_INTEGER
): CandidateRegionPairingInput {
  return { section: bodySection, ocrRegions, geminiRegions, ledger: new AlignmentLedger(maxCells) }
}

export function candidatePairingWork(
  ocrRegions: readonly Region[],
  geminiRegions: readonly Region[],
  anchorCount: number
): number {
  const preprocessing = candidateRegionPreprocessingWork(ocrRegions.length, geminiRegions.length)
  const contextual = contextualCriticalCardinalityWork([
    {
      ocrTokenCount: ocrRegions.reduce((total, value) => total + value.tokens.length, 0),
      geminiTokenCount: geminiRegions.reduce((total, value) => total + value.tokens.length, 0),
      anchorCount,
    },
  ])
  if (
    preprocessing === undefined ||
    contextual === undefined ||
    preprocessing > Number.MAX_SAFE_INTEGER - contextual
  ) {
    throw new Error('expected safe candidate pairing work')
  }
  return preprocessing + contextual
}

export function pairedCandidateRegions(
  value: CandidateRegionPairingInput
): Extract<CandidateRegionPairingResult, { status: 'paired' }> {
  const result = pairCandidateRegions(value)
  expect(result.status).toBe('paired')
  if (result.status !== 'paired') throw new Error('expected paired candidate regions')
  return result
}
