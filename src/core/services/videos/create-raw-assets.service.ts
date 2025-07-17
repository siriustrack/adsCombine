import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { RawAssetsRequestBody } from 'api/controllers/videos.controllers';
import {
  FEED_DIR,
  PUBLIC_DIR,
  STORY_FULLSCREEN_DIR,
  STORY_TARJAS_DIR,
  TEMP_DIR,
} from 'config/dirs';
import { env } from 'config/env';
import ffmpeg from 'fluent-ffmpeg';
import type { WebhookService } from '../webhook.service';
import type { VideoDimension, VideoMeta } from '.';

export type Asset = {
  videos: string[];
  dir: string;
  suffix: string;
  description: string;
};

export type VideoDownloadInfo = {
  type: string;
  url: string;
  fileName: string;
};

export class CreateRawAssetsService {
  constructor(
    private videosMeta: VideoMeta[],
    private webhookService: WebhookService
  ) {}

  async execute({ extension, fileName, videos, webhookDestination }: RawAssetsRequestBody) {
    const jobId = `assets-${fileName}-${Date.now()}`;
    const jobTemp = path.join(TEMP_DIR, jobId);

    const { error } = await wrapPromiseResult<unknown, Error>(
      fs.mkdir(jobTemp, { recursive: true })
    );

    if (error) {
      logger.error(error);
      return;
    }

    console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

    const { error: downloadError } = await this.downloadRawAssetVideos(
      videos,
      jobTemp,
      fileName,
      webhookDestination
    );

    if (downloadError) {
      logger.error(downloadError);
      await this.handleRawAssetsError(downloadError, jobTemp, fileName, webhookDestination);

      return;
    }

    const { value, error: probeError } = await this.probeRawAssetVideos(videos, jobTemp, fileName);

    if (probeError) {
      logger.error(probeError);
      await this.handleRawAssetsError(probeError, jobTemp, fileName, webhookDestination);

      return;
    }

    const { videoDimensions, warnings } = value;

    if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);
    console.log(`[${fileName}] Raw assets processing started with warnings:`, warnings);

    const { value: downloadUrls, error: assetsError } = await this.processAndConcatenateAssets(
      videoDimensions,
      jobTemp,
      fileName,
      extension
    );

    if (assetsError) {
      console.error(`[${fileName}] Error processing assets: ${assetsError.message}`);
      await this.webhookService.notifyWebhook(
        webhookDestination,
        { fileName, status: 'error', error: assetsError.message },
        fileName
      );
      await this.handleRawAssetsError(assetsError, jobTemp, fileName, webhookDestination);

      return;
    }

