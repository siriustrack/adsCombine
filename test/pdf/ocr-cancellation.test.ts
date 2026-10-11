import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import fs from 'node:fs'
import { PROCESSING_TIMEOUTS } from '@config/constants'
import { errResult, okResult } from '@lib/result.types'
import { pdfWorkerPool } from '@lib/worker-pool'
import {
  OcrCancellationError,
  OcrOrchestrator,
} from '../../src/core/services/messages/pdf-utils/ocr-orchestrator.service'
import { ProcessPdfService } from '../../src/core/services/messages/pdf-utils/process-pdf.service'

function pdfBuffer() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>',
  ]
  let text = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text))
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(text)
  text += `xref\n0 6\n0000000000 65535 f \n`
  text += offsets
    .slice(1)
    .map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  text += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}

const poolSpies: Array<{ mockRestore(): void }> = []
afterEach(() => {
  for (const spy of poolSpies.splice(0)) spy.mockRestore()
})

describe('OCR scoped cancellation', () => {
  test('pdfinfo validation propagates cancellation instead of invalid-PDF success', async () => {
    const controller = new AbortController()
    const reason = new Error('validation cancelled')
    controller.abort(reason)
    const orchestrator = new OcrOrchestrator()
    await expect(
      orchestrator['validatePdfStructure'](
        '/nonexistent-cancellation.pdf',
        'validation-cancel',
        controller.signal
      )
    ).rejects.toBe(reason)
  })

  for (const mode of ['legacy', 'selected', 'enhanced'] as const) {
    const run = (orchestrator: OcrOrchestrator, signal?: AbortSignal) => {
      const options = { buffer: pdfBuffer(), totalPages: 3, fileId: 'cancel-test', signal }
      switch (mode) {
        case 'legacy':
          return orchestrator.processWithOcr(options)
        case 'selected':
          return orchestrator.processPagesWithOcr({ ...options, pageNumbers: [1, 3] })
        case 'enhanced':
          return orchestrator.processWithEnhancedOcr(options)
      }
    }

    test(`${mode} rejects cancellation before work including zero pages`, async () => {
      const controller = new AbortController()
      controller.abort(new Error('caller stopped'))
      const spy = spyOn(pdfWorkerPool, 'run')
      poolSpies.push(spy)
      const result = await run(new OcrOrchestrator(), controller.signal)
      expect(result.error).toBeInstanceOf(OcrCancellationError)
      expect(spy).not.toHaveBeenCalled()
      const empty = await new OcrOrchestrator().processWithOcr({
        buffer: Buffer.alloc(0),
        totalPages: 0,
        fileId: 'empty',
        signal: controller.signal,
      })
      expect(empty.error).toBeInstanceOf(OcrCancellationError)
    })

    test(`${mode} aborts every sibling and removes its temporary PDF`, async () => {
      const controller = new AbortController()
      const started = Promise.withResolvers<void>()
      const paths = new Set<string>()
      let active = 0
      const spy = spyOn(pdfWorkerPool, 'run').mockImplementation((payload, options) => {
        paths.add(payload.pdfPath)
        active++
        const signal = options?.signal
        if (!(signal instanceof AbortSignal)) throw new Error('Missing task cancellation')
        const task = new Promise<never>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              active--
              reject(signal.reason)
            },
            { once: true }
          )
        })
        started.resolve()
        return task
      })
      poolSpies.push(spy)
      const pending = run(new OcrOrchestrator(), controller.signal)
      await started.promise
      controller.abort(new Error('caller stopped active OCR'))
      const result = await pending
      expect(result.error).toBeInstanceOf(OcrCancellationError)
      expect(active).toBe(0)
      expect([...paths].every(path => !fs.existsSync(path))).toBe(true)
    })

    test(`${mode} cancels pending siblings on ordinary task failure`, async () => {
      let active = 0
      const failure = new Error('OCR command failed')
      const spy = spyOn(pdfWorkerPool, 'run').mockImplementation((payload, options) => {
        const signal = options?.signal
        if (!(signal instanceof AbortSignal)) throw new Error('Missing task cancellation')
        active++
        return new Promise<never>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              active--
              reject(signal.reason)
            },
            { once: true }
          )
          // Fail after all synchronous task submissions; no timing dependency.
          if (payload.pageRange.first === 1) queueMicrotask(() => reject(failure))
        })
      })
      poolSpies.push(spy)
      const result = await run(new OcrOrchestrator())
      expect(result.error).toBe(failure)
      expect(active).toBe(0)
    })

    test(`${mode} global timeout is terminal and clears active tasks`, async () => {
      const originalSetTimeout = globalThis.setTimeout
      const expirations: Array<() => void> = []
      const timers: Array<ReturnType<typeof setTimeout>> = []
      const cleared = spyOn(globalThis, 'clearTimeout')
      poolSpies.push(cleared)
      const orchestrator = new OcrOrchestrator(expire => {
        expirations.push(expire)
        const timer = originalSetTimeout(expire, PROCESSING_TIMEOUTS.PDF_GLOBAL)
        timers.push(timer)
        return timer
      })
      const started = Promise.withResolvers<void>()
      let active = 0
      const spy = spyOn(pdfWorkerPool, 'run').mockImplementation((_payload, options) => {
        const signal = options?.signal
        if (!(signal instanceof AbortSignal)) throw new Error('Missing task cancellation')
        active++
        const pending = new Promise<never>((_, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              active--
              reject(signal.reason)
            },
            { once: true }
          )
        })
        started.resolve()
        return pending
      })
      poolSpies.push(spy)
      const pending = run(orchestrator)
      await started.promise
      for (const expire of expirations) expire()
      expect((await pending).error?.name).toBe('TimeoutError')
      expect(active).toBe(0)
      expect(timers.every(timer => cleared.mock.calls.some(([value]) => value === timer))).toBe(
        true
      )
    })
  }
})

