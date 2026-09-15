import type { Token } from './gemini-critical-tokenization'

export type Region = {
  readonly index: number
  readonly start: number
  readonly end: number
  readonly tokens: Token[]
  readonly marker?: Token
  readonly markerKey?: string
  readonly signature: string
}

export type RegionPair = {
  readonly ocr: Region
  readonly gemini: Region
  readonly structurallyUnique: boolean
}

function structuralSignature(tokens: Token[]): string {
  return tokens
    .filter(token => token.category === undefined && /[\p{L}\p{N}]/u.test(token.value))
    .map(token => token.normalized)
    .join('|')
}

export function filterIgnoredTokens(
  tokens: Token[],
  spans: Array<{ start: number; end: number }>
): Token[] {
  const orderedSpans = [...spans].sort((left, right) => left.start - right.start)
  let spanIndex = 0
  return tokens.filter(token => {
    while ((orderedSpans[spanIndex]?.end ?? Number.POSITIVE_INFINITY) <= token.start) spanIndex++
    const span = orderedSpans[spanIndex]
    return !span || token.start < span.start || token.end > span.end
  })
}

export function createRegions(text: string, tokens: Token[]): Region[] {
  if (!tokens.some(token => token.category === 'registry_marker')) {
    return [
      { index: 0, start: 0, end: text.length, tokens, signature: structuralSignature(tokens) },
    ]
  }
  const groups: Array<{ start: number; marker?: Token; tokens: Token[] }> = []
  for (const token of tokens) {
    if (token.category === 'registry_marker')
      groups.push({ start: token.start, marker: token, tokens: [] })
    if (groups.length === 0) groups.push({ start: 0, tokens: [] })
    groups.at(-1)?.tokens.push(token)
  }
  return groups.map((group, index) => ({
    index,
    start: group.start,
    end: groups[index + 1]?.start ?? text.length,
    tokens: group.tokens,
    ...(group.marker ? { marker: group.marker, markerKey: group.marker.normalized } : {}),
    signature: structuralSignature(group.tokens),
  }))
}

function uniquePairBy(
  ocrRegions: Region[],
  geminiRegions: Region[],
  keyFor: (region: Region) => string | undefined
): RegionPair[] {
  const pairs: RegionPair[] = []
  const indexByKey = (regions: Region[]) => {
    const index = new Map<string, Region[]>()
    for (const region of regions) {
      const key = keyFor(region)
      if (!key) continue
      const matches = index.get(key) ?? []
      matches.push(region)
      index.set(key, matches)
    }
    return index
  }
  const ocrByKey = indexByKey(ocrRegions)
  const geminiByKey = indexByKey(geminiRegions)
  for (const [key, ocrMatches] of ocrByKey) {
    const geminiMatches = geminiByKey.get(key) ?? []
    const ocrMatch = ocrMatches[0]
    const geminiMatch = geminiMatches[0]
    if (ocrMatches.length === 1 && geminiMatches.length === 1 && ocrMatch && geminiMatch) {
      pairs.push({ ocr: ocrMatch, gemini: geminiMatch, structurallyUnique: true })
    }
  }
  return pairs
}

export function pairRegions(
  ocr: Region[],
  gemini: Region[]
): { pairs: RegionPair[]; ambiguous: boolean } {
  const singleOcr = ocr[0]
  const singleGemini = gemini[0]
  if (
    ocr.length === 1 &&
    gemini.length === 1 &&
    singleOcr &&
    singleGemini &&
    !singleOcr.marker &&
    !singleGemini.marker
  ) {
    return {
      pairs: [{ ocr: singleOcr, gemini: singleGemini, structurallyUnique: false }],
      ambiguous: false,
    }
  }
  const markerPairs = uniquePairBy(ocr, gemini, region => region.markerKey)
  const pairedOcr = new Set(markerPairs.map(pair => pair.ocr))
  const pairedGemini = new Set(markerPairs.map(pair => pair.gemini))
  const remainingOcr = ocr.filter(region => !pairedOcr.has(region))
  const remainingGemini = gemini.filter(region => !pairedGemini.has(region))
  const signaturePairs = uniquePairBy(
    remainingOcr,
    remainingGemini,
    region => region.signature || undefined
  )
  for (const pair of signaturePairs) {
    pairedOcr.add(pair.ocr)
    pairedGemini.add(pair.gemini)
  }
  const pairs = [...markerPairs, ...signaturePairs]
  const residualOcr = ocr.filter(region => !pairedOcr.has(region))
  const residualGemini = gemini.filter(region => !pairedGemini.has(region))
  const ocrResidual = residualOcr[0]
  const geminiResidual = residualGemini[0]
  const anchors = [...pairs].sort((left, right) => left.ocr.index - right.ocr.index)
  let previousGeminiIndex: number | undefined
  const monotonic = anchors.every(pair => {
    if (previousGeminiIndex !== undefined && pair.gemini.index <= previousGeminiIndex) return false
    previousGeminiIndex = pair.gemini.index
    return true
  })
  if (
    residualOcr.length === 1 &&
    residualGemini.length === 1 &&
    ((ocrResidual?.marker && geminiResidual?.marker) ||
      (!ocrResidual?.marker &&
        !geminiResidual?.marker &&
        ocrResidual?.index === 0 &&
        geminiResidual?.index === 0)) &&
    anchors.length > 0 &&
    monotonic &&
    anchors.filter(pair => pair.ocr.index < ocrResidual.index).length ===
      anchors.filter(pair => pair.gemini.index < geminiResidual.index).length
  ) {
    pairs.push({ ocr: ocrResidual, gemini: geminiResidual, structurallyUnique: false })
    pairedOcr.add(ocrResidual)
    pairedGemini.add(geminiResidual)
  }
  const unmatchedOcr = ocr.filter(region => !pairedOcr.has(region))
  const unmatchedGemini = gemini.filter(region => !pairedGemini.has(region))
  const normalized = (regions: Region[]) =>
    regions.map(region => region.tokens.map(token => token.normalized).join(' '))
  const unmatchedEqual =
    JSON.stringify(normalized(unmatchedOcr)) === JSON.stringify(normalized(unmatchedGemini))
  return { pairs, ambiguous: !unmatchedEqual }
}

export function movedPairs(pairs: RegionPair[]): Set<RegionPair> {
  const ocrSlots: Array<RegionPair | undefined> = []
  const geminiSlots: Array<RegionPair | undefined> = []
  for (const pair of pairs) {
    ocrSlots[pair.ocr.index] = pair
    geminiSlots[pair.gemini.index] = pair
  }
  const orderedByOcr = ocrSlots.filter(pair => pair !== undefined)
  const orderedByGemini = geminiSlots.filter(pair => pair !== undefined)
  return new Set(orderedByOcr.filter((pair, index) => orderedByGemini[index] !== pair))
}
