import fs from 'node:fs';
import { cpus } from 'node:os';
import { PROCESSING_TIMEOUTS } from '@config/constants';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { pdfWorkerPool } from '@lib/worker-pool';
import axios, { type AxiosResponse } from 'axios';
import pdf from 'pdf-parse';
import tmp from 'tmp';
import { sanitize } from 'utils/sanitize';
import type { FileInput } from './process-messages.service';

export class ProcessPdfService {
  private readonly MAX_WORKERS = cpus().length / 2;

  private readonly VISUAL_CONTENT_THRESHOLDS = {
    LARGE_IMAGE: 100000,
    AVERAGE_SIZE: 50000,
    TOTAL_SIZE: 120000,
    MAX_TEXT_FOR_OCR: 50000,
  } as const;

  private readonly OCR_SETTINGS = {
    MAX_PAGES_TO_ANALYZE: 3,
    MAX_CHUNKS: 5,
    MAX_REPETITIONS_FACTOR: 0.8,
  } as const;

  async execute(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    const timeoutPromise = this.createTimeoutPromise(PROCESSING_TIMEOUTS.PDF_GLOBAL);
    const { value: response, error } = await wrapPromiseResult<AxiosResponse, Error>(
      axios.get(url, { responseType: 'arraybuffer', validateStatus: (status) => status < 500 })
    );

    if (error) {
      logger.error('Error fetching PDF file', {
        fileId,
        url,
        error: error.message,
        stack: error.stack,
      });
      return errResult(new Error(`Failed to fetch PDF file: ${error.message}`));
    }

    if (response.status === 404) {
      logger.warn('PDF file not found in bucket', {
        fileId,
        url,
        status: response.status,
      });
      return errResult(
        new Error('Arquivo PDF não encontrado no bucket. Verifique se o arquivo existe.')
      );
    }

    if (response.status >= 400) {
      logger.error('HTTP error fetching PDF file', {
        fileId,
        url,
        status: response.status,
        statusText: response.statusText,
      });
      return errResult(new Error(`Erro HTTP ${response.status}: ${response.statusText}`));
    }

    const buffer = Buffer.from(response.data);

    const { value: directTextResult, error: extractionError } = await this.extractDirectTextFromPdf(
      buffer,
      fileId
    );

    if (extractionError) {
      logger.error('Error extracting text from PDF', {
        fileId,
        error: extractionError.message,
      });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${extractionError.message}`));
    }

    const { text: extractedText, totalPages } = directTextResult;

    if (this.shouldSkipOcr(extractedText)) {
      return okResult(sanitize(extractedText));
    }

    if (totalPages === 0) {
      return okResult(sanitize(extractedText));
    }

    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);

    const chunks = this.createProcessingChunks(totalPages, fileId);

    const ocrPromise = Promise.all(
      chunks.map((chunk, index) => {
        const chunkStartTime = Date.now();
        const chunkPdfPath = tempPdf!.name;

        return pdfWorkerPool
          .run({
            pageRange: chunk,
            pdfPath: chunkPdfPath,
            fileId,
            totalPages,
          })
          .catch((error) => {
            const chunkDuration = Date.now() - chunkStartTime;
            logger.error('Chunk OCR failed', {
              fileId,
              chunkIndex: index,
              pageRange: chunk,
              chunkDuration,
              error: error.message,
            });
            throw error;
          });
      })
    );

    const { value: ocrResults, error: ocrError } = await wrapPromiseResult<string[][], Error>(
      Promise.race([ocrPromise, timeoutPromise])
    );

    if (ocrError) {
      logger.error('Error in OCR processing', { fileId, error: ocrError });
      return errResult(new Error(`Erro no processamento OCR: ${ocrError}`));
    }

    if (ocrResults && ocrResults.length > 0) {
      const ocrText = this.processOcrResults(ocrResults);
      const finalText = this.combineTextResults(extractedText, ocrText, fileId);

      return okResult(finalText);
    }

    tempPdf?.removeCallback();
    return okResult(sanitize(extractedText));
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise<never>((_, reject) => {
      const timeoutInMinutes = timeout / 60000;
      setTimeout(
        () => reject(new Error(`PDF processing timed out after ${timeoutInMinutes} minutes`)),
        timeout
      );
    });
  }

  private async extractDirectTextFromPdf(
    buffer: Buffer,
    fileId: string
  ): Promise<Result<{ text: string; totalPages: number }, Error>> {
    const { value: data, error } = await wrapPromiseResult<pdf.Result, Error>(pdf(buffer));

    if (error) {
      logger.error('Erro ao extrair texto do PDF', { fileId, error: error.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${error.message}`));
    }

    const text = data.text?.trim() ?? '';
    const totalPages = data.numpages ?? 0;

    return okResult({ text, totalPages });
  }

  private shouldSkipOcr(extractedText: string): boolean {
    const textLength = extractedText.length;

    if (textLength < 500) {
      return false;
    }

    if (textLength > this.VISUAL_CONTENT_THRESHOLDS.MAX_TEXT_FOR_OCR) {
      return true;
    }

    return this.isHighQualityText(extractedText);
  }

  private createProcessingChunks(
    totalPages: number,
    fileId: string
  ): { first: number; last: number }[] {
    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      return [];
    }

    const maxWorkers = this.MAX_WORKERS;
    const chunks: { first: number; last: number }[] = [];

    if (totalPages <= maxWorkers) {
      for (let i = 1; i <= totalPages; i++) {
        chunks.push({ first: i, last: i });
      }
    } else if (totalPages <= maxWorkers * 2) {
      const pagesPerWorker = Math.ceil(totalPages / Math.min(maxWorkers, 5));
      for (let i = 0; i < totalPages; i += pagesPerWorker) {
        const first = i + 1;
        const last = Math.min(i + pagesPerWorker, totalPages);
        chunks.push({ first, last });
      }
    } else {
      const optimalChunkSize = Math.max(3, Math.ceil(totalPages / maxWorkers));
      for (let i = 0; i < totalPages; i += optimalChunkSize) {
        const first = i + 1;
        const last = Math.min(i + optimalChunkSize, totalPages);
        chunks.push({ first, last });
      }
    }

    return chunks;
  }

  private processOcrResults(ocrResults: string[][]): string {
    if (!ocrResults || ocrResults.length === 0) {
      return '';
    }

    const flattenedResults = ocrResults.flat();
    const allLines = flattenedResults.join('\n').split('\n');
    const lineCount = this.countLines(allLines);
    const filteredLines = this.filterOcrLines(allLines, lineCount, flattenedResults.length);

    return filteredLines.join('\n');
  }

  private countLines(allLines: string[]): Record<string, number> {
    const lineCount: Record<string, number> = {};
    allLines.forEach((line) => {
      const cleanLine = line.trim();
      if (cleanLine.length > 5) {
        lineCount[cleanLine] = (lineCount[cleanLine] || 0) + 1;
      }
    });
    return lineCount;
  }

  private isHighQualityText(text: string): boolean {
    return Boolean(text && text.trim().length > 1000 && !text.includes('�'));
  }

  private filterOcrLines(
    allLines: string[],
    lineCount: Record<string, number>,
    totalChunks: number
  ): string[] {
    const preservePatterns = this.getPreservePatterns();
    const maxRepetitions = Math.ceil(totalChunks * this.OCR_SETTINGS.MAX_REPETITIONS_FACTOR);

    return allLines.filter((line) => {
      const cleanLine = line.trim();

      if (!cleanLine || cleanLine.length <= 3) {
        return true;
      }

      const hasImportantData = preservePatterns.some((pattern) => pattern.test(cleanLine));
      if (hasImportantData) {
        return true;
      }

      const isRepetitive = lineCount[cleanLine] > maxRepetitions;
      const isGeneric = this.isGenericLine(cleanLine);

      return !(isRepetitive && isGeneric);
    });
  }

  private getPreservePatterns(): RegExp[] {
    return [
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
      /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
      /\b\d{5}-?\d{3}\b/,
      /\bR\$\s*[\d.,]+/,
      /\b[A-ZÁÊÇÕ]{2,}\s+[A-ZÁÊÇÕ\s]+\b/,
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\w+@\w+\.\w+/,
      /\(\d{2}\)\s*\d{4,5}-?\d{4}/,
      /\b\d+\b/,
      /[A-Z]{2,}\s+\d+/,
    ];
  }

  private isGenericLine(line: string): boolean {
    return (
      line.length < 20 &&
      (line.includes('Página') ||
        line.includes('página') ||
        Boolean(line.match(/^\d+$/)) ||
        Boolean(line.match(/^[-\s]+$/)) ||
        Boolean(line.match(/^\w+\s-\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}$/)))
    );
  }

  private combineTextResults(extractedText: string, ocrText: string, fileId: string): string {
    let combinedText = '';

    if (extractedText && extractedText.trim().length > 100) {
      combinedText = extractedText;
      if (ocrText && ocrText.trim().length > 100) {
        combinedText += `\n\n--- TEXTO ADICIONAL DO OCR ---\n\n${ocrText}`;
      }
    } else {
      combinedText = ocrText || extractedText || '';
    }

    const finalText = sanitize(combinedText);

    if (finalText.trim().length < 50) {
      logger.warn('Very little text extracted from PDF', {
        fileId,
        finalTextLength: finalText.length,
        extractedTextLength: extractedText ? extractedText.length : 0,
        ocrTextLength: ocrText ? ocrText.length : 0,
      });
    }

    return finalText;
  }
}
