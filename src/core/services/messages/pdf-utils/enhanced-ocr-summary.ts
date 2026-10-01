type OcrSummaryPage = {
  readonly meanConfidence?: number
  readonly selectedAttempt?: { readonly label: string }
  readonly warnings?: readonly string[]
}

export function summarizeOcrPages(pages: readonly OcrSummaryPage[]) {
  const confidences = pages.flatMap(page =>
    page.meanConfidence === undefined ? [] : [page.meanConfidence]
  )
  const warningsByType: Record<string, number> = {}
  const attemptsByLabel: Record<string, number> = {}
  let warningPageCount = 0
  for (const page of pages) {
    if ((page.warnings?.length ?? 0) > 0) warningPageCount++
    for (const warning of page.warnings ?? []) {
      warningsByType[warning] = (warningsByType[warning] ?? 0) + 1
    }
    const label = page.selectedAttempt?.label
    if (label) attemptsByLabel[label] = (attemptsByLabel[label] ?? 0) + 1
  }
  return {
    pageCount: pages.length,
    warningPageCount,
    warningsByType,
    attemptsByLabel,
    ...(confidences.length > 0
      ? {
          averageConfidence:
            confidences.reduce((total, confidence) => total + confidence, 0) / confidences.length,
          minimumConfidence: Math.min(...confidences),
        }
      : {}),
  }
}
