import { sanitizePdfText } from 'utils/sanitize'
import { tokenize } from './gemini-critical-tokenization'

type FurnitureBand = 'top' | 'bottom'

type TextLine = {
  start: number
  end: number
  text: string
  normalized: string
  signature: string
  pageCounter: boolean
  counter?: {
    page: number
    total?: number
    numberStart: number
    numberEnd: number
    structure: string
  }
}

export type FurnitureLine = TextLine & {
  band: FurnitureBand
  documentPageNumber?: number
}

export type PageFurnitureProfile = {
  top: FurnitureLine[]
  bottom: FurnitureLine[]
  preprocessingExceeded?: true
  preprocessingWork?: number
}

export type FurnitureAlignmentSection = {
  kind: 'top' | 'body' | 'bottom'
  ocrStart: number
  ocrEnd: number
  geminiStart: number
  geminiEnd: number
  structurallyUnique?: boolean
}

export type FurnitureAlignmentPlan = {
  sections: FurnitureAlignmentSection[]
  ignoredOcrSpans: Array<{ start: number; end: number }>
  ignoredGeminiSpans: Array<{ start: number; end: number }>
  preprocessingExceeded?: true
  preprocessingWork?: number
}

const PAGE_COUNTER_PATTERN = /^\s*(p[aá]gina|p[aá]g\.?|folha)\s+(\d+)(?:\s*(de|\/)\s*(\d+))?\s*$/iu

function parsePageCounter(text: string): TextLine['counter'] {
  const match = PAGE_COUNTER_PATTERN.exec(text)
  if (!match || match.index === undefined) return undefined
  const numberStart = text.indexOf(match[2], match.index + match[1].length)
  return {
    page: Number(match[2]),
    ...(match[4] === undefined ? {} : { total: Number(match[4]) }),
    numberStart,
    numberEnd: numberStart + match[2].length,
    structure: `${normalizeLine(match[1])}:${match[3] ?? 'single'}:${match[4] === undefined ? 'open' : 'total'}`,
  }
}

function normalizeLine(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase('pt-BR').replace(/\s+/gu, ' ').trim()
}

function nonCriticalSignature(text: string): string {
  const normalized = normalizeLine(text)
  const counter = parsePageCounter(normalized)
  if (counter) return `<page-counter:${counter.structure}>`
  return tokenize(normalized)
    .filter(token => token.category === undefined && /[\p{L}\p{N}]/u.test(token.value))
    .map(token => token.normalized)
    .join('|')
}

function textLines(text: string): TextLine[] {
  const lines: TextLine[] = []
  let start = 0
  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 ? text.length : newline
    const lineText = text.slice(start, end)
    const normalized = normalizeLine(lineText)
    if (normalized) {
      const counter = parsePageCounter(lineText)
      lines.push({
        start,
        end,
        text: lineText,
        normalized,
        signature: nonCriticalSignature(lineText),
        pageCounter: counter !== undefined,
        ...(counter ? { counter } : {}),
      })
    }
    if (newline < 0) break
    start = newline + 1
  }
  return lines
}

function edgeLines(text: string): { top: TextLine[]; bottom: TextLine[]; all: TextLine[] } {
  const all = textLines(text)
  if (all.length < 5) return { top: [], bottom: [], all }
  return { top: all.slice(0, 2), bottom: all.slice(-2), all }
}

function furnitureKey(line: TextLine): string {
  return line.pageCounter ? line.signature : line.normalized
}

type Candidate = FurnitureLine & {
  documentPageNumber: number
  key: string
  occurrenceCount: number
}

function legalActSpans(text: string): Array<{ start: number; end: number }> {
  const tokens = tokenize(text)
  const spans: Array<{ start: number; end: number }> = []
  let openStart: number | undefined
  for (const token of tokens) {
    if (token.category === 'registry_marker') {
      if (openStart !== undefined) spans.push({ start: openStart, end: token.start })
      openStart = token.start
    } else if (openStart !== undefined && (token.value === ';' || token.value === '.')) {
      spans.push({ start: openStart, end: token.end })
      openStart = undefined
    }
  }
  if (openStart !== undefined) spans.push({ start: openStart, end: text.length })
  return spans
}

