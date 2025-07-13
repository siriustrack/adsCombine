import fs from 'node:fs/promises';
import path from 'node:path';
import { PUBLIC_DIR } from '@config/dirs';
import { wrapPromiseResult } from '@lib/result.types';
import type { VideoMeta } from '.';

export class DeleteVideosService {
  constructor(private readonly videosMeta: VideoMeta[]) {}

  async execute(fileName: string) {
    const idx = this.videosMeta.findIndex((v) => v.fileName === fileName);

    if (idx === -1) {
      console.error(`Delete failed: ${fileName} not found`);
      return { error: 'Not found' };
    }

    const { extension } = this.videosMeta[idx];

    const filePath = path.join(PUBLIC_DIR, `${fileName}${extension}`);

    const { value: exists } = await wrapPromiseResult(fs.exists(filePath));

    if (exists) {
      await wrapPromiseResult(fs.unlink(filePath));
      console.log(`Deleted public file ${filePath}`);
    }

    this.videosMeta.splice(idx, 1);

    return { message: 'Deleted' };
  }
}
