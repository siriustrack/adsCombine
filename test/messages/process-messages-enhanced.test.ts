import { afterEach, describe, expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import { ProcessMessagesService } from '../../src/core/services/messages/process-messages.service'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'

const conversationId = 'enhanced-process-messages-test'

afterEach(async () => {
  await rm(join(process.cwd(), 'public', 'texts', conversationId), { recursive: true, force: true })
})

function createPdfServiceSeam() {
  const calls = { standard: 0, enhanced: 0 }
  const service: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
    async execute() {
      calls.standard++
      return { value: 'standard PDF text', error: undefined }
    },
    async executeEnhanced(_file, options) {
      calls.enhanced++
      options?.onEnhancedMetadata?.({
        fileId: 'file-1',
        pageQuality: [
          {
            pageNumber: 1,
            qualityScore: 94,
            confidence: 94,
            wordCount: 12,
            selectedAttempt: {
              label: 'rotated',
              psm: 6,
              rotation: { angle: 90, baselineLabel: 'orig', scoreGain: 20 },
            },
            legalSignals: {
              registryMarkers: 1,
              legalMarkers: 2,
              cpfCnpj: 1,
              dates: 1,
              currency: 0,
              fractions: 0,
              squareMeters: 0,
              corruptedSymbols: 0,
              fragmentedNumbersOrMeasures: 0,
              duplicateLabels: 0,
              garbledSpans: 0,
            },
            warnings: ['low contrast'],
          },
        ],
      })
      return { value: 'enhanced PDF text', error: undefined }
    },
  }

  return { calls, service }
}

function createRequest() {
  return {
    protocol: 'http',
    host: 'localhost:3000',
    messages: [
      {
        conversationId,
        body: {
          files: [
            { fileId: 'file-1', url: 'https://example.com/file.pdf', mimeType: 'application/pdf' },
          ],
        },
      },
    ],
  }
}

