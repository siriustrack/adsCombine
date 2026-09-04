// biome-ignore lint/style/noExcessiveLinesPerFile: PDF processing paths are intentionally kept together to share download, extraction, limits, and OCR fallbacks.
import { env } from '@config/env'
import logger from '@lib/logger'
import { redactUrl } from '@lib/redact-url'
import { errResult, okResult, type Result } from '@lib/result.types'
import { sanitizePdfText } from 'utils/sanitize'
import type { FileInput } from '../process-messages.service'
import { FileDownloadService } from './file-download.service'
import { OcrOrchestrator } from './ocr-orchestrator.service'
import type { PdfPageText } from './pdf-text-extractor.service'
import { PdfTextExtractorService } from './pdf-text-extractor.service'
import { PdfLimitError, type ProcessPdfOptions } from './process-pdf.types'
import {
  combineTextResults,
  createMixedPageDiagnostics,
  logMixedPageDiagnostics,
  logOcrDecision,
  normalizePages,
  shouldBypassOcr,
  shouldOcrPage,
  shouldPreferNativePdfTextOverOcr,
  shouldUseDirectOcrForSmallImageOnlyPdf,
  validatePdfPageLimit,
} from './process-pdf-helpers'
import { TextQualityAnalyzer } from './text-quality-analyzer.service'

export class ProcessPdfService {
  // biome-ignore lint/complexity/useMaxParams: constructor injection keeps PDF dependencies replaceable in focused tests.
  constructor(
    private readonly fileDownloadService = new FileDownloadService(),
    private readonly textExtractorService: Pick<
      PdfTextExtractorService,
      'extractTextFromPdf'
    > = new PdfTextExtractorService(),
    private readonly textQualityAnalyzer = new TextQualityAnalyzer(),
    private readonly ocrOrchestrator: Pick<
      OcrOrchestrator,
      'processWithOcr' | 'processPagesWithOcr' | 'processWithEnhancedOcr'
    > = new OcrOrchestrator()
  ) {}

  async execute(file: FileInput, options: ProcessPdfOptions = {}): Promise<Result<string, Error>> {
    const { fileId, url } = file

    logger.debug('Starting PDF processing', { fileId, url: redactUrl(url) })

    // 1. Download do arquivo
    const downloadStartedAt = Date.now()
    logger.debug('Downloading PDF file', { fileId, url: redactUrl(url) })

    const { value: downloadedFile, error: downloadError } =
      await this.fileDownloadService.downloadFile(url, fileId, { maxBytes: options.maxFileBytes })

    if (downloadError) {
      return errResult(downloadError)
    }

    logger.debug('PDF file downloaded', {
      fileId,
      bytes: downloadedFile.buffer.byteLength,
      contentLength: downloadedFile.contentLength,
      durationMs: Date.now() - downloadStartedAt,
    })

    // 2. Extração de texto direto
    const nativeExtractionStartedAt = Date.now()
    logger.debug('Extracting native text from PDF', {
      fileId,
      bytes: downloadedFile.buffer.byteLength,
    })

    const { value: textData, error: extractionError } =
      await this.textExtractorService.extractTextFromPdf(downloadedFile.buffer, fileId, {
        includePageVisualMetadata: options.mode === 'mixed-page',
      })

    if (extractionError) {
      logger.error('Error extracting text from PDF', {
        fileId,
        error: extractionError.message,
      })
      return errResult(new Error(`Erro ao extrair texto do PDF: ${extractionError.message}`))
    }

    logger.debug('Native PDF extraction completed', {
      fileId,
      totalPages: textData.totalPages,
      textLength: textData.text.length,
      durationMs: Date.now() - nativeExtractionStartedAt,
    })

    const { text: extractedText, totalPages } = textData

    const pageLimitError = validatePdfPageLimit(totalPages, options.maxPdfPages)
    if (pageLimitError) {
      return errResult(pageLimitError)
    }

    if (options.mode === 'mixed-page') {
      return this.processMixedPagePdf({ buffer: downloadedFile.buffer, textData, fileId, options })
    }

    if (options.mode === 'enhanced') {
      return this.processEnhancedPdf({
        buffer: downloadedFile.buffer,
        extractedText,
        totalPages,
        fileId,
        options,
        onEnhancedMetadata: options.onEnhancedMetadata,
      })
    }

    return this.processLegacyPdf({
      buffer: downloadedFile.buffer,
      extractedText,
      totalPages,
      fileId,
    })
  }

