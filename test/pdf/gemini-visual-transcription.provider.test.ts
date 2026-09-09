import { afterEach, describe, expect, test } from 'bun:test'
import { GeminiVisualTranscriptionProvider } from '../../src/core/services/messages/pdf-utils/gemini-visual-transcription.provider'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function successfulResponse(content: string) {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text: content }] } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function setFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = Object.assign(implementation, { preconnect: originalFetch.preconnect })
}

describe('GeminiVisualTranscriptionProvider', () => {
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
