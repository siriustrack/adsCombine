import { describe, expect, test } from 'bun:test'
import {
  bindAbortSignal,
  parsePdfinfoVersion,
  validateOcrPageCoverage,
} from '../../src/core/services/messages/pdf-utils/ocr-orchestrator.service'

describe('enhanced OCR page coverage', () => {
  test('reads the Poppler version from stderr or stdout', () => {
    expect(parsePdfinfoVersion('', 'pdfinfo version 25.06.0')).toBe('25.06.0')
    expect(parsePdfinfoVersion('pdfinfo version 24.02.1', '')).toBe('24.02.1')
  })

  test('accepts every expected page exactly once regardless of result order', () => {
    expect(
      validateOcrPageCoverage(
        [
          { pageNumber: 2, text: '' },
          { pageNumber: 1, text: 'texto' },
        ],
        [1, 2]
      )
    ).toBeUndefined()
  })

  test('rejects missing, duplicate, and unexpected pages', () => {
    expect(
      validateOcrPageCoverage(
        [
          { pageNumber: 1, text: 'a' },
          { pageNumber: 1, text: 'b' },
          { pageNumber: 3, text: 'c' },
        ],
        [1, 2]
      )
    ).toMatchObject({
      name: 'OcrPageCoverageError',
      missingPages: [2],
      duplicatePages: [1],
      unexpectedPages: [3],
    })
  })

  test('forwards an already-aborted parent signal immediately', () => {
    const parent = new AbortController()
    const child = new AbortController()
    const reason = new Error('cancelled before enhanced chunks')
    parent.abort(reason)

    const unbind = bindAbortSignal(parent.signal, child)

    expect(child.signal.aborted).toBe(true)
    expect(child.signal.reason).toBe(reason)
    unbind()
  })
})
