import { describe, expect, test } from 'bun:test'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'
import { enhancedPdfFile } from './process-pdf-enhanced.test-support'

const noLegalSignals = {
  registryMarkers: 0,
  legalMarkers: 0,
  cpfCnpj: 0,
  dates: 0,
  currency: 0,
  fractions: 0,
  squareMeters: 0,
  corruptedSymbols: 0,
  fragmentedNumbersOrMeasures: 0,
  duplicateLabels: 0,
  garbledSpans: 0,
}

function createSinglePageEnhancedService({
  text,
  meanConfidence,
  wordCount,
  warnings,
  visualFallbackService,
}: {
  readonly text: string
  readonly meanConfidence: number
  readonly wordCount: number
  readonly warnings: string[]
  readonly visualFallbackService: Pick<VisualFallbackService, 'execute'>
}) {
  return new ProcessPdfService(
    {
      async downloadFile() {
        return { value: { buffer: Buffer.from('pdf'), contentLength: 3 }, error: undefined }
      },
    },
    {
      async extractTextFromPdf() {
        return {
          value: {
            text: '',
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text: '',
                embeddedImageCount: 0,
                tableCount: 0,
                hasVisualContent: false,
              },
            ],
          },
          error: undefined,
        }
      },
    },
    undefined,
    {
      async processWithOcr() {
        throw new Error('legacy OCR must not run')
      },
      async processPagesWithOcr() {
        throw new Error('selected-page OCR must not run')
      },
      async processWithEnhancedOcr() {
        return {
          value: {
            ocrText: text,
            totalPages: 1,
            pages: [
              {
                pageNumber: 1,
                text,
                meanConfidence,
                wordCount,
                warnings,
                legalSignals: noLegalSignals,
              },
            ],
            chunksProcessed: 1,
            processingTime: 1,
          },
          error: undefined,
        }
      },
    },
    visualFallbackService
  )
}

