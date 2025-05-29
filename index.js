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
ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));

// —————————————————————————————
// Swagger UI v3 em /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
// —————————————————————————————

// Enable more detailed error logging
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({ error: err.message });
});

// Configure error handling for unhandled Promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Configure error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Configs
const PORT      = process.env.PORT || 3000;
const TOKEN     = process.env.TOKEN;
const BASE_URL  = process.env.BASE_URL;
const publicDir = path.join(__dirname, 'public');
const tempDir   = path.join(__dirname, 'temp');

// Ensure directories exist
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(tempDir))   fs.mkdirSync(tempDir);

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
  if (req.path === '/' || req.path.startsWith('/videos') === false) {
    return next();
  }
  
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    console.error(`Unauthorized access attempt`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = auth.split(' ')[1];
  if (token !== TOKEN) {
    console.error(`Forbidden: Invalid token`);
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
  const videoDimensions = [];
  
  // Get dimensions of all videos
  await Promise.all(videos.map((_, i) => new Promise((resolve) => {
    const filePath = path.join(jobTemp, `${i}.mp4`);
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) {
        warnings.push(`Error probing video ${i}: ${err.message}`);
        videoDimensions.push(null);
      } else {
        const s = meta.streams.find(s => s.width && s.height);
        const audioStream = meta.streams.find(s => s.codec_type === 'audio');
        
        if (!s) {
          warnings.push(`Video ${i} has no video stream`);
          videoDimensions.push(null);
        } else {
          videoDimensions.push({
            width: s.width,
            height: s.height,
            duration: parseFloat(s.duration) || 0,
            path: filePath,
            audioBitrate: audioStream ? (audioStream.bit_rate || '192k') : '192k'
          });
          if (s.width !== width || s.height !== height) {
            warnings.push(`Video ${i} is ${s.width}x${s.height}, expected ${width}x${height}`);
          }
        }
      }
      resolve();
    });
  })));
  
  if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);

  // 3) Immediate response
  console.log(`[${fileName}] Processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Processing started', warnings });

  // 4) Create standardized versions of each video with the target dimensions
  console.log(`[${fileName}] Standardizing videos to ${width}x${height}...`);
  
  try {
    // Create standardized versions sequentially to avoid overloading resources
    const standardizedVideos = [];
    
    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }
      
      const standardizedPath = path.join(jobTemp, `standardized-${i}.mp4`);
      console.log(`[${fileName}] Starting standardization of video ${i} (${inputVideo.width}x${inputVideo.height}) to ${width}x${height}...`);
      
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
            console.log(`[${fileName}] FFmpeg standardization of video ${i} started`);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`[${fileName}] Standardizing video ${i}: ${progress.percent.toFixed(2)}% done`);
            }
          })
          .on('end', () => {
            console.log(`[${fileName}] Standardized video ${i} successfully`);
            standardizedVideos.push(standardizedPath);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[${fileName}] Error standardizing video ${i}: ${err.message}`);
            reject(err);
          });
          
        command.run();
      });
    }
    
    // 5) Create a concat file
    const concatFilePath = path.join(jobTemp, 'concat.txt');
    const concatFileContent = standardizedVideos.map(file => `file '${file}'`).join('\n');
    fs.writeFileSync(concatFilePath, concatFileContent);
    
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
 * /videos/story-crop:
 *   post:
 *     summary: Recorta vídeos 1920x1080 para formato story 1080x1920
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
app.post('/videos/story-crop', async (req, res) => {
  const { webhookDestination, fileName, extension, videos } = req.body;

  console.log(`[${fileName}] Received story-crop request: ${JSON.stringify({
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

  // Create temp folder for this job
  const jobId = `story-${fileName}-${Date.now()}`;
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
  const videoDimensions = [];
  
  // Get dimensions of all videos
  await Promise.all(videos.map((_, i) => new Promise((resolve) => {
    const filePath = path.join(jobTemp, `${i}.mp4`);
    ffmpeg.ffprobe(filePath, (err, meta) => {
      if (err) {
        warnings.push(`Error probing video ${i}: ${err.message}`);
        videoDimensions.push(null);
      } else {
        const s = meta.streams.find(s => s.width && s.height);
        const audioStream = meta.streams.find(s => s.codec_type === 'audio');
        
        if (!s) {
          warnings.push(`Video ${i} has no video stream`);
          videoDimensions.push(null);
        } else {
          videoDimensions.push({
            width: s.width,
            height: s.height,
            duration: parseFloat(s.duration) || 0,
            path: filePath,
            audioBitrate: audioStream ? (audioStream.bit_rate || '192k') : '192k'
          });
          if (s.width !== 1920 && s.width !== 1280) {
            warnings.push(`Video ${i} is ${s.width}x${s.height}, will attempt to crop but optimal formats are 1920x1080 or 1280x720`);
          }
        }
      }
      resolve();
    });
  })));
  
  if (warnings.length) console.warn(`[${fileName}] Warnings: ${warnings.join('; ')}`);

  // 3) Immediate response
  console.log(`[${fileName}] Story crop processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Story crop processing started', warnings });

  // 4) Create story-cropped versions of each video (1080x1920)
  console.log(`[${fileName}] Cropping videos to story format 1080x1920...`);
  
  try {
    // Create cropped versions sequentially to avoid overloading resources
    const croppedVideos = [];
    
    for (let i = 0; i < videoDimensions.length; i++) {
      const inputVideo = videoDimensions[i];
      if (!inputVideo) {
        console.log(`[${fileName}] Skipping video ${i} - missing data`);
        continue;
      }
      
      const croppedPath = path.join(jobTemp, `cropped-${i}.mp4`);
      console.log(`[${fileName}] Starting story crop of video ${i} (${inputVideo.width}x${inputVideo.height}) to 1080x1920...`);
      
      await new Promise((resolve, reject) => {
        // Calculate crop dimensions based on input video size
        let cropFilter;
        let targetWidth, targetHeight;
        
        if (inputVideo.width === 1920 && inputVideo.height === 1080) {
          // 1920x1080 -> crop 1080x1080 from center, then scale to 1080x1920
          const cropX = (1920 - 1080) / 2; // 420
          cropFilter = `crop=1080:1080:${cropX}:0,scale=1080:1920`;
          targetWidth = 1080;
          targetHeight = 1920;
          console.log(`[${fileName}] Using 1920x1080 crop: ${cropFilter}`);
        } else if (inputVideo.width === 1280 && inputVideo.height === 720) {
          // 1280x720 -> crop 720x720 from center, then scale to 1080x1920
          const cropX = (1280 - 720) / 2; // 280
          cropFilter = `crop=720:720:${cropX}:0,scale=1080:1920`;
          targetWidth = 1080;
          targetHeight = 1920;
          console.log(`[${fileName}] Using 1280x720 crop: ${cropFilter}`);
        } else {
          // For other dimensions, try to crop the largest square possible from center
          const minDimension = Math.min(inputVideo.width, inputVideo.height);
          const cropX = (inputVideo.width - minDimension) / 2;
          const cropY = (inputVideo.height - minDimension) / 2;
          cropFilter = `crop=${minDimension}:${minDimension}:${cropX}:${cropY},scale=1080:1920`;
          targetWidth = 1080;
          targetHeight = 1920;
          console.log(`[${fileName}] Using generic crop for ${inputVideo.width}x${inputVideo.height}: ${cropFilter}`);
        }
        
        // Create FFmpeg command to crop the video from center
        const command = ffmpeg(inputVideo.path)
          .outputOptions([
            `-vf ${cropFilter}`, // Dynamic crop and scale filter
            '-c:v libx264', // Use h.264 codec
            '-preset medium', // Balance between speed and quality
            '-crf 18', // Constant Rate Factor (quality) - Lower is better quality, 18 is high quality
            '-c:a aac', // Audio codec
            '-b:a 320k', // High quality audio bitrate
            '-ar 48000', // Audio sample rate (CD quality)
            '-ac 2' // Stereo audio
          ])
          .output(croppedPath)
          .on('start', () => {
            console.log(`[${fileName}] FFmpeg story crop of video ${i} started`);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`[${fileName}] Cropping video ${i}: ${progress.percent.toFixed(2)}% done`);
            }
          })
          .on('end', () => {
            console.log(`[${fileName}] Story cropped video ${i} successfully`);
            croppedVideos.push(croppedPath);
            resolve();
          })
          .on('error', (err) => {
            console.error(`[${fileName}] Error cropping video ${i}: ${err.message}`);
            reject(err);
          });
          
        command.run();
      });
    }
    
    // 5) Create a concat file
    const concatFilePath = path.join(jobTemp, 'concat.txt');
    const concatFileContent = croppedVideos.map(file => `file '${file}'`).join('\n');
    fs.writeFileSync(concatFilePath, concatFileContent);
    
    // 6) Concat all cropped videos with high quality settings
    const outputPath = path.join(publicDir, `story_size_${fileName}${extension}`);
    
    // Calculate highest bitrate from input videos to ensure we maintain quality
    const highestAudioBitrate = videoDimensions
      .filter(Boolean)
      .reduce((max, video) => {
        const bitNum = parseInt(video.audioBitrate);
        return isNaN(bitNum) ? max : Math.max(max, bitNum);
      }, 192000); // Default to 192k if can't determine
    
    const audioBitrate = Math.max(320000, highestAudioBitrate).toString();
    console.log(`[${fileName}] Starting concatenation of ${croppedVideos.length} story videos with audio bitrate ${audioBitrate}`);
    console.log(`[${fileName}] Concat file created at ${concatFilePath} with content: ${concatFileContent}`);
    
    await new Promise((resolve, reject) => {
      const ffmpegCmd = ffmpeg()
        .input(concatFilePath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions([
          `-c:v libx264`,
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
      console.log(`[${fileName}] FFmpeg story concat command: ffmpeg ${ffmpegCommandString}`);
      
      ffmpegCmd
        .on('start', (cmd) => {
          console.log(`[${fileName}] FFmpeg story concat started with command: ${cmd}`);
        })
        .on('progress', progress => {
          const percent = progress.percent ? progress.percent.toFixed(2) : 'unknown';
          const frames = progress.frames || 0;
          const fps = progress.currentFps || 0;
          console.log(`[${fileName}] Processing: ${percent}% done | Frames: ${frames} | FPS: ${fps}`);
        })
        .on('end', () => {
          console.log(`[${fileName}] FFmpeg story processing finished. Output at ${outputPath}`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`[${fileName}] FFmpeg story concat error: ${err.message}`);
          console.error(`[${fileName}] FFmpeg stderr: ${stderr}`);
          reject(err);
        })
        .run();
    });
    
    // 7) Success handling
    console.log(`[${fileName}] Story video processing completed successfully`);
    
    // Cleanup temp
    fs.rmSync(jobTemp, { recursive: true, force: true });
    console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);
    
    // Notify webhook
    const downloadUrl = `${BASE_URL}/files/story_size_${fileName}${extension}`;
    const stats = fs.statSync(outputPath);
    try {
      const response = await fetch(webhookDestination, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: `story_size_${fileName}`, downloadUrl, size: stats.size, status: 'success' })
      });
      console.log(`[${fileName}] Webhook notified with success: ${downloadUrl}, response: ${response.status}`);
    } catch (webhookErr) {
      console.error(`[${fileName}] Failed to notify webhook on success: ${webhookErr.message}`);
    }
    
    // Store metadata
    videosMeta.push({ 
      webhookDestination, 
      fileName: `story_size_${fileName}`, 
      extension, 
      width: 1080, 
      height: 1920, 
      downloadUrl 
    });
    
  } catch (err) {
    console.error(`[${fileName}] Story processing error: ${err.message}`);
    
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

// Serve static files
app.use(express.static(publicDir));

// Start server
app.listen(PORT, () => console.log(`🚀 Service listening on port ${PORT}`));