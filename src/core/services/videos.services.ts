import { RawAssetsRequestBody, VideoRequestBody } from 'api/controllers/videos.controllers';
import { FEED_DIR, PUBLIC_DIR, STORY_FULLSCREEN_DIR, STORY_TARJAS_DIR, TEMP_DIR } from 'config/dirs';
import { env } from 'config/env';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

interface VideoMeta {
  [key: string]: any;
}

export class VideosServices {
  private readonly videosMeta: VideoMeta[] = [];

  async createVideo({ bitrate, codec, extension, fileName, height, videos, webhookDestination, width }: VideoRequestBody) {
    const jobId = `${fileName}-${Date.now()}`;
    const jobTemp = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(jobTemp, { recursive: true });
    console.log(`[${fileName}] Created temp directory at ${jobTemp}`);


    try {
      console.log(`[${fileName}] Starting SEQUENTIAL download of ${videos.length} videos...`);
      const downloadedVideos = await this.downloadVideos(videos, jobTemp, fileName);
      console.log(`[${fileName}]=> All videos downloaded sequentially in correct order`);


      console.log(`[${fileName}] Checking video dimensions in correct order...`);
      const { warnings, videoDimensions } = await this.probeVideos(downloadedVideos, fileName, width, height);

      if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);
      console.log(`[${fileName}] Processing started with warnings:`, warnings);


      console.log(`[${fileName}] Standardizing videos to ${width}x${height} in correct order...`);
      const standardizedVideos = await this.standardizeVideos(videoDimensions, jobTemp, fileName, width, height);


      const outputPath = await this.concatenateVideos(standardizedVideos, videoDimensions, jobTemp, fileName, extension, codec, bitrate);


      console.log(`[${fileName}] Video processing completed successfully`);
      fs.rmSync(jobTemp, { recursive: true, force: true });
      console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);

      const downloadUrl = `${env.BASE_URL}/files/${fileName}${extension}`;
      const stats = fs.statSync(outputPath);