function candidatesForPage(pageNumber: number, text: string): Candidate[] {
  const edges = edgeLines(text)
  const protectedSpans = legalActSpans(text)
  const occurrences = new Map<string, number>()
  for (const line of edges.all) {
    const key = furnitureKey(line)
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1)
  }
  const candidates: Candidate[] = []
  for (const band of ['top', 'bottom'] as const) {
    for (const line of edges[band]) {
      if (protectedSpans.some(span => line.start < span.end && line.end > span.start)) continue
      const key = furnitureKey(line)
      candidates.push({
        ...line,
        band,
        documentPageNumber: pageNumber,
        key,
        occurrenceCount: occurrences.get(key) ?? 0,
      })
    }
  }
  return candidates
}

function validCounterGroup(group: Candidate[]): boolean {
  if (!group[0]?.pageCounter) return true
  const totals = new Set(group.flatMap(candidate => candidate.counter?.total ?? []))
  return (
    totals.size <= 1 &&
    group.every(
      candidate =>
        candidate.counter?.page === candidate.documentPageNumber &&
        (candidate.counter.total === undefined || candidate.counter.page <= candidate.counter.total)
    )
  )
}

function groupCandidates(candidates: Candidate[]): Map<string, Candidate[]> {
  const bandsByKey = new Map<string, Set<FurnitureBand>>()
  for (const candidate of candidates) {
    const bands = bandsByKey.get(candidate.key) ?? new Set<FurnitureBand>()
    bands.add(candidate.band)
    bandsByKey.set(candidate.key, bands)
  }
  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    if (bandsByKey.get(candidate.key)?.size !== 1) continue
    const groupKey = `${candidate.band}:${candidate.key}`
    const group = groups.get(groupKey) ?? []
    group.push(candidate)
    groups.set(groupKey, group)
  }
  return groups
}

function isConfirmedGroup(group: Candidate[]): boolean {
  if (new Set(group.map(candidate => candidate.documentPageNumber)).size < 3) return false
  const countByPage = new Map<number, number>()
  for (const candidate of group) {
    countByPage.set(
      candidate.documentPageNumber,
      (countByPage.get(candidate.documentPageNumber) ?? 0) + 1
    )
  }
  return (
    validCounterGroup(group) &&
    group.every(
      candidate =>
        countByPage.get(candidate.documentPageNumber) === 1 && candidate.occurrenceCount === 1
    )
  )
}

export function buildDocumentFurnitureProfile(
  pages: Array<{ pageNumber: number; text: string }>,
  maxPreprocessingWork = Number.MAX_SAFE_INTEGER
): ReadonlyMap<number, PageFurnitureProfile> {
  const rawProfiles = new Map<number, PageFurnitureProfile>(
    pages.map(page => [page.pageNumber, { top: [], bottom: [] }])
  )
  const estimatedWork = pages.reduce((total, page) => total + page.text.length, 0)
  if (estimatedWork > maxPreprocessingWork) {
    for (const profile of rawProfiles.values()) profile.preprocessingExceeded = true
    return rawProfiles
  }
  for (const profile of rawProfiles.values()) {
    Object.defineProperty(profile, 'preprocessingWork', { value: estimatedWork })
  }
  const normalizedPages = pages.map(page => ({ ...page, text: sanitizePdfText(page.text) }))
  const profiles = rawProfiles
  if (normalizedPages.length < 3) return profiles
  const candidates = normalizedPages.flatMap(page => candidatesForPage(page.pageNumber, page.text))
  for (const group of groupCandidates(candidates).values()) {
    if (!isConfirmedGroup(group)) continue
    for (const candidate of group) {
      const profile = profiles.get(candidate.documentPageNumber)
      if (!profile) continue
      profile[candidate.band].push(candidate)
    }
  }
  for (const profile of profiles.values()) {
    profile.top.sort((left, right) => left.start - right.start)
    profile.bottom.sort((left, right) => left.start - right.start)
  }
  return profiles
}

