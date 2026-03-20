import fs from 'node:fs';
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

  async sampleOcrPages(
    buffer: Buffer,
    totalPages: number,
    fileId: string
  ): Promise<{ pageSamples: { page: number; ocrTextLength: number }[] }> {
    const pagesToSample = this.pickSamplePages(totalPages);

    if (pagesToSample.length === 0) {
      return { pageSamples: [] };
    }

    const tempPdf = tmp.fileSync({ postfix: '.pdf' });

    try {
      await fs.promises.writeFile(tempPdf.name, buffer);

      const samples: { page: number; ocrTextLength: number }[] = [];

      for (const page of pagesToSample) {
        try {
          const result = await pdfWorkerPool.run({
            pageRange: { first: page, last: page },
            pdfPath: tempPdf.name,
            fileId,
            totalPages,
          });

          const textLen = typeof result === 'string' ? result.trim().length : 0;
          samples.push({ page, ocrTextLength: textLen });
        } catch (error) {
          logger.warn('OCR sample failed for page', {
            fileId,
            page,
            error: (error as Error).message,
          });
          samples.push({ page, ocrTextLength: 0 });
        }
      }

      return { pageSamples: samples };
    } finally {
      try {
        tempPdf.removeCallback();
      } catch {
        // ignore
      }
    }
  }

  private pickSamplePages(totalPages: number): number[] {
    if (totalPages <= 2) return [1];
    if (totalPages <= 5) return [1, totalPages];

    const mid = Math.ceil(totalPages / 2);
    const lastThird = Math.ceil(totalPages * 0.75);
    return [1, mid, lastThird];
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

    // Criar chunks de processamento
    const chunks = this.chunkManager.createProcessingChunks(totalPages, fileId);

    if (chunks.length === 0) {
      return okResult({
        ocrText: '',
        chunksProcessed: 0,
        processingTime: Date.now() - startTime,
      });
    }

    // Criar arquivo temporário
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });

    try {
      await fs.promises.writeFile(tempPdf.name, buffer);

      // Processar chunks em paralelo
      const { value: ocrResults, error: ocrError } = await this.processChunksInParallel(
        chunks,
        tempPdf.name,
        fileId,
        totalPages
      );

      if (ocrError) {
        return errResult(ocrError);
      }

      // Processar resultados
      const ocrText = ocrResults.join('\n');
      const processingTime = Date.now() - startTime;

      logger.info('OCR processing completed', {
        fileId,
        totalPages,
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
