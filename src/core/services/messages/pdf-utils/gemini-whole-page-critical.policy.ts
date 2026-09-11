import { sanitizePdfText } from 'utils/sanitize'
import {
  CRITICAL_TOKEN_ALIGNMENT_VERSION,
  type CriticalCategory,
  type CriticalDivergence,
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
const TOKEN_PATTERN =
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|(?:R\$|US\$|€|£)\s*\d+(?:[.,]\d+)*|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d+\s*\/\s*\d+\b|\b\d+(?:[.,]\d+)*\s*(?:mm|cm|km|m²|m2|m|ha)(?![\p{L}\p{N}])|\b(?:R|AV)\s*\.\s*\d+|\b(?:não|nao|sem|nunca|jamais|inexistente|inexistem|nenhum|nenhuma)\b|\b\d+(?:[.,/-]\d+)*\b|[\p{L}\p{M}]+|[^\s]/giu

type Token = {
  value: string
  normalized: string
  start: number
  end: number
  category?: CriticalCategory
}

type Match = { ocrIndex: number; geminiIndex: number }
type Hunk = {
  ocr: Token[]
  gemini: Token[]
  ocrInsertionOffset: number
  geminiInsertionOffset: number
}

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

function categoryFor(value: string, prefix: string): CriticalCategory | undefined {
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/u.test(value)) {
    return 'cpf_cnpj'
  }
  if (/^(?:R\$|US\$|€|£)/iu.test(value)) return 'currency'
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/u.test(value)) return 'date'
  if (/^\d+\s*\/\s*\d+$/u.test(value)) return 'fraction'
  if (/^\d+(?:[.,]\d+)*\s*(?:mm|cm|km|m²|m2|m|ha)$/iu.test(value)) return 'measurement'
  if (/^(?:R|AV)\s*\./iu.test(value)) return 'registry_marker'
  if (/^(?:não|nao|sem|nunca|jamais|inexistente|inexistem|nenhum|nenhuma)$/iu.test(value)) {
    return 'negation'
  }
  if (/^\d/u.test(value)) {
    return /matr[ií]cula\s*(?:n[º°o.]?\s*)?$/iu.test(prefix) ? 'registry_identifier' : 'number'
  }
  return undefined
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = match[0]
    const start = match.index
    tokens.push({
      value,
      normalized: value.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ''),
      start,
      end: start + value.length,
      ...(categoryFor(value, text.slice(Math.max(0, start - 32), start)) !== undefined
        ? { category: categoryFor(value, text.slice(Math.max(0, start - 32), start)) }
        : {}),
    })
  }
  return tokens
}

function contextualWeight({
  left,
  right,
  leftIndex,
  rightIndex,
}: {
  left: Token[]
  right: Token[]
  leftIndex: number
  rightIndex: number
}): number {
  let weight = 4
  if (left[leftIndex - 1]?.normalized === right[rightIndex - 1]?.normalized) weight++
  if (left[leftIndex + 1]?.normalized === right[rightIndex + 1]?.normalized) weight++
  return weight
}

function alignTokens(ocr: Token[], gemini: Token[], maxCells?: number): Match[] | undefined {
  const columns = gemini.length + 1
  const cells = (ocr.length + 1) * columns
  const invalidBudget =
    typeof maxCells !== 'number' ||
    !Number.isSafeInteger(maxCells) ||
    maxCells <= 0 ||
    cells > maxCells
  if (invalidBudget) return undefined
  const scores = new Uint32Array(cells)
  for (let leftIndex = 1; leftIndex <= ocr.length; leftIndex++) {
    for (let rightIndex = 1; rightIndex <= gemini.length; rightIndex++) {
      const offset = leftIndex * columns + rightIndex
      const above = scores[offset - columns]
      const before = scores[offset - 1]
      const equal = ocr[leftIndex - 1].normalized === gemini[rightIndex - 1].normalized
      const diagonal = equal
        ? scores[offset - columns - 1] +
          contextualWeight({
            left: ocr,
            right: gemini,
            leftIndex: leftIndex - 1,
            rightIndex: rightIndex - 1,
          })
        : 0
      scores[offset] = Math.max(above, before, diagonal)
    }
  }

  const matches: Match[] = []
  let leftIndex = ocr.length
  let rightIndex = gemini.length
  while (leftIndex > 0 && rightIndex > 0) {
    const offset = leftIndex * columns + rightIndex
    const equal = ocr[leftIndex - 1].normalized === gemini[rightIndex - 1].normalized
    const diagonal = equal
      ? scores[offset - columns - 1] +
        contextualWeight({
          left: ocr,
          right: gemini,
          leftIndex: leftIndex - 1,
          rightIndex: rightIndex - 1,
        })
      : 0
    if (equal && scores[offset] === diagonal) {
      matches.push({ ocrIndex: leftIndex - 1, geminiIndex: rightIndex - 1 })
      leftIndex--
      rightIndex--
    } else if (scores[offset - columns] >= scores[offset - 1]) {
      leftIndex--
    } else {
      rightIndex--
    }
  }
  matches.reverse()
  return matches
}

function createHunks(ocr: Token[], gemini: Token[], matches: Match[]): Hunk[] {
  const hunks: Hunk[] = []
  let ocrStart = 0
  let geminiStart = 0
  for (const match of [...matches, { ocrIndex: ocr.length, geminiIndex: gemini.length }]) {
    if (match.ocrIndex > ocrStart || match.geminiIndex > geminiStart) {
      hunks.push({
        ocr: ocr.slice(ocrStart, match.ocrIndex),
        gemini: gemini.slice(geminiStart, match.geminiIndex),
        geminiInsertionOffset:
          gemini[geminiStart]?.start ?? gemini[match.geminiIndex]?.start ?? gemini.at(-1)?.end ?? 0,
        ocrInsertionOffset:
          ocr[ocrStart]?.start ?? ocr[match.ocrIndex]?.start ?? ocr.at(-1)?.end ?? 0,
      })
    }
    ocrStart = match.ocrIndex + 1
    geminiStart = match.geminiIndex + 1
  }
  return hunks
}

