import fs from 'node:fs';
import path, { join } from 'node:path';
import { PROCESSING_TIMEOUTS } from '@config/constants';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { FileInfo, ProcessMessage } from 'api/controllers/messages.controllers';
import axios from 'axios';
import { TEXTS_DIR } from 'config/dirs';
import { openaiConfig } from 'config/openai';
import mammoth from 'mammoth';
import { OpenAI } from 'openai';
import { sanitize } from 'utils/sanitize';
import { sanitizeText } from 'utils/textSanitizer';
import { ProcessPdfService } from './process-pdf.service';

export interface FileInput {
  fileId: string;
  url: string;
  mimeType: string;
}

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
        const promises = files.map((file) =>
          this.processAndHandleFile(file, extractedTexts)
        );
        const results = await Promise.all(promises);

        results.forEach((result) => {
          if (result.success) {
            processedFiles.push(result.fileId);
          } else {
            failedFiles.push({ fileId: result.fileId, error: result.error || 'Unknown error' });
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

  private async processAndHandleFile(
    file: FileInfo,
    extractedTexts: string[]
  ): Promise<{ success: boolean; fileId: string; error?: string }> {
    const result = await this.processFile(file);

    if (result.error) {
      logger.error('Failed to process file', {
        fileId: file.fileId,
        error: result.error.message,
      });
      return { success: false, fileId: file.fileId, error: result.error.message };
    }

    const fileName = path.basename(new URL(file.url).pathname);
    const header = `## Transcricao do arquivo: ${fileName}:\n\n`;
    extractedTexts.push(header + result.value);

    return { success: true, fileId: file.fileId };
  }

  private async processFile(file: FileInput): Promise<Result<string, Error>> {
    const fileType = file.mimeType.split('/')[1];

    const fileTypeMap: Record<string, () => Promise<Result<string, Error>>> = {
      plain: () => this.processTxt(file),
      pdf: () => this.processPdfService.execute(file),
      jpeg: () => this.processImage(file),
      jpg: () => this.processImage(file),
      png: () => this.processImage(file),
      'vnd.openxmlformats-officedocument.wordprocessingml.document': () => this.processDocx(file),
      'msword': () => this.processDocx(file), // Added support for .doc files
    };

    const processor = fileTypeMap[fileType];

    if (!processor) {
      logger.warn('Unsupported file type, skipping', {
        fileType,
        fileId: file.fileId,
      });
      return errResult(new Error(`Unsupported file type: ${fileType}`));
    }

    return processor();
  }

  private async processWithTimeout<T>(
    processor: () => Promise<T>,
    timeout: number,
    fileId: string,
    fileType: string
  ): Promise<Result<T, Error>> {
    const timeoutError = `${fileType.toUpperCase()} processing timed out after ${
      timeout / 1000
    } seconds`;
    const userErrorMessage = `O processamento deste arquivo ${fileType.toUpperCase()} excedeu o tempo limite de ${
      timeout / 1000
    } segundos.`;

    const { value, error } = await wrapPromiseResult<T, Error>(
      Promise.race([
        processor(),
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutError)), timeout)),
      ])
    );

    if (error) {
      logger.error(`Error processing ${fileType} file`, {
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

  private async processTxt(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const textContent = Buffer.from(response.data).toString('utf-8');
        return sanitize(textContent);
      },
      PROCESSING_TIMEOUTS.TXT,
      fileId,
      'txt'
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
      fileId,
      'image'
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
      fileId,
      'docx'
    );
  }
}
