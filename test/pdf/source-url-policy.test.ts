import { describe, expect, test } from 'bun:test'
import {
  SourceUrlPolicy,
  SourceUrlPolicyError,
} from '../../src/core/services/messages/pdf-utils/source-url-policy'

const allowedPrefix = 'https://project.supabase.co/storage/v1/object/'

function createPolicy(addresses = ['8.8.8.8']) {
  return new SourceUrlPolicy({
    allowedPrefixes: [allowedPrefix],
    resolveHostname: async () => addresses,
  })
}

describe('SourceUrlPolicy', () => {
  test('accepts a configured HTTPS storage URL resolved to a public address', async () => {
    const url = `${allowedPrefix}sign/documents/source.pdf?token=signed`

    await expect(createPolicy().assertSafeUrl(url)).resolves.toEqual(new URL(url))
  })

  test('accepts any public HTTPS source URL when no allowlist prefix is configured', async () => {
    const policy = new SourceUrlPolicy({
      allowedPrefixes: [],
      resolveHostname: async () => ['8.8.8.8'],
    })
    const url = 'https://external-customer-storage.example.com/files/source.pdf?token=signed'

    await expect(policy.assertSafeUrl(url)).resolves.toEqual(new URL(url))
  })

  test.each([
    'http://project.supabase.co/storage/v1/object/public/documents/source.pdf',
    'https://user:password@project.supabase.co/storage/v1/object/public/documents/source.pdf',
    'https://project.supabase.co/rest/v1/documents',
    'https://localhost/storage/v1/object/public/documents/source.pdf',
  ])('rejects an unsafe source URL: %s', async url => {
    await expect(createPolicy().assertSafeUrl(url)).rejects.toBeInstanceOf(SourceUrlPolicyError)
  })

  test.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', '::1', 'fe80::1'])(
    'rejects a configured origin that resolves to a non-public address: %s',
    async address => {
      const url = `${allowedPrefix}public/documents/source.pdf`

      await expect(createPolicy([address]).assertSafeUrl(url)).rejects.toBeInstanceOf(
        SourceUrlPolicyError
      )
    }
  )

  test('rejects redirect targets outside the configured storage prefix', async () => {
    await expect(
      createPolicy().assertSafeUrl('https://project.supabase.co/rest/v1/documents')
    ).rejects.toBeInstanceOf(SourceUrlPolicyError)
  })
})