describe('ProcessPdfService V2 blank unavailable visual fallback', () => {
  test('keeps blank unavailable metadata without failing range validation', async () => {
    let pageQuality: Array<Record<string, unknown>> | undefined
    const service = createSinglePageEnhancedService({
      text: '',
      meanConfidence: 0,
      wordCount: 0,
      warnings: ['no-text-detected'],
      visualFallbackService: {
        async execute() {
          return {
            byPage: new Map([
              [
                1,
                {
                  schemaVersion: 'visual-fallback/v2' as const,
                  policyVersion: 'gemini-whole-page-critical-v2' as const,
                  outcome: 'unavailable' as const,
                  state: 'fallback_failed' as const,
                  reasons: ['weak-ocr-evidence' as const],
                  offsetEncoding: 'utf16_code_units' as const,
                  sourceRange: { start: 0, end: 0 },
                  riskySpans: [{ start: 0, end: 0 }],
                  selectedTextSource: 'ocr' as const,
                  decisionReason: 'budget_exhausted' as const,
                },
              ],
            ]),
            acceptedVisualTextByPage: new Map(),
            selectedPageCount: 0,
            enabled: true,
          }
        },
      },
    })

    const result = await service.executeEnhanced(enhancedPdfFile, {
      onEnhancedMetadata: metadata => {
        pageQuality = metadata.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.error).toBeNull()
    expect(pageQuality?.[0]?.visualFallback).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'unavailable',
      decisionReason: 'budget_exhausted',
      sourceRange: { start: 0, end: 0 },
      riskySpans: [{ start: 0, end: 0 }],
    })
  })

  test('keeps blank provider abstain metadata without failing range validation', async () => {
    let pageQuality: Array<Record<string, unknown>> | undefined
    const visualFallbackService = new VisualFallbackService(
      {
        async renderPages(_buffer, pageNumbers) {
          return pageNumbers.map(pageNumber => ({
            pageNumber,
            image: Buffer.from(`page-${pageNumber}`),
          }))
        },
      },
      {
        async transcribe() {
          return { status: 'abstain' }
        },
      },
      {
        enabled: true,
        shadowMode: false,
        contextualPairingShadowEnabled: false,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        timeoutMs: 20,
        maxRetries: 1,
        concurrency: 1,
        maxAlignmentCells: 10_000_000,
        maxPagesPerPdf: 1,
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      }
    )
    const service = createSinglePageEnhancedService({
      text: '',
      meanConfidence: 0,
      wordCount: 0,
      warnings: ['no-text-detected'],
      visualFallbackService,
    })

    const result = await service.executeEnhanced(enhancedPdfFile, {
      onEnhancedMetadata: metadata => {
        pageQuality = metadata.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.error).toBeNull()
    expect(pageQuality?.[0]?.visualFallback).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'unavailable',
      decisionReason: 'provider_abstained',
      sourceRange: { start: 0, end: 0 },
      riskySpans: [{ start: 0, end: 0 }],
    })
  })

  test('propagates OCR metrics into visual fallback weak evidence routing', async () => {
    const providerCalls: number[] = []
    const renderedPages: number[][] = []
    const visualFallbackService = new VisualFallbackService(
      {
        async renderPages(_buffer, pageNumbers) {
          renderedPages.push(pageNumbers)
          return pageNumbers.map(pageNumber => ({
            pageNumber,
            image: Buffer.from(`page-${pageNumber}`),
          }))
        },
      },
      {
        async transcribe({ pageNumber }) {
          providerCalls.push(pageNumber)
          return { status: 'abstain' }
        },
      },
      {
        enabled: true,
        shadowMode: false,
        contextualPairingShadowEnabled: false,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        timeoutMs: 20,
        maxRetries: 1,
        concurrency: 1,
        maxAlignmentCells: 10_000_000,
        maxPagesPerPdf: 1,
      }
    )
    const service = createSinglePageEnhancedService({
      text: 'texto OCR fraco com mais de trinta caracteres',
      meanConfidence: 45,
      wordCount: 4,
      warnings: [],
      visualFallbackService,
    })

    const result = await service.executeEnhanced(enhancedPdfFile)

    expect(result.error).toBeNull()
    expect(renderedPages).toEqual([[1]])
    expect(providerCalls).toEqual([1])
  })

  test('accepts selected V2 metadata with empty critical uncertainties and risky spans', async () => {
    let pageQuality: Array<Record<string, unknown>> | undefined
    const selectedText = 'texto visual selecionado'
    const service = createSinglePageEnhancedService({
      text: 'texto OCR original',
      meanConfidence: 45,
      wordCount: 4,
      warnings: [],
      visualFallbackService: {
        async execute() {
          return {
            byPage: new Map([
              [
                1,
                {
                  schemaVersion: 'visual-fallback/v2' as const,
                  policyVersion: 'gemini-whole-page-critical-v2' as const,
                  alignmentVersion: 'critical-token-alignment-v1' as const,
                  outcome: 'selected' as const,
                  state: 'reconciled' as const,
                  reasons: ['weak-ocr-evidence' as const],
                  offsetEncoding: 'utf16_code_units' as const,
                  sourceRange: { start: 0, end: selectedText.length },
                  criticalUncertainties: [],
                  riskySpans: [],
                  selectedTextSource: 'visual' as const,
                  decisionReason: 'gemini_whole_page_selected' as const,
                  provenance: {
                    provider: 'gemini' as const,
                    model: 'gemini-test',
                    imageSha256: 'a'.repeat(64),
                    candidateSha256: 'b'.repeat(64),
                  },
                },
              ],
            ]),
            acceptedVisualTextByPage: new Map([[1, selectedText]]),
            selectedPageCount: 1,
            enabled: true,
          }
        },
      },
    })

    const result = await service.executeEnhanced(enhancedPdfFile, {
      onEnhancedMetadata: metadata => {
        pageQuality = metadata.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.error).toBeNull()
    expect(result.value).toContain(selectedText)
    expect(pageQuality?.[0]?.visualFallback).toMatchObject({
      outcome: 'selected',
      criticalUncertainties: [],
      riskySpans: [],
      sourceRange: { start: 0, end: selectedText.length },
    })
    expect(pageQuality?.[0]?.classification).toBe('visual-selected')
  })

  test('reports a warning when a visual numeric conflict preserves OCR', async () => {
    const ocrText = 'UNIDADE C19 C20 C21\nAp.36 10 20 30'
    let pageQuality: Array<Record<string, unknown>> | undefined
    const service = createSinglePageEnhancedService({
      text: ocrText,
      meanConfidence: 87,
      wordCount: 10,
      warnings: [],
      visualFallbackService: {
        async execute() {
          return {
            byPage: new Map([
              [
                1,
                {
                  schemaVersion: 'visual-fallback/v2' as const,
                  policyVersion: 'gemini-whole-page-critical-v2' as const,
                  alignmentVersion: 'critical-token-alignment-v1' as const,
                  outcome: 'rejected' as const,
                  state: 'conflict' as const,
                  reasons: ['missing-measure' as const],
                  offsetEncoding: 'utf16_code_units' as const,
                  sourceRange: { start: 0, end: ocrText.length },
                  criticalUncertainties: [
                    {
                      start: 0,
                      end: ocrText.length,
                      scope: 'page' as const,
                      categories: ['number' as const],
                      divergences: ['duplicate_or_reordered' as const],
                    },
                  ],
                  riskySpans: [{ start: 0, end: ocrText.length }],
                  selectedTextSource: 'ocr' as const,
                  decisionReason: 'critical_numeric_order_ambiguous' as const,
                  provenance: {
                    provider: 'gemini' as const,
                    model: 'gemini-test',
                    imageSha256: 'a'.repeat(64),
                    candidateSha256: 'b'.repeat(64),
                  },
                },
              ],
            ]),
            acceptedVisualTextByPage: new Map(),
            selectedPageCount: 1,
            enabled: true,
          }
        },
      },
    })

    const result = await service.executeEnhanced(enhancedPdfFile, {
      onEnhancedMetadata: metadata => {
        pageQuality = metadata.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.value).toContain(ocrText)
    expect(pageQuality?.[0]).toMatchObject({
      classification: 'ocr-warning',
      warnings: ['visual-fallback-conflict'],
    })
  })
})
