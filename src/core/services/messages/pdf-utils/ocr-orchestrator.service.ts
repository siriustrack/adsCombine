// biome-ignore lint/style/noExcessiveLinesPerFile: OCR orchestration paths share temporary-file lifecycle and timeout handling.
import { execFile as execFileCb } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { PROCESSING_TIMEOUTS } from '@config/constants'
import logger from '@lib/logger'
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types'
import { pdfWorkerPool } from '@lib/worker-pool'
import tmp from 'tmp'
import type { EnhancedOcrPageMetadata } from './enhanced-ocr.types'
import type { PageChunk } from './ocr-chunk-manager.service'
import { OcrChunkManager } from './ocr-chunk-manager.service'
import { PdfLimitError } from './process-pdf.types'

export interface OcrProcessingResult {
  ocrText: string
  chunksProcessed: number
  processingTime: number
}

export interface OcrPageResult {
  pageNumber: number
  text: string
  meanConfidence?: number
  wordCount?: number
  selectedAttempt?: EnhancedOcrPageMetadata['selectedAttempt']
  legalSignals?: EnhancedOcrPageMetadata['legalSignals']
  warnings?: string[]
}

export class OcrPageCoverageError extends Error {
  constructor(
    readonly missingPages: number[],
    readonly duplicatePages: number[],
    readonly unexpectedPages: number[]
  ) {
    super('Enhanced OCR did not return every expected page exactly once')
    this.name = 'OcrPageCoverageError'
  }
}

export function validateOcrPageCoverage(
  pages: OcrPageResult[],
  expectedPages: number[]
): OcrPageCoverageError | undefined {
  const expected = new Set(expectedPages)
  const counts = new Map<number, number>()
  for (const page of pages) counts.set(page.pageNumber, (counts.get(page.pageNumber) ?? 0) + 1)
  const missingPages = expectedPages.filter(pageNumber => !counts.has(pageNumber))
  const duplicatePages = [...counts]
    .filter(([, count]) => count > 1)
    .map(([pageNumber]) => pageNumber)
    .sort((left, right) => left - right)
  const unexpectedPages = [...counts.keys()]
    .filter(pageNumber => !expected.has(pageNumber))
    .sort((left, right) => left - right)
  return missingPages.length > 0 || duplicatePages.length > 0 || unexpectedPages.length > 0
    ? new OcrPageCoverageError(missingPages, duplicatePages, unexpectedPages)
    : undefined
}

export function parsePdfinfoVersion(stdout: string, stderr: string): string | undefined {
  return `${stdout}\n${stderr}`.match(/(\d+\.\d+\.\d+)/u)?.[1]
}

export function bindAbortSignal(
  signal: AbortSignal | undefined,
  controller: AbortController
): () => void {
  if (!signal) return () => {}
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) {
    abort()
    return () => {}
  }
  signal.addEventListener('abort', abort, { once: true })
  return () => signal.removeEventListener('abort', abort)
}

export interface OcrPagesProcessingResult {
  pages: OcrPageResult[]
  chunksProcessed: number
  processingTime: number
}

export type EnhancedOcrProcessingResult = OcrPagesProcessingResult & {
  ocrText: string
  totalPages: number
}

export type EnhancedOcrLimits = {
  maxOcrPagesPerPdf?: number
  ocrPageBudget?: {
    reserve(pageCount: number): boolean
    remaining(): number
  }
}

export type EnhancedOcrProcessingOptions = EnhancedOcrLimits & {
  buffer: Buffer
  totalPages: number
  fileId: string
  signal?: AbortSignal
}

export function validateEnhancedOcrLimits(
  actualPageCount: number,
  limits: EnhancedOcrLimits
): PdfLimitError | undefined {
  if (limits.maxOcrPagesPerPdf && actualPageCount > limits.maxOcrPagesPerPdf) {
    return new PdfLimitError(
      'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED',
      `PDF requer OCR em ${actualPageCount} páginas, acima do limite configurado de ${limits.maxOcrPagesPerPdf}.`
    )
  }

  if (limits.ocrPageBudget && !limits.ocrPageBudget.reserve(actualPageCount)) {
    return new PdfLimitError(
      'OCR_PAGES_PER_JOB_LIMIT_EXCEEDED',
      `PDF requer OCR em ${actualPageCount} páginas, mas restam ${limits.ocrPageBudget.remaining()} páginas de OCR no limite deste job.`
    )
  }

  return undefined
}

