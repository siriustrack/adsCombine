import { env } from '@config/env';
import logger from '@lib/logger';
import { errResult, okResult, type Result } from '@lib/result.types';
import { sanitize } from 'utils/sanitize';
import type { FileInput } from '../process-messages.service';
import { FileDownloadService } from './file-download.service';
import { OcrOrchestrator } from './ocr-orchestrator.service';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { TextQualityAnalyzer } from './text-quality-analyzer.service';

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

  async execute(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    logger.info('Starting PDF processing', { fileId, url });

    // 1. Download do arquivo
    const { value: downloadedFile, error: downloadError } =
      await this.fileDownloadService.downloadFile(url, fileId);

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

    // 3. Análise de qualidade do texto
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
        const needsOcr = await this.validateWithOcrSample(
          downloadedFile.buffer,
          totalPages,
          charsPerPage,
          fileId
        );

        if (!needsOcr) {
          logger.info('Skipping OCR - sample confirmed text is sufficient', {
            fileId,
            totalPages,
            charsPerPage: Math.round(charsPerPage),
            reason: 'sample-validated',
          });
          return okResult(sanitize(extractedText));
        }

        logger.info('OCR sample detected image-heavy pages, proceeding with full OCR', {
          fileId,
          totalPages,
        });
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

    const { value: ocrResult, error: ocrError } = await this.ocrOrchestrator.processWithOcr(
      downloadedFile.buffer,
      totalPages,
      fileId
    );

    if (ocrError) {
      logger.error('OCR processing failed', { fileId, error: ocrError.message });
      return errResult(ocrError);
    }

    // 6. Combinação dos resultados
    const finalText = this.combineTextResults(ocrResult.ocrText, fileId, ocrResult);

    return okResult(finalText);
  }

  private async validateWithOcrSample(
    buffer: Buffer,
    totalPages: number,
    expectedCharsPerPage: number,
    fileId: string
  ): Promise<boolean> {
    try {
      const { pageSamples } = await this.ocrOrchestrator.sampleOcrPages(buffer, totalPages, fileId);

      const threshold = expectedCharsPerPage * 0.4;

      for (const sample of pageSamples) {
        if (sample.ocrTextLength > threshold) {
          logger.info('OCR sample page exceeds threshold', {
            fileId,
            page: sample.page,
            ocrTextLength: sample.ocrTextLength,
            threshold: Math.round(threshold),
          });
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.warn('OCR sample validation failed, defaulting to full OCR', {
        fileId,
        error: (error as Error).message,
      });
      return true;
    }
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
