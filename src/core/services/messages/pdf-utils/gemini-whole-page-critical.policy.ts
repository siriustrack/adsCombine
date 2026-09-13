import { sanitizePdfText } from 'utils/sanitize'
import { localizeCriticalEvidence } from './gemini-critical-evidence'
import { AlignmentLedger } from './gemini-critical-tokenization'
import { createFurnitureAlignmentPlan, type PageFurnitureProfile } from './gemini-page-furniture'
import {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  type CriticalUncertaintyRange,
  GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
  VISUAL_FALLBACK_V2_SCHEMA_VERSION,
} from './visual-fallback.types'

export {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
  VISUAL_FALLBACK_V2_SCHEMA_VERSION,
} from './visual-fallback.types'

const REFUSAL_PATTERN =
  /^(?:desculpe|sinto muito|não posso|nao posso|i cannot|i can't|sorry)[\s,.:;-]/iu
const CLEAR_TRUNCATION_PATTERN = /(?:\.{3}|…|\[(?:texto )?(?:cortado|truncado)\])\s*$/iu

type ReconciliationMetadata = {
  schemaVersion: typeof VISUAL_FALLBACK_V2_SCHEMA_VERSION
  policyVersion: typeof GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION
  alignmentVersion: typeof CRITICAL_TOKEN_ALIGNMENT_VERSION
  criticalUncertainties: CriticalUncertaintyRange[]
}

export type GeminiWholePageReconciliation =
  | {
      status: 'selected'
      text: string
      metadata: ReconciliationMetadata
      ocrCriticalUncertainties: CriticalUncertaintyRange[]
      ocrTextLength: number
    }
  | {
      status: 'rejected'
      reason:
        | 'candidate_empty_after_sanitization'
        | 'candidate_invalid_utf16'
        | 'candidate_truncated'
        | 'alignment_budget_exceeded'
        | 'alignment_invariant_failed'
    }

function hasValidUtf16(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function rangesAreValid(text: string, ranges: CriticalUncertaintyRange[]): boolean {
  return ranges.every(
    range =>
      Number.isInteger(range.start) &&
      Number.isInteger(range.end) &&
      range.start >= 0 &&
      range.end > range.start &&
      range.end <= text.length &&
      ['token', 'clause', 'page'].includes(range.scope) &&
      range.categories.length > 0 &&
      range.divergences.length > 0
  )
}

export function reconcileGeminiWholePage(input: {
  ocrText: string
  visualText: string
  maxAlignmentCells?: number
  furnitureProfile?: PageFurnitureProfile
}): GeminiWholePageReconciliation {
  const maxAlignmentCells = input.maxAlignmentCells ?? 0
  if (
    !Number.isSafeInteger(maxAlignmentCells) ||
    maxAlignmentCells <= 0 ||
    input.ocrText.length + input.visualText.length > maxAlignmentCells
  ) {
    return { status: 'rejected', reason: 'alignment_budget_exceeded' }
  }
  const ledger = new AlignmentLedger(maxAlignmentCells)
  if (!ledger.consume(input.ocrText.length + input.visualText.length)) {
    return { status: 'rejected', reason: 'alignment_budget_exceeded' }
  }
  if (!hasValidUtf16(input.visualText)) {
    return { status: 'rejected', reason: 'candidate_invalid_utf16' }
  }
  const text = sanitizePdfText(input.visualText)
  if (!text || REFUSAL_PATTERN.test(text)) {
    return { status: 'rejected', reason: 'candidate_empty_after_sanitization' }
  }
  if (CLEAR_TRUNCATION_PATTERN.test(text)) {
    return { status: 'rejected', reason: 'candidate_truncated' }
  }
  const sanitizedOcr = sanitizePdfText(input.ocrText)
  if (sanitizedOcr.length > 0 && text.length * 5 < sanitizedOcr.length * 4) {
    return { status: 'rejected', reason: 'candidate_truncated' }
  }

  const localized = localizeCriticalEvidence({
    ocrText: sanitizedOcr,
    geminiText: text,
    maxAlignmentCells,
    ledger,
    furniturePlan: createFurnitureAlignmentPlan(sanitizedOcr, text, input.furnitureProfile),
  })
  if (localized.status === 'budget_exceeded') {
    return { status: 'rejected', reason: 'alignment_budget_exceeded' }
  }
  const criticalUncertainties = localized.geminiRanges
  const ocrCriticalUncertainties = localized.ocrRanges
  if (
    !rangesAreValid(text, criticalUncertainties) ||
    !rangesAreValid(sanitizedOcr, ocrCriticalUncertainties)
  ) {
    return { status: 'rejected', reason: 'alignment_invariant_failed' }
  }
  return {
    status: 'selected',
    text,
    metadata: {
      schemaVersion: VISUAL_FALLBACK_V2_SCHEMA_VERSION,
      policyVersion: GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION,
      alignmentVersion: CRITICAL_TOKEN_ALIGNMENT_VERSION,
      criticalUncertainties,
    },
    ocrCriticalUncertainties,
    ocrTextLength: sanitizedOcr.length,
  }
}