  async executeEnhanced(file: FileInput, options: Omit<ProcessPdfOptions, 'mode'> = {}) {
    return this.execute(file, { ...options, mode: 'enhanced' })
  }

  private async processEnhancedPdf({
    buffer,
    extractedText,
    totalPages,
    fileId,
    options,
    onEnhancedMetadata,
  }: {
    buffer: Buffer
    extractedText: string
    totalPages: number
    fileId: string
    options: ProcessPdfOptions
    onEnhancedMetadata?: ProcessPdfOptions['onEnhancedMetadata']
  }): Promise<Result<string, Error>> {
    if (totalPages === 0) return okResult(sanitizePdfText(extractedText))

    const { value: ocrResult, error } = await this.ocrOrchestrator.processWithEnhancedOcr({
      buffer,
      totalPages,
      fileId,
      maxOcrPagesPerPdf: options.maxOcrPagesPerPdf,
      ocrPageBudget: options.ocrPageBudget,
    })
    if (error) {
      if (error instanceof PdfLimitError) return errResult(error)
      return extractedText.trim().length > 0
        ? okResult(sanitizePdfText(extractedText))
        : errResult(error)
    }
    if (!ocrResult.ocrText.trim() && extractedText.trim().length > 0) {
      return okResult(sanitizePdfText(extractedText))
    }

    logger.debug('Enhanced all-page OCR completed', {
      fileId,
      totalPages,
      chunksProcessed: ocrResult.chunksProcessed,
      processingTime: ocrResult.processingTime,
      pages: ocrResult.pages.map(page => ({
        pageNumber: page.pageNumber,
        meanConfidence: page.meanConfidence,
        wordCount: page.wordCount,
        selectedAttempt: page.selectedAttempt,
        legalSignals: page.legalSignals,
        warnings: page.warnings,
      })),
    })
    const pagesByNumber = new Map(ocrResult.pages.map(page => [page.pageNumber, page]))
    onEnhancedMetadata?.({
      fileId,
      pageQuality: Array.from({ length: ocrResult.totalPages }, (_, index) => {
        const pageNumber = index + 1
        const page = pagesByNumber.get(pageNumber)
        const noTextWarning = !page?.text.trim() ? ['no-text-detected'] : []
        const warnings = [...new Set([...(page?.warnings ?? []), ...noTextWarning])]

        return {
          pageNumber,
          qualityScore: page?.meanConfidence ?? 0,
          confidence: page?.meanConfidence ?? 0,
          classification: warnings.length > 0 ? 'ocr-warning' : 'ocr-selected',
          shouldOcr: true,
          ocrDecisionReason: page?.selectedAttempt?.label,
          wordCount: page?.wordCount ?? 0,
          selectedAttempt: page?.selectedAttempt,
          legalSignals: page?.legalSignals,
          warnings,
        }
      }),
    })
    return okResult(combineTextResults(ocrResult.ocrText, fileId, ocrResult))
  }

