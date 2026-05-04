import { env } from '@config/env';
import logger from '@lib/logger';
import { errResult, okResult, type Result } from '@lib/result.types';
import { sanitize } from 'utils/sanitize';
import type { FileInput } from '../process-messages.service';
import { FileDownloadService } from './file-download.service';
import { OcrOrchestrator } from './ocr-orchestrator.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { TextQualityAnalyzer } from './text-quality-analyzer.service';

type ProcessPdfOptions = {
  maxFileBytes?: number;
  mode?: 'legacy' | 'mixed-page';
  maxPdfPages?: number;
  maxOcrPagesPerPdf?: number;
  ocrPageBudget?: {
    reserve(pageCount: number): boolean;
    remaining(): number;
  };
};

class PdfLimitError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PdfLimitError';
  }
}

export class ProcessPdfService {
  private readonly fileDownloadService = new FileDownloadService();
  private readonly textExtractorService = new PdfTextExtractorService();
  private readonly textQualityAnalyzer = new TextQualityAnalyzer();
  private readonly ocrOrchestrator = new OcrOrchestrator();

  private shouldBypassOcr({
    extractedText,
    totalPages,
    qualityAnalysis,
  }: {
    extractedText: string;
    totalPages: number;
    qualityAnalysis: ReturnType<TextQualityAnalyzer['analyze']>;
  }) {
    const pages = Math.max(1, totalPages || 0);
    const charsPerPage = extractedText.length / pages;
    const minCharsPerPage = pages <= 1 ? 300 : pages === 2 ? 650 : 900;
    const hasStrongDirectText =
      qualityAnalysis.isHighQuality &&
      qualityAnalysis.hasSubstantialContent &&
      !qualityAnalysis.isRepetitive &&
      charsPerPage >= minCharsPerPage &&
      extractedText.length >= 8000;

    return {
      charsPerPage,
      hasStrongDirectText,
      shouldSkipOcr:
        hasStrongDirectText || (qualityAnalysis.shouldSkipOcr && charsPerPage >= minCharsPerPage),
    };
  }

  private logOcrDecision({
    fileId,
    extractedText,
    totalPages,
    qualityAnalysis,
    charsPerPage,
    hasStrongDirectText,
    ocrAlwaysThreshold,
  }: {
    fileId: string;
    extractedText: string;
    totalPages: number;
    qualityAnalysis: ReturnType<TextQualityAnalyzer['analyze']>;
    charsPerPage: number;
    hasStrongDirectText: boolean;
    ocrAlwaysThreshold: number;
  }) {
    logger.info('PDF OCR decision evaluated', {
      fileId,
      totalPages,
      textLength: extractedText.length,
      charsPerPage: Math.round(charsPerPage),
      ocrAlwaysThreshold,
      hasStrongDirectText,
      shouldSkipOcr: qualityAnalysis.shouldSkipOcr,
      isHighQuality: qualityAnalysis.isHighQuality,
      isRepetitive: qualityAnalysis.isRepetitive,
      hasOcrIndicators: qualityAnalysis.hasOcrIndicators,
      hasSubstantialContent: qualityAnalysis.hasSubstantialContent,
      qualityScore: qualityAnalysis.qualityScore,
    });
  }

  async execute(
    file: FileInput,
    options: ProcessPdfOptions = {}
  ): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    logger.info('Starting PDF processing', { fileId, url });

    // 1. Download do arquivo
    const { value: downloadedFile, error: downloadError } =
      await this.fileDownloadService.downloadFile(url, fileId, { maxBytes: options.maxFileBytes });

    if (downloadError) {
      return errResult(downloadError);
    }

    // 2. Extração de texto direto
    const { value: textData, error: extractionError } =
      await this.textExtractorService.extractTextFromPdf(downloadedFile.buffer, fileId);

