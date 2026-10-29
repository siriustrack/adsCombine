import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import tmp from 'tmp'
import type { OcrPageResult } from './ocr-orchestrator.service'

type Command = (
  command: string,
  args: readonly string[],
  options: { signal: AbortSignal; timeout: number; maxBuffer: number; encoding: 'utf8' }
) => Promise<{ stdout: string }>
type Image = { page: number; kind: string; width: number; height: number }
type ReadBudget = { attempts: number; extractedPages: number }
type CommandOptions = Parameters<Command>[2]
const exec = promisify(execFile)
const noticePattern = /\bn[aã]o\s+vale\s+como\s+certid[aã]o\b/iu

function selectNoticeImages(images: readonly Image[]) {
  const candidates = images.flatMap((image, index) =>
    image.kind === 'image' &&
    image.width >= 400 &&
    image.width <= 4096 &&
    image.height >= 40 &&
    image.height <= 512 &&
    image.width / image.height >= 3 &&
    image.width * image.height <= 1024 * 1024
      ? [index]
      : []
  )
  const safeSize =
    images.length <= 16 &&
    images.every(image => Number.isFinite(image.width * image.height)) &&
    images.reduce((sum, image) => sum + image.width * image.height, 0) <= 32 * 1024 * 1024
  return { candidates, safeSize }
}

/** Reads small embedded notice strips, not full page images or AI candidates. */
export class EmbeddedDocumentNoticeReader {
  constructor(
    private readonly run: Command = (command, args, options) => exec(command, [...args], options)
  ) {}

  async read(
    pdfPath: string,
    pages: readonly OcrPageResult[],
    signal: AbortSignal
  ): Promise<OcrPageResult[]> {
    signal.throwIfAborted()
    const budgetSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)])
    const options = {
      signal: budgetSignal,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8' as const,
    }
    const output = [...pages]
    let directory: ReturnType<typeof tmp.dirSync> | undefined
    try {
      const listing = await this.run('pdfimages', ['-list', pdfPath], options)
      const images: Image[] = listing.stdout
        .split('\n')
        .filter(line => /^\s*\d+\s+\d+\s/u.test(line))
        .map(line => {
          const fields = line.trim().split(/\s+/u)
          return {
            page: Number(fields[0]),
            kind: fields[2] ?? '',
            width: Number(fields[3]),
            height: Number(fields[4]),
          }
        })
      const budget: ReadBudget = { attempts: 0, extractedPages: 0 }
      for (const [pageIndex, page] of output.entries()) {
        if (noticePattern.test(page.text)) continue
        const pageImages = images.filter(image => image.page === page.pageNumber)
        const { candidates, safeSize } = selectNoticeImages(pageImages)
        if (!candidates.length) continue
        if (!safeSize || budget.attempts >= 2 || budget.extractedPages >= 2) {
          output[pageIndex] = {
            ...page,
            warnings: [...(page.warnings ?? []), 'document-notice-budget-exhausted'],
          }
          continue
        }
        directory ??= tmp.dirSync({ unsafeCleanup: true })
        const prefix = path.join(directory.name, `notice-${page.pageNumber}`)
        await this.run(
          'pdfimages',
          ['-f', String(page.pageNumber), '-l', String(page.pageNumber), '-png', pdfPath, prefix],
          options
        )
        budget.extractedPages++
        const { notice, exhausted } = await this.readNotice(prefix, candidates, { options, budget })
        if (notice) {
          output[pageIndex] = {
            ...page,
            text: `${page.text}\n\n[Aviso em imagem incorporada - OCR]\n${notice}`,
            wordCount:
              (page.wordCount ?? page.text.trim().split(/\s+/u).length) +
              notice.split(/\s+/u).length,
            warnings: [...(page.warnings ?? []), 'embedded-document-notice'],
          }
        } else if (exhausted) {
          output[pageIndex] = {
            ...page,
            warnings: [...(page.warnings ?? []), 'document-notice-budget-exhausted'],
          }
        }
      }
      return output
    } catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof Error)) throw error
      return output.map(page => ({
        ...page,
        warnings: [...(page.warnings ?? []), 'document-notice-read-unavailable'],
      }))
    } finally {
      directory?.removeCallback()
    }
  }

  private async readNotice(
    prefix: string,
    candidates: readonly number[],
    context: { options: CommandOptions; budget: ReadBudget }
  ): Promise<{ notice: string; exhausted: boolean }> {
    let readCandidates = 0
    for (const index of candidates) {
      if (context.budget.attempts >= 2) break
      context.budget.attempts++
      readCandidates++
      const result = await this.run(
        'tesseract',
        [`${prefix}-${String(index).padStart(3, '0')}.png`, 'stdout', '-l', 'por', '--psm', '6'],
        context.options
      )
      const lines = result.stdout
        .split('\n')
        .filter(line => line.length <= 240 && noticePattern.test(line))
        .map(line => line.trim())
      if (lines.length) return { notice: [...new Set(lines)].join('\n'), exhausted: false }
    }
    return { notice: '', exhausted: readCandidates < candidates.length }
  }
}