  private processLegacyPdf({
    buffer,
    extractedText,
    totalPages,
    fileId,
  }: {
    buffer: Buffer
    extractedText: string
    totalPages: number
    fileId: string
  }): Promise<Result<string, Error>> | Result<string, Error> {
    const qualityAnalysis = this.textQualityAnalyzer.analyze(extractedText)

    logger.debug('Text quality analysis completed', {
      fileId,
      textLength: extractedText.length,
      totalPages,
      qualityAnalysis,
    })

    const ocrAlwaysThreshold = env.PDF_OCR_ALWAYS_THRESHOLD
    const { charsPerPage, hasStrongDirectText, shouldSkipOcr } = shouldBypassOcr({
      extractedText,
      totalPages,
      qualityAnalysis,
    })

    logOcrDecision({
      fileId,
      extractedText,
      totalPages,
      qualityAnalysis,
      charsPerPage,
      hasStrongDirectText,
      ocrAlwaysThreshold,
    })

    if (totalPages === 0) {
      logger.warn('No pages found in PDF', { fileId })
      return okResult(sanitizePdfText(extractedText))
    }

    if (totalPages <= ocrAlwaysThreshold) {
      logger.debug('Running OCR - document within always-OCR threshold', {
        fileId,
        totalPages,
        ocrAlwaysThreshold,
      })
    } else if (shouldSkipOcr) {
      if (hasStrongDirectText && qualityAnalysis.hasOcrIndicators) {
        const bytesPerPage = buffer.byteLength / totalPages
        const looksLikeScannedDoc = bytesPerPage > env.PDF_BYTES_PER_PAGE_THRESHOLD

        logger.debug('PDF file-size heuristic', {
          fileId,
          totalBytes: buffer.byteLength,
          totalPages,
          bytesPerPage: Math.round(bytesPerPage),
          bytesPerPageThreshold: env.PDF_BYTES_PER_PAGE_THRESHOLD,
          looksLikeScannedDoc,
        })

        if (looksLikeScannedDoc) {
          logger.debug('Running OCR - file size suggests scanned/image content', {
            fileId,
            bytesPerPage: Math.round(bytesPerPage),
          })
        } else {
          logger.debug('Skipping OCR - file size consistent with digital text', {
            fileId,
            totalPages,
            charsPerPage: Math.round(charsPerPage),
            bytesPerPage: Math.round(bytesPerPage),
            reason: 'filesize-validated',
          })
          return okResult(sanitizePdfText(extractedText))
        }
      } else {
        logger.debug('Skipping OCR - text quality is sufficient', {
          fileId,
          totalPages,
          charsPerPage: Math.round(charsPerPage),
          reason: hasStrongDirectText ? 'strong-direct-text' : 'quality-analysis',
        })
        return okResult(sanitizePdfText(extractedText))
      }
    }

    logger.debug('Starting OCR processing', {
      fileId,
      totalPages,
      qualityScore: qualityAnalysis.qualityScore,
      extractedTextLength: extractedText.length,
    })

    return this.runOcrWithFallback({ buffer, totalPages, fileId, extractedText })
  }

