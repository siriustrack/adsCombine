import type { CriticalCategory, CriticalDivergence } from './visual-fallback.types'

const TOKEN_PATTERN =
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|(?:R\$|US\$|€|£)\s*\d+(?:[.,]\d+)*|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d+\s*\/\s*\d+\b|\b\d+(?:[.,]\d+)*\s*(?:mm|cm|km|m²|m2|m|ha)(?![\p{L}\p{N}])|\b(?:R|AV)\s*\.\s*\d+(?:\s*\/\s*\d+(?:[.,]\d+)*)?|\b(?:não|nao|sem|nunca|jamais|inexistente|inexistem|nenhum|nenhuma)\b|\b\d+(?:[.,/-]\d+)*\b|[\p{L}\p{M}]+|[^\s]/giu

export type Token = {
  value: string
  normalized: string
  start: number
  end: number
  category?: CriticalCategory
}

export type Match = { ocrIndex: number; geminiIndex: number }

export type Hunk = {
  ocr: Token[]
  gemini: Token[]
  ocrInsertionOffset: number
  geminiInsertionOffset: number
  hasLeftMatch: boolean
  hasRightMatch: boolean
}

export class AlignmentLedger {
  private remaining: number

  constructor(maxCells: number) {
    this.remaining = maxCells
  }

  consume(cells: number): boolean {
    if (cells > this.remaining) return false
    this.remaining -= cells
    return true
  }
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

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const value = match[0]
    const start = match.index
    const category = categoryFor(value, text.slice(Math.max(0, start - 32), start))
    tokens.push({
      value,
      normalized: value.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ''),
      start,
      end: start + value.length,
      ...(category === undefined ? {} : { category }),
    })
  }
  return tokens
}

function contextualWeight(input: {
  left: Token[]
  right: Token[]
  leftIndex: number
  rightIndex: number
}) {
  let weight = 4
  if (
    input.left[input.leftIndex - 1]?.normalized === input.right[input.rightIndex - 1]?.normalized
  ) {
    weight++
  }
  if (
    input.left[input.leftIndex + 1]?.normalized === input.right[input.rightIndex + 1]?.normalized
  ) {
    weight++
  }
  return weight
}

export function alignTokens(
  ocr: Token[],
  gemini: Token[],
  ledger: AlignmentLedger
): Match[] | undefined {
  const columns = gemini.length + 1
  const cells = (ocr.length + 1) * columns
  if (!ledger.consume(cells)) return undefined
  const scores = new Uint32Array(cells)
  for (let leftIndex = 1; leftIndex <= ocr.length; leftIndex++) {
    for (let rightIndex = 1; rightIndex <= gemini.length; rightIndex++) {
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
      scores[offset] = Math.max(scores[offset - columns], scores[offset - 1], diagonal)
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
  return matches.reverse()
}

export function createHunks(ocr: Token[], gemini: Token[], matches: Match[]): Hunk[] {
  const hunks: Hunk[] = []
  let ocrStart = 0
  let geminiStart = 0
  const terminal = { ocrIndex: ocr.length, geminiIndex: gemini.length }
  for (const [matchIndex, match] of [...matches, terminal].entries()) {
    if (match.ocrIndex > ocrStart || match.geminiIndex > geminiStart) {
      hunks.push({
        ocr: ocr.slice(ocrStart, match.ocrIndex),
        gemini: gemini.slice(geminiStart, match.geminiIndex),
        ocrInsertionOffset:
          ocr[ocrStart]?.start ?? ocr[match.ocrIndex]?.start ?? ocr.at(-1)?.end ?? 0,
        geminiInsertionOffset:
          gemini[geminiStart]?.start ?? gemini[match.geminiIndex]?.start ?? gemini.at(-1)?.end ?? 0,
        hasLeftMatch: matchIndex > 0,
        hasRightMatch: matchIndex < matches.length,
      })
    }
    ocrStart = match.ocrIndex + 1
    geminiStart = match.geminiIndex + 1
  }
  return hunks
}

export type CriticalOrderAnalysis = {
  ambiguous: boolean
  categories: CriticalCategory[]
  divergences: CriticalDivergence[]
}

export function analyzeCriticalOrder(ocr: Token[], gemini: Token[]): CriticalOrderAnalysis {
  const critical = (tokens: Token[]) => tokens.filter(token => token.category !== undefined)
  const ocrCritical = critical(ocr)
  const geminiCritical = critical(gemini)
  const keyFor = (token: Token) => `${token.category}:${token.normalized}`
  const countTokens = (tokens: Token[]) => {
    const counts = new Map<string, number>()
    for (const token of tokens) {
      const key = keyFor(token)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }
  const ocrCounts = countTokens(ocrCritical)
  const geminiCounts = countTokens(geminiCritical)
  const keys = new Set([...ocrCounts.keys(), ...geminiCounts.keys()])
  let ocrOnly = false
  let geminiOnly = false
  let repeatedAmbiguity = false
  for (const key of keys) {
    const ocrCount = ocrCounts.get(key) ?? 0
    const geminiCount = geminiCounts.get(key) ?? 0
    ocrOnly ||= ocrCount > geminiCount
    geminiOnly ||= geminiCount > ocrCount
    repeatedAmbiguity ||= ocrCount !== geminiCount && Math.max(ocrCount, geminiCount) > 1
  }
  const balancedKeys = new Set(
    [...keys].filter(key => {
      const ocrCount = ocrCounts.get(key) ?? 0
      return ocrCount > 0 && ocrCount === (geminiCounts.get(key) ?? 0)
    })
  )
  const balancedSequence = (tokens: Token[]) =>
    tokens.map(keyFor).filter(key => balancedKeys.has(key))
  const ocrSequence = balancedSequence(ocrCritical)
  const geminiSequence = balancedSequence(geminiCritical)
  const reordered =
    ocrSequence.length > 1 && ocrSequence.some((key, index) => geminiSequence[index] !== key)
  const ambiguous = repeatedAmbiguity || reordered
  const divergences: CriticalDivergence[] = []
  if (ambiguous) divergences.push('duplicate_or_reordered')
  if (reordered && geminiOnly) divergences.push('gemini_only')
  if (reordered && ocrOnly) divergences.push('ocr_only')
  return {
    ambiguous,
    categories: uniqueSorted(
      [...ocrCritical, ...geminiCritical].flatMap(token => token.category ?? [])
    ),
    divergences: uniqueSorted(divergences),
  }
}

export function uniqueSorted<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort()
}
