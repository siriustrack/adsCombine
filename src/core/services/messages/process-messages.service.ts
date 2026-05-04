import fs from 'node:fs';
import path, { join } from 'node:path';
import { PROCESSING_TIMEOUTS } from '@config/constants';
import { env } from '@config/env';
import { httpClient } from '@config/http';
import { openaiClient, openaiConfig } from '@config/openai';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { FileInfo, ProcessMessage } from 'api/controllers/messages.controllers';
import { TEXTS_DIR } from 'config/dirs';
import mammoth from 'mammoth';
import type { Uploadable } from 'openai/uploads';
import pLimit from 'p-limit';
import { sanitize } from 'utils/sanitize';
import { sanitizeText } from 'utils/textSanitizer';
import WordExtractor from 'word-extractor';
import { FileSizeLimitError } from './pdf-utils/file-download.service';
import { ProcessPdfService } from './pdf-utils/process-pdf.service';
import { processXLSXFile, xlsxToText } from './xlsx/xlsx-processor';

export interface FileInput {
  fileId: string;
  url: string;
  mimeType: string;
}

type ProcessMessagesOptions = {
  includeReadableErrorBlocks?: boolean;
  pdfMode?: 'legacy' | 'mixed-page';
  limits?: {
    maxFileBytes?: number;
    maxFiles?: number;
    maxPdfPages?: number;
    maxOcrPagesPerPdf?: number;
    maxTotalOcrPagesPerJob?: number;
  };
};

export class OcrPageBudget {
  private usedPages = 0;

  constructor(private readonly maxPages: number) {}

  reserve(pageCount: number): boolean {
    if (this.usedPages + pageCount > this.maxPages) {
      return false;
    }

    this.usedPages += pageCount;
    return true;
  }

  remaining(): number {
    return Math.max(0, this.maxPages - this.usedPages);
  }
}

export type ProcessMessagesResponse = {
  conversationId: string;
  processedFiles: string[];
  failedFiles: { fileId: string; error: string }[];
  filename: string;
  downloadUrl: string;
};

export class ProcessMessagesService {
  private readonly processPdfService = new ProcessPdfService();
  private readonly wordExtractor = new WordExtractor();

  async execute({
    messages,
    host,
    protocol,
  }: {
    messages: ProcessMessage;
    protocol: string;
    host: string;
  }, options: ProcessMessagesOptions = {}): Promise<ProcessMessagesResponse> {
    const processedFiles: string[] = [];
    const failedFiles: { fileId: string; error: string }[] = [];
    const extractedTexts: string[] = [];
    const ocrPageBudget = options.limits?.maxTotalOcrPagesPerJob
      ? new OcrPageBudget(options.limits.maxTotalOcrPagesPerJob)
      : undefined;

    for (const message of messages) {
      const { body } = message;
      const { files } = body;

      if (files && files.length > 0) {
        if (options.limits?.maxFiles && files.length > options.limits.maxFiles) {
          const errorMessage = `A requisição contém ${files.length} arquivos, acima do limite configurado de ${options.limits.maxFiles}.`;
          failedFiles.push(...files.map((file) => ({ fileId: file.fileId, error: errorMessage })));

          if (options.includeReadableErrorBlocks) {
            extractedTexts.push(
              this.createReadableErrorBlock('request-files-limit', new Error(errorMessage))
            );
          }

          continue;
        }

        const limit = pLimit(env.PROCESSING_CONCURRENCY);
        const promises = files.map((file) =>
          limit(() => this.processAndHandleFile(file, extractedTexts, options, ocrPageBudget))
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
    extractedTexts: string[],
    options: ProcessMessagesOptions,
    ocrPageBudget?: OcrPageBudget
  ): Promise<{ success: boolean; fileId: string; error?: string }> {
    const result = await this.processFile(file, options, ocrPageBudget);

    if (result.error) {
      logger.error('Failed to process file', {
        fileId: file.fileId,
        error: result.error.message,
      });

      if (options.includeReadableErrorBlocks) {
        extractedTexts.push(
          this.createReadableErrorBlock(path.basename(new URL(file.url).pathname), result.error)
        );
      }

      return { success: false, fileId: file.fileId, error: result.error.message };
    }

    const fileName = path.basename(new URL(file.url).pathname);
    const header = `## Transcricao do arquivo: ${fileName}:\n\n`;
    extractedTexts.push(header + result.value);

    return { success: true, fileId: file.fileId };
  }

  private async processFile(
    file: FileInput,
    options: ProcessMessagesOptions = {},
    ocrPageBudget?: OcrPageBudget
  ): Promise<Result<string, Error>> {
    const fileType = file.mimeType.split('/')[1];

    if (file.mimeType.startsWith('audio/')) {
      return this.processAudio(file);
    }

    const fileTypeMap: Record<string, () => Promise<Result<string, Error>>> = {
      plain: () => this.processTxt(file),
      pdf: () =>
        this.processPdfService.execute(file, {
          maxFileBytes: options.limits?.maxFileBytes,
          mode: options.pdfMode,
          maxPdfPages: options.limits?.maxPdfPages,
          maxOcrPagesPerPdf: options.limits?.maxOcrPagesPerPdf,
          ocrPageBudget,
        }),
      jpeg: () => this.processImage(file),
      jpg: () => this.processImage(file),
      png: () => this.processImage(file),
      'vnd.openxmlformats-officedocument.wordprocessingml.document': () => this.processDocx(file),
      msword: () => this.processDoc(file), // .doc files are not supported
      'vnd.openxmlformats-officedocument.spreadsheetml.sheet': () => this.processXlsx(file),
      'vnd.ms-excel': () => this.processXlsx(file), // Added support for .xls files
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
    const timeoutError = `${fileType.toUpperCase()} processing timed out after ${timeout / 1000} seconds`;
    const userErrorMessage = `O processamento deste arquivo ${fileType.toUpperCase()} excedeu o tempo limite de ${
      timeout / 1000
    } segundos.`;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const { value, error } = await wrapPromiseResult<T, Error>(
      Promise.race([
        processor(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(timeoutError)), timeout);
        }),
      ]).finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
      })
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
  ): Promise<ProcessMessagesResponse> {
    const filename = `${conversationId}-${Date.now()}.txt`;

    const { error: mkdirError } = await wrapPromiseResult(
      fs.promises.mkdir(join(TEXTS_DIR, conversationId), { recursive: true })
    );

    if (mkdirError) {
      logger.error('Failed to create texts directory', { error: mkdirError, conversationId });
      throw new Error('Failed to create texts directory');
    }

    const filePath = path.join(TEXTS_DIR, conversationId, filename);
    const sanitizedText = sanitizeText(allExtractedText.trim());
    await fs.promises.writeFile(filePath, sanitizedText);

    const downloadUrl = `${protocol}://${host}/texts/${conversationId}/${filename}`;

    return {
      conversationId,
      processedFiles,
      failedFiles,
      filename,
      downloadUrl,
    };
  }

