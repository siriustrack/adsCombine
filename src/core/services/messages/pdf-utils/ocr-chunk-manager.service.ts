import logger from '@lib/logger';
import { maxWorkers } from '@lib/worker-pool';

export interface PageChunk {
  first: number;
  last: number;
}

export class OcrChunkManager {
  createProcessingChunks(totalPages: number, fileId: string): PageChunk[] {
    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      return [];
    }

    const targetChunks = maxWorkers * 2;
    // Calculate optimal chunk size to aim for targetChunks, but keep it within bounds
    // Min 1 page to ensure we use available workers for small files
    // Max 50 pages to avoid blocking workers for too long
    const rawChunkSize = Math.ceil(totalPages / targetChunks);
    const chunkSize = Math.max(1, Math.min(50, rawChunkSize));

    const chunks: PageChunk[] = [];
    for (let i = 0; i < totalPages; i += chunkSize) {
      const first = i + 1;
      const last = Math.min(i + chunkSize, totalPages);
      chunks.push({ first, last });
    }

    logger.debug('Created processing chunks', {
      fileId,
      totalPages,
      chunksCount: chunks.length,
      maxWorkers: maxWorkers,
      chunks: chunks.map((c) => `${c.first}-${c.last}`),
    });

    return chunks;
  }
}