      await this.notifyWebhook(webhookDestination, { fileName, downloadUrl, size: stats.size, status: 'success' }, fileName);
      this.videosMeta.push({ webhookDestination, fileName, extension, width, height, downloadUrl });
      return
    } catch (err: any) {
      console.error(`[${fileName}] Processing error: ${err.message}`);


      try {
        fs.rmSync(jobTemp, { recursive: true, force: true });
      } catch (cleanupErr: any) {
        console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
      }


      await this.notifyWebhook(webhookDestination, { fileName, status: 'error', error: err.message }, fileName);

      return
    }
  }

  async getVideosMeta() {
    return this.videosMeta;
  }

  async deleteVideosMeta(fileName: string) {
    const idx = this.videosMeta.findIndex(v => v.fileName === fileName);
    if (idx === -1) {
      console.error(`Delete failed: ${fileName} not found`);
      return { error: 'Not found' };
    }
    const { extension } = this.videosMeta[idx];
    const filePath = path.join(PUBLIC_DIR, `${fileName}${extension}`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted public file ${filePath}`);
    }
    this.videosMeta.splice(idx, 1);
    return { message: 'Deleted' };
  }

  async createRawAssetsHandler({ extension, fileName, videos, webhookDestination }: RawAssetsRequestBody) {
    const jobId = `assets-${fileName}-${Date.now()}`;
    const jobTemp = path.join(TEMP_DIR, jobId);
    fs.mkdirSync(jobTemp, { recursive: true });
    console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

    try {
      await this.downloadRawAssetVideos(videos, jobTemp, fileName, webhookDestination);
      const { warnings, videoDimensions } = await this.probeRawAssetVideos(videos, jobTemp, fileName);
      
      if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);
      console.log(`[${fileName}] Raw assets processing started with warnings:`, warnings);

      const downloadUrls = await this.processAndConcatenateAssets(videoDimensions, jobTemp, fileName, extension, webhookDestination);
      
      await this.finalizeRawAssetsProcessing(jobTemp, fileName, extension, webhookDestination, downloadUrls);
    } catch (err: any) {
      await this.handleRawAssetsError(err, jobTemp, fileName, webhookDestination);
    }
  }

  private async downloadRawAssetVideos(videos: { url: string }[], jobTemp: string, fileName: string, webhookDestination: string) {
    console.log(`[${fileName}] Starting download of ${videos.length} videos...`);
    try {
      await Promise.all(videos.map(async (v, i) => {
        const outPath = path.join(jobTemp, `${i}.mp4`);
        const response = await fetch(v.url);
        if (!response.ok) throw new Error(`Failed to download ${v.url}`);
        return await new Promise<void>((resolve, reject) => {
          const dest = fs.createWriteStream(outPath);
          Readable.fromWeb(response.body as any).pipe(dest);
          dest.on('finish', () => {
            console.log(`[${fileName}] Downloaded video ${i} -> ${outPath}`);
            resolve();
          });
          dest.on('error', reject);
        });
      }));
      console.log(`[${fileName}] All videos downloaded successfully`);
    } catch (err: any) {
      console.error(`[${fileName}] Error downloading videos: ${err.message}`);
      await this.notifyWebhook(webhookDestination, { fileName, status: 'error', error: err.message }, fileName);
      throw new Error(`Failed to download videos: ${err.message}`);
    }
  }

  private async probeRawAssetVideos(videos: { url: string }[], jobTemp: string, fileName: string) {
    console.log(`[${fileName}] Checking video dimensions...`);
    const warnings: string[] = [];
    const videoDimensions: { originalIndex: number; width: number; height: number; duration: number; path: string; audioBitrate: string }[] = [];

    for (let i = 0; i < videos.length; i++) {
      const filePath = path.join(jobTemp, `${i}.mp4`);
      try {
        const meta: ffmpeg.FfprobeData = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
              return reject(err instanceof Error ? err : new Error(String(err)));
            }
            resolve(metadata);
          });
        });

        const s = meta.streams.find(s => s.width && s.height);
        const audioStream = meta.streams.find(s => s.codec_type === 'audio');

        if (!s) {
          warnings.push(`Video ${i} has no video stream`);
        } else {
          videoDimensions[i] = {
            width: s.width!,
            height: s.height!,
            duration: parseFloat(s.duration || '0') || 0,
            path: filePath,
            audioBitrate: audioStream ? (audioStream.bit_rate || '192k') : '192k',
            originalIndex: i
          };
        }
      } catch (err: any) {
        warnings.push(`Error probing video ${i}: ${err.message}`);
      }
    }

    return { warnings, videoDimensions };
  }

  private async processAndConcatenateAssets(videoDimensions: any[], jobTemp: string, fileName: string, extension: string, webhookDestination: string) {
    const { feedVideos, storyTarjasVideos, storyFullscreenVideos } = await this.createAssetVariants(videoDimensions, jobTemp, fileName);
    
    const assets = [
      { videos: feedVideos, dir: FEED_DIR, suffix: '_feed', description: 'FEED' },
      { videos: storyTarjasVideos, dir: STORY_TARJAS_DIR, suffix: '_story_tarjas', description: 'STORY TARJAS' },
      { videos: storyFullscreenVideos, dir: STORY_FULLSCREEN_DIR, suffix: '_story_fullscreen', description: 'STORY FULLSCREEN' }
    ];

    return await this.concatenateAssets(assets, jobTemp, fileName, extension);
  }

  private async createAssetVariants(videoDimensions: any[], jobTemp: string, fileName: string) {
    const feedVideos: string[] = [];
    const storyTarjasVideos: string[] = [];
    const storyFullscreenVideos: string[] = [];

    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }

      console.log(`[${fileName}] Processing video ${i} (${inputVideo.width}x${inputVideo.height}) into 3 formats...`);
      const scaledPath = await this.scaleVideoIfNeeded(inputVideo, jobTemp, fileName, i);
      
      const feedPath = await this.createFeedVariant(scaledPath, inputVideo, jobTemp, fileName, i);
      feedVideos.push(feedPath);

      const storyTarjasPath = await this.createStoryTarjasVariant(scaledPath, inputVideo, jobTemp, fileName, i);
      storyTarjasVideos.push(storyTarjasPath);

      const storyFullscreenPath = await this.createStoryFullscreenVariant(scaledPath, inputVideo, jobTemp, fileName, i);
      storyFullscreenVideos.push(storyFullscreenPath);
    }

    return { feedVideos, storyTarjasVideos, storyFullscreenVideos };
  }

  private async scaleVideoIfNeeded(inputVideo: any, jobTemp: string, fileName: string, index: number): Promise<string> {
    if (inputVideo.width === 1280 && inputVideo.height === 720) {
      const scaledPath = path.join(jobTemp, `scaled-${index}.mp4`);
      console.log(`[${fileName}] Scaling video ${index} from 1280x720 to 1920x1080...`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputVideo.path)
          .outputOptions([
            '-vf scale=1920:1080',
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-c:a aac',
            '-b:a 320k',
            '-ar 48000',
            '-ac 2'
          ])
          .output(scaledPath)
          .on('start', () => {
            console.log(`[${fileName}] FFmpeg scaling of video ${index} started`);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`[${fileName}] Scaling video ${index}: ${progress.percent.toFixed(2)}% done`);
            }
          })
          .on('end', () => {
            console.log(`[${fileName}] Scaled video ${index} successfully to 1920x1080`);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[${fileName}] Error scaling video ${index}: ${err.message}`);
            reject(err);
          })
          .run();
      });
      
      return scaledPath;
    }
    
    return inputVideo.path;
  }

  private async createFeedVariant(scaledPath: string, inputVideo: any, jobTemp: string, fileName: string, index: number): Promise<string> {
    const feedPath = path.join(jobTemp, `feed-${index}.mp4`);
    console.log(`[${fileName}] Creating FEED version ${index} (1080x1350)...`);

    const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
    const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;

    await new Promise<void>((resolve, reject) => {
      const cropX = Math.max(0, (processWidth - 1080) / 2);
      const cropY = Math.max(0, (processHeight - 1350) / 2);

      let cropFilter;
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
          '-ac 2'
        ])
        .output(feedPath)
        .on('end', () => {
          console.log(`[${fileName}] FEED version ${index} completed`);
          resolve();
        })
        .on('error', reject)
        .run();
    });

    return feedPath;
  }

  private async createStoryTarjasVariant(scaledPath: string, inputVideo: any, jobTemp: string, fileName: string, index: number): Promise<string> {
    const storyTarjasPath = path.join(jobTemp, `story-tarjas-${index}.mp4`);
    console.log(`[${fileName}] Creating STORY TARJAS version ${index} (1080x1920 with black bars)...`);

    const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
    const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;

    await new Promise<void>((resolve, reject) => {
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
          '-ac 2'
        ])
        .output(storyTarjasPath)
        .on('end', () => {
          console.log(`[${fileName}] STORY TARJAS version ${index} completed`);
          resolve();
        })
        .on('error', reject)
        .run();
    });

    return storyTarjasPath;
  }

  private async createStoryFullscreenVariant(scaledPath: string, inputVideo: any, jobTemp: string, fileName: string, index: number): Promise<string> {
    const storyFullscreenPath = path.join(jobTemp, `story-fullscreen-${index}.mp4`);
    console.log(`[${fileName}] Creating STORY FULLSCREEN version ${index} (1080x1920 cropped)...`);

    const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
    const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;

    await new Promise<void>((resolve, reject) => {
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
          '-ac 2'
        ])
        .output(storyFullscreenPath)
        .on('end', () => {
          console.log(`[${fileName}] STORY FULLSCREEN version ${index} completed`);
          resolve();
        })
        .on('error', reject)
        .run();
    });

    return storyFullscreenPath;
  }

  private async concatenateAssets(assets: any[], jobTemp: string, fileName: string, extension: string) {
    const downloadUrls: { type: string; url: string; fileName: string; }[] = [];

    for (const asset of assets) {
      if (asset.videos.length === 0) {
        console.log(`[${fileName}] No videos to concatenate for ${asset.description}`);
        continue;
      }

      console.log(`[${fileName}] Concatenating ${asset.videos.length} videos for ${asset.description}...`);

      const concatFilePath = path.join(jobTemp, `concat-${asset.suffix}.txt`);
      const concatFileContent = asset.videos.map((file: string) => `file '${file}'`).join('\n');
      fs.writeFileSync(concatFilePath, concatFileContent);

      const outputPath = path.join(asset.dir, `${fileName}${asset.suffix}${extension}`);

      await new Promise<void>((resolve, reject) => {
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
            '-preset slow'
          ])
          .output(outputPath)
          .on('start', (cmd) => {
            console.log(`[${fileName}] FFmpeg ${asset.description} concat started`);
          })
          .on('progress', progress => {
            const percent = progress.percent ? progress.percent.toFixed(2) : 'unknown';
            console.log(`[${fileName}] ${asset.description} Processing: ${percent}% done`);
          })
          .on('end', () => {
            console.log(`[${fileName}] ${asset.description} processing finished`);

            const relativePath = path.relative(PUBLIC_DIR, outputPath).replace(/\\/g, '/');
            downloadUrls.push({
              type: asset.description.toLowerCase().replace(' ', '_'),
              url: `${env.BASE_URL}/files/${relativePath}`,
              fileName: `${fileName}${asset.suffix}${extension}`
            });

            resolve();
          })
          .on('error', (err, stdout, stderr) => {
            console.error(`[${fileName}] FFmpeg ${asset.description} error: ${err.message}`);
            console.error(`[${fileName}] FFmpeg stderr: ${stderr}`);
            reject(err);
          })
          .run();
      });
    }

    return downloadUrls;
  }

  private async finalizeRawAssetsProcessing(jobTemp: string, fileName: string, extension: string, webhookDestination: string, downloadUrls: any[]) {
    console.log(`[${fileName}] All raw assets processing completed successfully`);

    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);

    await this.notifyWebhook(webhookDestination, {
      fileName,
      status: 'success',
      assets: downloadUrls
    }, fileName);

    downloadUrls.forEach(asset => {
      this.videosMeta.push({
        webhookDestination,
        fileName: asset.fileName,
        extension,
        width: 1080,
        height: asset.type === 'feed' ? 1350 : 1920,
        downloadUrl: asset.url,
        assetType: asset.type
      });
    });
  }

  private async handleRawAssetsError(err: any, jobTemp: string, fileName: string, webhookDestination: string) {
    console.error(`[${fileName}] Raw assets processing error: ${err.message}`);

    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr: any) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
    }

    await this.notifyWebhook(webhookDestination, { fileName, status: 'error', error: err.message }, fileName);
  }


  private async downloadVideos(videos: { url: string }[], jobTemp: string, fileName: string): Promise<{ index: number; path: string }[]> {
    const downloadedVideos: { index: number; path: string }[] = [];

    for (let i = 0; i < videos.length; i++) {
      const outPath = path.join(jobTemp, `video_${String(i).padStart(3, '0')}.mp4`);
      console.log(`[${fileName}] Downloading video ${i} from: ${videos[i].url}`);

      const response = await fetch(videos[i].url);
      if (!response.ok) {
        throw new Error(`Failed to download video ${i} from ${videos[i].url}: ${response.status} ${response.statusText}`);
      }

      await new Promise<void>((resolve, reject) => {
        const dest = fs.createWriteStream(outPath);
        Readable.fromWeb(response.body as any).pipe(dest);
        dest.on('finish', () => {
          console.log(`[${fileName}] ✅ Downloaded video ${i} -> ${outPath}`);
          downloadedVideos.push({ index: i, path: outPath });
          resolve();
        });
        dest.on('error', reject);
      });
    }

    return downloadedVideos;
  };

  private async probeVideos(downloadedVideos: { index: number; path: string }[], fileName: string, width: number, height: number) {
    const warnings: string[] = [];
    const videoDimensions: { originalIndex: number; width: number; height: number; duration: number; path: string; audioBitrate: string }[] = [];

    for (const downloadedVideo of downloadedVideos) {
      const filePath = downloadedVideo.path;
      console.log(`[${fileName}] Probing video ${downloadedVideo.index} at ${filePath}`);

      try {
        const meta: ffmpeg.FfprobeData = await new Promise((resolve, reject) => {
          ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
              return reject(err instanceof Error ? err : new Error(String(err)));
            }
            resolve(metadata);
          });
        });

        const s = meta.streams.find((s) => s.width && s.height);
        const audioStream = meta.streams.find((s) => s.codec_type === 'audio');

        if (!s) {
          warnings.push(`Video ${downloadedVideo.index} has no video stream`);
        } else {
          videoDimensions.push({
            originalIndex: downloadedVideo.index,
            width: s.width!,
            height: s.height!,
            duration: parseFloat(s.duration ?? '0') || 0,
            path: filePath,
            audioBitrate: audioStream ? (audioStream.bit_rate || '192k') : '192k'
          });

          console.log(`[${fileName}] Video ${downloadedVideo.index}: ${s.width}x${s.height}, duration: ${parseFloat(s.duration || '0') || 0}s`);

          if (s.width !== width || s.height !== height) {
            warnings.push(`Video ${downloadedVideo.index} is ${s.width}x${s.height}, expected ${width}x${height}`);
          }
        }
      } catch (err: any) {
        warnings.push(`Error probing video ${downloadedVideo.index}: ${err.message}`);
      }
    }

    return { warnings, videoDimensions };
  };

  private async standardizeVideos(videoDimensions: any[], jobTemp: string, fileName: string, width: number, height: number): Promise<string[]> {
    const standardizedVideos: string[] = [];

    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }

      const standardizedPath = path.join(jobTemp, `standardized_${String(i).padStart(3, '0')}.mp4`);
      console.log(`[${fileName}] Starting standardization of video ${inputVideo.originalIndex} (position ${i}) (${inputVideo.width}x${inputVideo.height}) to ${width}x${height}...`);

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg(inputVideo.path)
          .outputOptions([
            `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
            '-c:v libx264',
            '-preset medium',
            '-crf 18',
            '-c:a aac',
            '-b:a 320k',
            '-ar 48000',
            '-ac 2'
          ])
          .output(standardizedPath)
          .on('start', () => {
            console.log(`[${fileName}] FFmpeg standardization of video ${inputVideo.originalIndex} (position ${i}) started`);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`[${fileName}] Standardizing video ${inputVideo.originalIndex} (pos ${i}): ${progress.percent.toFixed(2)}% done`);
            }
          })
          .on('end', () => {
            console.log(`[${fileName}] ✅ Standardized video ${inputVideo.originalIndex} (position ${i}) successfully`);
            standardizedVideos.push(standardizedPath);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[${fileName}] Error standardizing video ${inputVideo.originalIndex} (position ${i}): ${err.message}`);
            reject(err);
          });

        command.run();
      });
    }

    return standardizedVideos;
  };

  private async concatenateVideos(standardizedVideos: string[], videoDimensions: any[], jobTemp: string, fileName: string, extension: string, codec: string, bitrate: string): Promise<string> {
    const concatFilePath = path.join(jobTemp, 'concat.txt');
    const concatFileContent = standardizedVideos.map((file, index) => {
      console.log(`[${fileName}] Concat order ${index}: ${path.basename(file)}`);
      return `file '${file}'`;
    }).join('\n');

    fs.writeFileSync(concatFilePath, concatFileContent);
    console.log(`[${fileName}] Concat file created with guaranteed order:`);
    console.log(concatFileContent);

    const outputPath = path.join(PUBLIC_DIR, `${fileName}${extension}`);

    const highestAudioBitrate = videoDimensions
      .filter(Boolean)
      .reduce((max, video) => {
        const bitNum = parseInt(video.audioBitrate);
        return isNaN(bitNum) ? max : Math.max(max, bitNum);
      }, 192000);

    const audioBitrate = Math.max(parseInt(bitrate) || 320000, highestAudioBitrate).toString();
    console.log(`[${fileName}] Starting concatenation of ${standardizedVideos.length} videos with audio bitrate ${audioBitrate}`);

    await new Promise<void>((resolve, reject) => {
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
          `-preset slow`
        ])
        .output(outputPath);

      const ffmpegCommandString = ffmpegCmd._getArguments().join(' ');
      console.log(`[${fileName}] FFmpeg concat command: ffmpeg ${ffmpegCommandString}`);

      ffmpegCmd
        .on('start', (cmd) => {
          console.log(`[${fileName}] FFmpeg concat started with command: ${cmd}`);
        })
        .on('progress', progress => {
          const percent = progress.percent ? progress.percent.toFixed(2) : 'unknown';
          const frames = progress.frames || 0;
          const fps = progress.currentFps || 0;
          console.log(`[${fileName}] Processing: ${percent}% done | Frames: ${frames} | FPS: ${fps}`);
        })
        .on('end', () => {
          console.log(`[${fileName}] FFmpeg processing finished. Output at ${outputPath}`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`[${fileName}] FFmpeg concat error: ${err.message}`);
          console.error(`[${fileName}] FFmpeg stderr: ${stderr}`);
          reject(err);
        })
        .run();
    });

    return outputPath;
  };

  private async notifyWebhook(webhookDestination: string, payload: any, fileName: string): Promise<void> {
    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log(`[${fileName}] Webhook response: ${response.status} ${response.statusText}`);
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook: ${webhookErr.message}`);
    }
  };

}