function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort()
}

function containingClause(text: string, offset: number): { start: number; end: number } {
  const boundedOffset = Math.min(Math.max(offset, 0), text.length)
  const before = text.slice(0, boundedOffset)
  const previousBoundary = Math.max(
    before.lastIndexOf('.'),
    before.lastIndexOf(';'),
    before.lastIndexOf('\n')
  )
  const start = previousBoundary < 0 ? 0 : previousBoundary + 1
  const remainder = text.slice(boundedOffset)
  const nextRelative = remainder.search(/[.;\n]/u)
  const end = nextRelative < 0 ? text.length : boundedOffset + nextRelative + 1
  let trimmedStart = start
  while (/\s/u.test(text[trimmedStart] ?? '')) trimmedStart++
  return { start: trimmedStart, end }
}

function classifyDivergence(hunk: Hunk, ocr: Token[], gemini: Token[]): CriticalDivergence {
  const ocrCritical = hunk.ocr.filter(token => token.category).map(token => token.normalized)
  const geminiCritical = hunk.gemini.filter(token => token.category).map(token => token.normalized)
  if (ocrCritical.some(value => geminiCritical.includes(value))) return 'duplicate_or_reordered'
  if (
    ocrCritical.some(value => gemini.some(token => token.category && token.normalized === value)) ||
    geminiCritical.some(value => ocr.some(token => token.category && token.normalized === value))
  ) {
    return 'duplicate_or_reordered'
  }
  if (hunk.ocr.length === 0) return 'gemini_only'
  if (hunk.gemini.length === 0) return 'ocr_only'
  return 'different_value'
}

function rangeForHunk({
  text,
  hunk,
  divergence,
  target,
}: {
  text: string
  hunk: Hunk
  divergence: CriticalDivergence
  target: 'gemini' | 'ocr'
}) {
  if (divergence === 'duplicate_or_reordered') {
    return { start: 0, end: text.length, scope: 'page' as const }
  }
  const targetTokens = hunk[target]
  if (targetTokens.length === 0) {
    return {
      ...containingClause(
        text,
        target === 'gemini' ? hunk.geminiInsertionOffset : hunk.ocrInsertionOffset
      ),
      scope: 'clause' as const,
    }
  }
  return {
    start: targetTokens[0].start,
    end: targetTokens.at(-1)?.end ?? targetTokens[0].end,
    scope: 'token' as const,
  }
}

function broaderScope(
  left: CriticalUncertaintyRange['scope'],
  right: CriticalUncertaintyRange['scope']
): CriticalUncertaintyRange['scope'] {
  const rank = { token: 0, clause: 1, page: 2 } as const
  return rank[left] >= rank[right] ? left : right
}

function mergeRanges(text: string, ranges: CriticalUncertaintyRange[]): CriticalUncertaintyRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: CriticalUncertaintyRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      const replacement: CriticalUncertaintyRange = {
        start: previous.start,
        end: Math.max(previous.end, range.end),
        scope: broaderScope(previous.scope, range.scope),
        categories: uniqueSorted([...previous.categories, ...range.categories]),
        divergences: uniqueSorted([...previous.divergences, ...range.divergences]),
      }
      merged[merged.length - 1] = replacement
    } else {
      merged.push({
        ...range,
        categories: [...range.categories],
        divergences: [...range.divergences],
      })
    }
  }
  if (merged.length <= 32) return merged
  return [
    {
      start: 0,
      end: text.length,
      scope: 'page',
      categories: uniqueSorted(merged.flatMap(range => range.categories)),
      divergences: uniqueSorted(merged.flatMap(range => range.divergences)),
    },
  ]
}

function createUncertaintyRanges({
  text,
  ocr,
  gemini,
  matches,
  target,
}: {
  text: string
  ocr: Token[]
  gemini: Token[]
  matches: Match[]
  target: 'gemini' | 'ocr'
}) {
  const ranges: CriticalUncertaintyRange[] = []
  for (const hunk of createHunks(ocr, gemini, matches)) {
    const categories = uniqueSorted(
      [...hunk.ocr, ...hunk.gemini]
        .map(token => token.category)
        .filter((category): category is CriticalCategory => category !== undefined)
    )
    if (categories.length === 0) continue
    const divergence = classifyDivergence(hunk, ocr, gemini)
    const range = rangeForHunk({ text, hunk, divergence, target })
    const projectedDivergence =
      target === 'ocr' && divergence === 'gemini_only'
        ? 'ocr_only'
        : target === 'ocr' && divergence === 'ocr_only'
          ? 'gemini_only'
          : divergence
    ranges.push({ ...range, categories, divergences: [projectedDivergence] })
  }
  return mergeRanges(text, ranges)
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
}): GeminiWholePageReconciliation {
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

  const ocr = tokenize(sanitizedOcr)
  const gemini = tokenize(text)
  const matches = alignTokens(ocr, gemini, input.maxAlignmentCells)
  if (!matches) return { status: 'rejected', reason: 'alignment_budget_exceeded' }
  const criticalUncertainties = createUncertaintyRanges({
    text,
    ocr,
    gemini,
    matches,
    target: 'gemini',
  })
  const ocrCriticalUncertainties = createUncertaintyRanges({
    text: sanitizedOcr,
    ocr,
    gemini,
    matches,
    target: 'ocr',
  })
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
