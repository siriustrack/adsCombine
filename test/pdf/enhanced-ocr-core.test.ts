import { describe, expect, test } from 'bun:test'
import worker from '../../src/core/services/messages/pdfChunkWorker.js'
import {
  analyzeEnhancedOcrText,
  sanitizeEnhancedOcrText,
  scoreEnhancedOcrAttempt,
} from '../../src/core/services/messages/pdf-utils/enhanced-ocr.service.js'

type WorkerTestApi = {
  performOcrOnPages: (
    pngs: string[],
    env: Record<string, string>,
    options?: Record<string, unknown>
  ) => {
    pageNumber: number
    text: string
    meanConfidence: number
    wordCount: number
    selectedAttempt: { label: string; psm: number }
    legalSignals: { registryMarkers: number; cpfCnpj: number }
    warnings: string[]
  }[]
  setHooks: (hooks: {
    runTesseractTsv?: (imagePath: string, options: { psm: number; dpi: number }) => OcrResult
  }) => void
  resetHooks: () => void
}

type OcrResult = { text: string; meanConfidence: number; wordCount: number }

const workerTest = worker.__test as WorkerTestApi

describe('enhanced OCR core', () => {
  test('sanitizes spacing without changing factual values or line/page boundaries', () => {
    const input = 'Matrícula   nº  62.132\r\nCPF 123.456.789-10\r\n\r\nÁrea 131,22 m²'

    expect(sanitizeEnhancedOcrText(input)).toBe(
      'Matrícula nº 62.132\nCPF 123.456.789-10\n\nÁrea 131,22 m²'
    )
  })

  test('rewards exact registry and legal markers while penalizing corrupted OCR evidence', () => {
    const legalText =
      'Matrícula nº 62.132\nAverbação 4\nCPF 123.456.789-10\nR$ 1.234,56\n01/02/2026\nÁrea 131,22 m²\n1/2'
    const corruptedText = 'Matrícula �� ��\n1 3 1 , 2 2 m ²\nAV. 4\nAV. 4\n@@@ ###'

    const legalSignals = analyzeEnhancedOcrText(legalText)
    const corruptedSignals = analyzeEnhancedOcrText(corruptedText)

    expect(legalSignals.registryMarkers).toBeGreaterThan(0)
    expect(legalSignals.legalMarkers).toBeGreaterThan(0)
    expect(legalSignals.cpfCnpj).toBe(1)
    expect(legalSignals.currency).toBe(1)
    expect(legalSignals.dates).toBe(1)
    expect(legalSignals.squareMeters).toBe(1)
    expect(legalSignals.fractions).toBe(1)
    expect(corruptedSignals.corruptedSymbols).toBeGreaterThan(0)
    expect(corruptedSignals.fragmentedNumbersOrMeasures).toBeGreaterThan(0)
    expect(corruptedSignals.duplicateLabels).toBeGreaterThan(0)
    expect(corruptedSignals.garbledSpans).toBeGreaterThan(0)
    expect(
      scoreEnhancedOcrAttempt({ text: legalText, meanConfidence: 60, wordCount: 20 })
    ).toBeGreaterThan(
      scoreEnhancedOcrAttempt({ text: corruptedText, meanConfidence: 85, wordCount: 20 })
    )
  })

  test('does not treat distinct registry acts as duplicated labels', () => {
    const distinctActs =
      'Av.01 Averbação inicial\nAv.02 Atualização de confrontantes\nR.08 Partilha'
    const duplicatedAct = 'Av.02 Atualização de confrontantes\nAv.02 Atualização de confrontantes'

    expect(analyzeEnhancedOcrText(distinctActs).duplicateLabels).toBe(0)
    expect(analyzeEnhancedOcrText(duplicatedAct).duplicateLabels).toBe(1)
  })

  test('does not treat words containing art or ordinary repeated prose as legal markers or labels', () => {
    const signals = analyzeEnhancedOcrText(
      'Cartório das partes\nCartório das partes\nart. 12\nart. 12'
    )

    expect(signals.legalMarkers).toBe(2)
    expect(signals.duplicateLabels).toBe(1)
  })

  test('accepts ordinary legal typography without reporting corrupted symbols', () => {
    const signals = analyzeEnhancedOcrText(
      '§ 1º — A expressão “norma vigente” inclui área de atuação, alínea “a”, item 1ª e (...)'
    )

    expect(signals.corruptedSymbols).toBe(0)
    expect(signals.garbledSpans).toBe(0)
  })

  test('keeps suffixed articles distinct and recognizes ungrouped currency', () => {
    const signals = analyzeEnhancedOcrText(
      'Art. 12-A Texto inicial\nArt. 12-B Texto seguinte\nValor R$ 1234,56'
    )

    expect(signals.duplicateLabels).toBe(0)
    expect(signals.currency).toBe(1)
  })

  test('uses a bounded fallback PSM only when enhanced signals show the first attempt is weak', () => {
    const previousMaxAttempts = process.env.PDF_OCR_MAX_ATTEMPTS
    process.env.PDF_OCR_MAX_ATTEMPTS = '2'
    const psms: number[] = []
    workerTest.setHooks({
      runTesseractTsv: (_imagePath, { psm }) => {
        psms.push(psm)
        return psm === 4
          ? { text: '### �� ��\n1 3 1 , 2 2 m ²', meanConfidence: 92, wordCount: 8 }
          : {
              text: 'Matrícula nº 62.132\nÁrea 131,22 m²\nCPF 123.456.789-10',
              meanConfidence: 70,
              wordCount: 8,
            }
      },
    })

    const pages = workerTest.performOcrOnPages(
      ['page-1.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    workerTest.resetHooks()
    if (previousMaxAttempts === undefined) delete process.env.PDF_OCR_MAX_ATTEMPTS
    else process.env.PDF_OCR_MAX_ATTEMPTS = previousMaxAttempts

    expect(psms).toEqual([4, 6])
    expect(pages[0].selectedAttempt).toEqual({ label: 'orig', psm: 6 })
    expect(pages[0].text).toContain('Matrícula nº 62.132')
    expect(pages[0]).toMatchObject({
      pageNumber: 1,
      meanConfidence: 70,
      wordCount: 8,
      legalSignals: { registryMarkers: 1, cpfCnpj: 1 },
      warnings: [],
    })
  })

  test('does not stop early on high-confidence text with corruption signals', () => {
    const previousMaxAttempts = process.env.PDF_OCR_MAX_ATTEMPTS
    process.env.PDF_OCR_MAX_ATTEMPTS = '2'
    const psms: number[] = []
    workerTest.setHooks({
      runTesseractTsv: (_imagePath, { psm }) => {
        psms.push(psm)
        return psm === 4
          ? {
              text: `Matrícula �� ${'texto corrompido '.repeat(40)}`,
              meanConfidence: 92,
              wordCount: 80,
            }
          : {
              text: `Matrícula nº 62.132 ${'texto registral legível '.repeat(30)}`,
              meanConfidence: 82,
              wordCount: 70,
            }
      },
    })

    const pages = workerTest.performOcrOnPages(
      ['page-1.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    workerTest.resetHooks()
    if (previousMaxAttempts === undefined) delete process.env.PDF_OCR_MAX_ATTEMPTS
    else process.env.PDF_OCR_MAX_ATTEMPTS = previousMaxAttempts

    expect(psms).toEqual([4, 6])
    expect(pages[0].selectedAttempt).toEqual({ label: 'orig', psm: 6 })
    expect(pages[0].warnings).toEqual([])
  })

  test('stops after a good attempt without replacing a higher-scoring candidate', () => {
    const previousMaxAttempts = process.env.PDF_OCR_MAX_ATTEMPTS
    process.env.PDF_OCR_MAX_ATTEMPTS = '2'
    workerTest.setHooks({
      runTesseractTsv: (_imagePath, { psm }) =>
        psm === 4
          ? {
              text: `${'Art. 12 norma jurídica '.repeat(40)}�`,
              meanConfidence: 70,
              wordCount: 80,
            }
          : {
              text: 'texto comum plenamente legível '.repeat(40),
              meanConfidence: 80,
              wordCount: 80,
            },
    })

    const pages = workerTest.performOcrOnPages(
      ['page-1.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    workerTest.resetHooks()
    if (previousMaxAttempts === undefined) delete process.env.PDF_OCR_MAX_ATTEMPTS
    else process.env.PDF_OCR_MAX_ATTEMPTS = previousMaxAttempts

    expect(pages[0].selectedAttempt).toEqual({ label: 'orig', psm: 4 })
  })

  test('runs the fallback segmentation when the first OCR attempt throws', () => {
    const previousMaxAttempts = process.env.PDF_OCR_MAX_ATTEMPTS
    process.env.PDF_OCR_MAX_ATTEMPTS = '2'
    const psms: number[] = []
    workerTest.setHooks({
      runTesseractTsv: (_imagePath, { psm }) => {
        psms.push(psm)
        if (psm === 4) throw new Error('first attempt failed')
        return { text: 'Art. 1 Conteúdo recuperado', meanConfidence: 88, wordCount: 4 }
      },
    })

    const pages = workerTest.performOcrOnPages(
      ['page-1.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    workerTest.resetHooks()
    if (previousMaxAttempts === undefined) delete process.env.PDF_OCR_MAX_ATTEMPTS
    else process.env.PDF_OCR_MAX_ATTEMPTS = previousMaxAttempts

    expect(psms).toEqual([4, 6])
    expect(pages[0].text).toBe('Art. 1 Conteúdo recuperado')
  })

  test('does not execute duplicate attempt tuples when the attempt budget exceeds two', () => {
    const previousMaxAttempts = process.env.PDF_OCR_MAX_ATTEMPTS
    process.env.PDF_OCR_MAX_ATTEMPTS = '4'
    const attempts: Array<{ imagePath: string; psm: number }> = []
    workerTest.setHooks({
      runTesseractTsv: (imagePath, { psm }) => {
        attempts.push({ imagePath, psm })
        return { text: 'texto curto', meanConfidence: 10, wordCount: 2 }
      },
    })

    workerTest.performOcrOnPages(['page-1.png'], {}, { structuredPages: true, enhancedOcr: true })

    workerTest.resetHooks()
    if (previousMaxAttempts === undefined) delete process.env.PDF_OCR_MAX_ATTEMPTS
    else process.env.PDF_OCR_MAX_ATTEMPTS = previousMaxAttempts

    expect(attempts.map(({ imagePath, psm }) => `${imagePath}:${psm}`)).toEqual([
      'page-1.png:4',
      'page-1.png:6',
    ])
  })

  test('returns enhanced metadata for a blank OCR page', () => {
    workerTest.setHooks({
      runTesseractTsv: () => ({ text: '', meanConfidence: 0, wordCount: 0 }),
    })

    const pages = workerTest.performOcrOnPages(
      ['page-1.png'],
      {},
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )

    workerTest.resetHooks()

    expect(pages).toEqual([
      expect.objectContaining({
        pageNumber: 1,
        text: '',
        meanConfidence: 0,
        wordCount: 0,
        warnings: ['no-text-detected'],
      }),
    ])
  })

  test('uses the same effective DPI passed to rasterization and Tesseract', () => {
    let receivedDpi: number | undefined
    workerTest.setHooks({
      runTesseractTsv: (_imagePath, options) => {
        receivedDpi = options.dpi
        return { text: 'texto legível', meanConfidence: 90, wordCount: 2 }
      },
    })

    workerTest.performOcrOnPages(
      ['page-1.png'],
      { PDF_OCR_DPI: '450' },
      {
        structuredPages: true,
        enhancedOcr: true,
      }
    )
    workerTest.resetHooks()

    expect(receivedDpi).toBe(450)
  })
})
