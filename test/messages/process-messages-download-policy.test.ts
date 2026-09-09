import { afterEach, describe, expect, test } from 'bun:test'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { FileDownloadService } from '../../src/core/services/messages/pdf-utils/file-download.service'
import type { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'
import { SourceUrlPolicy } from '../../src/core/services/messages/pdf-utils/source-url-policy'
import { ProcessMessagesService } from '../../src/core/services/messages/process-messages.service'

const conversationId = 'source-download-policy-test'
const primaryPrefix = 'https://storage.example.com/storage/v1/object/'
const redirectPrefix = 'https://redirect.example.com/storage/v1/object/'

afterEach(async () => {
  await rm(join(process.cwd(), 'public', 'texts', conversationId), { recursive: true, force: true })
})

function createService(resolveHostname: (hostname: string) => Promise<string[]>, status = 200) {
  let requestCount = 0
  const downloader = new FileDownloadService(
    new SourceUrlPolicy({
      allowedPrefixes: [primaryPrefix, redirectPrefix],
      resolveHostname,
    }),
    {
      async get() {
        requestCount++
        return {
          status,
          statusText: status === 302 ? 'Found' : 'OK',
          headers:
            status === 302
              ? { location: `${redirectPrefix}public/private.txt` }
              : { 'content-length': '4' },
          data: Buffer.from('text'),
        }
      },
    }
  )
  const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
    async execute() {
      throw new Error('PDF processing is not used in this test')
    },
    async executeEnhanced() {
      throw new Error('Enhanced OCR is not used in this test')
    },
  }

  return {
    requestCount: () => requestCount,
    service: new ProcessMessagesService(pdfService, undefined, downloader),
  }
}

function createRequest(url: string) {
  return {
    protocol: 'http',
    host: 'localhost:3000',
    messages: [
      {
        conversationId,
        body: {
          files: [{ fileId: 'text-1', url, mimeType: 'text/plain' }],
        },
      },
    ],
  }
}

describe('ProcessMessagesService source downloads', () => {
  test('rejects a legacy request whose total files exceed the job-safe limit', async () => {
    let pdfCalls = 0
    const pdfService: Pick<ProcessPdfService, 'execute' | 'executeEnhanced'> = {
      async execute() {
        pdfCalls++
        return { value: 'PDF text', error: undefined }
      },
      async executeEnhanced() {
        throw new Error('Enhanced OCR is not used in this test')
      },
    }
    const service = new ProcessMessagesService(pdfService)
    const files = Array.from({ length: 12 }, (_, index) => ({
      fileId: `pdf-${index}`,
      url: `${primaryPrefix}public/source-${index}.pdf`,
      mimeType: 'application/pdf',
    }))

    const result = await service.execute(
      {
        protocol: 'http',
        host: 'localhost:3000',
        messages: [
          { conversationId, body: { files: files.slice(0, 6) } },
          { conversationId, body: { files: files.slice(6) } },
        ],
      },
      { limits: { maxFiles: 10 } }
    )

    expect(result.processedFiles).toEqual([])
    expect(result.failedFiles).toHaveLength(12)
    expect(pdfCalls).toBe(0)
  })

  test('rejects a non-PDF URL that violates the shared source URL policy before connecting', async () => {
    const { service, requestCount } = createService(async () => ['8.8.8.8'])

    const result = await service.execute(createRequest('http://storage.example.com/private.txt'))

    expect(result.processedFiles).toEqual([])
    expect(result.failedFiles).toEqual([
      expect.objectContaining({
        fileId: 'text-1',
        error: expect.stringContaining('URL de origem não permitida'),
      }),
    ])
    expect(requestCount()).toBe(0)
  })

  test('rejects a non-PDF redirect that resolves to a private address before requesting it', async () => {
    const { service, requestCount } = createService(
      async hostname => (hostname === 'redirect.example.com' ? ['127.0.0.1'] : ['8.8.8.8']),
      302
    )

    const result = await service.execute(createRequest(`${primaryPrefix}public/source.txt`))

    expect(result.processedFiles).toEqual([])
    expect(result.failedFiles).toEqual([
      expect.objectContaining({
        fileId: 'text-1',
        error: expect.stringContaining('URL de origem não permitida'),
      }),
    ])
    expect(requestCount()).toBe(1)
  })
})