describe('PDF cancellation versus useful native fallback', () => {
  const usefulNativeText = 'Useful native fallback '.repeat(10).trim()
  for (const mode of ['legacy', 'mixed-page', 'enhanced'] as const) {
    function service(error: Error, duringWork?: AbortController) {
      const ocrFailure = async () => {
        duringWork?.abort(error)
        return errResult(error)
      }
      return new ProcessPdfService(
        {
          async downloadFile() {
            return okResult({ buffer: pdfBuffer(), contentLength: 100 })
          },
        },
        {
          async extractTextFromPdf() {
            return okResult({
              text: usefulNativeText,
              totalPages: 2,
              pages: [1, 2].map(pageNumber => ({
                pageNumber,
                text: usefulNativeText,
                embeddedImageCount: 1,
                tableCount: 0,
                hasVisualContent: true,
              })),
            })
          },
        },
        undefined,
        {
          processWithOcr: ocrFailure,
          processPagesWithOcr: ocrFailure,
          processWithEnhancedOcr: ocrFailure,
        }
      )
    }
    const file = {
      fileId: 'fallback',
      url: 'https://example.com/test.pdf',
      mimeType: 'application/pdf',
    }
    test(`${mode} retains useful native fallback on ordinary OCR failure`, async () => {
      const result = await service(new Error('OCR unavailable')).execute(file, { mode })
      expect(result.error).toBeNull()
      expect(result.value).toBe(usefulNativeText)
    })
    test(`${mode} never returns native success after caller abort`, async () => {
      const controller = new AbortController()
      const result = await service(new Error('cancelled by caller'), controller).execute(file, {
        mode,
        signal: controller.signal,
      })
      expect(result.error).toBeInstanceOf(OcrCancellationError)
    })
    test(`${mode} never returns native success after scoped timeout`, async () => {
      const result = await service(new DOMException('expired', 'TimeoutError')).execute(file, {
        mode,
      })
      expect(result.error?.name).toBe('TimeoutError')
    })
  }
})

test('OCR process cancellation kills subprocesses and preserves unrelated work', async () => {
  const process = Bun.spawn(
    [Bun.which('bun') ?? 'bun', 'test/pdf/fixtures/ocr-cancellation-runtime.cjs'],
    {
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...globalThis.process.env, LOG_LEVEL: 'error' },
    }
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
  expect(JSON.parse(stdout)).toEqual({
    cancelled: true,
    queuedCancelled: true,
    isolated: true,
    subprocessSurvived: false,
  })
}, 15_000)
