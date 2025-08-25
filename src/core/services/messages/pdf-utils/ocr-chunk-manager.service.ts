import { cpus } from 'node:os';
import logger from '@lib/logger';

export interface PageChunk {
  first: number;
  last: number;
}

export class OcrChunkManager {
  private readonly MAX_WORKERS = cpus().length / 2;

  createProcessingChunks(totalPages: number, fileId: string): PageChunk[] {
    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      return [];
    }

    const maxWorkers = this.MAX_WORKERS;
    const chunks: PageChunk[] = [];

    if (totalPages <= maxWorkers) {
      // Uma página por worker se temos workers suficientes
      for (let i = 1; i <= totalPages; i++) {
        chunks.push({ first: i, last: i });
      }
    } else if (totalPages <= maxWorkers * 2) {
      // Distribuir páginas entre workers limitados
      const pagesPerWorker = Math.ceil(totalPages / Math.min(maxWorkers, 5));
      for (let i = 0; i < totalPages; i += pagesPerWorker) {
        const first = i + 1;
        const last = Math.min(i + pagesPerWorker, totalPages);
        chunks.push({ first, last });
      }
    } else {
      // Para muitas páginas, criar chunks otimais
      const optimalChunkSize = Math.max(3, Math.ceil(totalPages / maxWorkers));
      for (let i = 0; i < totalPages; i += optimalChunkSize) {
        const first = i + 1;
        const last = Math.min(i + optimalChunkSize, totalPages);
        chunks.push({ first, last });
      }
    }

    logger.debug('Created processing chunks', {
      fileId,
      totalPages,
      chunksCount: chunks.length,
      maxWorkers,
      chunks: chunks.map(c => `${c.first}-${c.last}`),
    });

    return chunks;
  }

}
