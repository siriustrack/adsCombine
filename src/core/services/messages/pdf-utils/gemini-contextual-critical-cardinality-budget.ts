export type ContextualCriticalCardinalityWorkSection = Readonly<{
  ocrTokenCount: number
  geminiTokenCount: number
  anchorCount: number
}>

function safeProduct(left: number, right: number): number | undefined {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) {
    return undefined
  }
  if (left !== 0 && right > Number.MAX_SAFE_INTEGER / left) return undefined
  return left * right
}

function safeSum(values: readonly number[]): number | undefined {
  let total = 0
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || total > Number.MAX_SAFE_INTEGER - value) {
      return undefined
    }
    total += value
  }
  return total
}

export function contextualCriticalCardinalityWork(
  sections: readonly ContextualCriticalCardinalityWorkSection[]
): number | undefined {
  const tokenCounts = sections.flatMap(section => [section.ocrTokenCount, section.geminiTokenCount])
  const totalTokenCount = safeSum(tokenCounts)
  if (totalTokenCount === undefined) return undefined
  const tokenWork = safeProduct(3, totalTokenCount)
  if (tokenWork === undefined) return undefined

  const sectionWork: number[] = []
  for (const section of sections) {
    const anchorWork = safeProduct(2, section.anchorCount)
    if (anchorWork === undefined) return undefined
    const work = safeSum([anchorWork, 1])
    if (work === undefined) return undefined
    sectionWork.push(work)
  }
  const structuralWork = safeSum(sectionWork)
  return structuralWork === undefined ? undefined : safeSum([tokenWork, structuralWork])
}
