import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { createRotatedScanPdf, scanLines } from './fixtures/rotated-scan-runtime'

const execFileAsync = promisify(execFile)
const resultSchema = z.object({
  pages: z
    .array(
      z.object({
        pageNumber: z.number(),
        text: z.string(),
        meanConfidence: z.number(),
        wordCount: z.number(),
        selectedAttempt: z.object({
          label: z.string(),
          rotation: z.object({ angle: z.number(), scoreGain: z.number() }).optional(),
        }),
      })
    )
    .length(2),
})
type OcrResult = z.infer<typeof resultSchema>

function tokenRecall(text: string) {
  const tokens = (value: string) => new Set(value.toLowerCase().match(/\p{L}+/gu))
  const expected = tokens(scanLines.join('\n'))
  const actual = tokens(text)
  return [...expected].filter(word => actual.has(word)).length / expected.size
}

async function runWorker(pdfPath: string, enabled: boolean): Promise<OcrResult> {
  // Separate runtimes isolate both environment configuration and existing unit-test hooks.
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('PDF_OCR_') || key.startsWith('PDF_RASTER_')) delete env[key]
  }
  Object.assign(env, {
    PDF_OCR_LANG: 'por',
    PDF_OCR_ROTATE_ENABLED: String(enabled),
    PDF_WORKER_LOGS: 'false',
    LOG_LEVEL: 'error',
    PDF_WORKER_CMD_TIMEOUT: '30000',
    OMP_NUM_THREADS: '1',
    OMP_THREAD_LIMIT: '1',
    TESSERACT_NUM_THREADS: '1',
    LC_ALL: 'C',
  })
  const workerPath = path.resolve(__dirname, '../../src/core/services/messages/pdfChunkWorker.js')
  const poolPath = path.resolve(__dirname, '../../src/lib/ocr-process-pool.ts')
  const script = `
    const { OcrProcessPool } = require(${JSON.stringify(poolPath)});
    const pool = new OcrProcessPool(${JSON.stringify(workerPath)}, 1);
    const result = await pool.run({
      pdfPath: ${JSON.stringify(pdfPath)}, fileId: 'synthetic-rotation-runtime',
      pageRange: { first: 1, last: 2 }, structuredPages: true, enhancedOcr: true
    });
    console.log(JSON.stringify(result));
  `
  const { stdout } = await execFileAsync(process.execPath, ['-e', script], {
    env,
    timeout: 60_000,
    maxBuffer: 1_000_000,
  })
  return resultSchema.parse(JSON.parse(stdout))
}

describe('pdfChunkWorker rotation through real Poppler and Tesseract', () => {
  let directory: string | undefined
  let disabled: OcrResult
  let enabled: OcrResult

  beforeAll(async () => {
    // Prerequisites are mandatory: missing binaries, por.traineddata or the font fail setup.
    // execFile completion callbacks subscribe before process execution; no polling or sleeps.
    const { stdout: languages } = await execFileAsync('tesseract', ['--list-langs'])
    expect(languages.split(/\r?\n/).map(line => line.trim())).toContain('por')
    directory = await mkdtemp(path.join(tmpdir(), 'adscombine-rotation-runtime-'))
    const pdfPath = path.join(directory, 'synthetic-scan.pdf')
    await writeFile(pdfPath, await createRotatedScanPdf())
    const { stdout: info } = await execFileAsync('pdfinfo', ['-f', '1', '-l', '2', pdfPath])
    expect(info).toMatch(/Pages:\s+2/)
    expect(info).toMatch(/Page\s+1 rot:\s+0/)
    expect(info).toMatch(/Page\s+2 rot:\s+0/)
    const { stdout: nativeText } = await execFileAsync('pdftotext', [pdfPath, '-'])
    expect(nativeText.trim()).toBe('')
    disabled = await runWorker(pdfPath, false)
    enabled = await runWorker(pdfPath, true)
  }, 150_000)

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  test('recovers sideways raster text when rotation is enabled', () => {
    const baseline = disabled.pages[0]
    const recovered = enabled.pages[0]
    expect(baseline.pageNumber).toBe(1)
    expect(recovered.pageNumber).toBe(1)
    expect(tokenRecall(baseline.text)).toBeLessThan(0.25)
    expect(tokenRecall(recovered.text)).toBeGreaterThanOrEqual(0.95)
    expect(recovered.meanConfidence).toBeGreaterThan(80)
    expect(recovered.meanConfidence - baseline.meanConfidence).toBeGreaterThan(40)
    expect(recovered.wordCount).toBeGreaterThanOrEqual(30)
    expect(recovered.selectedAttempt.label).toBe('rotated')
    expect(recovered.selectedAttempt.rotation?.angle).toBe(90)
    expect(recovered.selectedAttempt.rotation?.scoreGain).toBeGreaterThanOrEqual(8)
  })

  test('preserves upright raster text when rotation is enabled', () => {
    const baseline = disabled.pages[1]
    const preserved = enabled.pages[1]
    expect(preserved.pageNumber).toBe(2)
    expect(tokenRecall(preserved.text)).toBeGreaterThanOrEqual(0.95)
    expect(preserved.text).toBe(baseline.text)
    expect(preserved.meanConfidence).toBe(baseline.meanConfidence)
    expect(preserved.wordCount).toBe(baseline.wordCount)
    expect(preserved.selectedAttempt.rotation).toBeUndefined()
  })
})
