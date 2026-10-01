import { describe, expect, test } from 'bun:test'
import { createEnhancedPdfService, enhancedPdfFile } from './process-pdf-enhanced.test-support'

describe('ProcessPdfService V2 visual overflow', () => {
  test('compacts per-PDF overflow into a file summary', async () => {
    let pageQuality: Array<Record<string, unknown>> | undefined
    let visualFallbackSummary: Record<string, unknown> | undefined
    const { service } = createEnhancedPdfService(2, '', {
      async execute() {
        return {
          byPage: new Map([
            [
              2,
              {
                schemaVersion: 'visual-fallback/v2' as const,
                policyVersion: 'gemini-whole-page-critical-v2' as const,
                outcome: 'skipped' as const,
                state: 'fallback_skipped' as const,
                reasons: ['corrupted-symbols' as const],
                offsetEncoding: 'utf16_code_units' as const,
                selectedTextSource: 'ocr' as const,
                decisionReason: 'budget_exhausted' as const,
              },
            ],
          ]),
          acceptedVisualTextByPage: new Map(),
          selectedPageCount: 1,
          enabled: true,
          summary: {
            status: 'evaluated' as const,
            eligiblePageCount: 2,
            admittedPageCount: 1,
            renderAttemptedPageCount: 1,
            providerAttemptedPageCount: 1,
            selectedVisualPageCount: 0,
            reconciledPageCount: 0,
            shadowPageCount: 0,
            conflictPageCount: 1,
            unavailablePageCount: 0,
            budgetSkippedPageCount: 1,
            budgetSkippedByScope: { pdf: 1, job: 0 },
          },
        }
      },
    })

    const result = await service.executeEnhanced(enhancedPdfFile, {
      onEnhancedMetadata: metadata => {
        pageQuality = metadata.pageQuality as Array<Record<string, unknown>>
        visualFallbackSummary = metadata.visualFallbackSummary
      },
    })

    expect(result.error).toBeNull()
    expect(pageQuality?.[0]).not.toHaveProperty('visualFallback')
    expect(pageQuality?.[1]).not.toHaveProperty('visualFallback')
    expect(visualFallbackSummary).toMatchObject({
      budgetSkippedPageCount: 1,
      budgetSkippedByScope: { pdf: 1, job: 0 },
    })
  })
})