type OcrPageProcessingOptions = {
  buffer: Buffer
  totalPages: number
  fileId: string
  pageNumbers: number[]
}

type OcrChunkProcessingOptions = {
  chunks: PageChunk[]
  pdfPath: string
  fileId: string
  totalPages: number
  enhancedOcr?: boolean
  signal?: AbortSignal
}

export class OcrOrchestrator {
  private readonly chunkManager = new OcrChunkManager()
  private readonly execFile = promisify(execFileCb)

  static async checkPdfinfo(): Promise<{ available: boolean; version?: string }> {
    try {
      const execAsync = promisify(execFileCb)
      const { stdout, stderr } = await execAsync('pdfinfo', ['-v'], { timeout: 5_000 })
      return { available: true, version: parsePdfinfoVersion(stdout, stderr) }
    } catch {
      return { available: false }
    }
  }

  private async validatePdfStructure(
    pdfPath: string,
    fileId: string
  ): Promise<{ valid: boolean; pageCount: number }> {
    try {
      const { stdout } = await this.execFile('pdfinfo', [pdfPath], {
        timeout: 10_000,
      })
      const pagesMatch = stdout.match(/Pages:\s+(\d+)/)
      const pageCount = pagesMatch ? parseInt(pagesMatch[1], 10) : 0
      return { valid: pageCount > 0, pageCount }
    } catch (error) {
      logger.warn('PDF structure validation failed (pdfinfo)', {
        fileId,
        error: (error as Error).message,
      })
      return { valid: false, pageCount: 0 }
    }
  }

  async processWithOcr(
    buffer: Buffer,
    totalPages: number,
    fileId: string
  ): Promise<Result<OcrProcessingResult, Error>> {
    const startTime = Date.now()

    if (totalPages === 0) {
      logger.warn('No pages to process with OCR', { fileId })
      return okResult({
        ocrText: '',
        chunksProcessed: 0,
        processingTime: Date.now() - startTime,
      })
    }

    // Criar arquivo temporário antes de validar
    const tempPdf = tmp.fileSync({ postfix: '.pdf' })

    try {
      await fs.promises.writeFile(tempPdf.name, buffer)

      // Validar estrutura do PDF com poppler (mesmo engine do pdftoppm)
      const validation = await this.validatePdfStructure(tempPdf.name, fileId)

      if (!validation.valid) {
        logger.warn('PDF failed poppler structure validation, skipping OCR', {
          fileId,
          declaredPages: totalPages,
          popplerPages: validation.pageCount,
        })
        return okResult({
          ocrText: '',
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
        })
      }

      // Usar page count validado (poppler é autoritativo para pdftoppm)
      const effectivePages = validation.pageCount
      if (effectivePages !== totalPages) {
        logger.warn('Page count mismatch: pdf-parse vs pdfinfo', {
          fileId,
          pdfParsePages: totalPages,
          pdfInfoPages: effectivePages,
        })
      }

      // Criar chunks com page count validado
      const chunks = this.chunkManager.createProcessingChunks(effectivePages, fileId)

      if (chunks.length === 0) {
        return okResult({
          ocrText: '',
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
        })
      }

      // Processar chunks em paralelo
      const { value: ocrResults, error: ocrError } = await this.processChunksInParallel({
        chunks,
        pdfPath: tempPdf.name,
        fileId,
        totalPages: effectivePages,
      })

      if (ocrError) {
        return errResult(ocrError)
      }

      // Processar resultados
      const ocrText = ocrResults.join('\n')
      const processingTime = Date.now() - startTime

      logger.debug('OCR processing completed', {
        fileId,
        totalPages: effectivePages,
        chunksProcessed: chunks.length,
        ocrTextLength: ocrText.length,
        processingTime,
      })

      return okResult({
        ocrText,
        chunksProcessed: chunks.length,
        processingTime,
      })
    } finally {
      // Limpar arquivo temporário
      if (tempPdf) {
        try {
          tempPdf.removeCallback()
        } catch (error) {
          logger.warn('Failed to cleanup temporary PDF file', {
            fileId,
            tempFile: tempPdf.name,
            error: (error as Error).message,
          })
        }
      }
    }
  }

