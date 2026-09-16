import type { ContextualCriticalCardinalitySection } from '../../src/core/services/messages/pdf-utils/gemini-contextual-critical-cardinality'
import { analyzeContextualCriticalCardinality } from '../../src/core/services/messages/pdf-utils/gemini-contextual-critical-cardinality'
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

export const bodySection: FurnitureAlignmentSection = {
  kind: 'body',
  ocrStart: 0,
  ocrEnd: 1_000,
  geminiStart: 0,
  geminiEnd: 1_000,
}

export function critical(normalized: string, category: CriticalCategory = 'number'): Token {
  return { value: `raw-${normalized}`, normalized, start: 0, end: normalized.length, category }
}

export function region(input: {
  readonly index: number
  readonly critical?: readonly Token[]
  readonly markerKey?: string
  readonly signature?: string
}): Region {
  const marker =
    input.markerKey === undefined ? undefined : critical(input.markerKey, 'registry_marker')
  const tokens = [...(marker === undefined ? [] : [marker]), ...(input.critical ?? [])]
  return {
    index: input.index,
    start: input.index * 10,
    end: input.index * 10 + 9,
    tokens,
    ...(marker === undefined ? {} : { marker, markerKey: input.markerKey }),
    signature: input.signature ?? `signature-${input.index}`,
  }
}

export function anchor(ocr: Region, gemini: Region, structurallyUnique = true): RegionPair {
  return { ocr, gemini, structurallyUnique }
}

export function analyze(
  input: ContextualCriticalCardinalitySection,
  ledger = new AlignmentLedger(Number.MAX_SAFE_INTEGER)
) {
  const result = analyzeContextualCriticalCardinality({ sections: [input], ledger })
  if (result.status === 'budget_exceeded') {
    throw new Error('default contextual cardinality test ledger was exhausted')
  }
  return result
}
