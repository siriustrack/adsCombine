import fs from 'node:fs';
import path, { join } from 'node:path';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { FileInfo, ProcessMessage } from 'api/controllers/messages.controllers';
import axios from 'axios';
import { TEXTS_DIR } from 'config/dirs';
import { openaiConfig } from 'config/openai';
import mammoth from 'mammoth';
import { OpenAI } from 'openai';
import sharp from 'sharp';
import { sanitize } from 'utils/sanitize';
import { sanitizeText } from 'utils/textSanitizer';
import { ProcessPdfService } from './process-pdf.service';

sharp.cache(false);

export interface FileInput {
  fileId: string;
  url: string;
  mimeType: string;
  fileType?: string;
}

const PROCESSING_TIMEOUTS = {
  TXT: 10000,
  IMAGE: 30000,
  DOCX: 20000,
  PDF_GLOBAL: 300000,
  OPENAI: 25000,
} as const;

export class ProcessMessagesService {
  private readonly openai = new OpenAI({ apiKey: openaiConfig.apiKey });
  private readonly processPdfService = new ProcessPdfService();

  async execute({
    messages,
    host,
    protocol,
  }: {
    messages: ProcessMessage;
    protocol: string;
    host: string;
  }) {
    const processedFiles: string[] = [];
    const failedFiles: { fileId: string; error: string }[] = [];
    const extractedTexts: string[] = [];

    for (const message of messages) {
      const { body } = message;
      const { files, userId } = body;

      if (files && files.length > 0) {
        const results = await this.processFiles(files, userId!);

        results.forEach((result) => {
          if (result.success && result.text) {
            processedFiles.push(result.fileId);
            extractedTexts.push(result.text);
          } else if (result.error) {
            failedFiles.push({ fileId: result.fileId, error: result.error });
          }
        });
      }
    }

    return this.saveProcessedText(
      extractedTexts.join('\n\n---\n\n'),
      messages[0].conversationId,
      protocol,
      host,
      processedFiles,
      failedFiles
    );
  }

  private async processFiles(files: FileInfo[], userId: string) {
    const processingPromises = files
      .map((file) => this.updateURLForFile(file, userId))
      .map(async (file) => {
        const result = await this.processFile(file);

        if (result.error) {
          logger.error('Failed to process file', {
            fileId: file.fileId,
            error: result.error.message,
          });
          return { fileId: file.fileId, error: result.error.message, success: false };
        }

        return {
          fileId: file.fileId,
          text: result.value,
          success: true,
        };
      });

    return Promise.all(processingPromises);
  }

  private async processFile(file: FileInput): Promise<Result<string, Error>> {
    const fileTypeMap = {
      txt: () => this.processTxt(file),
      pdf: () => this.processPdfService.execute(file),
      jpeg: () => this.processImage(file),
      jpg: () => this.processImage(file),
      png: () => this.processImage(file),
      image: () => this.processImage(file),
      docx: () => this.processDocx(file),
    };

    const processor = fileTypeMap[file.fileType as keyof typeof fileTypeMap];

    if (!processor) {
      logger.warn('Unsupported file type, skipping', {
        fileType: file.fileType,
        fileId: file.fileId,
      });
      return errResult(new Error('Unsupported file type'));
    }

    return processor();
  }

  private async processWithTimeout<T>(
    processor: () => Promise<T>,
    timeout: number,
    timeoutError: string,
    userErrorMessage: string,
    fileId: string
  ): Promise<Result<T, Error>> {
    const { value, error } = await wrapPromiseResult<T, Error>(
      Promise.race([
        processor(),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutError)), timeout)),
      ])
    );

    if (error) {
      logger.error('Error processing file', {
        fileId,
        error: error.message,
        stack: error.stack,
      });

      if (error.message.includes('timed out')) {
        return errResult(new Error(userErrorMessage));
      }

      return errResult(error);
    }

    return okResult(value);
  }

  private async saveProcessedText(
    allExtractedText: string,
    conversationId: string,
    protocol: string,
    host: string,
    processedFiles: string[],
    failedFiles: { fileId: string; error: string }[]
  ) {
    const filename = `${conversationId}-${Date.now()}.txt`;

    const { error: mkdirError } = await wrapPromiseResult(
      fs.promises.mkdir(join(TEXTS_DIR, conversationId), { recursive: true })
    );

    if (mkdirError) {
      logger.error('Failed to create texts directory', { error: mkdirError, conversationId });
      return errResult({ status: 500, message: 'Failed to create texts directory' });
    }

    const filePath = path.join(TEXTS_DIR, conversationId, filename);
    const sanitizedText = sanitizeText(allExtractedText.trim());
    fs.writeFileSync(filePath, sanitizedText);

    const downloadUrl = `${protocol}://${host}/texts/${conversationId}/${filename}`;

    return {
      conversationId,
      processedFiles,
      failedFiles,
      filename,
      downloadUrl,
    };
  }

  updateURLForFile(file: FileInfo, userId: string): FileInfo {
    const currentUrl = file.url;
    if (currentUrl.includes('/storage/v1/object/public/conversation-files')) {
      const filePath = currentUrl.split('/storage/v1/object/public/conversation-files/')[1];

      const updatedFileInfo = {
        ...file,
        url: `${process.env.SUPABASE_GET_FILE_CONTENT_URL}?file_path=${filePath}&user_id=${userId}&token=${process.env.SUPABASE_TOKEN}`,
      };

      return updatedFileInfo;
    }
    return file;
  }

  private async processTxt(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const textContent = Buffer.from(response.data).toString('utf-8');
        return sanitize(textContent);
      },
      PROCESSING_TIMEOUTS.TXT,
      'TXT processing timed out',
      'O processamento deste arquivo de texto excedeu o tempo limite.',
      fileId
    );
  }

  private async processImage(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const imageBuffer = Buffer.from(response.data);
        const base64Image = imageBuffer.toString('base64');

        const aiResponse = await this.openai.chat.completions.create(
          {
            model: openaiConfig.models.image,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe this image in detail. Return in PT_BR.' },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${file.mimeType};base64,${base64Image}`,
                    },
                  },
                ],
              },
            ],
          },
          { timeout: PROCESSING_TIMEOUTS.OPENAI }
        );

        const description = aiResponse.choices[0].message.content || 'No description generated.';
        return sanitize(description);
      },
      PROCESSING_TIMEOUTS.IMAGE,
      'Image processing timed out',
      'O processamento desta imagem excedeu o tempo limite.',
      fileId
    );
  }

  private async processDocx({ fileId, url }: FileInput): Promise<Result<string, Error>> {
    return this.processWithTimeout(
      async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const result = await mammoth.extractRawText({ buffer });
        return result.value ? sanitize(result.value) : '';
      },
      PROCESSING_TIMEOUTS.DOCX,
      'DOCX processing timed out',
      'O processamento deste arquivo DOCX excedeu o tempo limite.',
      fileId
    );
  }
}
