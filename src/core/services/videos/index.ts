import { WebhookService } from '../webhook.service';
import { CreateRawAssetsService } from './create-raw-assets.service';
import { CreateVideoService } from './create-video.service';
import { DeleteVideosService } from './delete-videos.service';
import { GetVideosMeta } from './get-videos.service';

export interface VideoMeta {
  [key: string]: unknown;
}

export type VideoDimension = {
  originalIndex: number;
  width: number;
  height: number;
  duration: number;
  path: string;
  audioBitrate: string;
};

const videosMeta: VideoMeta[] = [];
const webhookService = new WebhookService();
export const createRawAssetsService = new CreateRawAssetsService(videosMeta, webhookService);
export const createVideosService = new CreateVideoService(videosMeta, webhookService);
export const deleteVideosService = new DeleteVideosService(videosMeta);
export const getVideosMetaService = new GetVideosMeta(videosMeta);
