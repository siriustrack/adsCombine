import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import tmp from 'tmp'
import type { OcrPageResult } from './ocr-orchestrator.service'
import {
  acquisitionClauseFromBaseImage,
  unreadAcquisitionClauses,
} from './registry-acquisition-clause'

type Command = (
  command: string,
  args: readonly string[],
  options: { signal: AbortSignal; timeout: number; maxBuffer: number; encoding: 'utf8' }
) => Promise<{ stdout: string }>
type Image = { page: number; kind: string; width: number; height: number }
type ReadBudget = { attempts: number; extractedPages: number; acquisitionAttempts: number }
type CommandOptions = Parameters<Command>[2]
type ReadContext = {
  pdfPath: string
  options: CommandOptions
  budget: ReadBudget
  signal: AbortSignal
  directory(): string
}
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
  const baseImages = images.flatMap((image, index) =>
    image.kind === 'image' &&
    image.width >= 800 &&
    image.height >= 800 &&
    image.width / image.height >= 0.5 &&
    image.width / image.height <= 1.2 &&
    image.width * image.height <= 16 * 1024 * 1024
      ? [index]
      : []
  )
  return { candidates, safeSize, baseImage: baseImages.length === 1 ? baseImages[0] : undefined }
}

/** Preserves observed embedded notices and bounded supplements for unread acquisition verbs. */
export class EmbeddedDocumentNoticeReader {
  constructor(
    private readonly run: Command = (command, args, options) =>
      exec(command, [...args], {
        ...options,
        env: {
          ...process.env,
          OMP_NUM_THREADS: '1',
          OMP_THREAD_LIMIT: '1',
          TESSERACT_NUM_THREADS: '1',
        },
      })
  ) {}

  async read(
    pdfPath: string,
    pages: readonly OcrPageResult[],
    signal: AbortSignal
  ): Promise<OcrPageResult[]> {
    signal.throwIfAborted()
    const needsAcquisition = pages.some(page => unreadAcquisitionClauses(page.text).length > 0)
    const budgetSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(needsAcquisition ? 15000 : 5000),
    ])
    const options = {
      signal: budgetSignal,
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8' as const,
    }
    const output = pages.map(page =>
      unreadAcquisitionClauses(page.text).length
        ? {
            ...page,
            warnings: [...(page.warnings ?? []), 'registry-acquisition-clause-unreadable'],
          }
        : page
    )
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
      const context: ReadContext = {
        pdfPath,
        options,
        budget: { attempts: 0, extractedPages: 0, acquisitionAttempts: 0 },
        signal,
        directory: () => {
          directory ??= tmp.dirSync({ unsafeCleanup: true })
          return directory.name
        },
      }
      for (const [pageIndex, page] of output.entries()) {
        const pageImages = images.filter(image => image.page === page.pageNumber)
        output[pageIndex] = await this.readPage(page, pageImages, context)
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

  private async readPage(
    page: OcrPageResult,
    images: readonly Image[],
    context: ReadContext
  ): Promise<OcrPageResult> {
    const gaps = unreadAcquisitionClauses(page.text)
    const { candidates, safeSize, baseImage } = selectNoticeImages(images)
    const readNotice = candidates.length > 0 && !noticePattern.test(page.text)
    const readClause = gaps.length > 0 && baseImage !== undefined
    if (!readNotice && !readClause) return page
    if (
      !safeSize ||
      context.budget.extractedPages >= 2 ||
      (context.budget.attempts >= 2 && (!readClause || context.budget.acquisitionAttempts >= 1))
    ) {
      return { ...page, warnings: [...(page.warnings ?? []), 'document-notice-budget-exhausted'] }
    }
    const prefix = path.join(context.directory(), `notice-${page.pageNumber}`)
    await this.run(
      'pdfimages',
      [
        '-f',
        String(page.pageNumber),
        '-l',
        String(page.pageNumber),
        '-png',
        context.pdfPath,
        prefix,
      ],
      context.options
    )
    context.budget.extractedPages++
    let result = page
    if (readNotice) {
      const { notice, exhausted } = await this.readNotice(prefix, candidates, context)
      if (notice) {
        result = {
          ...result,
          text: `${result.text}\n\n[Aviso em imagem incorporada - OCR]\n${notice}`,
          wordCount:
            (result.wordCount ?? result.text.trim().split(/\s+/u).length) +
            notice.split(/\s+/u).length,
          warnings: [...(result.warnings ?? []), 'embedded-document-notice'],
        }
      } else if (exhausted) {
        result = {
          ...result,
          warnings: [...(result.warnings ?? []), 'document-notice-budget-exhausted'],
        }
      }
    }
    const gap = gaps[0]
    if (!gap || baseImage === undefined || context.budget.acquisitionAttempts >= 1) return result
    context.budget.acquisitionAttempts++
    return this.recoverAcquisition(
      result,
      {
        gap,
        remainingGaps: gaps.length > 1,
        imagePath: `${prefix}-${String(baseImage).padStart(3, '0')}.png`,
      },
      context
    )
  }

  private async recoverAcquisition(
    page: OcrPageResult,
    recovery: {
      gap: ReturnType<typeof unreadAcquisitionClauses>[number]
      remainingGaps: boolean
      imagePath: string
    },
    context: ReadContext
  ): Promise<OcrPageResult> {
    try {
      const base = await this.run(
        'tesseract',
        [recovery.imagePath, 'stdout', '-l', 'por', '--psm', '6'],
        { ...context.options, timeout: 10000 }
      )
      const clause = acquisitionClauseFromBaseImage(base.stdout, recovery.gap.key)
      if (!clause) return page
      return {
        ...page,
        text: `${page.text.slice(0, recovery.gap.end)}\n\n[Leitura complementar da cláusula aquisitiva ${recovery.gap.key} - imagem-base; leitura principal preservada]\n${clause}\n\n${page.text.slice(recovery.gap.end)}`,
        wordCount:
          (page.wordCount ?? page.text.trim().split(/\s+/u).length) + clause.split(/\s+/u).length,
        warnings: [
          ...(page.warnings ?? []).filter(
            warning =>
              recovery.remainingGaps || warning !== 'registry-acquisition-clause-unreadable'
          ),
          'registry-acquisition-clause-recovered',
        ],
      }
    } catch (error) {
      context.signal.throwIfAborted()
      if (!(error instanceof Error)) throw error
      return page
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
