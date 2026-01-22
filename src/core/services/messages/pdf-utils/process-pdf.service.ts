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
      return okResult(sanitize(extractedText));
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
      return okResult(sanitize(extractedText));
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
    const finalText = this.combineTextResults(ocrResult.ocrText, fileId, ocrResult);

    return okResult(finalText);
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