  private createReadableErrorBlock(fileName: string, error: Error): string {
    const code = error instanceof FileSizeLimitError ? error.code : 'FILE_PROCESSING_ERROR';

    return `## Transcricao do arquivo: ${fileName}:\n\n[${code}]\nEste arquivo não foi processado integralmente.\nMotivo: ${error.message}\nOriente o usuário a reduzir, dividir ou reenviar uma versão compatível do arquivo, se necessário.`;
  }

  private async processTxt(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await httpClient.get(url, { responseType: 'arraybuffer' });
        const textContent = (response.data as Buffer).toString('utf-8');
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
        const response = await httpClient.get(url, { responseType: 'arraybuffer' });
        const imageBuffer = response.data as Buffer;
        const base64Image = imageBuffer.toString('base64');

        const aiResponse = await openaiClient.chat.completions.create(
          {
            model: openaiConfig.models.vision,
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
        const response = await httpClient.get(url, { responseType: 'arraybuffer' });
        const buffer = response.data as Buffer;
        const result = await mammoth.extractRawText({ buffer });
        return sanitize(result.value);
      },
      PROCESSING_TIMEOUTS.DOCX,
      fileId,
      'docx'
    );
  }

  private async processDoc(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await httpClient.get(url, { responseType: 'arraybuffer' });
        const buffer = response.data as Buffer;
        const doc = await this.wordExtractor.extract(buffer);
        return sanitize(doc.getBody());
      },
      PROCESSING_TIMEOUTS.DOCX, // Reusing DOCX timeout for now
      fileId,
      'doc'
    );
  }

  private async processXlsx(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await httpClient.get(url, { responseType: 'arraybuffer' });
        const buffer = response.data as Buffer;
        const xlsxResult = processXLSXFile(
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer
        );
        return xlsxToText(xlsxResult);
      },
      PROCESSING_TIMEOUTS.XLSX,
      fileId,
      'xlsx'
    );
  }

  private async processAudio(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    return this.processWithTimeout(
      async () => {
        const response = await httpClient.get(url, { responseType: 'arraybuffer' });
        const buffer = response.data as Buffer;

        const arrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer;

        const fileName = path.basename(new URL(url).pathname) || 'audio';
        const audioFile = new File([arrayBuffer], fileName, {
          type: file.mimeType,
        }) as Uploadable;

        const transcription = await openaiClient.audio.transcriptions.create(
          {
            file: audioFile,
            model: openaiConfig.models.audio,
            language: 'pt',
            response_format: 'json',
          },
          { timeout: PROCESSING_TIMEOUTS.OPENAI }
        );

        return sanitize(transcription.text || '');
      },
      PROCESSING_TIMEOUTS.AUDIO,
      fileId,
      'audio'
    );
  }
}
