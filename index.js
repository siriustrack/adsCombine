require('dotenv').config();
const express = require('express');
const { swaggerUi, swaggerSpec } = require('./swagger');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Corrigido import do node-fetch v3
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const serveIndex = require('serve-index');
const logger = require('./src/lib/logger');
const processRouter = require('./src/routes/process');

ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// —————————————————————————————
// Swagger UI v3 em /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', processRouter);
// —————————————————————————————

// Enable more detailed error logging
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  res.status(500).json({ error: err.message });
});

// Configure error handling for unhandled Promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

// Configure error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Configs
const PORT      = process.env.PORT || 3000;
const TOKEN     = process.env.TOKEN;
const BASE_URL  = process.env.BASE_URL;
const publicDir = path.join(__dirname, 'public');
const tempDir   = path.join(__dirname, 'temp');
const textsDir  = path.join(__dirname, 'public', 'texts');

// Ensure directories exist
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(tempDir))   fs.mkdirSync(tempDir);
if (!fs.existsSync(textsDir))  fs.mkdirSync(textsDir, { recursive: true });

// ───────────────────────────────────────────────
// Rota pública para servir arquivos de texto gerados
app.use('/texts', express.static(textsDir));

// ───────────────────────────────────────────────
// 1) Rota pública para listar e baixar tudo em /public
//    — sem autenticação
app.use(
  '/files',
  express.static(publicDir, {
    // força download em vez de reprodução inline
    setHeaders: (res, filePath) => {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  }),
  serveIndex(publicDir, { icons: true })
);
// ───────────────────────────────────────────────


// In-memory store (restarts on app restart)
const videosMeta = [];

// Bearer authentication middleware
app.use((req, res, next) => {
  // Skip auth check for static files
  if (req.path === '/' || req.path.startsWith('/files') || req.path.startsWith('/api-docs') || req.path.startsWith('/api/process-message')) {
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
app.post('/videos', async (req, res) => {
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

  // Basic validation
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

  // Create temp folder for this job
  const jobId = `${fileName}-${Date.now()}`;
  const jobTemp = path.join(tempDir, jobId);
  fs.mkdirSync(jobTemp, { recursive: true });
  console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

  // 1) Download videos SEQUENTIALLY to guarantee order
  console.log(`[${fileName}] Starting SEQUENTIAL download of ${videos.length} videos...`);
  const downloadedVideos = [];
  
  try {
    // Download one by one, in exact order
    for (let i = 0; i < videos.length; i++) {
      const outPath = path.join(jobTemp, `video_${String(i).padStart(3, '0')}.mp4`); // Use name with padding for alphabetical order
      console.log(`[${fileName}] Downloading video ${i} from: ${videos[i].url}`);
      
      const response = await fetch(videos[i].url);
      if (!response.ok) {
        throw new Error(`Failed to download video ${i} from ${videos[i].url}: ${response.status} ${response.statusText}`);
      }
      
      await new Promise((resolve, reject) => {
        const dest = fs.createWriteStream(outPath);
        response.body.pipe(dest);
        dest.on('finish', () => {
          console.log(`[${fileName}] ✅ Downloaded video ${i} -> ${outPath}`);
          downloadedVideos.push({ index: i, path: outPath }); // Store index and path
          resolve();
        });
        dest.on('error', reject);
      });
    }
    
    console.log(`[${fileName}] All videos downloaded sequentially in correct order`);
    console.log(`[${fileName}] Download order verification:`, downloadedVideos.map(v => `${v.index}: ${path.basename(v.path)}`));
  } catch (err) {
    console.error(`[${fileName}] Error downloading videos: ${err.message}`);
    try {
      await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook of download error: ${webhookErr.message}`);
    }
    return res.status(500).json({ error: 'Failed to download videos' });
  }

  // 2) Check dimensions and prepare input file list using correct order
  console.log(`[${fileName}] Checking video dimensions in correct order...`);
  const warnings = [];
  const videoDimensions = [];
  
  // Process in exact order of downloads
  for (let i = 0; i < downloadedVideos.length; i++) {
    const downloadedVideo = downloadedVideos[i];
    const filePath = downloadedVideo.path;
    
    console.log(`[${fileName}] Probing video ${downloadedVideo.index} at ${filePath}`);
    
    try {
      const meta = await new Promise((resolve, reject) => {
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
        warnings.push(`Video ${downloadedVideo.index} has no video stream`);
        videoDimensions.push(null);
      } else {
        videoDimensions.push({
          originalIndex: downloadedVideo.index,
          width: s.width,
          height: s.height,
          duration: parseFloat(s.duration) || 0,
          path: filePath,
          audioBitrate: audioStream ? (audioStream.bit_rate || '192k') : '192k'
        });
        
        console.log(`[${fileName}] Video ${downloadedVideo.index}: ${s.width}x${s.height}, duration: ${parseFloat(s.duration) || 0}s`);
        
        if (s.width !== width || s.height !== height) {
          warnings.push(`Video ${downloadedVideo.index} is ${s.width}x${s.height}, expected ${width}x${height}`);
        }
      }
    } catch (err) {
      warnings.push(`Error probing video ${downloadedVideo.index}: ${err.message}`);
      videoDimensions.push(null);
    }
  }
  
  if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);

  // 3) Immediate response
  console.log(`[${fileName}] Processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Processing started', warnings });

  // 4) Create standardized versions maintaining order
  console.log(`[${fileName}] Standardizing videos to ${width}x${height} in correct order...`);
  
  try {
    // Create standardized versions sequentially to avoid overloading resources
    const standardizedVideos = [];
    
    // Process in correct order
    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }
      
      const standardizedPath = path.join(jobTemp, `standardized_${String(i).padStart(3, '0')}.mp4`);
      console.log(`[${fileName}] Starting standardization of video ${inputVideo.originalIndex} (position ${i}) (${inputVideo.width}x${inputVideo.height}) to ${width}x${height}...`);
      
      await new Promise((resolve, reject) => {
        // Create FFmpeg command to resize and pad the video
        const command = ffmpeg(inputVideo.path)
          .outputOptions([
            `-vf scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`, // Scale and pad to target dimensions
            '-c:v libx264', // Use h.264 codec
            '-preset medium', // Balance between speed and quality
            '-crf 18', // Constant Rate Factor (quality) - Lower is better quality, 18 is high quality
            '-c:a aac', // Audio codec
            '-b:a 320k', // High quality audio bitrate
            '-ar 48000', // Audio sample rate (CD quality)
            '-ac 2' // Stereo audio
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
    
    // 5) Create concat file with guaranteed order
    const concatFilePath = path.join(jobTemp, 'concat.txt');
    const concatFileContent = standardizedVideos.map((file, index) => {
      console.log(`[${fileName}] Concat order ${index}: ${path.basename(file)}`);
      return `file '${file}'`;
    }).join('\n');
    
    fs.writeFileSync(concatFilePath, concatFileContent);
    console.log(`[${fileName}] Concat file created with guaranteed order:`);
    console.log(concatFileContent);

    // 6) Concat all standardized videos with high quality settings
    const outputPath = path.join(publicDir, `${fileName}${extension}`);
    
    // Calculate highest bitrate from input videos to ensure we maintain quality
    const highestAudioBitrate = videoDimensions
      .filter(Boolean)
      .reduce((max, video) => {
        const bitNum = parseInt(video.audioBitrate);
        return isNaN(bitNum) ? max : Math.max(max, bitNum);
      }, 192000); // Default to 192k if can't determine
    
    const audioBitrate = Math.max(parseInt(bitrate) || 320000, highestAudioBitrate).toString();
    console.log(`[${fileName}] Starting concatenation of ${standardizedVideos.length} videos with audio bitrate ${audioBitrate}`);
    console.log(`[${fileName}] Concat file created at ${concatFilePath} with content: ${concatFileContent}`);
    
    await new Promise((resolve, reject) => {
      const ffmpegCmd = ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          `-c:v ${codec}`,
          `-c:a aac`, // Use AAC for audio
          `-b:a ${Math.max(320000, parseInt(audioBitrate) || 320000)}`, // Use at least 320k audio bitrate or higher if input has higher
          `-ar 48000`, // 48kHz audio sample rate (high quality)
          `-ac 2`, // Stereo audio
          `-crf 18`, // Maintain high video quality with constant rate factor
          `-preset slow` // Use slow preset for better quality encoding
        ])
        .output(outputPath);
      
      // Log all FFmpeg command options for debugging
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
    
    // 7) Success handling
    console.log(`[${fileName}] Video processing completed successfully`);
    
    // Cleanup temp
    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);
    
    // Notify webhook
    const downloadUrl = `${BASE_URL}/files/${fileName}${extension}`;
    const stats = fs.statSync(outputPath);
    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, downloadUrl, size: stats.size, status: 'success' })
      });
      console.log(`[${fileName}] Webhook notified with success: ${downloadUrl}, response: ${response.status}`);
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook on success: ${webhookErr.message}`);
    }
    
    // Store metadata
    videosMeta.push({ webhookDestination, fileName, extension, width, height, downloadUrl });
    
  } catch (err) {
    console.error(`[${fileName}] Processing error: ${err.message}`);
    
    // Cleanup on error
    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
    }
    
    // Notify webhook of failure
    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
      console.log(`[${fileName}] Webhook error response: ${response.status} ${response.statusText}`);
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook on error: ${webhookErr.message}`);
    }
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
  res.json({ message: 'Deleted' });
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

  // Basic validation
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

  // Create directories for different asset types
  const feedDir = path.join(publicDir, 'feed');
  const storyTarjasDir = path.join(publicDir, 'story_tarjas');
  const storyFullscreenDir = path.join(publicDir, 'story_fullscreen');
  
  [feedDir, storyTarjasDir, storyFullscreenDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // Create temp folder for this job
  const jobId = `assets-${fileName}-${Date.now()}`;
  const jobTemp = path.join(tempDir, jobId);
  fs.mkdirSync(jobTemp, { recursive: true });
  console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

  // 1) Download videos
  console.log(`[${fileName}] Starting download of ${videos.length} videos...`);
  try {
    await Promise.all(videos.map((v, i) => {
      const outPath = path.join(jobTemp, `${i}.mp4`);
      return fetch(v.url)
        .then(response => {
          if (!response.ok) throw new Error(`Failed to download ${v.url}`);
          return new Promise((resolve, reject) => {
            const dest = fs.createWriteStream(outPath);
            response.body.pipe(dest);
            dest.on('finish', () => {
              console.log(`[${fileName}] Downloaded video ${i} -> ${outPath}`);
              resolve();
            });
            dest.on('error', reject);
          });
        });
    }));
    console.log(`[${fileName}] All videos downloaded successfully`);
  } catch (err) {
    console.error(`[${fileName}] Error downloading videos: ${err.message}`);
    try {
      await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook of download error: ${webhookErr.message}`);
    }
    return res.status(500).json({ error: 'Failed to download videos' });
  }

  // 2) Check dimensions and prepare input file list
  console.log(`[${fileName}] Checking video dimensions...`);
  const warnings = [];
  const videoDimensions = new Array(videos.length); // Initialize with fixed size
  
  // Get dimensions of all videos sequentially to avoid potential concurrency issues with ffprobe
  for (let i = 0; i < videos.length; i++) {
    const filePath = path.join(jobTemp, `${i}.mp4`);
    try {
      const meta = await new Promise((resolve, reject) => {
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
        videoDimensions[i] = null;
      } else {
        videoDimensions[i] = {
          width: s.width,
          height: s.height,
          duration: parseFloat(s.duration) || 0,
          path: filePath,
          audioBitrate: audioStream ? (audioStream.bit_rate || '192k') : '192k'
        };
        if (s.width !== width || s.height !== height) {
          warnings.push(`Video ${i} is ${s.width}x${s.height}, expected ${width}x${height}`);
        }
      }
    } catch (err) {
      warnings.push(`Error probing video ${i}: ${err.message}`);
      videoDimensions[i] = null;
    }
  }
  
  if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);

  // 3) Immediate response
  console.log(`[${fileName}] Raw assets processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Raw assets processing started', warnings });

  try {
    // Arrays to store processed videos for each format
    const feedVideos = [];
    const storyTarjasVideos = [];
    const storyFullscreenVideos = [];
    
    // 4) Process each video to create 3 versions
    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }
      
      console.log(`[${fileName}] Processing video ${i} (${inputVideo.width}x${inputVideo.height}) into 3 formats...`);
      
      // First, scale 1280x720 videos to 1920x1080 if needed
      let scaledPath = inputVideo.path;
      if (inputVideo.width === 1280 && inputVideo.height === 720) {
        scaledPath = path.join(jobTemp, `scaled-${i}.mp4`);
        console.log(`[${fileName}] Scaling video ${i} from 1280x720 to 1920x1080...`);
        
        await new Promise((resolve, reject) => {
          ffmpeg(inputVideo.path)
            .outputOptions([
              '-vf scale=1920:1080', // Scale to 1920x1080
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
      
      // Get dimensions for processing (after scaling)
      const processWidth = inputVideo.width === 1280 ? 1920 : inputVideo.width;
      const processHeight = inputVideo.height === 720 ? 1080 : inputVideo.height;
      
      // A) Create FEED version (1080x1350 crop from center)
      const feedPath = path.join(jobTemp, `feed-${i}.mp4`);
      console.log(`[${fileName}] Creating FEED version ${i} (1080x1350)...`);
      
      await new Promise((resolve, reject) => {
        // Calculate crop position to center the 1080x1350 area
        const cropX = Math.max(0, (processWidth - 1080) / 2);
        const cropY = Math.max(0, (processHeight - 1350) / 2);
        
        // If source is smaller than target, we need to scale first then crop
        let cropFilter;
        if (processHeight < 1350) {
          // Scale to make height at least 1350, maintaining aspect ratio
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
      
      // B) Create STORY WITH TARJAS version (1080x1920 with black bars)
      const storyTarjasPath = path.join(jobTemp, `story-tarjas-${i}.mp4`);
      console.log(`[${fileName}] Creating STORY TARJAS version ${i} (1080x1920 with black bars)...`);
      
      await new Promise((resolve, reject) => {
        // Scale to 1080 width maintaining aspect ratio, then pad to 1080x1920
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
      
      // C) Create STORY FULLSCREEN version (scale to 1920 height, crop 1080x1920 from center)
      const storyFullscreenPath = path.join(jobTemp, `story-fullscreen-${i}.mp4`);
      console.log(`[${fileName}] Creating STORY FULLSCREEN version ${i} (1080x1920 cropped)...`);
      
      await new Promise((resolve, reject) => {
        // Scale to 1920 height maintaining aspect ratio, then crop 1080x1920 from center
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
    
    // 5) Concatenate each type of video
    const assets = [
      { videos: feedVideos, dir: feedDir, suffix: '_feed', description: 'FEED' },
      { videos: storyTarjasVideos, dir: storyTarjasDir, suffix: '_story_tarjas', description: 'STORY TARJAS' },
      { videos: storyFullscreenVideos, dir: storyFullscreenDir, suffix: '_story_fullscreen', description: 'STORY FULLSCREEN' }
    ];
    
    const downloadUrls = [];
    
    for (const asset of assets) {
      if (asset.videos.length === 0) {
        console.log(`[${fileName}] No videos to concatenate for ${asset.description}`);
        continue;
      }
      
      console.log(`[${fileName}] Concatenating ${asset.videos.length} videos for ${asset.description}...`);
      
      // Create concat file
      const concatFilePath = path.join(jobTemp, `concat-${asset.suffix}.txt`);
      const concatFileContent = asset.videos.map(file => `file '${file}'`).join('\n');
      fs.writeFileSync(concatFilePath, concatFileContent);
      
      // Output path
      const outputPath = path.join(asset.dir, `${fileName}${asset.suffix}${extension}`);
      
      await new Promise((resolve, reject) => {
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
            
            // Add download URL
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
    
    // 6) Success handling
    console.log(`[${fileName}] All raw assets processing completed successfully`);
    
    // Cleanup temp
    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);
    
    // Notify webhook with all download URLs
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
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook on success: ${webhookErr.message}`);
    }
    
    // Store metadata for each asset
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
    
  } catch (err) {
    console.error(`[${fileName}] Raw assets processing error: ${err.message}`);
    
    // Cleanup on error
    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
    }
    
    // Notify webhook of failure
    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, status: 'error', error: err.message })
      });
      console.log(`[${fileName}] Webhook error response: ${response.status} ${response.statusText}`);
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook on error: ${webhookErr.message}`);
    }
  }
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

  // LIMPAR o fileName removendo quebras de linha e espaços
  if (fileName) {
    fileName = fileName.trim().replace(/[\r\n]/g, '');
  }

  console.log(`[${fileName}] Received image processing request`);

  // Basic validation
  if (!fileName) {
    console.error(`Missing fileName`);
    return res.status(400).json({ error: 'Missing required field: fileName' });
  }

  if (!imageUrl && !imageData) {
    console.error(`[${fileName}] Missing image source`);
    return res.status(400).json({ error: 'Must provide either imageUrl or imageData' });
  }

  // Validate Stability AI API Key
  if (!process.env.STABILITY_API_KEY) {
    console.error(`[${fileName}] Missing STABILITY_API_KEY`);
    return res.status(500).json({ error: 'Stability AI API key not configured' });
  }

  // Create imgs directory structure
  const imgsDir = path.join(publicDir, 'imgs');
  const feedImgsDir = path.join(imgsDir, 'feed');
  const storyImgsDir = path.join(imgsDir, 'story');
  const feedFullyImgsDir = path.join(imgsDir, 'feed-fully');
  const storyFullyImgsDir = path.join(imgsDir, 'story-fully');
  
  [imgsDir, feedImgsDir, storyImgsDir, feedFullyImgsDir, storyFullyImgsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // Create temp folder for this job
  const jobId = `img-${fileName}-${Date.now()}`;
  const jobTemp = path.join(tempDir, jobId);
  fs.mkdirSync(jobTemp, { recursive: true });
  console.log(`[${fileName}] Created temp directory at ${jobTemp}`);

  try {
    // 1) Get image data
    console.log(`[${fileName}] Processing image...`);
    const inputImagePath = path.join(jobTemp, 'input.png');
    
    if (imageData) {
      // Handle base64 data
      console.log(`[${fileName}] Processing base64 image data...`);
      
      // Extract base64 data (remove data:image/png;base64, prefix if present)
      const base64Data = imageData.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
      const imageBuffer = Buffer.from(base64Data, 'base64');
      
      fs.writeFileSync(inputImagePath, imageBuffer);
      console.log(`[${fileName}] Base64 image saved successfully`);
      
    } else if (imageUrl) {
      // Handle URL download
      console.log(`[${fileName}] Downloading image from URL...`);
      
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
      }
      
      const imageBuffer = await response.buffer();
      fs.writeFileSync(inputImagePath, imageBuffer);
      console.log(`[${fileName}] Image downloaded successfully`);
    }

    // 2) Create FEED version (1080x1350 with white background)
    const feedOutputPath = path.join(feedImgsDir, `${fileName}_feed.png`);
    console.log(`[${fileName}] Creating FEED version (1080x1350)...`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputImagePath)
        .outputOptions([
          // Create white background canvas 1080x1350 and overlay the 1024x1024 image in center
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

    // 3) Create STORY version (1080x1920 with white background)
    const storyOutputPath = path.join(storyImgsDir, `${fileName}_story.png`);
    console.log(`[${fileName}] Creating STORY version (1080x1920)...`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(inputImagePath)
        .outputOptions([
          // Create white background canvas 1080x1920 and overlay the 1024x1024 image in center
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

    // 4) Generate AI-completed versions using Stability AI
    console.log(`[${fileName}] Starting Stability AI image completion...`);
    
    // Helper function to call Stability AI API with local masks
    const generateStabilityImage = async (inputPath, outputPath, targetWidth, targetHeight, maskType) => {
      const FormData = require('form-data');
      
      // Calcular dimensões que respeitam o limite de 1,048,576 pixels
      const maxPixels = 1048576;
      const aspectRatio = targetWidth / targetHeight;
      
      let aiWidth, aiHeight;
      if (targetWidth * targetHeight > maxPixels) {
        // Redimensionar mantendo proporção
        aiHeight = Math.floor(Math.sqrt(maxPixels / aspectRatio));
        aiWidth = Math.floor(aiHeight * aspectRatio);
        
        // Ajustar para múltiplos de 64 (requirement da Stability AI)
        aiWidth = Math.floor(aiWidth / 64) * 64;
        aiHeight = Math.floor(aiHeight / 64) * 64;
        
        console.log(`[${fileName}] Resizing from ${targetWidth}x${targetHeight} to ${aiWidth}x${aiHeight} for Stability AI (${aiWidth * aiHeight} pixels)`);
      } else {
        aiWidth = targetWidth;
        aiHeight = targetHeight;
      }
      
      // Usar máscaras locais redimensionadas
      const originalMaskPath = path.join(__dirname, 'assets-img', `mask${maskType}.png`);
      
      if (!fs.existsSync(originalMaskPath)) {
        throw new Error(`Local mask not found: ${originalMaskPath}`);
      }
      
      // Redimensionar máscara se necessário
      const maskPath = path.join(jobTemp, `mask_${aiWidth}x${aiHeight}.png`);
      
      await new Promise((resolve, reject) => {
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
      
      // Criar canvas com a imagem original centralizada
      const canvasPath = path.join(jobTemp, `canvas_${aiWidth}x${aiHeight}.png`);
      
      // Calcular o tamanho da imagem que cabe no canvas mantendo proporção
      const imageSize = Math.min(aiWidth, aiHeight, 1024);
      
      await new Promise((resolve, reject) => {
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
      
      // Preparar form data para Stability AI - NOVO ENDPOINT E MODELO
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
      
      // Configurações otimizadas para outpainting
      form.append('prompt', 'Extend the advertising background maintaining the exact same style, colors, lighting and professional composition. Seamless background extension, high quality, professional advertising material.');
      form.append('negative_prompt', 'blurry, low quality, distorted, artifacts, bad composition, inconsistent lighting, different style');
      form.append('mode', 'image-to-image');
      form.append('output_format', 'png');
      form.append('strength', '0.8'); // Controla o quanto a IA pode alterar
      
      console.log(`[${fileName}] Sending outpainting request to Stability AI API for ${aiWidth}x${aiHeight} (${aiWidth * aiHeight} pixels)...`);
      
      // ENDPOINT CORRETO PARA STABLE DIFFUSION 3.5
      const response = await fetch('https://api.stability.ai/v2beta/stable-image/edit/inpaint', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Accept': 'image/*',
          ...form.getHeaders()
        },
        body: form
      });
      
      console.log(`[${fileName}] Stability AI response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${fileName}] Stability AI error details: ${errorText}`);
        throw new Error(`Stability AI error: ${response.status} ${errorText}`);
      }
      
      // A resposta agora é diretamente a imagem em bytes
      const imageBuffer = await response.buffer();
      console.log(`[${fileName}] Stability AI success, received image buffer of ${imageBuffer.length} bytes`);
      
      // Se redimensionamos para a API, agora precisamos redimensionar de volta para o tamanho final
      if (aiWidth !== targetWidth || aiHeight !== targetHeight) {
        console.log(`[${fileName}] Resizing AI result back to ${targetWidth}x${targetHeight}...`);
        
        const tempAiPath = path.join(jobTemp, `ai_temp_${aiWidth}x${aiHeight}.png`);
        fs.writeFileSync(tempAiPath, imageBuffer);
        
        await new Promise((resolve, reject) => {
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
        // Salvar a imagem final diretamente
        fs.writeFileSync(outputPath, imageBuffer);
      }
      
      console.log(`[${fileName}] AI ${targetWidth}x${targetHeight} version saved successfully`);
    };

    // Generate AI Feed version (1080x1350) usando máscara local
    const feedFullyOutputPath = path.join(feedFullyImgsDir, `${fileName}_feed_fully.png`);
    console.log(`[${fileName}] Creating AI FEED FULLY version (1080x1350)...`);
    await generateStabilityImage(inputImagePath, feedFullyOutputPath, 1080, 1350, 'Feed');

    // Generate AI Story version (1080x1920) usando máscara local
    const storyFullyOutputPath = path.join(storyFullyImgsDir, `${fileName}_story_fully.png`);
    console.log(`[${fileName}] Creating AI STORY FULLY version (1080x1920)...`);
    await generateStabilityImage(inputImagePath, storyFullyOutputPath, 1080, 1920, 'Story');

    // 5) Success handling
    console.log(`[${fileName}] Image processing completed successfully`);
    
    // PRIMEIRO: Salvar arquivo original ANTES de limpar o temp
    const originalOutputPath = path.join(imgsDir, `${fileName}_original.png`);
    fs.copyFileSync(inputImagePath, originalOutputPath);
    console.log(`[${fileName}] Original image saved to ${originalOutputPath}`);

    // DEPOIS: Cleanup temp (só depois de copiar o arquivo)
    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);
    
    // Generate URLs with HTTPS
    const baseUrl = BASE_URL.startsWith('http') ? BASE_URL : `https://${BASE_URL}`;
    const feedUrl = `${baseUrl}/files/imgs/feed/${fileName}_feed.png`;
    const storyUrl = `${baseUrl}/files/imgs/story/${fileName}_story.png`;
    const originalUrl = `${baseUrl}/files/imgs/${fileName}_original.png`;
    const feedFullyUrl = `${baseUrl}/files/imgs/feed-fully/${fileName}_feed_fully.png`;
    const storyFullyUrl = `${baseUrl}/files/imgs/story-fully/${fileName}_story_fully.png`;
    
    // Return response
    res.status(200).json({
      feedUrl,
      storyUrl,
      inputUrl: originalUrl,
      feedFullyUrl,
      storyFullyUrl
    });
    
    console.log(`[${fileName}] Response sent with URLs: feed=${feedUrl}, story=${storyUrl}, original=${originalUrl}, feedFully=${feedFullyUrl}, storyFully=${storyFullyUrl}`);
    
  } catch (err) {
    console.error(`[${fileName}] Image processing error: ${err.message}`);
    
    // Cleanup on error
    try {
      fs.rmSync(jobTemp, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(`[${fileName}] Error cleaning up: ${cleanupErr.message}`);
    }
    
    res.status(500).json({ error: `Failed to process image: ${err.message}` });
  }
});

// Serve static files
app.use(express.static(publicDir));

// Start server
app.listen(PORT, () => console.log(`🚀 Service listening on port ${PORT}`));