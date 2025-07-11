import { VideosServices } from 'core/services/videos.services';
import { Request, Response } from 'express';
import { z } from 'zod';


const VideoRequestSchema = z.object({
  webhookDestination: z.string().min(1, 'Webhook destination is required'),
  fileName: z.string().min(1, 'File name is required'),
  extension: z.literal('.mp4', { message: 'Only .mp4 extension is supported' }),
  width: z.number().positive('Width must be a positive number'),
  height: z.number().positive('Height must be a positive number'),
  codec: z.string().min(1, 'Codec is required'),
  bitrate: z.string().min(1, 'Bitrate is required'),
  videos: z.array(z.object({
    url: z.url('Invalid video URL')
  })).min(1, 'Videos array must not be empty')
});
export type VideoRequestBody = z.infer<typeof VideoRequestSchema>;

const RawAssetsRequestSchema = z.object({
  webhookDestination: z.string().min(1, 'Webhook destination is required'),
  fileName: z.string().min(1, 'File name is required'),
  extension: z.literal('.mp4', { message: 'Only .mp4 extension is supported' }),
  videos: z.array(z.object({
    url: z.url('Invalid video URL')
  })).min(1, 'Videos array must not be empty')
});
export type RawAssetsRequestBody = z.infer<typeof RawAssetsRequestSchema>;

export class VideosController {

  constructor(private readonly videosServices: VideosServices) { }

  createVideoHandler = async (req: Request, res: Response) => {
    const data = VideoRequestSchema.parse(req.body);

    console.log(`[${data.fileName}] Received request: ${JSON.stringify({
      fileName: data.fileName,
      extension: data.extension,
      width: data.width,
      height: data.height,
      codec: data.codec,
      bitrate: data.bitrate,
      videoCount: data.videos?.length || 0
    })}`);

    this.videosServices.createVideo(data)

    res.status(200).json({ message: 'Processing started' });

  }

  getVideosMetaHandler = async (req: Request, res: Response) => {
    const meta = await this.videosServices.getVideosMeta();
    res.json(meta);
  }

  deleteVideosMetaHandler = async (req: Request, res: Response) => {
    const { fileName } = req.body;

    const response = await this.videosServices.deleteVideosMeta(fileName);

    if (response.error) {
      console.error(`Delete failed: ${response.error}`);
      return res.status(404).json({ error: response.error });
    }

    return res.json({ message: 'Deleted' });
  }

  createRawAssetsHandler = async (req: Request, res: Response) => {
    const data = RawAssetsRequestSchema.parse(req.body);

    console.log(`[${data.fileName}] Received create-raw-assets request: ${JSON.stringify({
      fileName: data.fileName,
      extension: data.extension,
      videoCount: data.videos?.length || 0
    })}`);

    this.videosServices.createRawAssetsHandler(data);

    res.status(200).json({ message: 'Raw assets processing started' });

  }
}