type FurnitureLinePair = { ocr: FurnitureLine; gemini: TextLine }

function uniqueCandidatePairs(
  text: string,
  band: FurnitureBand,
  expected: FurnitureLine[]
): FurnitureLinePair[] {
  const candidates = edgeLines(text)[band]
  const matched: FurnitureLinePair[] = []
  for (const line of expected) {
    const matches = candidates.filter(candidate => candidate.signature === line.signature)
    if (matches.length !== 1 || matched.some(pair => pair.gemini === matches[0])) continue
    matched.push({ ocr: line, gemini: matches[0] })
  }
  return matched
}

function numericSpans(lines: TextLine[]): Array<{ start: number; end: number }> {
  return lines.flatMap(line =>
    line.counter
      ? [{ start: line.start + line.counter.numberStart, end: line.start + line.counter.numberEnd }]
      : []
  )
}

export function createFurnitureAlignmentPlan(
  ocrText: string,
  geminiText: string,
  profile?: PageFurnitureProfile
): FurnitureAlignmentPlan | undefined {
  if (profile?.preprocessingExceeded) {
    return {
      sections: [],
      ignoredOcrSpans: [],
      ignoredGeminiSpans: [],
      preprocessingExceeded: true,
    }
  }
  if ((profile?.top.length ?? 0) > 2 || (profile?.bottom.length ?? 0) > 2) {
    return {
      sections: [],
      ignoredOcrSpans: [],
      ignoredGeminiSpans: [],
      preprocessingExceeded: true,
    }
  }
  if (!profile || (profile.top.length === 0 && profile.bottom.length === 0)) return undefined
  const geminiTopPairs = uniqueCandidatePairs(geminiText, 'top', profile.top)
  const geminiBottomPairs = uniqueCandidatePairs(geminiText, 'bottom', profile.bottom)
  const geminiTop = geminiTopPairs.map(pair => pair.gemini)
  const geminiBottom = geminiBottomPairs.map(pair => pair.gemini)
  const ocrTopEnd = Math.max(0, ...profile.top.map(line => line.end))
  const geminiTopEnd = Math.max(0, ...geminiTop.map(line => line.end))
  const ocrBottomStart = Math.min(ocrText.length, ...profile.bottom.map(line => line.start))
  const geminiBottomStart = Math.min(geminiText.length, ...geminiBottom.map(line => line.start))
  const candidateSections: FurnitureAlignmentSection[] = [
    {
      kind: 'top',
      ocrStart: 0,
      ocrEnd: ocrTopEnd,
      geminiStart: 0,
      geminiEnd: geminiTopEnd,
      structurallyUnique: true,
    },
    {
      kind: 'body',
      ocrStart: ocrTopEnd,
      ocrEnd: ocrBottomStart,
      geminiStart: geminiTopEnd,
      geminiEnd: geminiBottomStart,
      structurallyUnique: false,
    },
    {
      kind: 'bottom',
      ocrStart: ocrBottomStart,
      ocrEnd: ocrText.length,
      geminiStart: geminiBottomStart,
      geminiEnd: geminiText.length,
      structurallyUnique: true,
    },
  ]
  const sections = candidateSections.filter(
    section => section.ocrStart < section.ocrEnd || section.geminiStart < section.geminiEnd
  )
  const counterPairs = [...geminiTopPairs, ...geminiBottomPairs].filter(({ ocr, gemini }) => {
    const ocrCounter = ocr.counter
    const geminiCounter = gemini.counter
    if (!ocrCounter || !geminiCounter) return false
    return (
      ocr.pageCounter &&
      gemini.pageCounter &&
      ocrCounter.page === ocr.documentPageNumber &&
      geminiCounter.page === ocr.documentPageNumber &&
      geminiCounter.total === ocrCounter.total
    )
  })
  return {
    sections,
    preprocessingWork: profile.preprocessingWork,
    ignoredOcrSpans: numericSpans(counterPairs.map(pair => pair.ocr)),
    ignoredGeminiSpans: numericSpans(counterPairs.map(pair => pair.gemini)),
  }
}
