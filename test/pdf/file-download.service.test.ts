import { describe, expect, test } from 'bun:test'
import type { AxiosRequestConfig } from 'axios'
import { FileDownloadService } from '../../src/core/services/messages/pdf-utils/file-download.service'
import { SourceUrlPolicy } from '../../src/core/services/messages/pdf-utils/source-url-policy'

const allowedPrefix = 'https://project.supabase.co/storage/v1/object/'

function createPolicy() {
  return new SourceUrlPolicy({
    allowedPrefixes: [allowedPrefix],
    resolveHostname: async () => ['8.8.8.8'],
  })
}

describe('FileDownloadService', () => {
  test('manually validates every redirect before requesting it', async () => {
    const requestedUrls: string[] = []
    const requestConfigs: AxiosRequestConfig[] = []
    const downloadService = new FileDownloadService(createPolicy(), {
      get: async (url, config) => {
        requestedUrls.push(url)
        requestConfigs.push(config)
        if (url === `${allowedPrefix}sign/temporary-source.pdf`) {
          return {
            status: 302,
            statusText: 'Found',
            headers: { location: `${allowedPrefix}public/source.pdf` },
            data: Buffer.alloc(0),
          }
        }

        return {
          status: 200,
          statusText: 'OK',
          headers: { 'content-length': '4' },
          data: Buffer.from('pdf!'),
        }
      },
    })

    const result = await downloadService.downloadFile(
      `${allowedPrefix}sign/temporary-source.pdf`,
      'file-1'
    )

    expect(result.error).toBeNull()
    expect(result.value?.buffer.toString()).toBe('pdf!')
    expect(requestedUrls).toEqual([
      `${allowedPrefix}sign/temporary-source.pdf`,
      `${allowedPrefix}public/source.pdf`,
    ])
    expect(requestConfigs).toEqual([
      expect.objectContaining({ maxRedirects: 0, lookup: expect.any(Function), proxy: false }),
      expect.objectContaining({ maxRedirects: 0, lookup: expect.any(Function), proxy: false }),
    ])
  })

  test('does not request redirects outside the configured storage prefix', async () => {
    const requestedUrls: string[] = []
    const downloadService = new FileDownloadService(createPolicy(), {
      get: async url => {
        requestedUrls.push(url)
        return {
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://example.com/source.pdf' },
          data: Buffer.alloc(0),
        }
      },
    })

    const result = await downloadService.downloadFile(
      `${allowedPrefix}sign/temporary-source.pdf`,
      'file-1'
    )

    expect(result.error?.message).toContain('URL de origem não permitida')
    expect(requestedUrls).toEqual([`${allowedPrefix}sign/temporary-source.pdf`])
  })
})
