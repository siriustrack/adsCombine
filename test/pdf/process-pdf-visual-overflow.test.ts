import { describe, expect, test } from 'bun:test'
import { createEnhancedPdfService, enhancedPdfFile } from './process-pdf-enhanced.test-support'

describe('ProcessPdfService V2 visual overflow', () => {
  test('retains per-PDF overflow metadata in downstream page quality', async () => {
    const pageText = 'enhanced text'
    let pageQuality: Array<Record<string, unknown>> | undefined
    const { service } = createEnhancedPdfService(2, '', {
      async execute() {
        return {
          byPage: new Map([
            [
              2,
              {
                schemaVersion: 'visual-fallback/v2' as const,
                policyVersion: 'gemini-whole-page-critical-v2' as const,
                outcome: 'unavailable' as const,
                state: 'fallback_failed' as const,
                reasons: ['corrupted-symbols' as const],
                offsetEncoding: 'utf16_code_units' as const,
                sourceRange: { start: 0, end: pageText.length },
                riskySpans: [{ start: 0, end: pageText.length }],
                selectedTextSource: 'ocr' as const,
                decisionReason: 'budget_exhausted' as const,
              },
            ],
          ]),
          acceptedVisualTextByPage: new Map(),
          selectedPageCount: 1,
          enabled: true,
        }
      },
    })

    const result = await service.executeEnhanced(enhancedPdfFile, {
      onEnhancedMetadata: metadata => {
        pageQuality = metadata.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.error).toBeNull()
    expect(pageQuality?.[0]).not.toHaveProperty('visualFallback')
    expect(pageQuality?.[1]?.visualFallback).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'unavailable',
      decisionReason: 'budget_exhausted',
      sourceRange: { start: pageText.length + 2, end: pageText.length * 2 + 2 },
      riskySpans: [{ start: pageText.length + 2, end: pageText.length * 2 + 2 }],
    })
  })
})
