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
import pLimit from 'p-limit';
import { sanitize } from 'utils/sanitize';
import { sanitizeText } from 'utils/textSanitizer';
import WordExtractor from 'word-extractor';
import type { PdfMetadata, PdfProcessingResult } from './pdf-utils/pdf-metadata.types';
import { ProcessPdfService } from './pdf-utils/process-pdf.service';
import { processXLSXFile, xlsxToText } from './xlsx/xlsx-processor';

export interface FileInput {
  fileId: string;
  url: string;
  mimeType: string;
}

export class ProcessMessagesService {
  private readonly openai = new OpenAI({ apiKey: openaiConfig.apiKey });
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
  }) {
    const processedFiles: string[] = [];
    const failedFiles: { fileId: string; error: string }[] = [];
    const extractedTexts: string[] = [];
    const fileMetadata: Record<string, PdfMetadata> = {}; // NEW: collect metadata

    for (const message of messages) {
      const { body } = message;
      const { files } = body;

      if (files && files.length > 0) {
        const limit = pLimit(5); // Limit to 5 concurrent file processings
        const promises = files.map((file) =>
          limit(() => this.processAndHandleFile(file, extractedTexts))
        );
        const results = await Promise.all(promises);

        results.forEach((result) => {
          if (result.success) {
            processedFiles.push(result.fileId);
            // NEW: Store metadata if present
            if (result.metadata) {
              fileMetadata[result.fileId] = result.metadata;
            }
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
      failedFiles,
      fileMetadata // NEW: Pass metadata
    );
  }

  private async processAndHandleFile(
    file: FileInfo,
    extractedTexts: string[]
  ): Promise<{ success: boolean; fileId: string; error?: string; metadata?: PdfMetadata }> {
    const result = await this.processFile(file);

    if (result.error) {
      logger.error('Failed to process file', {
        fileId: file.fileId,
        error: result.error.message,
      });
      return { success: false, fileId: file.fileId, error: result.error.message };
    }

    const fileName = path.basename(new URL(file.url).pathname);
    const header = `## Transcrição do arquivo: ${fileName}:\n\n`;

    // Handle both string (legacy) and PdfProcessingResult (enhanced)
    let text: string;
    let metadata: PdfMetadata | undefined;

    if (typeof result.value === 'string') {
      // Legacy path: images, docx, xlsx, etc.
      text = result.value;
    } else {
      // Enhanced path: PDFs with metadata
      text = result.value.text;
      metadata = result.value.metadata;
    }

    extractedTexts.push(header + text);

    return { success: true, fileId: file.fileId, metadata };
  }

  private async processFile(file: FileInput): Promise<Result<string | PdfProcessingResult, Error>> {
    const fileType = file.mimeType.split('/')[1];

    const fileTypeMap: Record<string, () => Promise<Result<string | PdfProcessingResult, Error>>> =
      {
        plain: () => this.processTxt(file),
        pdf: () => this.processPdfService.execute(file), // Returns PdfProcessingResult
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
    failedFiles: { fileId: string; error: string }[],
    fileMetadata: Record<string, PdfMetadata> // NEW parameter
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
      metadata: Object.keys(fileMetadata).length > 0 ? fileMetadata : undefined, // NEW: include metadata if present
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
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
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
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const xlsxResult = processXLSXFile(buffer.buffer);
        return xlsxToText(xlsxResult);
      },
      PROCESSING_TIMEOUTS.XLSX,
      fileId,
      'xlsx'
    );
  }
}
