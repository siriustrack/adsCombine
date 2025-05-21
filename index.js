require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
ffmpeg.setFfprobePath(ffprobeInstaller.path);

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json());
app.use(morgan('combined'));

// Configs
const PORT      = process.env.PORT || 3000;
const TOKEN     = process.env.TOKEN;
const BASE_URL  = process.env.BASE_URL;
const publicDir = path.join(__dirname, 'public');
const tempDir   = path.join(__dirname, 'temp');

// Ensure directories exist
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(tempDir))   fs.mkdirSync(tempDir);

// In-memory store (restarts on app restart)
const videosMeta = [];

// Bearer authentication
app.use((req, res, next) => {
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
 * POST /videos
 */
app.post('/videos', async (req, res) => {
  const { webhookDestination, fileName, extension, width, height, codec, bitrate, videos } = req.body;

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
  const jobTemp = path.join(tempDir, fileName);
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
          const dest = fs.createWriteStream(outPath);
          response.body.pipe(dest);
          return new Promise((resolve, reject) => {
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
    await fetch(webhookDestination, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ fileName, status: 'error', error: err.message })
    });
    return res.status(500).json({ error: 'Failed to download videos' });
  }

  // 2) Check dimensions
  console.log(`[${fileName}] Checking video dimensions...`);
  const warnings = [];
  await Promise.all(videos.map((_, i) => new Promise((ok) => {
    ffmpeg.ffprobe(path.join(jobTemp, `${i}.mp4`), (err, meta) => {
      if (!err) {
        const s = meta.streams.find(s => s.width && s.height);
        if (!s || s.width !== width || s.height !== height) {
          warnings.push(`Video ${i} is ${s ? s.width + 'x' + s.height : 'unknown'}, expected ${width}x${height}`);
        }
      }
      ok();
    });
  })));
  if (warnings.length) console.warn(`[${fileName}] Dimension warnings: ${warnings.join('; ')}`);

  // 3) Immediate response
  console.log(`[${fileName}] Processing started with warnings:`, warnings);
  res.status(200).json({ message: 'Processing started', warnings });

  // 4) FFmpeg concat
  const outputPath = path.join(publicDir, `${fileName}${extension}`);
  const proc = ffmpeg();
  videos.forEach((_, i) => proc.input(path.join(jobTemp, `${i}.mp4`)));
  proc.videoCodec(codec)
      .audioBitrate(bitrate)
      .on('start', () => console.log(`[${fileName}] FFmpeg job started`))
      .on('progress', progress => console.log(`[${fileName}] Processing: ${progress.percent.toFixed(2)}% done`))
      .on('end', async () => {
        console.log(`[${fileName}] FFmpeg processing finished. Output at ${outputPath}`);
        // Cleanup temp
        fs.rmSync(jobTemp, { recursive:true, force:true });
        console.log(`[${fileName}] Cleaned temp directory ${jobTemp}`);

        // Notify webhook
        const downloadUrl = `${BASE_URL}/${fileName}${extension}`;
        const stats = fs.statSync(outputPath);
        await fetch(webhookDestination, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ fileName, downloadUrl, size: stats.size, status: 'success' })
        });
        console.log(`[${fileName}] Webhook notified with success: ${downloadUrl}`);

        // Store metadata
        videosMeta.push({ webhookDestination, fileName, extension, width, height, downloadUrl });
      })
      .on('error', async (err) => {
        console.error(`[${fileName}] FFmpeg error: ${err.message}`);
        fs.rmSync(jobTemp, { recursive:true, force:true });
        await fetch(webhookDestination, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ fileName, status: 'error', error: err.message })
        });
      })
      .mergeToFile(outputPath, jobTemp);
});

/**
 * GET /videos
 */
app.get('/videos', (req, res) => {
  res.json(videosMeta);
});

/**
 * DELETE /videos
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

// Serve static files
app.use(express.static(publicDir));

// Start server
app.listen(PORT, () => console.log(`🚀 Service listening on port ${PORT}`));
