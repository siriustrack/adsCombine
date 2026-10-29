import { afterEach, describe, expect, test } from 'bun:test'
import { shouldUseEnhancedPsmFallback } from '../../src/core/services/messages/pdf-utils/enhanced-ocr.service.js'
import worker from '../../src/core/services/messages/pdfChunkWorker.js'

type OcrResult = { text: string; meanConfidence: number; wordCount: number }
type Page = {
  text: string
  selectedAttempt: { label: string; psm: number }
  warnings: string[]
}
const workerTest = worker.__test as {
  performOcrOnPages(
    pngs: string[],
    env: Record<string, string>,
    options: Record<string, unknown>
  ): Page[]
  setHooks(hooks: { runTesseractTsv: (path: string, options: { psm: number }) => OcrResult }): void
  resetHooks(): void
}
const originalMaxAttempts = process.env.PDF_OCR_MAX_ATTEMPTS
afterEach(() => {
  workerTest.resetHooks()
  if (originalMaxAttempts === undefined) delete process.env.PDF_OCR_MAX_ATTEMPTS
  else process.env.PDF_OCR_MAX_ATTEMPTS = originalMaxAttempts
})

const initialAct = `Av. 1 - Cidade, 2006.\n${'Condição resolutiva da compra anterior. '.repeat(12).trimEnd()}`
const cancellationAct = 'Av. 2 - Cidade, 2006.\nCancelamento da Av. 1 por quitação.\n'
const terminalAct = 'R. 3 - Cidade, 2021.\nVenda pelos titulares anteriores ao novo adquirente.'

describe('enhanced OCR registry coverage', () => {
  for (const [name, text] of [
    ['contiguous', `${initialAct}\n${cancellationAct}${terminalAct}`],
    ['page continuation', 'R. 5 - Ato.\nAv. 6 - Outro ato.'],
    ['different registries', 'Av.1/9001\nAto.\nR.3/9002\nOutro ato.'],
    ['inline reference', 'Av.1 - Ato.\nReferencia a R.3 nesta frase.'],
  ]) {
    test(`does not request gap recovery for ${name}`, () => {
      expect(shouldUseEnhancedPsmFallback({ text, meanConfidence: 90, wordCount: 100 })).toBe(false)
    })
  }

  test('rechecks a high-confidence gap before accepting an incomplete registry page', () => {
    // Given: the first attempt misses an act even though its average confidence is high.
    process.env.PDF_OCR_MAX_ATTEMPTS = '2'
    const psms: number[] = []
    const incomplete = `${initialAct}\n${terminalAct}`
    const complete = `${initialAct}\n${cancellationAct}${terminalAct}`
    workerTest.setHooks({
      runTesseractTsv: (_path, { psm }) => {
        psms.push(psm)
        return { text: psm === 4 ? incomplete : complete, meanConfidence: 89, wordCount: 100 }
      },
    })

    // When: the enhanced worker evaluates the page.
    const pages = workerTest.performOcrOnPages(
      ['synthetic.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    // Then: the bounded alternate segmentation preserves the cancellation and later sale.
    expect(psms).toEqual([4, 6])
    expect(pages[0]?.text).toBe(complete)
    expect(pages[0]?.selectedAttempt.psm).toBe(6)
    expect(pages[0]?.warnings).toEqual([])
  })

  test('reports the unresolved gap without exceeding the configured attempt budget', () => {
    // Given: an operator allows only one local OCR attempt.
    process.env.PDF_OCR_MAX_ATTEMPTS = '1'
    let calls = 0
    const incomplete = `${initialAct}\n${terminalAct}`
    workerTest.setHooks({
      runTesseractTsv: () => {
        calls++
        return { text: incomplete, meanConfidence: 89, wordCount: 100 }
      },
    })

    // When: the page cannot be reread within the budget.
    const pages = workerTest.performOcrOnPages(
      ['synthetic.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    // Then: retain source evidence but do not silently classify its act coverage as clean.
    expect(calls).toBe(1)
    expect(pages[0]?.text).toBe(incomplete)
    expect(pages[0]?.warnings).toContain('registry-act-sequence-gap')
  })

  test('does not recover the middle act by discarding an already recognized terminal act', () => {
    // Given: the alternate segmentation has higher confidence but drops the sale.
    process.env.PDF_OCR_MAX_ATTEMPTS = '2'
    const incomplete = `${initialAct}\n${terminalAct}`
    workerTest.setHooks({
      runTesseractTsv: (_path, { psm }) => ({
        text: psm === 4 ? incomplete : `${initialAct}\n${cancellationAct.trimEnd()}`,
        meanConfidence: psm === 4 ? 89 : 99,
        wordCount: 100,
      }),
    })

    // When: candidates disagree on act coverage.
    const pages = workerTest.performOcrOnPages(
      ['synthetic.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    // Then: preserve known evidence and expose the unresolved gap, rather than claiming repair.
    expect(pages[0]?.text).toBe(incomplete)
    expect(pages[0]?.warnings).toContain('registry-act-sequence-gap')
  })
})
