export const SAFE_VISUAL_POLICY_VERSION = 'safe-visual-v1' as const

export const SAFE_VISUAL_THRESHOLDS = {
  minimumOcrConfidence: 70,
  minimumSimilarityBps: 9_900,
  maximumEditDistance: 20,
  minimumLengthRatio: 0.95,
  maximumLengthRatio: 1.05,
} as const

export type VisualReconciliationDecision = 'retain_ocr' | 'promote_visual' | 'conflict'

export type VisualComparison = {
  similarityBps: number
  editDistance: number
  protectedFieldsMatch: boolean
}

export type VisualReconciliationResult = {
  policyVersion: typeof SAFE_VISUAL_POLICY_VERSION
  decision: VisualReconciliationDecision
  decisionReason: string
  comparison: VisualComparison
}

type ReconciliationInput = {
  ocrText: string
  visualText: string
  ocrConfidence?: number
}

type MeasuredEditDistance = {
  distance: number
  operations: number
}

type BandValueInput = {
  row: Int32Array
  rowStart: number
  rowEnd: number
  index: number
  sentinel: number
}

const protectedPatterns = [
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/giu,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/giu,
  /(?:R\$|US\$|€|£)\s*\d+(?:[.,]\d+)*/giu,
  /\b\d+\s*\/\s*\d+\b/giu,
  /\b\d+(?:[.,]\d+)*\s*(?:mm|cm|km|m²|m2|m|ha)(?![\p{L}\p{N}])/giu,
  /\bmatr[ií]cula\s*(?:n[º°o.]?\s*)?\d+(?:[.-]\d+)*/giu,
  /\b(?:R|AV)\s*\.\s*\d+/giu,
  /\b(?:não|nao|sem|nunca|jamais|inexistente|inexistem|nenhum|nenhuma)\b/giu,
  /\b\d+(?:[.,/-]\d+)*\b/gu,
] as const