  async processPagesWithOcr({
    buffer,
    totalPages,
    fileId,
    pageNumbers,
  }: OcrPageProcessingOptions): Promise<Result<OcrPagesProcessingResult, Error>> {
    const startTime = Date.now()
    const selectedPages = [...new Set(pageNumbers)].filter(page => page >= 1).sort((a, b) => a - b)

    if (selectedPages.length === 0) {
      return okResult({ pages: [], chunksProcessed: 0, processingTime: Date.now() - startTime })
    }

    const tempPdf = tmp.fileSync({ postfix: '.pdf' })

    try {
      await fs.promises.writeFile(tempPdf.name, buffer)
      const validation = await this.validatePdfStructure(tempPdf.name, fileId)

      if (!validation.valid) {
        logger.warn('PDF failed poppler structure validation, skipping selected-page OCR', {
          fileId,
          declaredPages: totalPages,
          popplerPages: validation.pageCount,
        })
        return okResult({ pages: [], chunksProcessed: 0, processingTime: Date.now() - startTime })
      }

      const effectivePages = validation.pageCount
      const validSelectedPages = selectedPages.filter(page => page <= effectivePages)
      const chunks = this.chunkManager.createProcessingChunksForPages(validSelectedPages, fileId)

      const { value: pages, error } = await this.processPageChunksInParallel({
        chunks,
        pdfPath: tempPdf.name,
        fileId,
        totalPages: effectivePages,
      })

      if (error) {
        return errResult(error)
      }

      const processingTime = Date.now() - startTime

      logger.debug('Selected-page OCR processing completed', {
        fileId,
        totalPages: effectivePages,
        selectedPages: validSelectedPages.length,
        chunksProcessed: chunks.length,
        processingTime,
      })

      return okResult({
        pages: pages.sort((a, b) => a.pageNumber - b.pageNumber),
        chunksProcessed: chunks.length,
        processingTime,
      })
    } finally {
      try {
        tempPdf.removeCallback()
      } catch (error) {
        logger.warn('Failed to cleanup temporary PDF file', {
          fileId,
          tempFile: tempPdf.name,
          error: (error as Error).message,
        })
      }
    }
  }

  async processWithEnhancedOcr({
    buffer,
    totalPages,
    fileId,
    signal,
    ...limits
  }: EnhancedOcrProcessingOptions): Promise<Result<EnhancedOcrProcessingResult, Error>> {
    const startTime = Date.now()
    if (totalPages === 0) {
      return okResult({
        pages: [],
        ocrText: '',
        totalPages: 0,
        chunksProcessed: 0,
        processingTime: 0,
      })
    }

    const tempPdf = tmp.fileSync({ postfix: '.pdf' })
    try {
      await fs.promises.writeFile(tempPdf.name, buffer)
      const validation = await this.validatePdfStructure(tempPdf.name, fileId)
      if (!validation.valid) {
        return okResult({
          pages: [],
          ocrText: '',
          totalPages: validation.pageCount,
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
        })
      }

      const limitError = validateEnhancedOcrLimits(validation.pageCount, limits)
      if (limitError) return errResult(limitError)

      const chunks = this.chunkManager.createProcessingChunks(validation.pageCount, fileId)
      const { value: pages, error } = await this.processEnhancedChunksInParallel({
        chunks,
        pdfPath: tempPdf.name,
        fileId,
        totalPages: validation.pageCount,
        enhancedOcr: true,
        signal,
      })
      if (error) return errResult(error)

      const expectedPages = Array.from({ length: validation.pageCount }, (_, index) => index + 1)
      const coverageError = validateOcrPageCoverage(pages, expectedPages)
      if (coverageError) return errResult(coverageError)
      const orderedPages = pages.sort((a, b) => a.pageNumber - b.pageNumber)
      return okResult({
        pages: orderedPages,
        ocrText: orderedPages.map(page => page.text).join('\n\n'),
        totalPages: validation.pageCount,
        chunksProcessed: chunks.length,
        processingTime: Date.now() - startTime,
      })
    } finally {
      try {
        tempPdf.removeCallback()
      } catch (error) {
        logger.warn('Failed to cleanup temporary PDF file', {
          fileId,
          tempFile: tempPdf.name,
          error: (error as Error).message,
        })
      }
    }
  }