    await this.finalizeRawAssetsProcessing(
      jobTemp,
      fileName,
      extension,
      webhookDestination,
      downloadUrls
    );
  }

  private async downloadRawAssetVideos(
    videos: { url: string }[],
    jobTemp: string,
    fileName: string,
    webhookDestination: string
  ): Promise<Result<null, Error>> {
    console.log(`[${fileName}] Starting download of ${videos.length} videos...`);
    const { error } = await wrapPromiseResult<undefined[], Error>(
      Promise.all(
        videos.map(async (v, i) => {
          const outPath = path.join(jobTemp, `${i}.mp4`);
          const response = await fetch(v.url);
          if (!response.ok) throw new Error(`Failed to download ${v.url}`);
          return await new Promise<undefined>((resolve, reject) => {
            const dest = createWriteStream(outPath);
            if (!response.body) {
              reject(new Error(`No response body for video ${i}`));
              return;
            }
            Readable.fromWeb(response.body as ReadableStream).pipe(dest);
            dest.on('finish', () => {
              console.log(`[${fileName}] Downloaded video ${i} -> ${outPath}`);
              resolve(undefined);
            });
            dest.on('error', reject);
          });
        })
      )
    );

    if (error) {
      console.error(`[${fileName}] Error downloading videos: ${error.message}`);
      await this.webhookService.notifyWebhook(
        webhookDestination,
        { fileName, status: 'error', error: error.message },
        fileName
      );

      return errResult(new Error(`Failed to download videos: ${error.message}`));
    }

    console.log(`[${fileName}] All videos downloaded successfully`);

    return okResult(null);
  }

  private async probeRawAssetVideos(
    videos: { url: string }[],
    jobTemp: string,
    fileName: string
  ): Promise<
    Result<
      {
        warnings: string[];
        videoDimensions: VideoDimension[];
      },
      Error
    >
  > {
    console.log(`[${fileName}] Checking video dimensions...`);
    const warnings: string[] = [];
    const videoDimensions: VideoDimension[] = [];

    for (let i = 0; i < videos.length; i++) {
      const filePath = path.join(jobTemp, `${i}.mp4`);

      const { value: meta, error } = await wrapPromiseResult<ffmpeg.FfprobeData, Error>(
        new Promise((resolve, reject) => {
          ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
              return reject(err instanceof Error ? err : new Error(String(err)));
            }
            resolve(metadata);
          });
        })
      );

      if (error) {
        warnings.push(`Error probing video ${i}: ${error.message}`);
        continue;
      }

      const s = meta.streams.find((s) => s.width && s.height);
      const audioStream = meta.streams.find((s) => s.codec_type === 'audio');

      if (!s) {
        warnings.push(`Video ${i} has no video stream`);
      } else {
        videoDimensions[i] = {
          width: s.width ?? 0,
          height: s.height ?? 0,
          duration: parseFloat(s.duration || '0') || 0,
          path: filePath,
          audioBitrate: audioStream ? audioStream.bit_rate || '192k' : '192k',
          originalIndex: i,
        };
      }
    }

    return okResult({ warnings, videoDimensions });
  }

  private async processAndConcatenateAssets(
    videoDimensions: VideoDimension[],
    jobTemp: string,
    fileName: string,
    extension: string
  ): Promise<Result<VideoDownloadInfo[], Error>> {
    const { value, error } = await this.createAssetVariants(videoDimensions, jobTemp, fileName);

    if (error) {
      console.error(`[${fileName}] Error creating asset variants: ${error.message}`);
      return errResult(new Error(`Failed to create asset variants: ${error.message}`));
    }

    const { feedVideos, storyTarjasVideos, storyFullscreenVideos } = value;
    ('');

    const assets = [
      { videos: feedVideos, dir: FEED_DIR, suffix: '_feed', description: 'FEED' },
      {
        videos: storyTarjasVideos,
        dir: STORY_TARJAS_DIR,
        suffix: '_story_tarjas',
        description: 'STORY TARJAS',
      },
      {
        videos: storyFullscreenVideos,
        dir: STORY_FULLSCREEN_DIR,
        suffix: '_story_fullscreen',
        description: 'STORY FULLSCREEN',
      },
    ];

    return this.concatenateAssets(assets, jobTemp, fileName, extension);
  }

  private async createAssetVariants(
    videoDimensions: VideoDimension[],
    jobTemp: string,
    fileName: string
  ): Promise<
    Result<
      {
        feedVideos: string[];
        storyTarjasVideos: string[];
        storyFullscreenVideos: string[];
      },
      Error
    >
  > {
    const feedVideos: string[] = [];
    const storyTarjasVideos: string[] = [];
    const storyFullscreenVideos: string[] = [];

    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }

      console.log(
        `[${fileName}] Processing video ${i} (${inputVideo.width}x${inputVideo.height}) into 3 formats...`
      );

      const { value: scaledPath, error } = await this.scaleVideoIfNeeded(
        inputVideo,
        jobTemp,
        fileName,
        i
      );

      if (error) {
        console.error(`[${fileName}] Error scaling video ${i}: ${error.message}`);
        return errResult(new Error(`Failed to scale video ${i}: ${error.message}`));
      }

      const { value: feedPath, error: feedError } = await this.createFeedVariant(
        scaledPath,
        inputVideo,
        jobTemp,
        fileName,
        i
      );

      if (feedError) {
        console.error(
          `[${fileName}] Error creating feed variant for video ${i}: ${feedError.message}`
        );
        return errResult(
          new Error(`Failed to create feed variant for video ${i}: ${feedError.message}`)
        );
      }

      feedVideos.push(feedPath);

      const { value: storyTarjasPath, error: storyTarjasError } =
        await this.createStoryTarjasVariant(scaledPath, inputVideo, jobTemp, fileName, i);

      if (storyTarjasError) {
        console.error(
          `[${fileName}] Error creating story tarjas variant for video ${i}: ${storyTarjasError.message}`
        );
        return errResult(
          new Error(
            `Failed to create story tarjas variant for video ${i}: ${storyTarjasError.message}`
          )
        );
      }

      storyTarjasVideos.push(storyTarjasPath);

      const { value: storyFullscreenPath, error: storyFullscreenError } =
        await this.createStoryFullscreenVariant(scaledPath, inputVideo, jobTemp, fileName, i);

      if (storyFullscreenError) {
        console.error(
          `[${fileName}] Error creating story fullscreen variant for video ${i}: ${storyFullscreenError.message}`
        );
        return errResult(
          new Error(
            `Failed to create story fullscreen variant for video ${i}: ${storyFullscreenError.message}`
          )
        );
      }

      storyFullscreenVideos.push(storyFullscreenPath);
    }

    return okResult({ feedVideos, storyTarjasVideos, storyFullscreenVideos });
  }

  private async scaleVideoIfNeeded(
    inputVideo: VideoDimension,
    jobTemp: string,
    fileName: string,
    index: number
  ): Promise<Result<string, Error>> {
    if (inputVideo.width === 1280 && inputVideo.height === 720) {
      const scaledPath = path.join(jobTemp, `scaled-${index}.mp4`);
      console.log(`[${fileName}] Scaling video ${index} from 1280x720 to 1920x1080...`);

      const { error } = await wrapPromiseResult<undefined, Error>(
        new Promise<undefined>((resolve, reject) => {
          ffmpeg(inputVideo.path)
            .outputOptions([
              '-vf scale=1920:1080',
              '-c:v libx264',
              '-preset medium',
              '-crf 18',
              '-c:a aac',
              '-b:a 320k',
              '-ar 48000',
              '-ac 2',
            ])
            .output(scaledPath)
            .on('start', () => {
              console.log(`[${fileName}] FFmpeg scaling of video ${index} started`);
            })
            .on('progress', (progress) => {
              if (progress.percent) {
                console.log(
                  `[${fileName}] Scaling video ${index}: ${progress.percent.toFixed(2)}% done`
                );
              }
            })
            .on('end', () => {
              console.log(`[${fileName}] Scaled video ${index} successfully to 1920x1080`);
              resolve(undefined);
            })
            .on('error', (err) => {
              console.error(`[${fileName}] Error scaling video ${index}: ${err.message}`);
              reject(err);
            })
            .run();
        })
      );

      if (error) {
        console.error(`[${fileName}] Failed to scale video ${index}: ${error.message}`);
        return errResult(new Error(`Failed to scale video ${index}: ${error.message}`));
      }

      return okResult(scaledPath);
    }

    return okResult(inputVideo.path);
  }

  private async createFeedVariant(
    scaledPath: string,
    inputVideo: VideoDimension,
    jobTemp: string,
    fileName: string,
    index: number
  ): Promise<Result<string, Error>> {
    const feedPath = path.join(jobTemp, `feed-${index}.mp4`);
    console.log(`[${fileName}] Creating FEED version ${index} (1080x1350)...`);

    const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
    const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;

    const { error } = await wrapPromiseResult<undefined, Error>(
      new Promise<undefined>((resolve, reject) => {
        const cropX = Math.max(0, (processWidth - 1080) / 2);
        const cropY = Math.max(0, (processHeight - 1350) / 2);

        let cropFilter: string;
        if (processHeight < 1350) {
          const scaleHeight = 1350;
          const scaleWidth = Math.round((processWidth * scaleHeight) / processHeight);
          const newCropX = Math.max(0, (scaleWidth - 1080) / 2);
          cropFilter = `scale=${scaleWidth}:${scaleHeight},crop=1080:1350:${newCropX}:0`;
        } else {
          cropFilter = `crop=1080:1350:${cropX}:${cropY}`;
        }

        ffmpeg(scaledPath)
          .outputOptions([
            `-vf ${cropFilter}`,
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-c:a aac',
            '-b:a 320k',
            '-ar 48000',
            '-ac 2',
          ])
          .output(feedPath)
          .on('end', () => {
            console.log(`[${fileName}] FEED version ${index} completed`);
            resolve(undefined);
          })
          .on('error', reject)
          .run();
      })
    );

    if (error) {
      console.error(`[${fileName}] Failed to create FEED version ${index}: ${error.message}`);
      return errResult(new Error(`Failed to create FEED version ${index}: ${error.message}`));
    }

    return okResult(feedPath);
  }

  private async createStoryTarjasVariant(
    scaledPath: string,
    inputVideo: VideoDimension,
    jobTemp: string,
    fileName: string,
    index: number
  ): Promise<Result<string, Error>> {
    const storyTarjasPath = path.join(jobTemp, `story-tarjas-${index}.mp4`);
    console.log(
      `[${fileName}] Creating STORY TARJAS version ${index} (1080x1920 with black bars)...`
    );

    const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
    const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;

    const { error } = await wrapPromiseResult<undefined, Error>(
      new Promise<undefined>((resolve, reject) => {
        const scaleHeight = Math.round((processHeight * 1080) / processWidth);
        const padFilter = `scale=1080:${scaleHeight},pad=1080:1920:0:(oh-ih)/2:black`;

        ffmpeg(scaledPath)
          .outputOptions([
            `-vf ${padFilter}`,
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-c:a aac',
            '-b:a 320k',
            '-ar 48000',
            '-ac 2',
          ])
          .output(storyTarjasPath)
          .on('end', () => {
            console.log(`[${fileName}] STORY TARJAS version ${index} completed`);
            resolve(undefined);
          })
          .on('error', reject)
          .run();
      })
    );

    if (error) {
      console.error(
        `[${fileName}] Failed to create STORY TARJAS version ${index}: ${error.message}`
      );
      return errResult(
        new Error(`Failed to create STORY TARJAS version ${index}: ${error.message}`)
      );
    }

    return okResult(storyTarjasPath);
  }

  private async createStoryFullscreenVariant(
    scaledPath: string,
    inputVideo: VideoDimension,
    jobTemp: string,
    fileName: string,
    index: number
  ): Promise<Result<string, Error>> {
    const storyFullscreenPath = path.join(jobTemp, `story-fullscreen-${index}.mp4`);
    console.log(`[${fileName}] Creating STORY FULLSCREEN version ${index} (1080x1920 cropped)...`);

    const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
    const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;

    const { error } = await wrapPromiseResult<undefined, Error>(
      new Promise<undefined>((resolve, reject) => {
        const scaleWidth = Math.round((processWidth * 1920) / processHeight);
        const cropX = Math.max(0, (scaleWidth - 1080) / 2);
        const fullscreenFilter = `scale=${scaleWidth}:1920,crop=1080:1920:${cropX}:0`;

        ffmpeg(scaledPath)
          .outputOptions([
            `-vf ${fullscreenFilter}`,
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-c:a aac',
            '-b:a 320k',
            '-ar 48000',
            '-ac 2',
          ])
          .output(storyFullscreenPath)
          .on('end', () => {
            console.log(`[${fileName}] STORY FULLSCREEN version ${index} completed`);
            resolve(undefined);
          })
          .on('error', reject)
          .run();
      })
    );

    if (error) {
      console.error(
        `[${fileName}] Failed to create STORY FULLSCREEN version ${index}: ${error.message}`
      );
      return errResult(
        new Error(`Failed to create STORY FULLSCREEN version ${index}: ${error.message}`)
      );
    }

    return okResult(storyFullscreenPath);
  }

  private async concatenateAssets(
    assets: Asset[],
    jobTemp: string,
    fileName: string,
    extension: string
  ): Promise<Result<VideoDownloadInfo[], Error>> {
    const downloadUrls: VideoDownloadInfo[] = [];

    for (const asset of assets) {
      if (asset.videos.length === 0) {
        console.log(`[${fileName}] No videos to concatenate for ${asset.description}`);
        continue;
      }

      console.log(
        `[${fileName}] Concatenating ${asset.videos.length} videos for ${asset.description}...`
      );

      const concatFilePath = path.join(jobTemp, `concat-${asset.suffix}.txt`);

      const concatFileContent = asset.videos.map((file: string) => `file '${file}'`).join('\n');

      const { error } = await wrapPromiseResult<void, Error>(
        fs.writeFile(concatFilePath, concatFileContent)
      );

      if (error) {
        console.error(`[${fileName}] Error writing concat file: ${error.message}`);
        return errResult(new Error(`Failed to write concat file: ${error.message}`));
      }

      const outputPath = path.join(asset.dir, `${fileName}${asset.suffix}${extension}`);

      const { error: ffmpegError } = await wrapPromiseResult<undefined, Error>(
        new Promise<undefined>((resolve, reject) => {
          ffmpeg()
            .input(concatFilePath)
            .inputOptions(['-f concat', '-safe 0'])
            .outputOptions([
              '-c:v libx264',
              '-c:a aac',
              '-b:a 320k',
              '-ar 48000',
              '-ac 2',
              '-crf 18',
              '-preset slow',
            ])
            .output(outputPath)
            .on('start', (_cmd) => {
              console.log(`[${fileName}] FFmpeg ${asset.description} concat started`);
            })
            .on('progress', (progress) => {
              const percent = progress.percent ? progress.percent.toFixed(2) : 'unknown';
              console.log(`[${fileName}] ${asset.description} Processing: ${percent}% done`);
            })
            .on('end', () => {
              console.log(`[${fileName}] ${asset.description} processing finished`);

              const relativePath = path.relative(PUBLIC_DIR, outputPath).replace(/\\/g, '/');
              downloadUrls.push({
                type: asset.description.toLowerCase().replace(' ', '_'),
                url: `${env.BASE_URL}/files/${relativePath}`,
                fileName: `${fileName}${asset.suffix}${extension}`,
              });

              resolve(undefined);
            })
            .on('error', (err, _stdout, stderr) => {
              console.error(`[${fileName}] FFmpeg ${asset.description} error: ${err.message}`);
              console.error(`[${fileName}] FFmpeg stderr: ${stderr}`);
              reject(err);
            })
            .run();
        })
      );

      if (ffmpegError) {
        console.error(
          `[${fileName}] Error concatenating ${asset.description}: ${ffmpegError.message}`
        );
        return errResult(
          new Error(`Failed to concatenate ${asset.description}: ${ffmpegError.message}`)
        );
      }
    }

    return okResult(downloadUrls);
  }

  private async finalizeRawAssetsProcessing(
    jobTemp: string,
    fileName: string,
    extension: string,
    webhookDestination: string,
    downloadUrls: VideoDownloadInfo[]
  ) {
    console.log(`[${fileName}] All raw assets processing completed successfully`);

    const { error: cleanupError } = await wrapPromiseResult<void, Error>(
      fs.rm(jobTemp, { recursive: true, force: true })
    );

    if (cleanupError) {
      console.error(`[${fileName}] Error cleaning up temp directory: ${cleanupError.message}`);

      await this.webhookService.notifyWebhook(
        webhookDestination,
        { fileName, status: 'error', error: cleanupError.message },
        fileName
      );

      return;
    }

    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);

    await this.webhookService.notifyWebhook(
      webhookDestination,
      {
        fileName,
        status: 'success',
        assets: downloadUrls,
      },
      fileName
    );

    downloadUrls.forEach((asset) => {
      this.videosMeta.push({
        webhookDestination,
        fileName: asset.fileName,
        extension,
        width: 1080,
        height: asset.type === 'feed' ? 1350 : 1920,
        downloadUrl: asset.url,
        assetType: asset.type,
      });
    });
  }

  private async handleRawAssetsError(
    err: Error,
    jobTemp: string,
    fileName: string,
    webhookDestination: string
  ) {
    console.error(`[${fileName}] Raw assets processing error: ${err.message}`);

    const { error: cleanupError } = await wrapPromiseResult<void, Error>(
      fs.rm(jobTemp, { recursive: true, force: true })
    );

    if (cleanupError) {
      console.error(`[${fileName}] Error cleaning up temp directory: ${cleanupError.message}`);
    } else {
      console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);
    }

    await this.webhookService.notifyWebhook(
      webhookDestination,
      { fileName, status: 'error', error: err.message },
      fileName
    );
  }
}