describe('ProcessMessagesService enhanced OCR delegation', () => {
  test('uses executeEnhanced exactly once and returns its page metadata for enhanced PDFs', async () => {
    const seam = createPdfServiceSeam()
    const service = new ProcessMessagesService(seam.service)

    const response = await service.execute(createRequest(), { enhancedOcr: true })

    expect(seam.calls).toEqual({ standard: 0, enhanced: 1 })
    expect(response.enhancedResult).toEqual({
      files: [
        expect.objectContaining({
          fileId: 'file-1',
          pageQuality: [
            expect.objectContaining({ confidence: 94, wordCount: 12, warnings: ['low contrast'] }),
          ],
        }),
      ],
    })
  })

  test('keeps standard PDFs on execute with no enhanced result', async () => {
    const seam = createPdfServiceSeam()
    const service = new ProcessMessagesService(seam.service)

    const response = await service.execute(createRequest())

    expect(seam.calls).toEqual({ standard: 1, enhanced: 0 })
    expect(response.enhancedResult).toBeUndefined()
  })

  test('preserves a blank enhanced page in the resulting metadata', async () => {
    const seam = createPdfServiceSeam()
    seam.service.executeEnhanced = async (_file, options) => {
      options?.onEnhancedMetadata?.({
        fileId: 'file-1',
        pageQuality: [
          { pageNumber: 1, confidence: 0, wordCount: 0, warnings: ['no-text-detected'] },
        ],
      })
      return { value: '', error: undefined }
    }
    const service = new ProcessMessagesService(seam.service)

    const response = await service.execute(createRequest(), { enhancedOcr: true })

    expect(response.enhancedResult?.files[0].pageQuality).toEqual([
      expect.objectContaining({ confidence: 0, wordCount: 0, warnings: ['no-text-detected'] }),
    ])
  })

  test('rebases repeated UTF-16 ranges by file and raw occurrence order', async () => {
    const repeatedPage = 'Página visual repetida'
    const body = `Introdução 🧾\n${repeatedPage}\n${repeatedPage}`
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        throw new Error('standard OCR must not run')
      },
      async executeEnhanced(file, options) {
        if (file.fileId === 'file-1') await Bun.sleep(10)
        const firstStart = body.indexOf(repeatedPage)
        const secondStart = body.indexOf(repeatedPage, firstStart + repeatedPage.length)
        const visualFallback = (start: number) => ({
          state: 'reconciled' as const,
          reasons: ['fragmented-number-or-measure' as const],
          offsetEncoding: 'utf16_code_units' as const,
          sourceRange: { start, end: start + repeatedPage.length },
          riskySpans: [
            { start, end: start + repeatedPage.length },
            { start, end: start + repeatedPage.length },
          ],
          policyVersion: 'safe-visual-v1' as const,
          selectedTextSource: 'visual' as const,
        })
        options?.onEnhancedMetadata?.({
          fileId: file.fileId,
          pageQuality: [
            { pageNumber: 1, visualFallback: visualFallback(firstStart) },
            { pageNumber: 2, visualFallback: visualFallback(secondStart) },
          ],
        })
        return { value: body, error: undefined }
      },
    }
    const service = new ProcessMessagesService(pdfService)
    const request = createRequest()
    request.messages[0].body.files = [
      { fileId: 'file-1', url: 'https://example.com/a/contrato.pdf', mimeType: 'application/pdf' },
      { fileId: 'file-2', url: 'https://example.com/b/contrato.pdf', mimeType: 'application/pdf' },
    ]

    const response = await service.execute(request, { enhancedOcr: true })
    const transcriptionText = response.transcriptionText ?? ''
    const persistedText = await readFile(
      join(process.cwd(), 'public', 'texts', conversationId, response.filename),
      'utf8'
    )

    expect(persistedText).toBe(transcriptionText)
    expect(response.processedFiles).toEqual(['file-1', 'file-2'])
    expect(response.enhancedResult?.files.map(metadata => metadata.fileId)).toEqual([
      'file-1',
      'file-2',
    ])
    const metadataRanges = (response.enhancedResult?.files ?? []).map(metadata =>
      metadata.pageQuality?.map(page => page.visualFallback?.sourceRange)
    )
    expect(metadataRanges[0]?.[0]?.start).toBeLessThan(metadataRanges[0]?.[1]?.start ?? 0)
    expect(metadataRanges[0]?.[1]?.start).toBeLessThan(metadataRanges[1]?.[0]?.start ?? 0)
    for (const metadata of response.enhancedResult?.files ?? []) {
      for (const page of metadata.pageQuality ?? []) {
        const visualFallback = page.visualFallback
        expect(
          transcriptionText.slice(
            visualFallback?.sourceRange?.start,
            visualFallback?.sourceRange?.end
          )
        ).toBe(repeatedPage)
        expect(
          visualFallback?.riskySpans?.map(range => transcriptionText.slice(range.start, range.end))
        ).toEqual([repeatedPage, repeatedPage])
      }
    }
  })

  test('rebases V2 ranges cumulatively across identical files with an astral prefix', async () => {
    const selected = 'Matrícula nº 12.346'
    const body = `🧾 prefixo\n${selected}`
    const selectedStart = body.indexOf(selected)
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        throw new Error('standard OCR must not run')
      },
      async executeEnhanced(file, options) {
        options?.onEnhancedMetadata?.({
          fileId: file.fileId,
          pageQuality: [
            {
              pageNumber: 1,
              visualFallback: {
                schemaVersion: 'visual-fallback/v2',
                policyVersion: 'gemini-whole-page-critical-v2',
                alignmentVersion: 'critical-token-alignment-v1',
                outcome: 'selected',
                state: 'reconciled',
                reasons: ['fragmented-number-or-measure'],
                offsetEncoding: 'utf16_code_units',
                sourceRange: { start: 0, end: body.length },
                criticalUncertainties: [
                  {
                    start: selectedStart,
                    end: selectedStart + selected.length,
                    scope: 'token',
                    categories: ['registry_identifier'],
                    divergences: ['different_value'],
                  },
                ],
                selectedTextSource: 'visual',
                decisionReason: 'gemini_whole_page_selected',
                provenance: {
                  provider: 'gemini',
                  model: 'gemini-test',
                  imageSha256: 'a'.repeat(64),
                  candidateSha256: 'b'.repeat(64),
                },
              },
            },
          ],
        })
        return { value: body, error: undefined }
      },
    }
    const request = createRequest()
    request.messages[0].body.files = [
      { fileId: 'file-1', url: 'https://example.com/a/igual.pdf', mimeType: 'application/pdf' },
      { fileId: 'file-2', url: 'https://example.com/b/igual.pdf', mimeType: 'application/pdf' },
    ]

    const response = await new ProcessMessagesService(pdfService).execute(request, {
      enhancedOcr: true,
    })
    const transcriptionText = response.transcriptionText ?? ''
    const criticalUncertainties = (response.enhancedResult?.files ?? []).map(metadata => {
      const visualFallback = metadata.pageQuality?.[0]?.visualFallback
      if (visualFallback?.policyVersion !== 'gemini-whole-page-critical-v2') return undefined
      if (visualFallback.outcome !== 'selected') return undefined
      return visualFallback.criticalUncertainties[0]
    })

    expect(criticalUncertainties[0]?.start).toBeLessThan(criticalUncertainties[1]?.start ?? 0)
    expect(
      criticalUncertainties.map(range => transcriptionText.slice(range?.start, range?.end))
    ).toEqual([selected, selected])
  })

  test('fails the enhanced result when sanitization collapses a V2 range', async () => {
    const body = 'A\u0000B'
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        throw new Error('standard OCR must not run')
      },
      async executeEnhanced(file, options) {
        options?.onEnhancedMetadata?.({
          fileId: file.fileId,
          pageQuality: [
            {
              pageNumber: 1,
              visualFallback: {
                schemaVersion: 'visual-fallback/v2',
                policyVersion: 'gemini-whole-page-critical-v2',
                alignmentVersion: 'critical-token-alignment-v1',
                outcome: 'selected',
                state: 'reconciled',
                reasons: ['garbled-spans'],
                offsetEncoding: 'utf16_code_units',
                sourceRange: { start: 0, end: body.length },
                criticalUncertainties: [
                  {
                    start: 1,
                    end: 2,
                    scope: 'token',
                    categories: ['number'],
                    divergences: ['different_value'],
                  },
                ],
                provenance: {
                  provider: 'gemini',
                  model: 'gemini-test',
                  imageSha256: 'a'.repeat(64),
                  candidateSha256: 'b'.repeat(64),
                },
                selectedTextSource: 'visual',
                decisionReason: 'gemini_whole_page_selected',
              },
            },
          ],
        })
        return { value: body, error: undefined }
      },
    }

    await expect(
      new ProcessMessagesService(pdfService).execute(createRequest(), { enhancedOcr: true })
    ).rejects.toThrow('V2 critical uncertainty collapsed during sanitization')
  })
})
