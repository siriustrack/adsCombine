import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import { ProcessMessagesService } from '../../src/core/services/messages/process-messages.service'

process.env.BASE_URL = 'http://localhost:3000'
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'

const conversationId = 'blank-unavailable-v2-process-messages-test'

afterEach(async () => {
  await rm(join(process.cwd(), 'public', 'texts', conversationId), { recursive: true, force: true })
})

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

describe('ProcessMessagesService V2 blank unavailable metadata', () => {
  test('rebases zero-length unavailable ranges to the deterministic sanitized boundary', async () => {
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        throw new Error('standard OCR must not run')
      },
      async executeEnhanced(_file, options) {
        options?.onEnhancedMetadata?.({
          fileId: 'file-1',
          pageQuality: [
            {
              pageNumber: 1,
              visualFallback: {
                schemaVersion: 'visual-fallback/v2',
                policyVersion: 'gemini-whole-page-critical-v2',
                outcome: 'unavailable',
                state: 'fallback_failed',
                reasons: ['weak-ocr-evidence'],
                offsetEncoding: 'utf16_code_units',
                sourceRange: { start: 0, end: 0 },
                riskySpans: [{ start: 0, end: 0 }],
                selectedTextSource: 'ocr',
                decisionReason: 'budget_exhausted',
              },
            },
          ],
        })
        return { value: '', error: undefined }
      },
    }

    const response = await new ProcessMessagesService(pdfService).execute(createRequest(), {
      enhancedOcr: true,
    })
    const visualFallback = response.enhancedResult?.files[0].pageQuality?.[0]?.visualFallback
    const bodyStart = response.transcriptionText?.length

    expect(visualFallback).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'unavailable',
      sourceRange: { start: bodyStart, end: bodyStart },
      riskySpans: [{ start: bodyStart, end: bodyStart }],
    })
    expect(visualFallback?.sourceRange?.end).toBeLessThanOrEqual(
      response.transcriptionText?.length ?? 0
    )
    expect(visualFallback).not.toHaveProperty('criticalUncertainties')
  })

  test('rebases a blank unavailable page to body start when the same PDF has nonblank text', async () => {
    const body = 'Página dois com OCR aproveitável'
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        throw new Error('standard OCR must not run')
      },
      async executeEnhanced(_file, options) {
        options?.onEnhancedMetadata?.({
          fileId: 'file-1',
          pageQuality: [
            {
              pageNumber: 1,
              visualFallback: {
                schemaVersion: 'visual-fallback/v2',
                policyVersion: 'gemini-whole-page-critical-v2',
                outcome: 'unavailable',
                state: 'fallback_failed',
                reasons: ['weak-ocr-evidence'],
                offsetEncoding: 'utf16_code_units',
                sourceRange: { start: 0, end: 0 },
                riskySpans: [{ start: 0, end: 0 }],
                selectedTextSource: 'ocr',
                decisionReason: 'budget_exhausted',
              },
            },
            { pageNumber: 2 },
          ],
        })
        return { value: body, error: undefined }
      },
    }

    const response = await new ProcessMessagesService(pdfService).execute(createRequest(), {
      enhancedOcr: true,
    })
    const bodyStart = response.transcriptionText?.indexOf(body)
    const visualFallback = response.enhancedResult?.files[0].pageQuality?.[0]?.visualFallback

    expect(bodyStart).toBeGreaterThan(0)
    expect(visualFallback).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'unavailable',
      sourceRange: { start: bodyStart, end: bodyStart },
      riskySpans: [{ start: bodyStart, end: bodyStart }],
    })
    expect(visualFallback).not.toHaveProperty('criticalUncertainties')
  })

  test('rebases selected V2 metadata with empty critical uncertainties and risky spans', async () => {
    const body = 'Texto visual selecionado sem incertezas críticas'
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        throw new Error('standard OCR must not run')
      },
      async executeEnhanced(_file, options) {
        options?.onEnhancedMetadata?.({
          fileId: 'file-1',
          pageQuality: [
            {
              pageNumber: 1,
              visualFallback: {
                schemaVersion: 'visual-fallback/v2',
                policyVersion: 'gemini-whole-page-critical-v2',
                alignmentVersion: 'critical-token-alignment-v1',
                outcome: 'selected',
                state: 'reconciled',
                reasons: ['weak-ocr-evidence'],
                offsetEncoding: 'utf16_code_units',
                sourceRange: { start: 0, end: body.length },
                criticalUncertainties: [],
                riskySpans: [],
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

    const response = await new ProcessMessagesService(pdfService).execute(createRequest(), {
      enhancedOcr: true,
    })
    const bodyStart = response.transcriptionText?.indexOf(body)
    const visualFallback = response.enhancedResult?.files[0].pageQuality?.[0]?.visualFallback

    expect(bodyStart).toBeGreaterThan(0)
    expect(visualFallback).toMatchObject({
      schemaVersion: 'visual-fallback/v2',
      outcome: 'selected',
      criticalUncertainties: [],
      riskySpans: [],
      sourceRange: { start: bodyStart, end: (bodyStart ?? 0) + body.length },
    })
  })
})
