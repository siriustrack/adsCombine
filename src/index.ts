import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import express, { type NextFunction, type Request, type Response } from 'express';
import ffmpeg from 'fluent-ffmpeg';
import morgan from 'morgan';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import serveIndex from 'serve-index';
import logger from './lib/logger';
import processRouter from './routes/process';
import { swaggerSpec, swaggerUi } from './swagger';
import FormData from 'form-data';

ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));

// Health check endpoint for Docker
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// —————————————————————————————
// API Routes
app.use('/api', processRouter);

const swaggerHandlers = [...swaggerUi.serve, swaggerUi.setup(swaggerSpec)];
app.use('/api-docs', swaggerHandlers as any);
// —————————————————————————————



app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Express error:', err);
  res.status(500).json({ error: err.message });
});


process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});


process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});


const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TOKEN;
const BASE_URL = process.env.BASE_URL;

const publicDir = path.join(__dirname, 'public');
const tempDir = path.join(__dirname, 'temp');
const textsDir = path.join(__dirname, 'public', 'texts');


if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(textsDir)) fs.mkdirSync(textsDir, { recursive: true });



app.use('/texts', express.static(textsDir));

app.use(
  '/files',
  express.static(publicDir, {

    setHeaders: (res, filePath) => {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }),
  serveIndex(publicDir, { icons: true }) as any
);

interface VideoMeta {

  [key: string]: any;
}
const videosMeta: VideoMeta[] = [];


app.use((req: Request, res: Response, next: NextFunction) => {

  if (req.path === '/' || req.path.startsWith('/files') || req.path.startsWith('/texts') || req.path.startsWith('/api-docs') || req.path.startsWith('/api/process-message')) {
    return next();
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    logger.error(`Unauthorized access attempt`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.split(' ')[1];
  if (token !== TOKEN) {
    logger.error(`Forbidden: Invalid token`);
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});


/**
 * @openapi
 * /videos:
 *   post:
 *     summary: Processa e concatena vídeos via FFmpeg
 *     tags:
 *       - Vídeos
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               webhookDestination:
 *                 type: string
 *                 format: uri
 *               fileName:
 *                 type: string
 *               extension:
 *                 type: string
 *                 enum: ['.mp4']
 *               width:
 *                 type: integer
 *               height:
 *                 type: integer
 *               codec:
 *                 type: string
 *               bitrate:
 *                 type: string
 *               videos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *     responses:
 *       '200':
 *         description: Processamento iniciado
 *       '400':
 *         description: Campos obrigatórios ausentes ou inválidos
 *       '401':
 *         description: Não autorizado
 *       '500':
 *         description: Erro interno de servidor
 */

interface VideoRequestBody {
  webhookDestination: string;
  fileName: string;
  extension: '.mp4';
  width: number;
  height: number;
  codec: string;
  bitrate: string;
  videos: { url: string }[];
}

app.post('/videos', async (req: Request, res: Response) => {
  const { webhookDestination, fileName, extension, width, height, codec, bitrate, videos } = req.body;

  console.log(`[${fileName}] Received request: ${JSON.stringify({
    fileName,
    extension,
    width,
    height,
    codec,
    bitrate,
    videoCount: videos?.length || 0
  })}`);


  if (!webhookDestination || !fileName || !extension || !width || !height || !codec || !bitrate || !videos) {
    console.error(`[${fileName}] Missing required fields`);
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (extension !== '.mp4') {
    console.error(`[${fileName}] Unsupported extension ${extension}`);
    return res.status(400).json({ error: 'Unsupported extension. Only .mp4 supported.' });
  }
  if (!Array.isArray(videos) || videos.length === 0) {
    console.error(`[${fileName}] Videos array invalid`);
    return res.status(400).json({ error: 'Videos array must not be empty' });
  }


  const jobId = `${fileName}-${Date.now()}`;
  const jobTemp = path.join(tempDir, jobId);
  fs.mkdirSync(jobTemp, { recursive: true });
  console.log(`[${fileName}] Created temp directory at ${jobTemp}`);


  console.log(`[${fileName}] Starting SEQUENTIAL download of ${videos.length} videos...`);
  const downloadedVideos: { index: number; path: string }[] = [];

  try {

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

    console.log(`[${fileName}] All videos downloaded sequentially in correct order`);
    console.log(`[${fileName}] Download order verification:`, downloadedVideos.map(v => `${v.index}: ${path.basename(v.path)}`));
  } catch (err: any) {
    console.error(`[${fileName}] Error downloading videos: ${err.message}`);
    try {
      await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook of download error: ${webhookErr.message}`);
    }
    return res.status(500).json({ error: 'Failed to download videos' });
  }


  console.log(`[${fileName}] Checking video dimensions in correct order...`);
  const warnings: string[] = [];
  const videoDimensions: { originalIndex: number; width: number; height: number; duration: number; path: string; audioBitrate: string }[] = [];


  for (let i = 0; i < downloadedVideos.length; i++) {
    const downloadedVideo = downloadedVideos[i];
    const filePath = downloadedVideo.path;

    console.log(`[${fileName}] Probing video ${downloadedVideo.index} at ${filePath}`);

    try {
      const meta: ffmpeg.FfprobeData = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            return reject(err);
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

  if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);


  console.log(`[${fileName}] Processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Processing started', warnings });


  console.log(`[${fileName}] Standardizing videos to ${width}x${height} in correct order...`);

  try {
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


    const concatFilePath = path.join(jobTemp, 'concat.txt');
    const concatFileContent = standardizedVideos.map((file, index) => {
      console.log(`[${fileName}] Concat order ${index}: ${path.basename(file)}`);
      return `file '${file}'`;
    }).join('\n');

    fs.writeFileSync(concatFilePath, concatFileContent);
    console.log(`[${fileName}] Concat file created with guaranteed order:`);
    console.log(concatFileContent);


    const outputPath = path.join(publicDir, `${fileName}${extension}`);


    const highestAudioBitrate = videoDimensions
      .filter(Boolean)
      .reduce((max, video) => {
        const bitNum = parseInt(video!.audioBitrate);
        return isNaN(bitNum) ? max : Math.max(max, bitNum);
      }, 192000);

    const audioBitrate = Math.max(parseInt(bitrate) || 320000, highestAudioBitrate).toString();
    console.log(`[${fileName}] Starting concatenation of ${standardizedVideos.length} videos with audio bitrate ${audioBitrate}`);
    console.log(`[${fileName}] Concat file created at ${concatFilePath} with content: ${concatFileContent}`);

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


    console.log(`[${fileName}] Video processing completed successfully`);


    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);


    const downloadUrl = `${BASE_URL}/files/${fileName}${extension}`;
    const stats = fs.statSync(outputPath);
    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, downloadUrl, size: stats.size, status: 'success' })
      });
      console.log(`[${fileName}] Webhook notified with success: ${downloadUrl}, response: ${response.status}`);
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook on success: ${webhookErr.message}`);
    }


    videosMeta.push({ webhookDestination, fileName, extension, width, height, downloadUrl });

    return;

  } catch (err: any) {
    console.error(`[${fileName}] Processing error: ${err.message}`);


    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr: any) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
    }


    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
      console.log(`[${fileName}] Webhook error response: ${response.status} ${response.statusText}`);
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook on error: ${webhookErr.message}`);
    }
    return res.status(500).json({ error: 'Failed to process videos' });
  }
});