  private async processChunksInParallel({
    chunks,
    pdfPath,
    fileId,
    totalPages,
  }: OcrChunkProcessingOptions): Promise<Result<string[], Error>> {
    const { promise: timeoutPromise, timer } = this.createTimeoutPromise(
      PROCESSING_TIMEOUTS.PDF_GLOBAL
    )

    const ocrPromise = Promise.all(
      chunks.map(async (chunk, index) => {
        const chunkStartTime = Date.now()

        try {
          const result = await pdfWorkerPool.run({
            pageRange: chunk,
            pdfPath,
            fileId,
            totalPages,
          })

          const chunkDuration = Date.now() - chunkStartTime
          logger.debug('Chunk processed successfully', {
            fileId,
            chunkIndex: index,
            pageRange: `${chunk.first}-${chunk.last}`,
            chunkDuration,
            resultLength:
              typeof result === 'string'
                ? result.length
                : Array.isArray(result)
                  ? result.join('').length
                  : 0,
          })

          return result
        } catch (error) {
          const chunkDuration = Date.now() - chunkStartTime
          logger.error('Chunk OCR failed', {
            fileId,
            chunkIndex: index,
            pageRange: `${chunk.first}-${chunk.last}`,
            chunkDuration,
            error: (error as Error).message,
          })
          throw error
        }
      })
    )

    const { value: ocrResults, error: ocrError } = await wrapPromiseResult<string[], Error>(
      Promise.race([ocrPromise, timeoutPromise]).finally(() => clearTimeout(timer))
    )

    if (ocrError) {
      logger.error('Error in OCR processing', {
        fileId,
        error: ocrError.message,
        chunksCount: chunks.length,
      })
      return errResult(new Error(`Erro no processamento OCR: ${ocrError.message}`))
    }

    return okResult(ocrResults)
  }

  private async processPageChunksInParallel({
    chunks,
    pdfPath,
    fileId,
    totalPages,
  }: OcrChunkProcessingOptions): Promise<Result<OcrPageResult[], Error>> {
    const { promise: timeoutPromise, timer } = this.createTimeoutPromise(
      PROCESSING_TIMEOUTS.PDF_GLOBAL
    )

    const ocrPromise = Promise.all(
      chunks.map(async chunk => {
        const result = await pdfWorkerPool.run({
          pageRange: chunk,
          pdfPath,
          fileId,
          totalPages,
          structuredPages: true,
        })

        return Array.isArray(result?.pages) ? (result.pages as OcrPageResult[]) : []
      })
    )

    const { value: chunkResults, error } = await wrapPromiseResult<OcrPageResult[][], Error>(
      Promise.race([ocrPromise, timeoutPromise]).finally(() => clearTimeout(timer))
    )

    if (error) {
      logger.error('Error in selected-page OCR processing', {
        fileId,
        error: error.message,
        chunksCount: chunks.length,
      })
      return errResult(new Error(`Erro no processamento OCR: ${error.message}`))
    }

    return okResult(chunkResults.flat())
  }

  private async processEnhancedChunksInParallel({
    chunks,
    pdfPath,
    fileId,
    totalPages,
    signal,
  }: OcrChunkProcessingOptions): Promise<Result<OcrPageResult[], Error>> {
    const controller = new AbortController()
    const unbindAbortSignal = bindAbortSignal(signal, controller)
    const timer = setTimeout(
      () => controller.abort(new Error('Enhanced OCR processing timed out')),
      PROCESSING_TIMEOUTS.PDF_GLOBAL
    )
    const ocrPromise = Promise.all(
      chunks.map(async chunk => {
        const result = await pdfWorkerPool.run(
          {
            pageRange: chunk,
            pdfPath,
            fileId,
            totalPages,
            structuredPages: true,
            enhancedOcr: true,
          },
          { signal: controller.signal }
        )
        return Array.isArray(result?.pages) ? (result.pages as OcrPageResult[]) : []
      })
    )
    const { value: chunkResults, error } = await wrapPromiseResult<OcrPageResult[][], Error>(
      ocrPromise.finally(() => {
        clearTimeout(timer)
        unbindAbortSignal()
      })
    )
    if (error) {
      logger.error('Error in enhanced OCR processing', {
        fileId,
        error: error.message,
        chunksCount: chunks.length,
      })
      return errResult(new Error(`Erro no processamento OCR: ${error.message}`))
    }
    return okResult(chunkResults.flat())
  }

  private createTimeoutPromise(timeout: number): {
    promise: Promise<never>
    timer: ReturnType<typeof setTimeout>
  } {
    const timeoutInMinutes = timeout / 60000
    let timer!: ReturnType<typeof setTimeout>

    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`OCR processing timed out after ${timeoutInMinutes} minutes`)),
        timeout
      )
    })

    return { promise, timer }
  }
}
