import { afterEach, describe, expect, test } from 'bun:test'
import { DeepSeekVisualTranscriptionProvider } from '../../src/core/services/messages/pdf-utils/deepseek-visual-transcription.provider'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function setFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = Object.assign(implementation, { preconnect: originalFetch.preconnect })
}

function successfulResponse(content: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('DeepSeekVisualTranscriptionProvider', () => {
  test('sends an OpenAI-compatible request with an inline PNG data URL and output cap', async () => {
    let url = ''
    let init: RequestInit | undefined
    setFetchMock(async (input, requestInit) => {
      url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      init = requestInit
      return successfulResponse(JSON.stringify({ status: 'abstain' }))
    })

    const result = await new DeepSeekVisualTranscriptionProvider('test-key').transcribe({
      image: Buffer.from('page'),
      pageNumber: 1,
      model: 'deepseek-v4-flash-vision-exp',
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ status: 'abstain' })
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(init?.headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      })
    )
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        model: 'deepseek-v4-flash-vision-exp',
        max_tokens: expect.any(Number),
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image_url',
                image_url: { url: 'data:image/png;base64,cGFnZQ==', detail: 'auto' },
              }),
            ]),
          }),
        ],
      })
    )
  })

  test('rejects malformed JSON content', async () => {
    setFetchMock(async () => successfulResponse('{not-json'))

    await expect(
      new DeepSeekVisualTranscriptionProvider('test-key').transcribe({
        image: Buffer.from('page'),
        pageNumber: 1,
        model: 'deepseek-v4-flash-vision-exp',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('invalid structured response')
  })

  test('rejects images over the 32 MiB inline image limit without calling DeepSeek', async () => {
    let calls = 0
    setFetchMock(async () => {
      calls++
      return successfulResponse(JSON.stringify({ status: 'abstain' }))
    })

    await expect(
      new DeepSeekVisualTranscriptionProvider('test-key').transcribe({
        image: Buffer.alloc(32 * 1024 * 1024 + 1),
        pageNumber: 1,
        model: 'deepseek-v4-flash-vision-exp',
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('image exceeds the 32 MiB limit')
    expect(calls).toBe(0)
  })

  test('rejects requests over the 48 MiB body limit without calling DeepSeek', async () => {
    let calls = 0
    setFetchMock(async () => {
      calls++
      return successfulResponse(JSON.stringify({ status: 'abstain' }))
    })

    await expect(
      new DeepSeekVisualTranscriptionProvider('test-key').transcribe({
        image: Buffer.alloc(32 * 1024 * 1024, 0xff),
        pageNumber: 1,
        model: 'x'.repeat(6 * 1024 * 1024),
        signal: new AbortController().signal,
      })
    ).rejects.toThrow('request body exceeds the 48 MiB limit')
    expect(calls).toBe(0)
  })
})