/**
 * @openapi
 * /videos:
 *   get:
 *     summary: Retorna lista de metadados de vídeos processados
 *     tags:
 *       - Vídeos
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Lista de objetos com metadados dos vídeos
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   webhookDestination:
 *                     type: string
 *                     format: uri
 *                   fileName:
 *                     type: string
 *                   extension:
 *                     type: string
 *                   width:
 *                     type: integer
 *                   height:
 *                     type: integer
 *                   downloadUrl:
 *                     type: string
 *                     format: uri
 *       '401':
 *         description: Não autorizado (token faltando)
 *       '403':
 *         description: Proibido (token inválido)
 */
app.get('/videos', (req, res) => {
  res.json(videosMeta);
});

/**
 * @openapi
 * /videos:
 *   delete:
 *     summary: Remove um vídeo processado e seu arquivo associado
 *     tags:
 *       - Vídeos
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fileName:
 *                 type: string
 *             required:
 *               - fileName
 *     responses:
 *       '200':
 *         description: Vídeo deletado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Deleted
 *       '400':
 *         description: Requisição malformada
 *       '401':
 *         description: Não autorizado (token faltando)
 *       '403':
 *         description: Proibido (token inválido)
 *       '404':
 *         description: Vídeo não encontrado
 */
app.delete('/videos', (req, res) => {
  const { fileName } = req.body;
  const idx = videosMeta.findIndex(v => v.fileName === fileName);
  if (idx === -1) {
    console.error(`Delete failed: ${fileName} not found`);
    return res.status(404).json({ error: 'Not found' });
  }
  const { extension } = videosMeta[idx];
  const filePath = path.join(publicDir, `${fileName}${extension}`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted public file ${filePath}`);
  }
  videosMeta.splice(idx, 1);
  return res.json({ message: 'Deleted' });
});

/**
 * @openapi
 * /videos/create-raw-assets:
 *   post:
 *     summary: Cria 3 versões de assets dos vídeos - feed, story com tarjas e story fullscreen
 *     tags:
 *       - Vídeos
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               webhookDestination:
 *                 type: string
 *                 format: uri
 *               fileName:
 *                 type: string
 *               extension:
 *                 type: string
 *                 enum: ['.mp4']
 *               videos:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *     responses:
 *       '200':
 *         description: Processamento iniciado
 *       '400':
 *         description: Campos obrigatórios ausentes ou inválidos
 *       '401':
 *         description: Não autorizado
 *       '500':
 *         description: Erro interno de servidor
 */
app.post('/videos/create-raw-assets', async (req, res) => {
  const { webhookDestination, fileName, extension, videos } = req.body;

  console.log(`[${fileName}] Received create-raw-assets request: ${JSON.stringify({
    fileName,
    extension,
    videoCount: videos?.length || 0
  })}`);


  if (!webhookDestination || !fileName || !extension || !videos) {
    console.error(`[${fileName}] Missing required fields`);
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (extension !== '.mp4') {
    console.error(`[${fileName}] Unsupported extension ${extension}`);
    return res.status(400).json({ error: 'Unsupported extension. Only .mp4 supported.' });
  }
  if (!Array.isArray(videos) || videos.length === 0) {
    console.error(`[${fileName}] Videos array invalid`);
    return res.status(400).json({ error: 'Videos array must not be empty' });
  }


  const feedDir = path.join(publicDir, 'feed');
  const storyTarjasDir = path.join(publicDir, 'story_tarjas');
  const storyFullscreenDir = path.join(publicDir, 'story_fullscreen');

  [feedDir, storyTarjasDir, storyFullscreenDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });


  const jobId = `assets-${fileName}-${Date.now()}`;
  const jobTemp = path.join(tempDir, jobId);
  fs.mkdirSync(jobTemp, { recursive: true });
  console.log(`[${fileName}] Created temp directory at ${jobTemp}`);


  console.log(`[${fileName}] Starting download of ${videos.length} videos...`);
  try {
    await Promise.all(videos.map((v, i) => {
      const outPath = path.join(jobTemp, `${i}.mp4`);
      return fetch(v.url)
        .then(response => {
          if (!response.ok) throw new Error(`Failed to download ${v.url}`);
          return new Promise<void>((resolve, reject) => {
            const dest = fs.createWriteStream(outPath);
            Readable.fromWeb(response.body as any).pipe(dest);
            dest.on('finish', () => {
              console.log(`[${fileName}] Downloaded video ${i} -> ${outPath}`);
              resolve();
            });
            dest.on('error', reject);
          });
        });
    }));
    console.log(`[${fileName}] All videos downloaded successfully`);
  } catch (err: any) {
    console.error(`[${fileName}] Error downloading videos: ${err.message}`);
    try {
      await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook of download error: ${webhookErr.message}`);
    }
    return res.status(500).json({ error: 'Failed to download videos' });
  }


  console.log(`[${fileName}] Checking video dimensions...`);
  const warnings: string[] = [];
  const videoDimensions: { originalIndex: number; width: number; height: number; duration: number; path: string; audioBitrate: string }[] = [];

  for (let i = 0; i < videos.length; i++) {
    const filePath = path.join(jobTemp, `${i}.mp4`);
    try {
      const meta: ffmpeg.FfprobeData = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err) {
            return reject(err);
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

  if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);


  console.log(`[${fileName}] Raw assets processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Raw assets processing started', warnings });

  try {

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


      let scaledPath = inputVideo.path;
      if (inputVideo.width === 1280 && inputVideo.height === 720) {
        scaledPath = path.join(jobTemp, `scaled-${i}.mp4`);
        console.log(`[${fileName}] Scaling video ${i} from 1280x720 to 1920x1080...`);

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
              console.log(`[${fileName}] FFmpeg scaling of video ${i} started`);
            })
            .on('progress', (progress) => {
              if (progress.percent) {
                console.log(`[${fileName}] Scaling video ${i}: ${progress.percent.toFixed(2)}% done`);
              }
            })
            .on('end', () => {
              console.log(`[${fileName}] Scaled video ${i} successfully to 1920x1080`);
              resolve();
            })
            .on('error', (err) => {
              console.error(`[${fileName}] Error scaling video ${i}: ${err.message}`);
              reject(err);
            })
            .run();
        });
      }


      const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
      const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;


      const feedPath = path.join(jobTemp, `feed-${i}.mp4`);
      console.log(`[${fileName}] Creating FEED version ${i} (1080x1350)...`);

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
            console.log(`[${fileName}] FEED version ${i} completed`);
            feedVideos.push(feedPath);
            resolve();
          })
          .on('error', reject)
          .run();
      });


      const storyTarjasPath = path.join(jobTemp, `story-tarjas-${i}.mp4`);
      console.log(`[${fileName}] Creating STORY TARJAS version ${i} (1080x1920 with black bars)...`);

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
            console.log(`[${fileName}] STORY TARJAS version ${i} completed`);
            storyTarjasVideos.push(storyTarjasPath);
            resolve();
          })
          .on('error', reject)
          .run();
      });

      const storyFullscreenPath = path.join(jobTemp, `story-fullscreen-${i}.mp4`);
      console.log(`[${fileName}] Creating STORY FULLSCREEN version ${i} (1080x1920 cropped)...`);

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
            console.log(`[${fileName}] STORY FULLSCREEN version ${i} completed`);
            storyFullscreenVideos.push(storyFullscreenPath);
            resolve();
          })
          .on('error', reject)
          .run();
      });
    }


    const assets = [
      { videos: feedVideos, dir: feedDir, suffix: '_feed', description: 'FEED' },
      { videos: storyTarjasVideos, dir: storyTarjasDir, suffix: '_story_tarjas', description: 'STORY TARJAS' },
      { videos: storyFullscreenVideos, dir: storyFullscreenDir, suffix: '_story_fullscreen', description: 'STORY FULLSCREEN' }
    ];

    const downloadUrls: { type: string; url: string; fileName: string; }[] = [];

    for (const asset of assets) {
      if (asset.videos.length === 0) {
        console.log(`[${fileName}] No videos to concatenate for ${asset.description}`);
        continue;
      }

      console.log(`[${fileName}] Concatenating ${asset.videos.length} videos for ${asset.description}...`);


      const concatFilePath = path.join(jobTemp, `concat-${asset.suffix}.txt`);
      const concatFileContent = asset.videos.map(file => `file '${file}'`).join('\n');
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


            const relativePath = path.relative(publicDir, outputPath).replace(/\\/g, '/');
            downloadUrls.push({
              type: asset.description.toLowerCase().replace(' ', '_'),
              url: `${BASE_URL}/files/${relativePath}`,
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


    console.log(`[${fileName}] All raw assets processing completed successfully`);


    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);


    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName,
          status: 'success',
          assets: downloadUrls
        })
      });
      console.log(`[${fileName}] Webhook notified with success, response: ${response.status}`);
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook on success: ${webhookErr.message}`);
    }


    downloadUrls.forEach(asset => {
      videosMeta.push({
        webhookDestination,
        fileName: asset.fileName,
        extension,
        width: asset.type === 'feed' ? 1080 : 1080,
        height: asset.type === 'feed' ? 1350 : 1920,
        downloadUrl: asset.url,
        assetType: asset.type
      });
    });

  } catch (err: any) {
    console.error(`[${fileName}] Raw assets processing error: ${err.message}`);


    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr: any) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
    }


    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
      console.log(`[${fileName}] Webhook error response: ${response.status} ${response.statusText}`);
    } catch (webhookErr: any) {
      console.error(`[${fileName}] Failed to notify webhook on error: ${webhookErr.message}`);
    }
  }

  return
});

