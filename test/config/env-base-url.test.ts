import { describe, expect, test } from 'bun:test'
import { envSchema } from '../../src/config/env'

const requiredEnvironment = {
  OPENAI_API_KEY: 'test-openai-key',
  OPENAI_MODEL_TEXT: 'test-model',
  JOBS_TOKEN: 'test-jobs-token',
  TOKEN: 'test-token',
}

describe('BASE_URL compatibility', () => {
  test('normalizes a production hostname without a scheme', () => {
    const parsed = envSchema.parse({
      ...requiredEnvironment,
      BASE_URL: 'security.napoleaoai.com.br',
    })

    expect(parsed.BASE_URL).toBe('https://security.napoleaoai.com.br')
  })

  test.each([
    ['https://api.example.com', 'https://api.example.com'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ] as const)('preserves an absolute HTTP origin %s', (baseUrl, expected) => {
    const parsed = envSchema.parse({
      ...requiredEnvironment,
      BASE_URL: baseUrl,
    })

    expect(parsed.BASE_URL).toBe(expected)
  })

  test.each([
    '',
    'ftp://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com/path',
    'https://api.example.com?region=br',
  ])('rejects a non-origin BASE_URL value %s', baseUrl => {
    expect(
      envSchema.safeParse({
        ...requiredEnvironment,
        BASE_URL: baseUrl,
      }).success
    ).toBe(false)
  })
})