  private async processMixedPagePdf({
    buffer,
    textData,
    fileId,
    options,
  }: {
    buffer: Buffer
    textData: { text: string; totalPages: number; pages: PdfPageText[] }
    fileId: string
    options: ProcessPdfOptions
  }): Promise<Result<string, Error>> {
    if (shouldUseDirectOcrForSmallImageOnlyPdf(textData)) {
      const directOcrPageCount = textData.totalPages

      if (options.maxOcrPagesPerPdf && directOcrPageCount > options.maxOcrPagesPerPdf) {
        return errResult(
          new PdfLimitError(
            'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED',
            `PDF requer OCR em ${directOcrPageCount} páginas, acima do limite configurado de ${options.maxOcrPagesPerPdf}.`
          )
        )
      }

      if (options.ocrPageBudget && !options.ocrPageBudget.reserve(directOcrPageCount)) {
        return errResult(
          new PdfLimitError(
            'OCR_PAGES_PER_JOB_LIMIT_EXCEEDED',
            `PDF requer OCR em ${directOcrPageCount} páginas, mas restam ${options.ocrPageBudget.remaining()} páginas de OCR no limite deste job.`
          )
        )
      }

      logger.debug('Running direct OCR - small PDF has insufficient native text', {
        fileId,
        totalPages: textData.totalPages,
        nativeCharsPerPage: Math.round(textData.text.trim().length / textData.totalPages),
        directOcrMaxPages: env.MIXED_PAGE_OCR_DIRECT_MAX_PAGES,
        minNativeCharsPerPage: env.MIXED_PAGE_MIN_NATIVE_CHARS_PER_PAGE,
      })
      return this.runOcrWithFallback({
        buffer,
        totalPages: textData.totalPages,
        fileId,
        extractedText: textData.text,
      })
    }

    const pages = normalizePages(textData)
    const pageDiagnostics = pages.map(page =>
      createMixedPageDiagnostics(this.textQualityAnalyzer, page)
    )
    const pagesToOcr = pages.filter(page => shouldOcrPage(this.textQualityAnalyzer, page))

    logMixedPageDiagnostics(fileId, textData.totalPages, pageDiagnostics)

    if (options.maxOcrPagesPerPdf && pagesToOcr.length > options.maxOcrPagesPerPdf) {
      return errResult(
        new PdfLimitError(
          'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED',
          `PDF requer OCR em ${pagesToOcr.length} páginas, acima do limite configurado de ${options.maxOcrPagesPerPdf}.`
        )
      )
    }

    if (options.ocrPageBudget && !options.ocrPageBudget.reserve(pagesToOcr.length)) {
      return errResult(
        new PdfLimitError(
          'OCR_PAGES_PER_JOB_LIMIT_EXCEEDED',
          `PDF requer OCR em ${pagesToOcr.length} páginas, mas restam ${options.ocrPageBudget.remaining()} páginas de OCR no limite deste job.`
        )
      )
    }

    if (pagesToOcr.length === 0) {
      logger.debug('Skipping OCR - all pages have sufficient native text', {
        fileId,
        totalPages: textData.totalPages,
      })
      return okResult(sanitizePdfText(pages.map(page => page.text).join('\n\n')))
    }

    const { value: ocrResult, error } = await this.ocrOrchestrator.processPagesWithOcr({
      buffer,
      totalPages: textData.totalPages,
      fileId,
      pageNumbers: pagesToOcr.map(page => page.pageNumber),
    })

    if (error) {
      const nativeText = textData.text.trim()
      if (nativeText.length > 0) {
        return okResult(sanitizePdfText(nativeText))
      }

      return errResult(error)
    }

    const ocrByPage = new Map(ocrResult.pages.map(page => [page.pageNumber, page.text]))
    const mergedText = pages
      .map(page => {
        const ocrText = ocrByPage.get(page.pageNumber)?.trim()
        return ocrText || page.text
      })
      .filter(text => text.trim().length > 0)
      .join('\n\n')

    logger.debug('Mixed-page PDF processing completed', {
      fileId,
      totalPages: textData.totalPages,
      nativePages: pages.length - pagesToOcr.length,
      ocrPages: pagesToOcr.length,
      chunksProcessed: ocrResult.chunksProcessed,
      processingTime: ocrResult.processingTime,
    })

    return okResult(sanitizePdfText(mergedText))
  }

  private async runOcrWithFallback({
    buffer,
    totalPages,
    fileId,
    extractedText,
  }: {
    buffer: Buffer
    totalPages: number
    fileId: string
    extractedText: string
  }): Promise<Result<string, Error>> {
    const { value: ocrResult, error: ocrError } = await this.ocrOrchestrator.processWithOcr(
      buffer,
      totalPages,
      fileId
    )

    if (ocrError) {
      logger.error('OCR processing failed', { fileId, error: ocrError.message })

      if (extractedText.trim().length > 0) {
        logger.debug('OCR failed, falling back to direct text extraction', {
          fileId,
          extractedTextLength: extractedText.length,
        })
        return okResult(sanitizePdfText(extractedText))
      }

      return errResult(ocrError)
    }

    if (!ocrResult.ocrText.trim() && extractedText.trim().length > 0) {
      logger.debug('OCR produced no text, using direct extraction as fallback', {
        fileId,
        chunksProcessed: ocrResult.chunksProcessed,
        extractedTextLength: extractedText.length,
      })
      return okResult(sanitizePdfText(extractedText))
    }

    if (
      extractedText.trim().length > 0 &&
      shouldPreferNativePdfTextOverOcr({ nativeText: extractedText, ocrText: ocrResult.ocrText })
    ) {
      logger.debug('Using native PDF text because OCR dropped legal amendment markers', {
        fileId,
        extractedTextLength: extractedText.length,
        ocrTextLength: ocrResult.ocrText.length,
      })
      return okResult(sanitizePdfText(extractedText))
    }

    return okResult(combineTextResults(ocrResult.ocrText, fileId, ocrResult))
  }
}
