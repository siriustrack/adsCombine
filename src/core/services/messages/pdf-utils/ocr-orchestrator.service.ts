import fs from 'node:fs';
import { PROCESSING_TIMEOUTS } from '@config/constants';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { pdfWorkerPool } from '@lib/worker-pool';
import tmp from 'tmp';
import type { PageChunk } from './ocr-chunk-manager.service';
import { OcrChunkManager } from './ocr-chunk-manager.service';
import type { PageBreak } from './pdf-metadata.types';

export interface OcrProcessingResult {
	ocrText: string;
	chunksProcessed: number;
	processingTime: number;
	pageBreaks: PageBreak[];
}

export class OcrOrchestrator {
  private readonly chunkManager = new OcrChunkManager();

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
        pageBreaks: []
      });
    }

    // Criar chunks de processamento
    const chunks = this.chunkManager.createProcessingChunks(totalPages, fileId);

    if (chunks.length === 0) {
      return okResult({
        ocrText: '',
        chunksProcessed: 0,
        processingTime: Date.now() - startTime,
        pageBreaks: []
      });
    }

    // Criar arquivo temporário
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });

    try {
      fs.writeFileSync(tempPdf.name, buffer);

      // Processar chunks em paralelo
      const { value: chunkResults, error: ocrError } = await this.processChunksInParallel(
        chunks,
        tempPdf.name,
        fileId,
        totalPages
      );

      if (ocrError) {
        return errResult(ocrError);
      }

      // Processar resultados
      const ocrText = chunkResults.texts.join('\n');
      const processingTime = Date.now() - startTime;

      logger.info('OCR processing completed', {
        fileId,
        totalPages,
        chunksProcessed: chunks.length,
        ocrTextLength: ocrText.length,
        pageBreaksDetected: chunkResults.pageBreaks.length,
        processingTime
      });

      return okResult({
        ocrText,
        chunksProcessed: chunks.length,
        processingTime,
        pageBreaks: chunkResults.pageBreaks
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
            error: (error as Error).message
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
  ): Promise<Result<{ texts: string[]; pageBreaks: PageBreak[] }, Error>> {
    const timeoutPromise = this.createTimeoutPromise(PROCESSING_TIMEOUTS.PDF_GLOBAL);

    const ocrPromise = Promise.all(
      chunks.map(async (chunk, index) => {
        const chunkStartTime = Date.now();

        try {
          const result = await pdfWorkerPool.run({
            pageRange: chunk,
            pdfPath,
            fileId,
            totalPages
          });

          const chunkDuration = Date.now() - chunkStartTime;
          logger.debug('Chunk processed successfully', {
            fileId,
            chunkIndex: index,
            pageRange: `${chunk.first}-${chunk.last}`,
            chunkDuration,
            resultLength:
              typeof result === 'string' ? result.length : Array.isArray(result) ? result.join('').length : 0
          });

          return result;
        } catch (error) {
          const chunkDuration = Date.now() - chunkStartTime;
          logger.error('Chunk OCR failed', {
            fileId,
            chunkIndex: index,
            pageRange: `${chunk.first}-${chunk.last}`,
            chunkDuration,
            error: (error as Error).message
          });
          throw error;
        }
      })
    );

    const { value: ocrResults, error: ocrError } = await wrapPromiseResult<string[], Error>(
      Promise.race([ocrPromise, timeoutPromise])
    );

    if (ocrError) {
      logger.error('Error in OCR processing', {
        fileId,
        error: ocrError.message,
        chunksCount: chunks.length
      });
      return errResult(new Error(`Erro no processamento OCR: ${ocrError.message}`));
    }

    // Build page breaks while assembling text from chunks
    const pageBreaks = this.buildPageBreaksFromChunks(chunks, ocrResults, fileId);

    return okResult({ texts: ocrResults, pageBreaks });
  }

  /**
   * Build page breaks array from OCR chunks
   * Tracks character position as chunks are concatenated
   */
  private buildPageBreaksFromChunks(
    chunks: PageChunk[],
    ocrTexts: string[],
    fileId: string
  ): PageBreak[] {
    const pageBreaks: PageBreak[] = [];
    let currentCharIndex = 0;

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const chunkText = ocrTexts[chunkIndex];

      // Calculate pages in this chunk
      const pagesInChunk = chunk.last - chunk.first + 1;
      const chunkLength = chunkText.length;
      const avgCharsPerPage = chunkLength / pagesInChunk;

      // Create page breaks for each page in this chunk
      for (let pageNum = chunk.first; pageNum <= chunk.last; pageNum++) {
        // Skip if this page was already added (shouldn't happen but safety check)
        if (pageBreaks.some(pb => pb.pageNumber === pageNum)) {
          continue;
        }

        // Calculate offset within chunk for this page
        const pageIndexInChunk = pageNum - chunk.first;
        const estimatedOffsetInChunk = Math.floor(pageIndexInChunk * avgCharsPerPage);

        // Estimated word count for this page
        const estimatedWords = Math.floor(avgCharsPerPage / 5); // Rough estimate: 5 chars per word

        pageBreaks.push({
          pageNumber: pageNum,
          charIndex: currentCharIndex + estimatedOffsetInChunk,
          estimatedWords
        });
      }

      // Move character index forward by chunk length
      currentCharIndex += chunkLength;
      
      // Add newline separator if not the last chunk
      if (chunkIndex < chunks.length - 1) {
        currentCharIndex += 1;
      }
    }

    // Sort by page number to ensure correct order
    pageBreaks.sort((a, b) => a.pageNumber - b.pageNumber);

    logger.debug('Built page breaks from OCR chunks', {
      fileId,
      totalPages: pageBreaks.length,
      chunks: chunks.length,
      sampleBreaks: pageBreaks.slice(0, 3).map(pb => ({
        page: pb.pageNumber,
        charIndex: pb.charIndex
      }))
    });

    return pageBreaks;
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise<never>((_, reject) => {
      const timeoutInMinutes = timeout / 60000;
      setTimeout(() => reject(new Error(`OCR processing timed out after ${timeoutInMinutes} minutes`)), timeout);
    });
  }
}
