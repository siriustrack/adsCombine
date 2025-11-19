import { openaiConfig } from '@config/openai';
import type { Request, Response } from 'express';
import logger from 'lib/logger';
import OpenAI from 'openai';
import type { Uploadable } from 'openai/uploads';

const openai = new OpenAI({
  apiKey: openaiConfig.apiKey,
});

export class TranscribeController {
  async transcribe(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();

    try {
      // Validate that audio file exists
      if (!req.file) {
        res.status(400).json({
          error: 'Arquivo de áudio não encontrado',
          code: 'AUDIO_NOT_FOUND',
          details: {
            received: 'empty',
            expected: "multipart/form-data with 'audio' field",
          },
        });
        return;
      }

      logger.info('Transcription request received', {
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      // Create a File-like object from the buffer
      const arrayBuffer = req.file.buffer.buffer.slice(
        req.file.buffer.byteOffset,
        req.file.buffer.byteOffset + req.file.buffer.byteLength
      ) as ArrayBuffer;
      const file = new File([arrayBuffer], req.file.originalname || 'audio.webm', {
        type: req.file.mimetype,
      }) as Uploadable;

      // Call OpenAI Whisper API
      const transcription = await openai.audio.transcriptions.create({
        file: file,
        model: 'whisper-1',
        language: 'pt', // Portuguese
        response_format: 'verbose_json', // Get additional metadata
      });

      const processingTime = Date.now() - startTime;

      logger.info('Transcription completed', {
        processingTime,
        textLength: transcription.text?.length || 0,
      });

      // Return formatted response
      res.status(200).json({
        text: transcription.text,
        duration: (transcription as any).duration,
        language: (transcription as any).language || 'pt',
        confidence: 0.95, // OpenAI doesn't provide this, using default
        processingTime,
      });
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error('Transcription error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime,
      });

      res.status(500).json({
        error: 'Erro interno do servidor',
        code: 'INTERNAL_ERROR',
        details: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }
}
