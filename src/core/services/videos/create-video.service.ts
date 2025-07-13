import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { VideoRequestBody } from 'api/controllers/videos.controllers';
import { PUBLIC_DIR, TEMP_DIR } from 'config/dirs';
import { env } from 'config/env';
import ffmpeg from 'fluent-ffmpeg';
import type { WebhookService } from '../webhook.service';
import type { VideoDimension, VideoMeta } from '.';

type VideoFilePathIndex = {
  index: number;
  path: string;
}[];

export class CreateVideoService {
  constructor(
    private videosMeta: VideoMeta[],
    private webhookService: WebhookService
  ) { }

  async execute({
    bitrate,
    codec,
    extension,
    fileName,
    height,
    videos,
    webhookDestination,
    width,
  }: VideoRequestBody) {
    const jobId = `${fileName}-${Date.now()}`;
    const jobTemp = path.join(TEMP_DIR, jobId);

    const { error: mkdirError } = await wrapPromiseResult(fs.mkdir(jobTemp, { recursive: true }));

    if (mkdirError) {
      logger.error(mkdirError);
      return;
    }

    console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

    console.log(`[${fileName}] Starting SEQUENTIAL download of ${videos.length} videos...`);
    const { value: downloadedVideos, error: downloadError } = await this.downloadVideos(videos, jobTemp, fileName);

    if (downloadError) {
      logger.error(downloadError);
      await this.removeTempDirectory(jobTemp, fileName);
      return;
    }

    console.log(`[${fileName}]=> All videos downloaded sequentially in correct order`);
    console.log(`[${fileName}] Checking video dimensions in correct order...`);
    const { warnings, videoDimensions } = await this.probeVideos(
      downloadedVideos,
      fileName,
      width,
      height
    );

    if (warnings.length) {
      console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);
      await this.removeTempDirectory(jobTemp, fileName);
      return
    }

    console.log(`[${fileName}] Standardizing videos to ${width}x${height} in correct order...`);
    const { value: standardizedVideos, error: standardizeError } = await this.standardizeVideos(
      videoDimensions,
      jobTemp,
      fileName,
      width,
      height
    );

    if (standardizeError) {
      logger.error(standardizeError);
      await this.removeTempDirectory(jobTemp, fileName);
      return;
    }

    const { value: outputPath, error: concatError } = await this.concatenateVideos(
      standardizedVideos,
      videoDimensions,
      jobTemp,
      fileName,
      extension,
      codec,
      bitrate
    );

    if (concatError) {
      logger.error(concatError);
      await this.removeTempDirectory(jobTemp, fileName);
      return;
    }

    console.log(`[${fileName}] Video processing completed successfully`);

    const { error: rmError } = await wrapPromiseResult(
      fs.rm(jobTemp, { recursive: true, force: true })
    );

