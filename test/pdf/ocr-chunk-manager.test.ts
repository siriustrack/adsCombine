import { describe, expect, test } from 'bun:test';
import { OcrChunkManager } from '../../src/core/services/messages/pdf-utils/ocr-chunk-manager.service';

describe('OcrChunkManager selected pages', () => {
  test('groups selected pages into contiguous ordered ranges', () => {
    const manager = new OcrChunkManager();

    expect(manager.createProcessingChunksForPages([9, 2, 4, 3, 9], 'file-1')).toEqual([
      { first: 2, last: 4 },
      { first: 9, last: 9 },
    ]);
  });
});
