import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ASSETS_IMG,
  FEED_FULLY_IMGS_DIR,
  FEED_IMGS_DIR,
  IMGS_DIR,
  STORY_FULLY_IMGS_DIR,
  STORY_IMGS_DIR,
  TEMP_DIR,
} from '@config/dirs';
import { env } from '@config/env';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { Service } from '@lib/service.types';
import ffmpeg from 'fluent-ffmpeg';
import FormData from 'form-data';

export class ProcessImageService implements Service {
  async execute({
    fileName,
    imageData,
    imageUrl,
  }: {
    imageUrl: string;
    imageData: string;
    fileName: string;
  }) {
    if (fileName) {
      fileName = fileName.trim().replace(/[\r\n]/g, '');
    }

    console.log(`[${fileName}] Received image processing request`);

    if (!fileName) {
      console.error(`Missing fileName`);
      return errResult({ status: 400, message: 'Missing required field: fileName' });
    }

    if (!imageUrl && !imageData) {
      console.error(`[${fileName}] Missing image source`);
      return errResult({ status: 400, message: 'Must provide either imageUrl or imageData' });
    }

    if (!process.env.STABILITY_API_KEY) {
      console.error(`[${fileName}] Missing STABILITY_API_KEY`);
      return errResult({ status: 500, message: 'Stability AI API key not configured' });
    }

    const jobId = `img-${fileName}-${Date.now()}`;
    const jobTemp = path.join(TEMP_DIR, jobId);
    const { error } = await wrapPromiseResult<string | undefined, Error>(fs.mkdir(jobTemp, { recursive: true }));

    if (error) {
      console.error(`[${fileName}] Error creating temp directory: ${error.message}`);
      return errResult({
        status: 500,
        message: `Failed to create temp directory: ${error.message}`,
      });
    }

    console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

    const inputImagePath = path.join(jobTemp, 'input.png');

    const processResult = await this.processInputImage(imageData, imageUrl, inputImagePath, fileName);
    if (processResult.error) {
      return processResult;
    }

    const versionResult = await this.createBasicVersions(inputImagePath, fileName);
    if (versionResult.error) {
      return versionResult;
    }

    console.log(`[${fileName}] Starting Stability AI image completion...`);

    const feedFullyOutputPath = path.join(FEED_FULLY_IMGS_DIR, `${fileName}_feed_fully.png`);
    console.log(`[${fileName}] Creating AI FEED FULLY version (1080x1350)...`);

    const { error: feedFullyError } = await wrapPromiseResult(this.generateStabilityImage({
      inputPath: inputImagePath,
      outputPath: feedFullyOutputPath,
      targetWidth: 1080,
      targetHeight: 1350,
      maskType: 'Feed',
      fileName,
      jobTemp
    }));

    if (feedFullyError) {
      console.error(`[${fileName}] Error creating AI FEED FULLY version:`, feedFullyError);
      return errResult({
        status: 500,
        message: `Failed to create AI FEED FULLY version: ${feedFullyError}`,
      });
    }

    const storyFullyOutputPath = path.join(STORY_FULLY_IMGS_DIR, `${fileName}_story_fully.png`);
    console.log(`[${fileName}] Creating AI STORY FULLY version (1080x1920)...`);

    const { error: storyFullyError } = await wrapPromiseResult(this.generateStabilityImage({
      inputPath: inputImagePath,
      outputPath: storyFullyOutputPath,
      targetWidth: 1080,
      targetHeight: 1920,
      maskType: 'Story',
      fileName,
      jobTemp
    }));
    if (storyFullyError) {
      console.error(`[${fileName}] Error creating AI STORY FULLY version:`, storyFullyError);
      return errResult({
        status: 500,
        message: `Failed to create AI STORY FULLY version: ${storyFullyError}`,
      });
    }

    console.log(`[${fileName}] Image processing completed successfully`);

    const originalOutputPath = path.join(IMGS_DIR, `${fileName}_original.png`);

    const { error: copyError } = await wrapPromiseResult(fs.copyFile(inputImagePath, originalOutputPath));
    if (copyError) {
      console.error(`[${fileName}] Error copying original file:`, copyError);
      return errResult({
        status: 500,
        message: `Failed to copy original file: ${copyError}`,
      });
    }
    console.log(`[${fileName}] Original image saved to ${originalOutputPath}`);

    const { error: cleanupError } = await wrapPromiseResult(fs.rm(jobTemp, { recursive: true, force: true }));
    if (cleanupError) {
      console.error(`[${fileName}] Error cleaning temp directory:`, cleanupError);
      // Continue despite cleanup error
    } else {
      console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);
    }

