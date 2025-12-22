import logger from '@lib/logger';
import { errResult, okResult, type Result } from '@lib/result.types';
import { sanitize } from 'utils/sanitize';
import type { FileInput } from '../process-messages.service';
import { FileDownloadService } from './file-download.service';
import { OcrOrchestrator } from './ocr-orchestrator.service';
import type { PageBreak, PdfMetadata, PdfProcessingResult } from './pdf-metadata.types';
import { PdfTextExtractorService } from './pdf-text-extractor.service';
import { SectionDetectorService } from './section-detector.service';
import { TextQualityAnalyzer } from './text-quality-analyzer.service';

export class ProcessPdfService {
  private readonly fileDownloadService = new FileDownloadService();
  private readonly textExtractorService = new PdfTextExtractorService();
  private readonly textQualityAnalyzer = new TextQualityAnalyzer();
  private readonly ocrOrchestrator = new OcrOrchestrator();
  private readonly sectionDetector = new SectionDetectorService();

  async execute(file: FileInput): Promise<Result<PdfProcessingResult, Error>> {
    const { fileId, url } = file;

    logger.info('Starting PDF processing', { fileId, url });

    // 1. Download do arquivo
    const { value: downloadedFile, error: downloadError } =
      await this.fileDownloadService.downloadFile(url, fileId);

    if (downloadError) {
      logger.error('Error processing files', {
        context: 'OCR',
        fileId,
        url,
        err: {
          type: downloadError.constructor.name,
          message: downloadError.message,
        },
      });
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

    // 4. Decisão sobre OCR
    const pages = Math.max(1, totalPages || 0);
    const charsPerPage = extractedText.length / pages;
    // Heurística extra: PDFs escaneados frequentemente têm um "text layer" parcial (cabeçalhos/rodapés)
    // que engana a análise de qualidade. Se o texto por página for baixo, fazemos OCR mesmo assim.
    const minCharsPerPageToSkipOcr = pages <= 1 ? 300 : pages === 2 ? 650 : 900;

    if (qualityAnalysis.shouldSkipOcr && charsPerPage >= minCharsPerPageToSkipOcr) {
      logger.info('Skipping OCR - text quality is sufficient', {
        fileId,
        qualityScore: qualityAnalysis.qualityScore,
        textLength: extractedText.length,
        totalPages,
        charsPerPage: Math.round(charsPerPage),
      });

      // Build metadata from direct extraction
      const pageBreaks = this.buildPageBreaksFromTextData(textData);
      const sections = this.sectionDetector.detectSections(extractedText, pageBreaks);

      const metadata: PdfMetadata = {
        totalPages,
        pageBreaks,
        sections,
        processingSource: 'direct',
      };

      return okResult({
        text: sanitize(extractedText),
        metadata,
      });
    }

    if (qualityAnalysis.shouldSkipOcr && charsPerPage < minCharsPerPageToSkipOcr) {
      logger.info('Forcing OCR - extracted text too short per page', {
        fileId,
        qualityScore: qualityAnalysis.qualityScore,
        textLength: extractedText.length,
        totalPages,
        charsPerPage: Math.round(charsPerPage),
        minCharsPerPageToSkipOcr,
      });
    }

    if (totalPages === 0) {
      logger.warn('No pages found in PDF', { fileId });
      return okResult({
        text: sanitize(extractedText),
        metadata: {
          totalPages: 0,
          pageBreaks: [],
          sections: [],
          processingSource: 'direct',
        },
      });
    }

    // 5. Processamento OCR
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
    const result = this.combineTextResults(ocrResult, fileId, totalPages);

    return okResult(result);
  }

  private combineTextResults(
    ocrResult: {
      ocrText: string;
      pageBreaks: PageBreak[];
      chunksProcessed: number;
      processingTime: number;
    },
    fileId: string,
    totalPages: number
  ): PdfProcessingResult {
    const finalText = sanitize(ocrResult.ocrText);

    // Detect sections from OCR text
    const sections = this.sectionDetector.detectSections(finalText, ocrResult.pageBreaks);

    const metadata: PdfMetadata = {
      totalPages,
      pageBreaks: ocrResult.pageBreaks,
      sections,
      processingSource: 'ocr',
    };

    logger.info('PDF processing completed', {
      fileId,
      finalTextLength: finalText.length,
      ocrTextLength: ocrResult.ocrText ? ocrResult.ocrText.length : 0,
      pageBreaksDetected: metadata.pageBreaks.length,
      sectionsDetected: metadata.sections?.length ?? 0,
      chunksProcessed: ocrResult.chunksProcessed,
      processingTime: ocrResult.processingTime,
    });

    if (finalText.trim().length < 50) {
      logger.warn('Very little text extracted from PDF', {
        fileId,
        finalTextLength: finalText.length,
        ocrTextLength: ocrResult.ocrText ? ocrResult.ocrText.length : 0,
      });
    }

    return { text: finalText, metadata };
  }

  /**
   * Convert pageInfo from PdfTextExtractor to PageBreak array
   */
  private buildPageBreaksFromTextData(textData: {
    pageInfo?: Array<{ pageNumber: number; estimatedCharStart: number }>;
  }): PageBreak[] {
    if (!textData.pageInfo) {
      return [];
    }

    return textData.pageInfo.map((info) => ({
      pageNumber: info.pageNumber,
      charIndex: info.estimatedCharStart,
    }));
  }
}
