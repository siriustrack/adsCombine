import { describe, expect, test } from 'bun:test'
import { validateEnhancedOcrLimits } from '../../src/core/services/messages/pdf-utils/ocr-orchestrator.service'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import { PdfLimitError } from '../../src/core/services/messages/pdf-utils/process-pdf.types'
import {
  createEnhancedPdfService,
  enhancedPdfFile as file,
} from './process-pdf-enhanced.test-support'

describe('ProcessPdfService enhanced OCR limits', () => {
  test('rejects enhanced all-page OCR above maxOcrPagesPerPdf before OCR begins', async () => {
    const { service, getEnhancedCalls } = createEnhancedPdfService(3)

    const result = await service.executeEnhanced(file, { maxOcrPagesPerPdf: 2 })

    expect(result.error).toBeInstanceOf(PdfLimitError)
    expect(result.error).toMatchObject({ code: 'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED' })
    expect(getEnhancedCalls()).toBe(0)
  })

  test('reserves every enhanced page against the job budget before OCR begins', async () => {
    const { service, getEnhancedCalls } = createEnhancedPdfService(3)
    const reserved: number[] = []
    const budget = {
      reserve(pageCount: number) {
        reserved.push(pageCount)
        return false
      },
      remaining() {
        return 2
      },
    }

    const result = await service.executeEnhanced(file, { ocrPageBudget: budget })

    expect(reserved).toEqual([3])
    expect(result.error).toBeInstanceOf(PdfLimitError)
    expect(result.error).toMatchObject({ code: 'OCR_PAGES_PER_JOB_LIMIT_EXCEEDED' })
    expect(getEnhancedCalls()).toBe(0)
  })

  test('enforces limits against the effective pdfinfo page count', () => {
    const error = validateEnhancedOcrLimits(5, { maxOcrPagesPerPdf: 3 })

    expect(error).toBeInstanceOf(PdfLimitError)
    expect(error).toMatchObject({ code: 'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED' })
  })

  test('does not bypass an enhanced OCR limit by falling back to native text', async () => {
    const { service } = createEnhancedPdfService(3, 'texto nativo disponível')

    const result = await service.executeEnhanced(file, { maxOcrPagesPerPdf: 2 })

    expect(result.error).toBeInstanceOf(PdfLimitError)
    expect(result.error).toMatchObject({ code: 'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED' })
  })

  test('uses the effective OCR page count for enhanced metadata', async () => {
    const { service } = createEnhancedPdfService(3)
    let metadataPages = 0

    const result = await service.executeEnhanced(file, {
      onEnhancedMetadata: metadata => {
        metadataPages = metadata.pageQuality?.length ?? 0
      },
    })

    expect(result.error).toBeNull()
    expect(metadataPages).toBe(3)
  })

  test('keeps enhanced metadata backward-compatible while visual fallback is disabled', async () => {
    const { service } = createEnhancedPdfService(1)
    let metadata: Record<string, unknown> | undefined

    const result = await service.executeEnhanced(file, {
      onEnhancedMetadata: value => {
        metadata = value.pageQuality?.[0]
      },
    })

    expect(result.error).toBeNull()
    expect(metadata).toBeDefined()
    expect(metadata).not.toHaveProperty('visualFallback')
  })

  test('decodes matrícula filenames before visual fallback eligibility', async () => {
    let fileName: string | undefined
    const { service } = createEnhancedPdfService(1, '', {
      async execute(input) {
        fileName = input.fileName
        return {
          byPage: new Map(),
          acceptedVisualTextByPage: new Map(),
          selectedPageCount: 0,
          enabled: false,
        }
      },
    })

    const result = await service.executeEnhanced({
      ...file,
      url: 'https://example.com/matr%C3%ADcula-12345.pdf',
    })

    expect(result.error).toBeNull()
    expect(fileName).toBe('matrícula-12345.pdf')
  })

  test('prefers the request filename for visual fallback eligibility over a signed URL path', async () => {
    let fileName: string | undefined
    const { service } = createEnhancedPdfService(1, '', {
      async execute(input) {
        fileName = input.fileName
        return {
          byPage: new Map(),
          acceptedVisualTextByPage: new Map(),
          selectedPageCount: 0,
          enabled: false,
        }
      },
    })

    const result = await service.executeEnhanced({
      ...file,
      fileName: 'matrícula-12345.pdf',
      url: 'https://storage.example.com/signed/3d9a0b4c?signature=secret',
    })

    expect(result.error).toBeNull()
    expect(fileName).toBe('matrícula-12345.pdf')
  })

  test('builds final enhanced text and UTF-16 ranges from approved page selections in page order', async () => {
    let metadata: Array<Record<string, unknown>> | undefined
    const visualText = 'Página dois visual 🧾'
    const service = new ProcessPdfService(
      {
        async downloadFile() {
          return { value: { buffer: Buffer.from('pdf'), contentLength: 3 }, error: undefined }
        },
      },
      {
        async extractTextFromPdf() {
          return {
            value: { text: '', totalPages: 2, pages: [] },
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
              ocrText: 'Página um OCR\n\nPágina dois OCR',
              totalPages: 2,
              pages: [
                { pageNumber: 2, text: 'Página dois OCR', meanConfidence: 85.12, warnings: [] },
                { pageNumber: 1, text: 'Página um OCR', meanConfidence: 99, warnings: [] },
              ],
              chunksProcessed: 1,
              processingTime: 1,
            },
            error: undefined,
          }
        },
      },
      {
        async execute() {
          return {
            byPage: new Map([
              [
                2,
                {
                  state: 'reconciled' as const,
                  reasons: [],
                  offsetEncoding: 'utf16_code_units' as const,
                  policyVersion: 'safe-visual-v1' as const,
                  decisionReason: 'safe_structural_repair',
                  selectedTextSource: 'visual' as const,
                },
              ],
            ]),
            acceptedVisualTextByPage: new Map([[2, visualText]]),
            selectedPageCount: 1,
            enabled: true,
          }
        },
      }
    )

    const result = await service.executeEnhanced(file, {
      onEnhancedMetadata: value => {
        metadata = value.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.value).toBe(`Página um OCR\n\n${visualText}`)
    expect(metadata?.[0]).not.toHaveProperty('visualFallback')
    expect(metadata?.[1]?.visualFallback).toMatchObject({
      sourceRange: {
        start: 'Página um OCR\n\n'.length,
        end: `Página um OCR\n\n${visualText}`.length,
      },
    })
  })

  test('rebases V2 local UTF-16 uncertainty ranges cumulatively for repeated pages', async () => {
    const candidate = '🧾 Registro R.23'
    const localStart = candidate.indexOf('R.23')
    let metadata: Array<Record<string, unknown>> | undefined
    const service = new ProcessPdfService(
      {
        async downloadFile() {
          return { value: { buffer: Buffer.from('pdf'), contentLength: 3 }, error: undefined }
        },
      },
      {
        async extractTextFromPdf() {
          return { value: { text: '', totalPages: 2, pages: [] }, error: undefined }
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
              ocrText: '🧾 Registro R.22\n\n🧾 Registro R.22',
              totalPages: 2,
              pages: [
                { pageNumber: 1, text: '🧾 Registro R.22', warnings: [] },
                { pageNumber: 2, text: '🧾 Registro R.22', warnings: [] },
              ],
              chunksProcessed: 1,
              processingTime: 1,
            },
            error: undefined,
          }
        },
      },
      {
        async execute() {
          const visualFallback = () => ({
            schemaVersion: 'visual-fallback/v2' as const,
            policyVersion: 'gemini-whole-page-critical-v2' as const,
            alignmentVersion: 'critical-token-alignment-v1' as const,
            outcome: 'selected' as const,
            state: 'reconciled' as const,
            reasons: [],
            offsetEncoding: 'utf16_code_units' as const,
            sourceRange: { start: 0, end: candidate.length },
            criticalUncertainties: [
              {
                start: localStart,
                end: localStart + 4,
                scope: 'token' as const,
                categories: ['registry_marker' as const],
                divergences: ['different_value' as const],
              },
            ],
            selectedTextSource: 'visual' as const,
            decisionReason: 'gemini_whole_page_selected' as const,
            provenance: {
              provider: 'gemini' as const,
              model: 'gemini-test',
              imageSha256: 'a'.repeat(64),
              candidateSha256: 'b'.repeat(64),
            },
          })
          return {
            byPage: new Map([
              [1, visualFallback()],
              [2, visualFallback()],
            ]),
            acceptedVisualTextByPage: new Map([
              [1, candidate],
              [2, candidate],
            ]),
            selectedPageCount: 2,
            enabled: true,
          }
        },
      }
    )

    const result = await service.executeEnhanced(file, {
      onEnhancedMetadata: value => {
        metadata = value.pageQuality as Array<Record<string, unknown>>
      },
    })

    expect(result.value).toBe(`${candidate}\n\n${candidate}`)
    const ranges = metadata?.map(page => {
      const visual = page.visualFallback as {
        criticalUncertainties: Array<{
          start: number
          end: number
          scope: string
          categories: string[]
          divergences: string[]
        }>
      }
      return visual.criticalUncertainties[0]
    })
    expect(ranges).toEqual([
      {
        start: localStart,
        end: localStart + 4,
        scope: 'token',
        categories: ['registry_marker'],
        divergences: ['different_value'],
      },
      {
        start: candidate.length + 2 + localStart,
        end: candidate.length + 2 + localStart + 4,
        scope: 'token',
        categories: ['registry_marker'],
        divergences: ['different_value'],
      },
    ])
  })
})