    const baseUrl = env.BASE_URL.startsWith('http') ? env.BASE_URL : `https://${env.BASE_URL}`;
    const feedUrl = `${baseUrl}/files/imgs/feed/${fileName}_feed.png`;
    const storyUrl = `${baseUrl}/files/imgs/story/${fileName}_story.png`;
    const originalUrl = `${baseUrl}/files/imgs/${fileName}_original.png`;
    const feedFullyUrl = `${baseUrl}/files/imgs/feed-fully/${fileName}_feed_fully.png`;
    const storyFullyUrl = `${baseUrl}/files/imgs/story-fully/${fileName}_story_fully.png`;

    console.log(
      `[${fileName}] Response sent with URLs: feed = ${feedUrl}, story = ${storyUrl}, original = ${originalUrl}, feedFully = ${feedFullyUrl}, storyFully = ${baseUrl}/files/imgs/story-fully/${fileName}_story_fully.png `
    );

    return okResult({
      status: 200,
      data: {
        feedUrl,
        storyUrl,
        inputUrl: originalUrl,
        feedFullyUrl,
        storyFullyUrl,
      },
    });
  }

  private async processInputImage(imageData: string | undefined, imageUrl: string | undefined, inputImagePath: string, fileName: string): Promise<Result<void, { status: number; message: string }>> {
    if (imageData) {
      console.log(`[${fileName}] Processing base64 image data...`);

      const base64Data = imageData.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      const { error: writeError } = await wrapPromiseResult(fs.writeFile(inputImagePath, imageBuffer));
      if (writeError) {
        console.error(`[${fileName}] Error writing base64 image:`, writeError);
        return errResult({
          status: 500,
          message: `Failed to write base64 image: ${writeError}`,
        });
      }
      console.log(`[${fileName}] Base64 image saved successfully`);
    } else if (imageUrl) {
      console.log(`[${fileName}] Downloading image from URL...`);

      const { value: response, error: fetchError } = await wrapPromiseResult(fetch(imageUrl));
      if (fetchError) {
        console.error(`[${fileName}] Error downloading image:`, fetchError);
        return errResult({
          status: 500,
          message: `Failed to download image: ${fetchError}`,
        });
      }

      if (!response!.ok) {
        console.error(`[${fileName}] Image download failed: ${response!.status} ${response!.statusText}`);
        return errResult({
          status: 500,
          message: `Failed to download image: ${response!.status} ${response!.statusText}`,
        });
      }

      const { value: arrayBuffer, error: bufferError } = await wrapPromiseResult(response!.arrayBuffer());
      if (bufferError) {
        console.error(`[${fileName}] Error reading image buffer:`, bufferError);
        return errResult({
          status: 500,
          message: `Failed to read image buffer: ${bufferError}`,
        });
      }

      const imageBuffer = Buffer.from(arrayBuffer!);

      const { error: writeError } = await wrapPromiseResult(fs.writeFile(inputImagePath, imageBuffer));
      if (writeError) {
        console.error(`[${fileName}] Error writing downloaded image:`, writeError);
        return errResult({
          status: 500,
          message: `Failed to write downloaded image: ${writeError}`,
        });
      }
      console.log(`[${fileName}] Image downloaded successfully`);
    }

    return okResult(undefined);
  }

  private async createBasicVersions(inputImagePath: string, fileName: string): Promise<Result<void, { status: number; message: string }>> {
    const feedOutputPath = path.join(FEED_IMGS_DIR, `${fileName}_feed.png`);
    console.log(`[${fileName}] Creating FEED version (1080x1350)...`);

    const createFeedPromise = new Promise<void>((resolve, reject) => {
      ffmpeg(inputImagePath)
        .outputOptions([
          '-vf scale=1024:1024,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:white',
          '-vframes 1',
        ])
        .output(feedOutputPath)
        .on('start', () => {
          console.log(`[${fileName}] FFmpeg FEED processing started`);
        })
        .on('end', () => {
          console.log(`[${fileName}] FEED version completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${fileName}] Error creating FEED version: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const { error: feedError } = await wrapPromiseResult(createFeedPromise);
    if (feedError) {
      console.error(`[${fileName}] Error creating FEED version:`, feedError);
      return errResult({
        status: 500,
        message: `Failed to create FEED version: ${feedError}`,
      });
    }

    const storyOutputPath = path.join(STORY_IMGS_DIR, `${fileName}_story.png`);
    console.log(`[${fileName}] Creating STORY version (1080x1920)...`);

    const createStoryPromise = new Promise<void>((resolve, reject) => {
      ffmpeg(inputImagePath)
        .outputOptions([
          '-vf scale=1024:1024,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:white',
          '-vframes 1',
        ])
        .output(storyOutputPath)
        .on('start', () => {
          console.log(`[${fileName}] FFmpeg STORY processing started`);
        })
        .on('end', () => {
          console.log(`[${fileName}] STORY version completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${fileName}] Error creating STORY version: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const { error: storyError } = await wrapPromiseResult(createStoryPromise);
    if (storyError) {
      console.error(`[${fileName}] Error creating STORY version:`, storyError);
      return errResult({
        status: 500,
        message: `Failed to create STORY version: ${storyError}`,
      });
    }

    return okResult(undefined);
  }

  private async generateStabilityImage(
    { inputPath, outputPath, targetWidth, targetHeight, maskType, fileName, jobTemp }: { inputPath: string; outputPath: string; targetWidth: number; targetHeight: number; maskType: string; fileName: string; jobTemp: string }) {
    const maxPixels = 1048576;
    const aspectRatio = targetWidth / targetHeight;

    let aiWidth: number, aiHeight: number;
    if (targetWidth * targetHeight > maxPixels) {
      aiHeight = Math.floor(Math.sqrt(maxPixels / aspectRatio));
      aiWidth = Math.floor(aiHeight * aspectRatio);

      aiWidth = Math.floor(aiWidth / 64) * 64;
      aiHeight = Math.floor(aiHeight / 64) * 64;

      console.log(
        `[${fileName}] Resizing from ${targetWidth}x${targetHeight} to ${aiWidth}x${aiHeight} for Stability AI (${aiWidth * aiHeight} pixels)`
      );
    } else {
      aiWidth = targetWidth;
      aiHeight = targetHeight;
    }

    const originalMaskPath = path.join(ASSETS_IMG, `mask${maskType}.png`);

    const maskPath = path.join(jobTemp, `mask_${aiWidth}x${aiHeight}.png`);

    const { error: maskError } = await this.resizeMaskForAI(originalMaskPath, maskPath, aiWidth, aiHeight, fileName);
    if (maskError) {
      console.error(`[${fileName}] Error resizing mask:`, maskError);
      throw new Error(`Failed to resize mask: ${maskError}`);
    }

    const canvasPath = path.join(jobTemp, `canvas_${aiWidth}x${aiHeight}.png`);

    const imageSize = Math.min(aiWidth, aiHeight, 1024);

    const { error: canvasError } = await this.createCanvasForAI(inputPath, canvasPath, imageSize, aiWidth, aiHeight, fileName);
    if (canvasError) {
      console.error(`[${fileName}] Error creating canvas:`, canvasError);
      throw new Error(`Failed to create canvas: ${canvasError}`);
    }

    const { value: form, error: formError } = await this.prepareFormData(canvasPath, maskPath, fileName);
    if (formError) {
      throw formError;
    }

    const { value: imageBuffer, error: stabilityError } = await this.callStabilityAPI(form, aiWidth, aiHeight, fileName);
    if (stabilityError) {
      console.error(`[${fileName}] Error calling Stability AI:`, stabilityError);
      throw new Error(`Failed to call Stability AI: ${stabilityError}`);
    }

    if (aiWidth !== targetWidth || aiHeight !== targetHeight) {
      console.log(`[${fileName}] Resizing AI result back to ${targetWidth}x${targetHeight}...`);

      const tempAiPath = path.join(jobTemp, `ai_temp_${aiWidth}x${aiHeight}.png`);

      const { error: writeError } = await wrapPromiseResult(fs.writeFile(tempAiPath, imageBuffer));
      if (writeError) {
        console.error(`[${fileName}] Error writing temp AI file:`, writeError);
        throw new Error(`Failed to write temp AI file: ${writeError}`);
      }

      const { error: upscaleError } = await this.upscaleAIResult(tempAiPath, outputPath, targetWidth, targetHeight, fileName);
      if (upscaleError) {
        console.error(`[${fileName}] Error upscaling AI result:`, upscaleError);
        throw new Error(`Failed to upscale AI result: ${upscaleError}`);
      }
    } else {
      const { error: writeError } = await wrapPromiseResult(fs.writeFile(outputPath, imageBuffer));
      if (writeError) {
        console.error(`[${fileName}] Error writing AI output:`, writeError);
        throw new Error(`Failed to write AI output: ${writeError}`);
      }
    }

    console.log(`[${fileName}] AI ${targetWidth}x${targetHeight} version saved successfully`);
  };

  private async callStabilityAPI(form: FormData, aiWidth: number, aiHeight: number, fileName: string): Promise<Result<Buffer, Error>> {
    console.log(
      `[${fileName}] Sending outpainting request to Stability AI API for ${aiWidth}x${aiHeight} (${aiWidth * aiHeight} pixels)...`
    );

    const { value: response, error: fetchError } = await wrapPromiseResult(fetch('https://api.stability.ai/v2beta/stable-image/edit/inpaint', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
        Accept: 'image/*',
        ...form.getHeaders(),
      },
      // @ts-ignore - FormData compatibility issue with fetch types
      body: form,
    }));

    if (fetchError) {
      console.error(`[${fileName}] Error calling Stability AI:`, fetchError);
      return errResult(new Error(`Stability AI fetch failed: ${fetchError}`));
    }

    console.log(`[${fileName}] Stability AI response status: ${response!.status}`);

    if (!response!.ok) {
      const { value: errorText, error: textError } = await wrapPromiseResult(response!.text());
      const errorMessage = textError ? 'Unable to read error details' : errorText;
      console.error(`[${fileName}] Stability AI error details: ${errorMessage}`);
      return errResult(new Error(`Stability AI message: ${response!.status} ${errorMessage}`));
    }

    const { value: arrayBuffer, error: bufferError } = await wrapPromiseResult(response!.arrayBuffer());
    if (bufferError) {
      console.error(`[${fileName}] Error reading response buffer:`, bufferError);
      return errResult(new Error(`Failed to read response buffer: ${bufferError}`));
    }

    const imageBuffer = Buffer.from(arrayBuffer!);
    console.log(
      `[${fileName}] Stability AI success, received image buffer of ${imageBuffer.length} bytes`
    );

    return okResult(imageBuffer);
  }

  private async resizeMaskForAI(originalMaskPath: string, maskPath: string, aiWidth: number, aiHeight: number, fileName: string): Promise<Result<void, Error>> {
    const resizeMaskPromise = new Promise<void>((resolve, reject) => {
      ffmpeg(originalMaskPath)
        .outputOptions([`-vf scale=${aiWidth}:${aiHeight}`, '-vframes 1'])
        .output(maskPath)
        .on('start', () => {
          console.log(`[${fileName}] Resizing mask to ${aiWidth}x${aiHeight}...`);
        })
        .on('end', () => {
          console.log(`[${fileName}] Mask resized successfully`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${fileName}] Error resizing mask: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const { error } = await wrapPromiseResult(resizeMaskPromise);
    if (error) {
      console.error(`[${fileName}] Error resizing mask:`, error);
      return errResult(new Error(`Failed to resize mask: ${error}`));
    }
    return okResult(undefined);
  }

  private async createCanvasForAI(inputPath: string, canvasPath: string, imageSize: number, aiWidth: number, aiHeight: number, fileName: string): Promise<Result<void, Error>> {
    const createCanvasPromise = new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          `-vf scale=${imageSize}:${imageSize},pad=${aiWidth}:${aiHeight}:(ow-iw)/2:(oh-ih)/2:white`,
          '-vframes 1',
        ])
        .output(canvasPath)
        .on('start', () => {
          console.log(
            `[${fileName}] Creating canvas ${aiWidth}x${aiHeight} with centered ${imageSize}x${imageSize} image...`
          );
        })
        .on('end', () => {
          console.log(`[${fileName}] Canvas created successfully`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${fileName}] Error creating canvas: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const { error } = await wrapPromiseResult(createCanvasPromise);
    if (error) {
      console.error(`[${fileName}] Error creating canvas:`, error);
      return errResult(new Error(`Failed to create canvas: ${error}`));
    }
    return okResult(undefined);
  }

  private async upscaleAIResult(tempAiPath: string, outputPath: string, targetWidth: number, targetHeight: number, fileName: string): Promise<Result<void, Error>> {
    const upscalePromise = new Promise<void>((resolve, reject) => {
      ffmpeg(tempAiPath)
        .outputOptions([`-vf scale=${targetWidth}:${targetHeight}`, '-vframes 1'])
        .output(outputPath)
        .on('start', () => {
          console.log(`[${fileName}] Upscaling AI result...`);
        })
        .on('end', () => {
          console.log(`[${fileName}] AI result upscaled successfully`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${fileName}] Error upscaling AI result: ${err.message}`);
          reject(err);
        })
        .run();
    });

    const { error } = await wrapPromiseResult(upscalePromise);
    if (error) {
      console.error(`[${fileName}] Error upscaling AI result:`, error);
      return errResult(new Error(`Failed to upscale AI result: ${error}`));
    }
    return okResult(undefined);
  }

  private async prepareFormData(canvasPath: string, maskPath: string, fileName: string): Promise<Result<FormData, Error>> {
    const form = new FormData();

    const { value: canvasStat, error: canvasStatError } = await wrapPromiseResult(fs.stat(canvasPath));
    if (canvasStatError) {
      console.error(`[${fileName}] Error getting canvas stats:`, canvasStatError);
      return errResult(new Error(`Failed to get canvas stats: ${canvasStatError}`));
    }
    console.log(`[${fileName}] Canvas image size: ${canvasStat!.size} bytes`);

    const { value: maskStat, error: maskStatError } = await wrapPromiseResult(fs.stat(maskPath));
    if (maskStatError) {
      console.error(`[${fileName}] Error getting mask stats:`, maskStatError);
      return errResult(new Error(`Failed to get mask stats: ${maskStatError}`));
    }
    console.log(`[${fileName}] Resized mask size: ${maskStat!.size} bytes`);

    form.append('image', createReadStream(canvasPath), {
      filename: 'image.png',
      contentType: 'image/png',
    });

    form.append('mask', createReadStream(maskPath), {
      filename: 'mask.png',
      contentType: 'image/png',
    });

    form.append(
      'prompt',
      'Extend the advertising background maintaining the exact same style, colors, lighting and professional composition. Seamless background extension, high quality, professional advertising material.'
    );
    form.append(
      'negative_prompt',
      'blurry, low quality, distorted, artifacts, bad composition, inconsistent lighting, different style'
    );
    form.append('mode', 'image-to-image');
    form.append('output_format', 'png');
    form.append('strength', '0.8');

    return okResult(form);
  }
}
