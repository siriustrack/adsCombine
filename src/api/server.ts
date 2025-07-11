import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import morgan from 'morgan';
import { env } from '@config/env';
import logger from 'lib/logger';
import { handleAuthMiddleware, handleGlobalRequestExceptions } from './middlewares';
import router from './routes';

ffmpeg.setFfprobePath(ffprobeInstaller.path);
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined', { stream: { write: (message: string) => logger.info(message.trim()) } }));

app.use(handleGlobalRequestExceptions)
app.use(handleAuthMiddleware)
app.use(router)

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});
app.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} `);
});