function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .replaceAll('\u00ad', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function comparisonText(text: string): string {
  return normalizeText(text).replace(/\s+/gu, ' ')
}

function structuralContent(text: string): string {
  return comparisonText(text).replace(/\s/gu, '')
}

function protectedFingerprint(text: string): string[] {
  const normalized = comparisonText(text).replace(/(?<=[\p{N}.,/mM-])\s+(?=[\p{N}².,/-])/gu, '')
  return protectedPatterns.flatMap(pattern =>
    (normalized.match(new RegExp(pattern.source, pattern.flags)) ?? []).map((match: string) =>
      match.replace(/\s/gu, '').toLocaleLowerCase('pt-BR')
    )
  )
}

function bandValue({ row, rowStart, rowEnd, index, sentinel }: BandValueInput): number {
  return index < rowStart || index > rowEnd ? sentinel : row[index - rowStart]
}

function measureBoundedEditDistance(
  left: string,
  right: string,
  maximum: number
): MeasuredEditDistance {
  if (left === right) return { distance: 0, operations: 0 }
  if (Math.abs(left.length - right.length) > maximum) {
    return { distance: maximum + 1, operations: 0 }
  }

  const sentinel = maximum + 1
  const bandWidth = maximum * 2 + 3
  let previous = new Int32Array(bandWidth)
  let current = new Int32Array(bandWidth)
  let previousStart = 0
  let previousEnd = Math.min(right.length, maximum)
  for (let column = previousStart; column <= previousEnd; column++) {
    previous[column - previousStart] = column
  }

  let operations = 0
  for (let row = 1; row <= left.length; row++) {
    current.fill(sentinel)
    const currentStart = Math.max(0, row - maximum)
    const currentEnd = Math.min(right.length, row + maximum)
    for (let column = currentStart; column <= currentEnd; column++) {
      if (column === 0) {
        current[column - currentStart] = row
        continue
      }
      operations++
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1
      current[column - currentStart] = Math.min(
        bandValue({
          row: previous,
          rowStart: previousStart,
          rowEnd: previousEnd,
          index: column,
          sentinel,
        }) + 1,
        bandValue({
          row: current,
          rowStart: currentStart,
          rowEnd: currentEnd,
          index: column - 1,
          sentinel,
        }) + 1,
        bandValue({
          row: previous,
          rowStart: previousStart,
          rowEnd: previousEnd,
          index: column - 1,
          sentinel,
        }) + substitutionCost
      )
    }
    const completedRow = previous
    previous = current
    current = completedRow
    previousStart = currentStart
    previousEnd = currentEnd
  }

  return {
    distance: Math.min(
      bandValue({
        row: previous,
        rowStart: previousStart,
        rowEnd: previousEnd,
        index: right.length,
        sentinel,
      }),
      sentinel
    ),
    operations,
  }
}

export function measureBoundedEditDistanceForTest(
  left: string,
  right: string,
  maximum: number
): MeasuredEditDistance {
  return measureBoundedEditDistance(left, right, maximum)
}

function createComparison(ocrText: string, visualText: string): VisualComparison {
  const normalizedOcr = comparisonText(ocrText)
  const normalizedVisual = comparisonText(visualText)
  const editDistance = measureBoundedEditDistance(
    normalizedOcr,
    normalizedVisual,
    SAFE_VISUAL_THRESHOLDS.maximumEditDistance
  ).distance
  const maximumLength = Math.max(
    Array.from(normalizedOcr).length,
    Array.from(normalizedVisual).length
  )
  const similarityBps =
    maximumLength === 0
      ? 10_000
      : Math.max(0, Math.round(((maximumLength - editDistance) / maximumLength) * 10_000))

  return {
    similarityBps,
    editDistance,
    protectedFieldsMatch:
      structuralContent(ocrText) === structuralContent(visualText) &&
      JSON.stringify(protectedFingerprint(ocrText)) ===
        JSON.stringify(protectedFingerprint(visualText)),
  }
}

function conflict(
  decisionReason: string,
  comparison: VisualComparison
): VisualReconciliationResult {
  return {
    policyVersion: SAFE_VISUAL_POLICY_VERSION,
    decision: 'conflict',
    decisionReason,
    comparison,
  }
}

export function reconcileVisualText(input: ReconciliationInput): VisualReconciliationResult {
  const normalizedOcr = comparisonText(input.ocrText)
  const normalizedVisual = comparisonText(input.visualText)

  if (normalizedOcr === normalizedVisual) {
    return {
      policyVersion: SAFE_VISUAL_POLICY_VERSION,
      decision: 'retain_ocr',
      decisionReason: 'equal_normalized_text',
      comparison: { similarityBps: 10_000, editDistance: 0, protectedFieldsMatch: true },
    }
  }
  const comparison = createComparison(input.ocrText, input.visualText)
  if (!comparison.protectedFieldsMatch) return conflict('protected_content_changed', comparison)
  if ((input.ocrConfidence ?? 0) < SAFE_VISUAL_THRESHOLDS.minimumOcrConfidence) {
    return conflict('ocr_confidence_below_alignment_floor', comparison)
  }

  const ocrLength = Array.from(normalizedOcr).length
  const visualLength = Array.from(normalizedVisual).length
  const lengthRatio = ocrLength === 0 ? Number.POSITIVE_INFINITY : visualLength / ocrLength
  if (
    lengthRatio < SAFE_VISUAL_THRESHOLDS.minimumLengthRatio ||
    lengthRatio > SAFE_VISUAL_THRESHOLDS.maximumLengthRatio
  ) {
    return conflict('length_ratio_out_of_bounds', comparison)
  }
  if (comparison.editDistance > SAFE_VISUAL_THRESHOLDS.maximumEditDistance) {
    return conflict('edit_distance_exceeded', comparison)
  }
  if (comparison.similarityBps < SAFE_VISUAL_THRESHOLDS.minimumSimilarityBps) {
    return conflict('similarity_below_threshold', comparison)
  }
  if (structuralContent(input.ocrText) !== structuralContent(input.visualText)) {
    return conflict('content_changed', comparison)
  }
  if (visualLength >= ocrLength) return conflict('structural_fragmentation_not_reduced', comparison)

  return {
    policyVersion: SAFE_VISUAL_POLICY_VERSION,
    decision: 'promote_visual',
    decisionReason: 'safe_structural_repair',
    comparison,
  }
}
