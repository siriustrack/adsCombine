import { describe, expect, test } from 'bun:test'
import { redactUrl } from '../../src/lib/redact-url'

describe('redactUrl', () => {
  test('preserves only the origin while removing path and query values', () => {
    const redacted = redactUrl(
      'https://storage.example.com/documents/file.pdf?token=secret-token&X-Amz-Signature=secret-signature&apikey=secret-key'
    )

    expect(redacted).toBe('https://storage.example.com/[redacted-path]?[redacted-query]')
    expect(redacted).not.toContain('/documents/file.pdf')
    expect(redacted).not.toContain('secret-token')
    expect(redacted).not.toContain('secret-signature')
    expect(redacted).not.toContain('secret-key')
    expect(redacted).not.toContain('token=')
    expect(redacted).not.toContain('X-Amz-Signature=')
    expect(redacted).not.toContain('apikey=')
  })

  test('returns a stable placeholder for invalid URLs', () => {
    expect(redactUrl('not a valid url')).toBe('[invalid-url]')
  })
})