    if (rmError) {
      logger.error(rmError);
      await this.removeTempDirectory(jobTemp, fileName);
      return;
    }

    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);

    const downloadUrl = `${env.BASE_URL}/files/${fileName}${extension}`;

    const { value: stats, error } = await wrapPromiseResult(fs.stat(outputPath));

    if (error) {
      logger.error(error);
      return;
    }

    await this.webhookService.notifyWebhook(
      webhookDestination,
      { fileName, downloadUrl, size: stats.size, status: 'success' },
      fileName
    );

    this.videosMeta.push({ webhookDestination, fileName, extension, width, height, downloadUrl });
  }


  private async removeTempDirectory(jobTemp: string, fileName: string): Promise<void> {
    const { error } = await wrapPromiseResult<void, Error>(
      fs.rm(jobTemp, { recursive: true, force: true })
    );

    if (error) {
      console.error(`[${fileName}] Error cleaning up: ${error.message}`);
    }
  }

  private async downloadVideos(
    videos: { url: string }[],
    jobTemp: string,
    fileName: string
  ): Promise<Result<VideoFilePathIndex, Error>> {
    const downloadedVideos: VideoFilePathIndex = [];

    for (let i = 0; i < videos.length; i++) {
      const outPath = path.join(jobTemp, `video_${String(i).padStart(3, '0')}.mp4`);
      console.log(`[${fileName}] Downloading video ${i} from: ${videos[i].url}`);

      const { value: response, error: fetchError } = await wrapPromiseResult(fetch(videos[i].url));

      if (fetchError || !response.ok) {
        return errResult(
          new Error(
            `Failed to download video ${i} from ${videos[i].url}: ${response.status} ${response.statusText}`
          )
        );
      }

      const { error } = await wrapPromiseResult<void, Error>(new Promise<void>((resolve, reject) => {
        const dest = createWriteStream(outPath);
        Readable.fromWeb(response.body as ReadableStream).pipe(dest);
        dest.on('finish', () => {
          console.log(`[${fileName}] ✅ Downloaded video ${i} -> ${outPath}`);
          downloadedVideos.push({ index: i, path: outPath });
          resolve();
        });
        dest.on('error', reject);
      }));


      if (error) {
        console.error(`[${fileName}] Error downloading video ${i}: ${error.message}`);
        return errResult(new Error(`Failed to download video ${i}: ${error.message}`));
      }

    }

    return okResult(downloadedVideos);
  }

  private async probeVideos(
    downloadedVideos: VideoFilePathIndex,
    fileName: string,
    width: number,
    height: number
  ) {
    const warnings: string[] = [];

    const videoDimensions: VideoDimension[] = [];

    for (const downloadedVideo of downloadedVideos) {
      await this.probeVideoFile(
        downloadedVideo,
        fileName,
        width,
        height,
        warnings,
        videoDimensions
      );
    }

    return { warnings, videoDimensions };
  }

  private async probeVideoFile(
    downloadedVideo: { index: number; path: string },
    fileName: string,
    width: number,
    height: number,
    warnings: string[],
    videoDimensions: VideoDimension[]
  ): Promise<void> {
    const filePath = downloadedVideo.path;
    console.log(`[${fileName}] Probing video ${downloadedVideo.index} at ${filePath}`);

    const { error, value } = await wrapPromiseResult<ffmpeg.FfprobeData, Error>(
      this.getVideoMetadata(filePath)
    );

    if (error) {
      warnings.push(`Error probing video ${downloadedVideo.index}: ${error.message}`);
      return;
    }

    this.processVideoMetadata(
      value,
      downloadedVideo,
      fileName,
      width,
      height,
      warnings,
      videoDimensions
    );
  }

  private async getVideoMetadata(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        resolve(metadata);
      });
    });
  }

  private processVideoMetadata(
    meta: ffmpeg.FfprobeData,
    downloadedVideo: { index: number; path: string },
    fileName: string,
    width: number,
    height: number,
    warnings: string[],
    videoDimensions: VideoDimension[]
  ) {
    const s = meta.streams.find((s) => s.width && s.height);
    const audioStream = meta.streams.find((s) => s.codec_type === 'audio');

    if (!s) {
      warnings.push(`Video ${downloadedVideo.index} has no video stream`);
    } else {
      videoDimensions.push({
        originalIndex: downloadedVideo.index,
        width: s.width ?? 0,
        height: s.height ?? 0,
        duration: parseFloat(s.duration ?? '0') || 0,
        path: downloadedVideo.path,
        audioBitrate: audioStream ? audioStream.bit_rate || '192k' : '192k',
      });

      console.log(
        `[${fileName}] Video ${downloadedVideo.index}: ${s.width}x${s.height}, duration: ${parseFloat(s.duration || '0') || 0}s`
      );

      if (s.width !== width || s.height !== height) {
        warnings.push(
          `Video ${downloadedVideo.index} is ${s.width}x${s.height}, expected ${width}x${height}`
        );
      }
    }
  }

  private async standardizeVideos(
    videoDimensions: VideoDimension[],
    jobTemp: string,
    fileName: string,
    width: number,
    height: number
  ): Promise<Result<string[], Error>> {
    const standardizedVideos: string[] = [];

    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }

      const standardizedPath = path.join(jobTemp, `standardized_${String(i).padStart(3, '0')}.mp4`);
      console.log(
        `[${fileName}] Starting standardization of video ${inputVideo.originalIndex} (position ${i}) (${inputVideo.width}x${inputVideo.height}) to ${width}x${height}...`
      );

      const { error } = await wrapPromiseResult<void, Error>(new Promise<void>((resolve, reject) => {
        const command = ffmpeg(inputVideo.path)
          .outputOptions([
            `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-c:a aac',
            '-b:a 320k',
            '-ar 48000',
            '-ac 2',
          ])
          .output(standardizedPath)
          .on('start', () => {
            console.log(
              `[${fileName}] FFmpeg standardization of video ${inputVideo.originalIndex} (position ${i}) started`
            );
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(
                `[${fileName}] Standardizing video ${inputVideo.originalIndex} (pos ${i}): ${progress.percent.toFixed(2)}% done`
              );
            }
          })
          .on('end', () => {
            console.log(
              `[${fileName}] ✅ Standardized video ${inputVideo.originalIndex} (position ${i}) successfully`
            );
            standardizedVideos.push(standardizedPath);
            resolve();
          })
          .on('error', (err) => {
            console.error(
              `[${fileName}] Error standardizing video ${inputVideo.originalIndex} (position ${i}): ${err.message}`
            );
            reject(err);
          });

        command.run();
      }));

      if (error) {
        console.error(
          `[${fileName}] Error standardizing video ${inputVideo.originalIndex} (position ${i}): ${error.message}`
        );
        return errResult(new Error(`Failed to standardize video ${inputVideo.originalIndex}: ${error.message}`));
      }
    }

    return okResult(standardizedVideos);
  }

  private async concatenateVideos(
    standardizedVideos: string[],
    videoDimensions: VideoDimension[],
    jobTemp: string,
    fileName: string,
    extension: string,
    codec: string,
    bitrate: string
  ): Promise<Result<string, Error>> {
    const concatFilePath = path.join(jobTemp, 'concat.txt');
    const concatFileContent = standardizedVideos
      .map((file, index) => {
        console.log(`[${fileName}] Concat order ${index}: ${path.basename(file)}`);
        return `file '${file}'`;
      })
      .join('\n');

    const { error } = await wrapPromiseResult<void, Error>(fs.writeFile(concatFilePath, concatFileContent));

    if (error) {
      console.error(`[${fileName}] Error writing concat file: ${error.message}`);
      return errResult(new Error(`Failed to write concat file: ${error.message}`));
    }

    console.log(`[${fileName}] Concat file created with guaranteed order:`);
    console.log(concatFileContent);

    const outputPath = path.join(PUBLIC_DIR, `${fileName}${extension}`);

    const highestAudioBitrate = videoDimensions.filter(Boolean).reduce((max, video) => {
      const bitNum = parseInt(video.audioBitrate);
      return Number.isNaN(bitNum) ? max : Math.max(max, bitNum);
    }, 192000);

    const audioBitrate = Math.max(parseInt(bitrate) || 320000, highestAudioBitrate).toString();
    console.log(
      `[${fileName}] Starting concatenation of ${standardizedVideos.length} videos with audio bitrate ${audioBitrate}`
    );

    const { error: concatError } = await wrapPromiseResult<void, Error>(
      new Promise<void>((resolve, reject) => {
        const ffmpegCmd = ffmpeg()
          .input(concatFilePath)
          .inputOptions(['-f concat', '-safe 0'])
          .outputOptions([
            `-c:v ${codec}`,
            `-c:a aac`,
            `-b:a ${Math.max(320000, parseInt(audioBitrate) || 320000)}`,
            `-ar 48000`,
            `-ac 2`,
            `-crf 18`,
            `-preset slow`,
          ])
          .output(outputPath);

        const ffmpegCommandString = ffmpegCmd._getArguments().join(' ');
        console.log(`[${fileName}] FFmpeg concat command: ffmpeg ${ffmpegCommandString}`);

        ffmpegCmd
          .on('start', (cmd) => {
            console.log(`[${fileName}] FFmpeg concat started with command: ${cmd}`);
          })
          .on('progress', (progress) => {
            const percent = progress.percent ? progress.percent.toFixed(2) : 'unknown';
            const frames = progress.frames || 0;
            const fps = progress.currentFps || 0;
            console.log(
              `[${fileName}] Processing: ${percent}% done | Frames: ${frames} | FPS: ${fps}`
            );
          })
          .on('end', () => {
            console.log(`[${fileName}] FFmpeg processing finished. Output at ${outputPath}`);
            resolve();
          })
          .on('error', (err, _stdout, stderr) => {
            console.error(`[${fileName}] FFmpeg concat error: ${err.message}`);
            console.error(`[${fileName}] FFmpeg stderr: ${stderr}`);
            reject(err);
          })
          .run();
      })
    );

    if (concatError) {
      console.error(`[${fileName}] Error during concatenation: ${concatError.message}`);
      return errResult(new Error(`Failed to concatenate videos: ${concatError.message}`));
    }

    return okResult(outputPath);
  }
}
