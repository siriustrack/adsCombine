import { ASSETS_IMG, FEED_FULLY_IMGS_DIR, FEED_IMGS_DIR, IMGS_DIR, STORY_FULLY_IMGS_DIR, STORY_IMGS_DIR, TEMP_DIR } from 'config/dirs';
import { env } from 'config/env';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import FormData from 'form-data';
import fs from 'node:fs';
import path from 'node:path';

const imagesRouter = express.Router();

imagesRouter.post('/process', async (req, res) => {
  let { imageUrl, imageData, fileName } = req.body;


  if (fileName) {
    fileName = fileName.trim().replace(/[\r\n]/g, '');
  }

  console.log(`[${fileName}] Received image processing request`);


  if (!fileName) {
    console.error(`Missing fileName`);
    return res.status(400).json({ error: 'Missing required field: fileName' });
  }

  if (!imageUrl && !imageData) {
    console.error(`[${fileName}] Missing image source`);
    return res.status(400).json({ error: 'Must provide either imageUrl or imageData' });
  }


  if (!process.env.STABILITY_API_KEY) {
    console.error(`[${fileName}] Missing STABILITY_API_KEY`);
    return res.status(500).json({ error: 'Stability AI API key not configured' });
  }


  const jobId = `img-${fileName}-${Date.now()}`;
  const jobTemp = path.join(TEMP_DIR, jobId);
  fs.mkdirSync(jobTemp, { recursive: true });
  console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

  try {

    console.log(`[${fileName}] Processing image...`);
    const inputImagePath = path.join(jobTemp, 'input.png');

    if (imageData) {

      console.log(`[${fileName}] Processing base64 image data...`);


      const base64Data = imageData.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');

      fs.writeFileSync(inputImagePath, imageBuffer);
      console.log(`[${fileName}] Base64 image saved successfully`);

    } else if (imageUrl) {

      console.log(`[${fileName}] Downloading image from URL...`);

      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      fs.writeFileSync(inputImagePath, imageBuffer);
      console.log(`[${fileName}] Image downloaded successfully`);
    }


    const feedOutputPath = path.join(FEED_IMGS_DIR, `${fileName}_feed.png`);
    console.log(`[${fileName}] Creating FEED version (1080x1350)...`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputImagePath)
        .outputOptions([
          '-vf scale=1024:1024,pad=1080:1350:(ow-iw)/2:(oh-ih)/2:white',
          '-vframes 1'
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


    const storyOutputPath = path.join(STORY_IMGS_DIR, `${fileName}_story.png`);
    console.log(`[${fileName}] Creating STORY version (1080x1920)...`);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputImagePath)
        .outputOptions([
          '-vf scale=1024:1024,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:white',
          '-vframes 1'
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


    console.log(`[${fileName}] Starting Stability AI image completion...`);


    const generateStabilityImage = async (inputPath: string, outputPath: string, targetWidth: number, targetHeight: number, maskType: string) => {

      const maxPixels = 1048576;
      const aspectRatio = targetWidth / targetHeight;

      let aiWidth, aiHeight;
      if (targetWidth * targetHeight > maxPixels) {

        aiHeight = Math.floor(Math.sqrt(maxPixels / aspectRatio));
        aiWidth = Math.floor(aiHeight * aspectRatio);


        aiWidth = Math.floor(aiWidth / 64) * 64;
        aiHeight = Math.floor(aiHeight / 64) * 64;

        console.log(`[${fileName}] Resizing from ${targetWidth}x${targetHeight} to ${aiWidth}x${aiHeight} for Stability AI (${aiWidth * aiHeight} pixels)`);
      } else {
        aiWidth = targetWidth;
        aiHeight = targetHeight;
      }

      const originalMaskPath = path.join(ASSETS_IMG, `mask${maskType}.png`);

      const maskPath = path.join(jobTemp, `mask_${aiWidth}x${aiHeight}.png`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(originalMaskPath)
          .outputOptions([
            `-vf scale=${aiWidth}:${aiHeight}`,
            '-vframes 1'
          ])
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


      const canvasPath = path.join(jobTemp, `canvas_${aiWidth}x${aiHeight}.png`);


      const imageSize = Math.min(aiWidth, aiHeight, 1024);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .outputOptions([
            `-vf scale=${imageSize}:${imageSize},pad=${aiWidth}:${aiHeight}:(ow-iw)/2:(oh-ih)/2:white`,
            '-vframes 1'
          ])
          .output(canvasPath)
          .on('start', () => {
            console.log(`[${fileName}] Creating canvas ${aiWidth}x${aiHeight} with centered ${imageSize}x${imageSize} image...`);
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


      const form = new FormData();

      console.log(`[${fileName}] Canvas image size: ${fs.statSync(canvasPath).size} bytes`);
      console.log(`[${fileName}] Resized mask size: ${fs.statSync(maskPath).size} bytes`);

      form.append('image', fs.createReadStream(canvasPath), {
        filename: 'image.png',
        contentType: 'image/png'
      });

      form.append('mask', fs.createReadStream(maskPath), {
        filename: 'mask.png',
        contentType: 'image/png'
      });


      form.append('prompt', 'Extend the advertising background maintaining the exact same style, colors, lighting and professional composition. Seamless background extension, high quality, professional advertising material.');
      form.append('negative_prompt', 'blurry, low quality, distorted, artifacts, bad composition, inconsistent lighting, different style');
      form.append('mode', 'image-to-image');
      form.append('output_format', 'png');
      form.append('strength', '0.8');

      console.log(`[${fileName}] Sending outpainting request to Stability AI API for ${aiWidth}x${aiHeight} (${aiWidth * aiHeight} pixels)...`);


      const response = await fetch('https://api.stability.ai/v2beta/stable-image/edit/inpaint', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Accept': 'image/*',
          ...form.getHeaders()
        },
        body: form as any
      });

      console.log(`[${fileName}] Stability AI response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${fileName}] Stability AI error details: ${errorText}`);
        throw new Error(`Stability AI error: ${response.status} ${errorText}`);
      }


      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      console.log(`[${fileName}] Stability AI success, received image buffer of ${imageBuffer.length} bytes`);


      if (aiWidth !== targetWidth || aiHeight !== targetHeight) {
        console.log(`[${fileName}] Resizing AI result back to ${targetWidth}x${targetHeight}...`);

        const tempAiPath = path.join(jobTemp, `ai_temp_${aiWidth}x${aiHeight}.png`);
        fs.writeFileSync(tempAiPath, imageBuffer);

        await new Promise<void>((resolve, reject) => {
          ffmpeg(tempAiPath)
            .outputOptions([
              `-vf scale=${targetWidth}:${targetHeight}`,
              '-vframes 1'
            ])
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
      } else {

        fs.writeFileSync(outputPath, imageBuffer);
      }

      console.log(`[${fileName}] AI ${targetWidth}x${targetHeight} version saved successfully`);
    };


    const feedFullyOutputPath = path.join(FEED_FULLY_IMGS_DIR, `${fileName}_feed_fully.png`);
    console.log(`[${fileName}] Creating AI FEED FULLY version (1080x1350)...`);
    await generateStabilityImage(inputImagePath, feedFullyOutputPath, 1080, 1350, 'Feed');


    const storyFullyOutputPath = path.join(STORY_FULLY_IMGS_DIR, `${fileName}_story_fully.png`);
    console.log(`[${fileName}] Creating AI STORY FULLY version (1080x1920)...`);
    await generateStabilityImage(inputImagePath, storyFullyOutputPath, 1080, 1920, 'Story');


    console.log(`[${fileName}] Image processing completed successfully`);


    const originalOutputPath = path.join(IMGS_DIR, `${fileName}_original.png`);
    fs.copyFileSync(inputImagePath, originalOutputPath);
    console.log(`[${fileName}] Original image saved to ${originalOutputPath}`);


    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);


    const baseUrl = env.BASE_URL.startsWith('http') ? env.BASE_URL : `https://${env.BASE_URL}`;
    const feedUrl = `${baseUrl}/files/imgs/feed/${fileName}_feed.png`;
    const storyUrl = `${baseUrl}/files/imgs/story/${fileName}_story.png`;
    const originalUrl = `${baseUrl}/files/imgs/${fileName}_original.png`;
    const feedFullyUrl = `${baseUrl}/files/imgs/feed-fully/${fileName}_feed_fully.png`;
    const storyFullyUrl = `${baseUrl}/files/imgs/story-fully/${fileName}_story_fully.png`;


    res.status(200).json({
      feedUrl,
      storyUrl,
      inputUrl: originalUrl,
      feedFullyUrl,
      storyFullyUrl
    });

    console.log(`[${fileName}] Response sent with URLs: feed = ${feedUrl}, story = ${storyUrl}, original = ${originalUrl}, feedFully = ${feedFullyUrl}, storyFully = ${storyFullyUrl} `);
    return

  } catch (err: any) {
    console.error(`[${fileName}] Image processing error: ${err.message} `);


    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr: any) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message} `);
    }

    return res.status(500).json({ error: `Failed to process image: ${err.message} ` });
  }
});

export default imagesRouter;