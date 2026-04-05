import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { PROCESSING_TIMEOUTS } from '@config/constants';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { pdfWorkerPool } from '@lib/worker-pool';
import tmp from 'tmp';
import type { PageChunk } from './ocr-chunk-manager.service';
import { OcrChunkManager } from './ocr-chunk-manager.service';

export interface OcrProcessingResult {
  ocrText: string;
  chunksProcessed: number;
  processingTime: number;
}

export class OcrOrchestrator {
  private readonly chunkManager = new OcrChunkManager();
  private readonly execFile = promisify(execFileCb);

  static async checkPdfinfo(): Promise<{ available: boolean; version?: string }> {
    try {
      const execAsync = promisify(execFileCb);
      const { stdout } = await execAsync('pdfinfo', ['-v'], { timeout: 5_000 });
      const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
      return { available: true, version: versionMatch?.[1] };
    } catch {
      return { available: false };
    }
  }

  private async validatePdfStructure(
    pdfPath: string,
    fileId: string
  ): Promise<{ valid: boolean; pageCount: number }> {
    try {
      const { stdout } = await this.execFile('pdfinfo', [pdfPath], {
        timeout: 10_000,
      });
      const pagesMatch = stdout.match(/Pages:\s+(\d+)/);
      const pageCount = pagesMatch ? parseInt(pagesMatch[1], 10) : 0;
      return { valid: pageCount > 0, pageCount };
    } catch (error) {
      logger.warn('PDF structure validation failed (pdfinfo)', {
        fileId,
        error: (error as Error).message,
      });
      return { valid: false, pageCount: 0 };
    }
  }

  async processWithOcr(
    buffer: Buffer,
    totalPages: number,
    fileId: string
  ): Promise<Result<OcrProcessingResult, Error>> {
    const startTime = Date.now();

    if (totalPages === 0) {
      logger.warn('No pages to process with OCR', { fileId });
      return okResult({
        ocrText: '',
        chunksProcessed: 0,
        processingTime: Date.now() - startTime,
      });
    }

    // Criar arquivo temporário antes de validar
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });

    try {
      await fs.promises.writeFile(tempPdf.name, buffer);

      // Validar estrutura do PDF com poppler (mesmo engine do pdftoppm)
      const validation = await this.validatePdfStructure(tempPdf.name, fileId);

      if (!validation.valid) {
        logger.warn('PDF failed poppler structure validation, skipping OCR', {
          fileId,
          declaredPages: totalPages,
          popplerPages: validation.pageCount,
        });
        return okResult({
          ocrText: '',
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
        });
      }

      // Usar page count validado (poppler é autoritativo para pdftoppm)
      const effectivePages = validation.pageCount;
      if (effectivePages !== totalPages) {
        logger.warn('Page count mismatch: pdf-parse vs pdfinfo', {
          fileId,
          pdfParsePages: totalPages,
          pdfInfoPages: effectivePages,
        });
      }

      // Criar chunks com page count validado
      const chunks = this.chunkManager.createProcessingChunks(effectivePages, fileId);

      if (chunks.length === 0) {
        return okResult({
          ocrText: '',
          chunksProcessed: 0,
          processingTime: Date.now() - startTime,
        });
      }

      // Processar chunks em paralelo
      const { value: ocrResults, error: ocrError } = await this.processChunksInParallel(
        chunks,
        tempPdf.name,
        fileId,
        effectivePages
      );

      if (ocrError) {
        return errResult(ocrError);
      }

      // Processar resultados
      const ocrText = ocrResults.join('\n');
      const processingTime = Date.now() - startTime;

      logger.info('OCR processing completed', {
        fileId,
        totalPages: effectivePages,
        chunksProcessed: chunks.length,
        ocrTextLength: ocrText.length,
        processingTime,
      });

      return okResult({
        ocrText,
        chunksProcessed: chunks.length,
        processingTime,
      });
    } finally {
      // Limpar arquivo temporário
      if (tempPdf) {
        try {
          tempPdf.removeCallback();
        } catch (error) {
          logger.warn('Failed to cleanup temporary PDF file', {
            fileId,
            tempFile: tempPdf.name,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  private async processChunksInParallel(
    chunks: PageChunk[],
    pdfPath: string,
    fileId: string,
    totalPages: number
  ): Promise<Result<string[], Error>> {
    const { promise: timeoutPromise, timer } = this.createTimeoutPromise(
      PROCESSING_TIMEOUTS.PDF_GLOBAL
    );

    const ocrPromise = Promise.all(
      chunks.map(async (chunk, index) => {
        const chunkStartTime = Date.now();

        try {
          const result = await pdfWorkerPool.run({
            pageRange: chunk,
            pdfPath,
            fileId,
            totalPages,
          });

          const chunkDuration = Date.now() - chunkStartTime;
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
          });

          return result;
        } catch (error) {
          const chunkDuration = Date.now() - chunkStartTime;
          logger.error('Chunk OCR failed', {
            fileId,
            chunkIndex: index,
            pageRange: `${chunk.first}-${chunk.last}`,
            chunkDuration,
            error: (error as Error).message,
          });
          throw error;
        }
      })
    );

    const { value: ocrResults, error: ocrError } = await wrapPromiseResult<string[], Error>(
      Promise.race([ocrPromise, timeoutPromise]).finally(() => clearTimeout(timer))
    );

    if (ocrError) {
      logger.error('Error in OCR processing', {
        fileId,
        error: ocrError.message,
        chunksCount: chunks.length,
      });
      return errResult(new Error(`Erro no processamento OCR: ${ocrError.message}`));
    }

    return okResult(ocrResults);
  }

  private createTimeoutPromise(timeout: number): {
    promise: Promise<never>;
    timer: ReturnType<typeof setTimeout>;
  } {
    const timeoutInMinutes = timeout / 60000;
    let timer!: ReturnType<typeof setTimeout>;

    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`OCR processing timed out after ${timeoutInMinutes} minutes`)),
        timeout
      );
    });

    return { promise, timer };
  }
}
