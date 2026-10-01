import { describe, expect, test } from 'bun:test'
import {
  createSignedTextDownload,
  parseTextArtifactPath,
  resolveTextSigningSecret,
  verifySignedTextDownload,
} from '../../src/core/services/texts/signed-text-download'

const config = {
  baseUrl: 'https://service.example.com',
  secret: 'a'.repeat(64),
  ttlSeconds: 900,
}

describe('signed text downloads', () => {
  test('authorizes GET and HEAD for the exact artifact until expiry', () => {
    const signed = createSignedTextDownload({
      ...config,
      conversationId: 'conversation-1',
      filename: 'artifact-1.txt',
      nowSeconds: 1_000,
    })

    expect(signed.url).toStartWith(
      'https://service.example.com/texts/conversation-1/artifact-1.txt?'
    )
    expect(signed.expiresAt).toBe('1970-01-01T00:31:40.000Z')
    expect(
      verifySignedTextDownload({
        ...config,
        method: 'GET',
        requestTarget: new URL(signed.url).pathname + new URL(signed.url).search,
        nowSeconds: 1_899,
      })
    ).toEqual({
      authorized: true,
      artifact: { conversationId: 'conversation-1', filename: 'artifact-1.txt' },
    })
    expect(
      verifySignedTextDownload({
        ...config,
        method: 'HEAD',
        requestTarget: new URL(signed.url).pathname + new URL(signed.url).search,
        nowSeconds: 1_899,
      }).authorized
    ).toBe(true)
  })

  test('rejects an expired link at the exact expiry boundary', () => {
    const signed = createSignedTextDownload({
      ...config,
      conversationId: 'conversation-1',
      filename: 'artifact-1.txt',
      nowSeconds: 1_000,
    })

    expect(
      verifySignedTextDownload({
        ...config,
        method: 'GET',
        requestTarget: new URL(signed.url).pathname + new URL(signed.url).search,
        nowSeconds: 1_900,
      })
    ).toEqual({ authorized: false, reason: 'expired' })
  })

  test('rejects path, signature, method, and query tampering', () => {
    const signed = createSignedTextDownload({
      ...config,
      conversationId: 'conversation-1',
      filename: 'artifact-1.txt',
      nowSeconds: 1_000,
    })
    const target = new URL(signed.url)

    const attempts = [
      {
        method: 'GET',
        requestTarget: target.pathname.replace('artifact-1.txt', 'artifact-2.txt') + target.search,
      },
      {
        method: 'GET',
        requestTarget: `${target.pathname}${target.search.replace(/sig=[^&]+/, 'sig=invalid')}`,
      },
      { method: 'POST', requestTarget: target.pathname + target.search },
      { method: 'GET', requestTarget: `${target.pathname}${target.search}&extra=1` },
      { method: 'GET', requestTarget: `${target.pathname}${target.search}&sig=duplicate` },
    ]

    for (const attempt of attempts) {
      expect(
        verifySignedTextDownload({
          ...config,
          ...attempt,
          nowSeconds: 1_001,
        }).authorized
      ).toBe(false)
    }
  })

  test('rejects unsafe conversation identifiers and filenames', () => {
    for (const path of [
      '/texts/../artifact.txt',
      '/texts/conversation-1/../artifact.txt',
      '/texts/conversation-1/nested/artifact.txt',
      '/texts/conversation-1/.hidden.txt',
      '/texts/conversation-1/artifact.pdf',
      '/texts/conversation%2Fescape/artifact.txt',
    ]) {
      expect(parseTextArtifactPath(path)).toBeUndefined()
    }
  })

  test('derives a stable domain-separated fallback key from TOKEN', () => {
    const first = resolveTextSigningSecret({ token: 'shared-project-token' })
    const second = resolveTextSigningSecret({ token: 'shared-project-token' })
    const other = resolveTextSigningSecret({ token: 'different-project-token' })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
    expect(other).not.toBe(first)
    expect(resolveTextSigningSecret({ secret: config.secret, token: 'ignored-token' })).toBe(
      config.secret
    )
  })

  test('signs and verifies with TOKEN when the explicit secret is absent', () => {
    const fallbackConfig = {
      baseUrl: config.baseUrl,
      token: 'shared-project-token',
      ttlSeconds: config.ttlSeconds,
    }
    const signed = createSignedTextDownload({
      ...fallbackConfig,
      conversationId: 'conversation-1',
      filename: 'artifact-1.txt',
      nowSeconds: 1_000,
    })
    const url = new URL(signed.url)

    expect(
      verifySignedTextDownload({
        ...fallbackConfig,
        method: 'GET',
        requestTarget: url.pathname + url.search,
        nowSeconds: 1_001,
      }).authorized
    ).toBe(true)
    expect(
      verifySignedTextDownload({
        ...fallbackConfig,
        token: 'different-project-token',
        method: 'GET',
        requestTarget: url.pathname + url.search,
        nowSeconds: 1_001,
      }).authorized
    ).toBe(false)
  })

  test('rejects invalid explicit secrets and missing key material', () => {
    expect(() => resolveTextSigningSecret({ secret: 'invalid' })).toThrow(
      'exactly 64 hexadecimal characters'
    )
    expect(() => resolveTextSigningSecret({})).toThrow(
      'TOKEN is required when TEXTS_SIGNING_SECRET is not configured'
    )
  })
})
