import { type Hunk, type Token, uniqueSorted } from './gemini-critical-tokenization'
import type {
  CriticalCategory,
  CriticalDivergence,
  CriticalUncertaintyRange,
} from './visual-fallback.types'

type RangeTarget = 'ocr' | 'gemini'
type CriticalToken = Token & { category: CriticalCategory }
export type ClauseIndex = { locate(offset: number): { start: number; end: number } }

export function criticalTokens(tokens: Token[]): CriticalToken[] {
  return tokens.filter((token): token is CriticalToken => token.category !== undefined)
}

export function buildClauseIndex(
  text: string,
  tokens: Token[],
  probe?: { onCharacterRead(): void }
): ClauseIndex {
  const protectedTokens = criticalTokens(tokens)
  const boundaries: number[] = [0]
  const starts: number[] = [0]
  let firstPendingStart = 0
  let protectedIndex = 0
  for (let index = 0; index < text.length; index++) {
    probe?.onCharacterRead()
    while (
      protectedTokens[protectedIndex] !== undefined &&
      protectedTokens[protectedIndex].end <= index
    ) {
      protectedIndex++
    }
    const protectedToken = protectedTokens[protectedIndex]
    const isProtected =
      protectedToken !== undefined && protectedToken.start <= index && index < protectedToken.end
    const character = text[index]
    if (!/\s/u.test(character)) {
      while (firstPendingStart < starts.length) {
        starts[firstPendingStart] = index
        firstPendingStart++
      }
    }
    if (character === ';' || character === '\n' || (character === '.' && !isProtected)) {
      boundaries.push(index + 1)
      starts.push(index + 1)
    }
  }
  while (firstPendingStart < starts.length) {
    starts[firstPendingStart] = text.length
    firstPendingStart++
  }
  if (boundaries.at(-1) !== text.length) {
    boundaries.push(text.length)
    starts.push(text.length)
  }
  return {
    locate(offset) {
      const bounded = Math.min(Math.max(offset, 0), text.length)
      let low = 0
      let high = boundaries.length - 1
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2)
        if (boundaries[middle] <= bounded) low = middle
        else high = middle
      }
      return { start: starts[low], end: boundaries[high] ?? text.length }
    },
  }
}

function divergenceFor(hunk: Hunk): CriticalDivergence {
  if (hunk.ocr.length === 0) return 'gemini_only'
  if (hunk.gemini.length === 0) return 'ocr_only'
  return 'different_value'
}

function projectedDivergence(divergence: CriticalDivergence, target: RangeTarget) {
  if (target !== 'ocr') return divergence
  if (divergence === 'gemini_only') return 'ocr_only'
  if (divergence === 'ocr_only') return 'gemini_only'
  return divergence
}

export function projectDivergences(
  divergences: CriticalDivergence[],
  target: RangeTarget
): CriticalDivergence[] {
  return divergences.map(divergence => projectedDivergence(divergence, target))
}

export function pageRange(
  text: string,
  categories: CriticalCategory[],
  divergences: CriticalDivergence[]
): CriticalUncertaintyRange {
  return { start: 0, end: text.length, scope: 'page', categories, divergences }
}

export function rangesForHunk({
  text,
  clauseIndex,
  hunk,
  target,
  structurallyUnique,
}: {
  text: string
  clauseIndex: ClauseIndex
  hunk: Hunk
  target: RangeTarget
  structurallyUnique: boolean
}): CriticalUncertaintyRange[] {
  const ocrCritical = criticalTokens(hunk.ocr)
  const geminiCritical = criticalTokens(hunk.gemini)
  const categories = uniqueSorted([...ocrCritical, ...geminiCritical].map(token => token.category))
  if (categories.length === 0) return []
  const divergence = divergenceFor(hunk)
  const targetCritical = target === 'gemini' ? geminiCritical : ocrCritical
  const bothSidesHaveCritical = ocrCritical.length > 0 && geminiCritical.length > 0
  const categoryCount = (tokens: CriticalToken[], category: CriticalCategory) =>
    tokens.filter(token => token.category === category).length
  const categoryCardinalityMismatch = categories.some(
    category => categoryCount(ocrCritical, category) !== categoryCount(geminiCritical, category)
  )
  if (bothSidesHaveCritical && categoryCardinalityMismatch) {
    const projected = projectedDivergence(divergence, target)
    if (!structurallyUnique) return [pageRange(text, categories, [projected])]
    const offset = target === 'gemini' ? hunk.geminiInsertionOffset : hunk.ocrInsertionOffset
    return [
      {
        ...clauseIndex.locate(offset),
        scope: 'clause',
        categories,
        divergences: [projected],
      },
    ]
  }
  if (targetCritical.length > 0) {
    return targetCritical.map(token => ({
      start: token.start,
      end: token.end,
      scope: 'token',
      categories: [token.category],
      divergences: [projectedDivergence(divergence, target)],
    }))
  }
  const sourceCritical = target === 'gemini' ? ocrCritical : geminiCritical
  const sourceAll = target === 'gemini' ? hunk.ocr : hunk.gemini
  const sourceCounts = new Map<string, number>()
  for (const token of sourceAll) {
    sourceCounts.set(token.normalized, (sourceCounts.get(token.normalized) ?? 0) + 1)
  }
  const repeatedSource = sourceCritical.some(token => (sourceCounts.get(token.normalized) ?? 0) > 1)
  const safelyEnclosed = structurallyUnique || (hunk.hasLeftMatch && hunk.hasRightMatch)
  if (!safelyEnclosed || repeatedSource) {
    return [pageRange(text, categories, [projectedDivergence(divergence, target)])]
  }
  const offset = target === 'gemini' ? hunk.geminiInsertionOffset : hunk.ocrInsertionOffset
  return [
    {
      ...clauseIndex.locate(offset),
      scope: 'clause',
      categories,
      divergences: [projectedDivergence(divergence, target)],
    },
  ]
}

export function aggregateRanges(
  text: string,
  ranges: CriticalUncertaintyRange[]
): CriticalUncertaintyRange[] {
  if (ranges.length > 32) {
    return [
      pageRange(
        text,
        uniqueSorted(ranges.flatMap(range => range.categories)),
        uniqueSorted(ranges.flatMap(range => range.divergences))
      ),
    ]
  }
  const byIdentity = new Map<string, CriticalUncertaintyRange>()
  for (const range of ranges) {
    const key = `${range.start}:${range.end}:${range.scope}`
    const previous = byIdentity.get(key)
    byIdentity.set(key, {
      ...range,
      categories: uniqueSorted([...(previous?.categories ?? []), ...range.categories]),
      divergences: uniqueSorted([...(previous?.divergences ?? []), ...range.divergences]),
    })
  }
  const sorted = [...byIdentity.values()].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )
  const merged: CriticalUncertaintyRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (previous && range.start < previous.end) {
      previous.end = Math.max(previous.end, range.end)
      previous.scope = previous.scope === 'page' || range.scope === 'page' ? 'page' : 'clause'
      previous.categories = uniqueSorted([...previous.categories, ...range.categories])
      previous.divergences = uniqueSorted([...previous.divergences, ...range.divergences])
    } else {
      merged.push({ ...range })
    }
  }
  if (merged.length <= 32) return merged
  return [
    pageRange(
      text,
      uniqueSorted(merged.flatMap(range => range.categories)),
      uniqueSorted(merged.flatMap(range => range.divergences))
    ),
  ]
}
