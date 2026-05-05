import { describe, expect, test } from 'bun:test';
import { OcrChunkManager } from '../../src/core/services/messages/pdf-utils/ocr-chunk-manager.service';

describe('OcrChunkManager selected pages', () => {
  test('groups selected pages into bounded contiguous ordered ranges', () => {
    const manager = new OcrChunkManager();

    expect(manager.createProcessingChunksForPages([9, 2, 4, 3, 9], 'file-1')).toEqual([
      { first: 2, last: 3 },
      { first: 4, last: 4 },
      { first: 9, last: 9 },
    ]);
  });

  test('splits fully selected PDFs into small chunks for parallel OCR', () => {
    const manager = new OcrChunkManager();

    expect(manager.createProcessingChunksForPages([1, 2, 3, 4, 5, 6, 7], 'file-2')).toEqual([
      { first: 1, last: 2 },
      { first: 3, last: 4 },
      { first: 5, last: 6 },
      { first: 7, last: 7 },
    ]);
  });
});