    if (extractionError) {
      logger.error('Error extracting text from PDF', {
        fileId,
        error: extractionError.message,
      });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${extractionError.message}`));
    }

    const { text: extractedText, totalPages } = textData;

    const pageLimitError = this.validatePdfPageLimit(totalPages, options.maxPdfPages);
    if (pageLimitError) {
      return errResult(pageLimitError);
    }

    if (options.mode === 'mixed-page') {
      return this.processMixedPagePdf(downloadedFile.buffer, textData, fileId, options);
    }

    return this.processLegacyPdf(downloadedFile.buffer, extractedText, totalPages, fileId);
  }

  private processLegacyPdf(
    buffer: Buffer,
    extractedText: string,
    totalPages: number,
    fileId: string
  ): Promise<Result<string, Error>> | Result<string, Error> {
    const qualityAnalysis = this.textQualityAnalyzer.analyze(extractedText);

    logger.debug('Text quality analysis completed', {
      fileId,
      textLength: extractedText.length,
      totalPages,
      qualityAnalysis,
    });

    const ocrAlwaysThreshold = env.PDF_OCR_ALWAYS_THRESHOLD;
    const { charsPerPage, hasStrongDirectText, shouldSkipOcr } = this.shouldBypassOcr({
      extractedText,
      totalPages,
      qualityAnalysis,
    });

    this.logOcrDecision({
      fileId,
      extractedText,
      totalPages,
      qualityAnalysis,
      charsPerPage,
      hasStrongDirectText,
      ocrAlwaysThreshold,
    });

    if (totalPages === 0) {
      logger.warn('No pages found in PDF', { fileId });
      return okResult(sanitize(extractedText));
    }

    if (totalPages <= ocrAlwaysThreshold) {
      logger.info('Running OCR - document within always-OCR threshold', {
        fileId,
        totalPages,
        ocrAlwaysThreshold,
      });
    } else if (shouldSkipOcr) {
      if (hasStrongDirectText && qualityAnalysis.hasOcrIndicators) {
        const bytesPerPage = buffer.byteLength / totalPages;
        const looksLikeScannedDoc = bytesPerPage > env.PDF_BYTES_PER_PAGE_THRESHOLD;

        logger.info('PDF file-size heuristic', {
          fileId,
          totalBytes: buffer.byteLength,
          totalPages,
          bytesPerPage: Math.round(bytesPerPage),
          bytesPerPageThreshold: env.PDF_BYTES_PER_PAGE_THRESHOLD,
          looksLikeScannedDoc,
        });

        if (looksLikeScannedDoc) {
          logger.info('Running OCR - file size suggests scanned/image content', {
            fileId,
            bytesPerPage: Math.round(bytesPerPage),
          });
        } else {
          logger.info('Skipping OCR - file size consistent with digital text', {
            fileId,
            totalPages,
            charsPerPage: Math.round(charsPerPage),
            bytesPerPage: Math.round(bytesPerPage),
            reason: 'filesize-validated',
          });
          return okResult(sanitize(extractedText));
        }
      } else {
        logger.info('Skipping OCR - text quality is sufficient', {
          fileId,
          totalPages,
          charsPerPage: Math.round(charsPerPage),
          reason: hasStrongDirectText ? 'strong-direct-text' : 'quality-analysis',
        });
        return okResult(sanitize(extractedText));
      }
    }

    logger.info('Starting OCR processing', {
      fileId,
      totalPages,
      qualityScore: qualityAnalysis.qualityScore,
      extractedTextLength: extractedText.length,
    });

    return this.runOcrWithFallback(buffer, totalPages, fileId, extractedText);
  }

  private async processMixedPagePdf(
    buffer: Buffer,
    textData: { text: string; totalPages: number; pages: Array<{ pageNumber: number; text: string }> },
    fileId: string,
    options: ProcessPdfOptions
  ): Promise<Result<string, Error>> {
    const pages = this.normalizePages(textData);
    const pagesToOcr = pages.filter((page) => this.shouldOcrPage(page.text));

    if (options.maxOcrPagesPerPdf && pagesToOcr.length > options.maxOcrPagesPerPdf) {
      return errResult(
        new PdfLimitError(
          'OCR_PAGES_PER_PDF_LIMIT_EXCEEDED',
          `PDF requer OCR em ${pagesToOcr.length} páginas, acima do limite configurado de ${options.maxOcrPagesPerPdf}.`
        )
      );
    }

    if (options.ocrPageBudget && !options.ocrPageBudget.reserve(pagesToOcr.length)) {
      return errResult(
        new PdfLimitError(
          'OCR_PAGES_PER_JOB_LIMIT_EXCEEDED',
          `PDF requer OCR em ${pagesToOcr.length} páginas, mas restam ${options.ocrPageBudget.remaining()} páginas de OCR no limite deste job.`
        )
      );
    }

    if (pagesToOcr.length === 0) {
      logger.info('Skipping OCR - all pages have sufficient native text', {
        fileId,
        totalPages: textData.totalPages,
      });
      return okResult(sanitize(pages.map((page) => page.text).join('\n\n')));
    }

    const { value: ocrResult, error } = await this.ocrOrchestrator.processPagesWithOcr(
      buffer,
      textData.totalPages,
      fileId,
      pagesToOcr.map((page) => page.pageNumber)
    );

    if (error) {
      const nativeText = textData.text.trim();
      if (nativeText.length > 0) {
        return okResult(sanitize(nativeText));
      }

      return errResult(error);
    }

    const ocrByPage = new Map(ocrResult.pages.map((page) => [page.pageNumber, page.text]));
    const mergedText = pages
      .map((page) => {
        const ocrText = ocrByPage.get(page.pageNumber)?.trim();
        return ocrText || page.text;
      })
      .filter((text) => text.trim().length > 0)
      .join('\n\n');

    logger.info('Mixed-page PDF processing completed', {
      fileId,
      totalPages: textData.totalPages,
      nativePages: pages.length - pagesToOcr.length,
      ocrPages: pagesToOcr.length,
      chunksProcessed: ocrResult.chunksProcessed,
      processingTime: ocrResult.processingTime,
    });

    return okResult(sanitize(mergedText));
  }

  private validatePdfPageLimit(totalPages: number, maxPdfPages?: number): Error | null {
    if (!maxPdfPages || totalPages <= maxPdfPages) {
      return null;
    }

    return new PdfLimitError(
      'PDF_PAGE_LIMIT_EXCEEDED',
      `PDF possui ${totalPages} páginas, acima do limite configurado de ${maxPdfPages}.`
    );
  }

  private normalizePages(textData: {
    totalPages: number;
    pages: Array<{ pageNumber: number; text: string }>;
  }): Array<{ pageNumber: number; text: string }> {
    const byPage = new Map(textData.pages.map((page) => [page.pageNumber, page.text]));
    const pages: Array<{ pageNumber: number; text: string }> = [];

    for (let pageNumber = 1; pageNumber <= textData.totalPages; pageNumber++) {
      pages.push({ pageNumber, text: byPage.get(pageNumber) ?? '' });
    }

    return pages;
  }

  private shouldOcrPage(pageText: string): boolean {
    const analysis = this.textQualityAnalyzer.analyzePage(pageText);
    return !analysis.shouldSkipOcr && (!analysis.isHighQuality || analysis.hasOcrIndicators);
  }

  private async runOcrWithFallback(
    buffer: Buffer,
    totalPages: number,
    fileId: string,
    extractedText: string
  ): Promise<Result<string, Error>> {
    const { value: ocrResult, error: ocrError } = await this.ocrOrchestrator.processWithOcr(
      buffer,
      totalPages,
      fileId
    );

    if (ocrError) {
      logger.error('OCR processing failed', { fileId, error: ocrError.message });

      if (extractedText.trim().length > 0) {
        logger.info('OCR failed, falling back to direct text extraction', {
          fileId,
          extractedTextLength: extractedText.length,
        });
        return okResult(sanitize(extractedText));
      }

      return errResult(ocrError);
    }

    if (!ocrResult.ocrText.trim() && extractedText.trim().length > 0) {
      logger.info('OCR produced no text, using direct extraction as fallback', {
        fileId,
        chunksProcessed: ocrResult.chunksProcessed,
        extractedTextLength: extractedText.length,
      });
      return okResult(sanitize(extractedText));
    }

    return okResult(this.combineTextResults(ocrResult.ocrText, fileId, ocrResult));
  }

  private combineTextResults(
    ocrText: string,
    fileId: string,
    ocrResult: { chunksProcessed: number; processingTime: number }
  ): string {
    const finalText = sanitize(ocrText);

    logger.info('PDF processing completed', {
      fileId,
      finalTextLength: finalText.length,
      ocrTextLength: ocrText ? ocrText.length : 0,
      chunksProcessed: ocrResult.chunksProcessed,
      processingTime: ocrResult.processingTime,
    });

    if (finalText.trim().length < 50) {
      logger.warn('Very little text extracted from PDF', {
        fileId,
        finalTextLength: finalText.length,
        ocrTextLength: ocrText ? ocrText.length : 0,
      });
    }

    return finalText;
  }
}