/**
 * @openapi
 * /images/process:
 *   post:
 *     summary: Processa uma imagem 1024x1024 e cria versões para feed e story
 *     tags:
 *       - Imagens
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               imageUrl:
 *                 type: string
 *                 format: uri
 *                 description: URL da imagem (opcional se imageData fornecido)
 *               imageData:
 *                 type: string
 *                 description: Imagem em base64 (data:image/png;base64,...)
 *               fileName:
 *                 type: string
 *             required:
 *               - fileName
 *     responses:
 *       '200':
 *         description: Imagem processada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 feedUrl:
 *                   type: string
 *                   format: uri
 *                 storyUrl:
 *                   type: string
 *                   format: uri
 *                 inputUrl:
 *                   type: string
 *                   format: uri
 *       '400':
 *         description: Campos obrigatórios ausentes ou inválidos
 *       '401':
 *         description: Não autorizado
 *       '500':
 *         description: Erro interno de servidor
 */
app.post('/images/process', async (req, res) => {
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


  const imgsDir = path.join(publicDir, 'imgs');
  const feedImgsDir = path.join(imgsDir, 'feed');
  const storyImgsDir = path.join(imgsDir, 'story');
  const feedFullyImgsDir = path.join(imgsDir, 'feed-fully');
  const storyFullyImgsDir = path.join(imgsDir, 'story-fully');

  [imgsDir, feedImgsDir, storyImgsDir, feedFullyImgsDir, storyFullyImgsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });


  const jobId = `img-${fileName}-${Date.now()}`;
  const jobTemp = path.join(tempDir, jobId);
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


    const feedOutputPath = path.join(feedImgsDir, `${fileName}_feed.png`);
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


    const storyOutputPath = path.join(storyImgsDir, `${fileName}_story.png`);
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


      const originalMaskPath = path.join(__dirname, 'assets-img', `mask${maskType}.png`);

      if (!fs.existsSync(originalMaskPath)) {
        throw new Error(`Local mask not found: ${originalMaskPath}`);
      }


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


    const feedFullyOutputPath = path.join(feedFullyImgsDir, `${fileName}_feed_fully.png`);
    console.log(`[${fileName}] Creating AI FEED FULLY version (1080x1350)...`);
    await generateStabilityImage(inputImagePath, feedFullyOutputPath, 1080, 1350, 'Feed');


    const storyFullyOutputPath = path.join(storyFullyImgsDir, `${fileName}_story_fully.png`);
    console.log(`[${fileName}] Creating AI STORY FULLY version (1080x1920)...`);
    await generateStabilityImage(inputImagePath, storyFullyOutputPath, 1080, 1920, 'Story');


    console.log(`[${fileName}] Image processing completed successfully`);


    const originalOutputPath = path.join(imgsDir, `${fileName}_original.png`);
    fs.copyFileSync(inputImagePath, originalOutputPath);
    console.log(`[${fileName}] Original image saved to ${originalOutputPath}`);


    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);


    const baseUrl = BASE_URL!.startsWith('http') ? BASE_URL : `https://${BASE_URL}`;
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} `);
  logger.info(`Server running on ${BASE_URL} `);
});