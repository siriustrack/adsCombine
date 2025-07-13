import type { VideoMeta } from '.';

export class GetVideosMeta {
  constructor(private readonly videosMeta: VideoMeta[]) {}

  async execute() {
    return this.videosMeta;
  }
}
