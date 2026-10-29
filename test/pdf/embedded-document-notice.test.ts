import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { EmbeddedDocumentNoticeReader } from '../../src/core/services/messages/pdf-utils/embedded-document-notice'

const text = 'Av. 1 - Condição.\nAv. 2 - Quitação.\nR. 3 - Venda.'
const pages = [{ pageNumber: 1, text }]
const listing = [
  '1 0 image 2500 3500 gray 1 8 image no 11 0 300 300 100K 1%',
  '1 1 image 800 200 rgb 3 8 image no 9 0 100 100 5K 1%',
  '1 2 smask 800 200 gray 1 8 image no 9 0 100 100 5K 1%',
  '1 3 image 800 200 rgb 3 8 image no 10 0 100 100 5K 1%',
].join('\n')

describe('embedded certificate notice', () => {
  test('preserves all acts and adds only the observed notice with temporary cleanup', async () => {
    // Given: the notice is in a separate strip; whole-page OCR omitted it.
    const calls: string[] = []
    let directory = ''
    const reader = new EmbeddedDocumentNoticeReader(async (command, args) => {
      calls.push(command)
      if (command === 'tesseract') {
        expect(args[0]?.endsWith('-001.png')).toBe(true)
        return { stdout: 'BROKEN HEADER\nNÃO VALE COMO CERTIDÃO\n' }
      }
      if (args[0] === '-list') return { stdout: listing }
      directory = path.dirname(args.at(-1) ?? '')
      expect(fs.existsSync(directory)).toBe(true)
      return { stdout: '' }
    })
    // When
    const result = await reader.read('synthetic.pdf', pages, new AbortController().signal)
    // Then: stop after positive evidence, not after scanning unrelated images.
    expect(calls).toEqual(['pdfimages', 'pdfimages', 'tesseract'])
    expect(result[0]?.text.startsWith(text)).toBe(true)
    expect(result[0]?.text).toContain('NÃO VALE COMO CERTIDÃO')
    expect(result[0]?.text.includes('BROKEN HEADER')).toBe(false)
    expect(result[0]?.warnings).toContain('embedded-document-notice')
    expect(pages[0]?.text).toBe(text)
    expect(fs.existsSync(directory)).toBe(false)
  })

  test('does not fabricate a notice from a generic logo or payment clause', async () => {
    // Given
    const reader = new EmbeddedDocumentNoticeReader(async (command, args) => ({
      stdout:
        command === 'tesseract' ? 'PAGAMENTO PURO E SIMPLES' : args[0] === '-list' ? listing : '',
    }))
    // When
    const result = await reader.read('synthetic.pdf', pages, new AbortController().signal)
    // Then
    expect(result).toEqual(pages)
  })

  test('does not export pages whose embedded raster size exceeds the bound', async () => {
    // Given
    let calls = 0
    const reader = new EmbeddedDocumentNoticeReader(async () => {
      calls++
      return { stdout: listing.replace('2500 3500', '20000 20000') }
    })
    // When
    const result = await reader.read('synthetic.pdf', pages, new AbortController().signal)
    // Then
    expect(calls).toBe(1)
    expect(result[0]?.text).toBe(text)
    expect(result[0]?.warnings).toContain('document-notice-budget-exhausted')
  })

  test('bounds supplemental OCR across the document and exposes unprocessed candidates', async () => {
    // Given
    let ocrCalls = 0
    const reader = new EmbeddedDocumentNoticeReader(async (command, args) => {
      if (command === 'tesseract') ocrCalls++
      return {
        stdout:
          args[0] === '-list'
            ? `${listing}\n2 4 image 800 200 rgb 3 8 image no 12 0 100 100 5K 1%`
            : '',
      }
    })
    // When
    const result = await reader.read(
      'synthetic.pdf',
      [...pages, { pageNumber: 2, text: 'R. 4 - Outro ato.' }],
      new AbortController().signal
    )
    // Then
    expect(ocrCalls).toBe(2)
    expect(result[1]?.warnings).toContain('document-notice-budget-exhausted')
    expect(result[1]?.text).toBe('R. 4 - Outro ato.')
  })

  test('propagates caller cancellation and removes extracted temporary images', async () => {
    // Given: cancel only after the command subscribes to the exact abort signal.
    const started = Promise.withResolvers<void>()
    const controller = new AbortController()
    let directory = ''
    const reader = new EmbeddedDocumentNoticeReader(async (_command, args, options) => {
      if (args[0] === '-list') return { stdout: listing }
      directory = path.dirname(args.at(-1) ?? '')
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        })
        started.resolve()
      })
    })
    // When
    const pending = reader.read('synthetic.pdf', pages, controller.signal)
    await started.promise
    controller.abort(new Error('cancelled by test'))
    // Then
    await expect(pending).rejects.toThrow('cancelled by test')
    expect(fs.existsSync(directory)).toBe(false)
  })
})
