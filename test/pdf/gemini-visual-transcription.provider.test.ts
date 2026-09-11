import { afterEach, describe, expect, test } from 'bun:test'
import { GeminiVisualTranscriptionProvider } from '../../src/core/services/messages/pdf-utils/gemini-visual-transcription.provider'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function successfulResponse(content: string, finishReason: string | null = 'STOP') {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          ...(finishReason === null ? {} : { finishReason }),
          content: { parts: [{ text: content }] },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function setFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = Object.assign(implementation, { preconnect: originalFetch.preconnect })
}

describe('GeminiVisualTranscriptionProvider', () => {
  test('accepts a structured transcription only after a STOP finish reason', async () => {
    setFetchMock(async () =>
      successfulResponse(JSON.stringify({ status: 'transcribed', transcription: 'texto completo' }))
    )

    await expect(
      new GeminiVisualTranscriptionProvider('test-key').transcribe({
        image: Buffer.from('page'),
        pageNumber: 1,
        model: 'gemini-2.5-flash',
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ status: 'transcribed', transcription: 'texto completo' })
  })

  test.each([null, 'MAX_TOKENS', 'SAFETY', 'OTHER'])(
    'rejects deterministic abnormal completion finishReason=%s',
    async finishReason => {
      setFetchMock(async () =>
        successfulResponse(
          JSON.stringify({ status: 'transcribed', transcription: 'conteúdo parcial' }),
          finishReason
        )
      )

      await expect(
        new GeminiVisualTranscriptionProvider('test-key').transcribe({
          image: Buffer.from('page'),
          pageNumber: 1,
          model: 'gemini-2.5-flash',
          signal: new AbortController().signal,
        })
      ).rejects.toThrow('abnormal completion')
    }
  )
  test('uses a document-neutral prompt and appends only approved profile hints', async () => {
    let requestBody: { contents?: Array<{ parts?: Array<{ text?: string }> }> } | undefined
    setFetchMock(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return successfulResponse(JSON.stringify({ status: 'abstain' }))
    })

    await new GeminiVisualTranscriptionProvider('test-key').transcribe({
      image: Buffer.from('page'),
      pageNumber: 1,
      model: 'gemini-2.5-flash',
      signal: new AbortController().signal,
      documentProfile: {
        kind: 'matricula',
        transcriptionHints: ['Preserve marcadores R. e AV. exatamente como visíveis.'],
      },
    })

    const prompt = requestBody?.contents?.[0]?.parts?.[0]?.text ?? ''
    expect(prompt).toContain('página do documento')
    expect(prompt).toContain('Preserve marcadores R. e AV.')
    expect(prompt).not.toContain('página de matrícula imobiliária')
  })

  test('caps Gemini structured output tokens', async () => {
    let requestBody: Record<string, unknown> | undefined
    setFetchMock(async (_input, init) => {
      requestBody = JSON.parse(String(init?.body))
      return successfulResponse(JSON.stringify({ status: 'abstain' }))
    })

    const result = await new GeminiVisualTranscriptionProvider('test-key').transcribe({
      image: Buffer.from('page'),
      pageNumber: 1,
      model: 'gemini-2.5-flash',
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ status: 'abstain' })
    expect(requestBody?.generationConfig).toEqual(
      expect.objectContaining({ maxOutputTokens: expect.any(Number) })
    )
  })

  test('rejects oversized structured transcriptions', async () => {
    setFetchMock(async () =>
      successfulResponse(
        JSON.stringify({ status: 'transcribed', transcription: 'x'.repeat(32_769) })
      )
    )

    await expect(
      new GeminiVisualTranscriptionProvider('test-key').transcribe({
        image: Buffer.from('page'),
        pageNumber: 1,
        model: 'gemini-2.5-flash',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('invalid structured response')
  })

  test('rejects malformed structured output', async () => {
    setFetchMock(async () => successfulResponse('{not-json'))

    await expect(
      new GeminiVisualTranscriptionProvider('test-key').transcribe({
        image: Buffer.from('page'),
        pageNumber: 1,
        model: 'gemini-2.5-flash',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('invalid structured response')
  })
})
