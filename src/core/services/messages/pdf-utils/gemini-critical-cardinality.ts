import type { Token } from './gemini-critical-tokenization'
import { uniqueSorted } from './gemini-critical-tokenization'
import type { CriticalCategory, CriticalDivergence } from './visual-fallback.types'

export type CriticalCardinalityCounts = Readonly<{
  ocrOnlyCriticalTokenCount: number
  geminiOnlyCriticalTokenCount: number
}>

export type CriticalOrderAnalysis = Readonly<{
  ambiguous: boolean
  cardinalityMismatch: boolean
  categories: CriticalCategory[]
  divergences: CriticalDivergence[]
}>

function criticalTokens(tokens: readonly Token[]): Token[] {
  return tokens.filter(token => token.category !== undefined)
}

function criticalIdentity(token: Token): string {
  return `${token.category}:${token.normalized}`
}

function countByIdentity(tokens: readonly Token[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) {
    const identity = criticalIdentity(token)
    counts.set(identity, (counts.get(identity) ?? 0) + 1)
  }
  return counts
}

export function countCriticalCardinality(
  ocr: readonly Token[],
  gemini: readonly Token[]
): CriticalCardinalityCounts {
  const ocrCounts = countByIdentity(criticalTokens(ocr))
  const geminiCounts = countByIdentity(criticalTokens(gemini))
  const identities = new Set([...ocrCounts.keys(), ...geminiCounts.keys()])
  let ocrOnlyCriticalTokenCount = 0
  let geminiOnlyCriticalTokenCount = 0
  for (const identity of identities) {
    const ocrOccurrences = ocrCounts.get(identity) ?? 0
    const geminiOccurrences = geminiCounts.get(identity) ?? 0
    ocrOnlyCriticalTokenCount += Math.max(ocrOccurrences - geminiOccurrences, 0)
    geminiOnlyCriticalTokenCount += Math.max(geminiOccurrences - ocrOccurrences, 0)
  }
  return { ocrOnlyCriticalTokenCount, geminiOnlyCriticalTokenCount }
}

export function analyzeCriticalOrder(
  ocr: readonly Token[],
  gemini: readonly Token[]
): CriticalOrderAnalysis {
  const ocrCritical = criticalTokens(ocr)
  const geminiCritical = criticalTokens(gemini)
  const ocrCounts = countByIdentity(ocrCritical)
  const geminiCounts = countByIdentity(geminiCritical)
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
  const balancedSequence = (tokens: readonly Token[]) =>
    tokens.map(criticalIdentity).filter(key => balancedKeys.has(key))
  const ocrSequence = balancedSequence(ocrCritical)
  const geminiSequence = balancedSequence(geminiCritical)
  const reordered =
    ocrSequence.length > 1 && ocrSequence.some((key, index) => geminiSequence[index] !== key)
  const ambiguous = repeatedAmbiguity || reordered
  const cardinalityMismatch = ocrOnly || geminiOnly
  const divergences: CriticalDivergence[] = []
  if (ambiguous) divergences.push('duplicate_or_reordered')
  if (reordered && geminiOnly) divergences.push('gemini_only')
  if (reordered && ocrOnly) divergences.push('ocr_only')
  return {
    ambiguous,
    cardinalityMismatch,
    categories: uniqueSorted(
      [...ocrCritical, ...geminiCritical].flatMap(token => token.category ?? [])
    ),
    divergences: uniqueSorted(divergences),
  }
}
