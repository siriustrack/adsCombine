import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { cpus } from 'node:os';
import path, { join } from 'node:path';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { pdfWorkerPool } from '@lib/worker-pool';
import type { FileInfo, ProcessMessage } from 'api/controllers/messages.controllers';
import axios, { type AxiosResponse } from 'axios';
import { TEXTS_DIR } from 'config/dirs';
import { openaiConfig } from 'config/openai';
import mammoth from 'mammoth';
import { OpenAI } from 'openai';
import pdf from 'pdf-parse';
import sharp from 'sharp';
import tmp from 'tmp';
import { sanitize } from 'utils/sanitize';
import { sanitizeText } from 'utils/textSanitizer';

sharp.cache(false);

interface FileInput {
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

const VISUAL_CONTENT_THRESHOLDS = {
  LARGE_IMAGE: 100000,
  AVERAGE_SIZE: 50000,
  TOTAL_SIZE: 120000,
  MAX_TEXT_FOR_OCR: 50000,
} as const;

const OCR_SETTINGS = {
  MAX_PAGES_TO_ANALYZE: 3,
  MAX_CHUNKS: 5,
  MAX_REPETITIONS_FACTOR: 0.8,
} as const;

export class ProcessMessagesService {
  private readonly openai = new OpenAI({ apiKey: openaiConfig.apiKey });
  private readonly MAX_WORKERS = cpus().length / 2;


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

        const fileName = path.basename(new URL(file.url).pathname);
        const header = `## Transcricao do arquivo: ${fileName}:\n\n`;

        return {
          fileId: file.fileId,
          text: header + result.value,
          success: true,
        };
      });

    return Promise.all(processingPromises);
  }

  private async processFile(file: FileInput): Promise<Result<string, Error>> {
    const fileTypeMap = {
      txt: () => this.processTxt(file),
      pdf: () => this.processPdf(file),
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

  private async processPdf(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    const timeoutPromise = this.createTimeoutPromise(PROCESSING_TIMEOUTS.PDF_GLOBAL);
    const { value: response, error } = await wrapPromiseResult<AxiosResponse, Error>(
      axios.get(url, { responseType: 'arraybuffer' })
    );

    if (error) {
      logger.error('Error fetching PDF file', {
        fileId,
        error: error.message,
        stack: error.stack,
      });
      return errResult(new Error(`Failed to fetch PDF file: ${error.message}`));
    }

    const buffer = Buffer.from(response.data);

    const { value: extractedText, error: extractionError } = await this.extractDirectTextFromPdf(
      buffer,
      fileId
    );

    if (extractionError) {
      logger.error('Error extracting text from PDF', { fileId, error: extractionError.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${extractionError.message}`));
    }


    const { tempPdf, totalPages, hasVisualContent } = await this.analyzePdfContent(buffer, fileId);


    if (this.shouldSkipOcr(extractedText, hasVisualContent)) {
      this.cleanupTempFiles(tempPdf);
      return okResult(sanitize(extractedText));
    }

    if (totalPages === 0) {
      this.cleanupTempFiles(tempPdf);
      return okResult(sanitize(extractedText));
    }

    const chunks = this.createProcessingChunks(totalPages, fileId);

    const physicalChunkPaths = await this.createPhysicalPdfChunks(tempPdf, chunks, fileId);


    const ocrPromise = Promise.all(
      chunks.map((chunk, index) => {
        const chunkStartTime = Date.now();
        const chunkPdfPath = physicalChunkPaths[index] || tempPdf.name;


        return pdfWorkerPool
          .run({
            pageRange: chunk,
            pdfPath: chunkPdfPath,
            fileId,
            totalPages,
          })
          .then((result) => {
            return result;
          })
          .catch((error) => {
            const chunkDuration = Date.now() - chunkStartTime;
            logger.error('Chunk OCR failed', {
              fileId,
              chunkIndex: index,
              pageRange: chunk,
              chunkDuration,
              error: error.message,
            });
            throw error;
          });
      })
    );

    const { value: ocrResults, error: ocrError } = await wrapPromiseResult<string[][], Error>(
      Promise.race([ocrPromise, timeoutPromise])
    );


    physicalChunkPaths.forEach((chunkPath) => {
      if (chunkPath !== tempPdf.name) {
        try {
          fs.unlinkSync(chunkPath);
        } catch (error) {
          logger.warn('Failed to cleanup PDF chunk', { fileId, chunkPath, error });
        }
      }
    });

    this.cleanupTempFiles(tempPdf);

    if (ocrError) {
      logger.error('Error in OCR processing', { fileId, error: ocrError });
      return errResult(new Error(`Erro no processamento OCR: ${ocrError}`));
    }

    if (ocrResults && ocrResults.length > 0) {
      const ocrText = this.processOcrResults(ocrResults);
      const finalText = this.combineTextResults(extractedText, ocrText, fileId);


      return okResult(finalText);
    }

    return okResult(sanitize(extractedText));
  }

  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('PDF processing timed out after 60 seconds')), timeout);
    });
  }

  private async extractDirectTextFromPdf(
    buffer: Buffer,
    fileId: string
  ): Promise<Result<string, Error>> {
    const { value: data, error } = await wrapPromiseResult<pdf.Result, Error>(pdf(buffer));

    if (error) {
      logger.error('Erro ao extrair texto do PDF', { fileId, error: error.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${error.message}`));
    }

    if (data.text && data.text.trim().length > 100) {
      return okResult(data.text);
    }

    return okResult('');
  }

  private isHighQualityText(text: string): boolean {
    return Boolean(text && text.trim().length > 1000 && !text.includes('�'));
  }

  private shouldSkipOcr(extractedText: string, hasVisualContent: boolean): boolean {
    const textLength = extractedText.trim().length;
    const isHighQuality = this.isHighQualityText(extractedText);

    if (textLength < 500) {
      return false;
    }

    if (hasVisualContent) {
      if (textLength > VISUAL_CONTENT_THRESHOLDS.MAX_TEXT_FOR_OCR) {
        return true;
      } else {
        return false;
      }
    }

    const shouldSkip = isHighQuality;


    return shouldSkip;
  }

  private async analyzePdfContent(buffer: Buffer, fileId: string) {
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);

    try {
      const pdfInfoOutput = execSync(`pdfinfo "${tempPdf.name}"`, { encoding: 'utf-8' });
      const pagesMatch = pdfInfoOutput.match(/Pages:\s*(\d+)/);
      const totalPages = pagesMatch ? parseInt(pagesMatch[1], 10) : 0;


      return { tempPdf, totalPages, hasVisualContent: true };
    } catch (error) {
      logger.warn('Failed to analyze PDF content', {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      });

      return { tempPdf, totalPages: 0, hasVisualContent: false };
    }
  }

  private async createPhysicalPdfChunks(
    tempPdf: { name: string },
    chunks: { first: number; last: number }[],
    fileId: string
  ): Promise<string[]> {
    const chunkPaths: string[] = [];



    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkPath = tmp.tmpNameSync({ postfix: `_chunk_${i}.pdf` });

      try {
        if (fs.existsSync('/usr/bin/pdftk')) {
          execSync(
            `pdftk "${tempPdf.name}" cat ${chunk.first}-${chunk.last} output "${chunkPath}"`,
            { timeout: 10000 }
          );
        } else if (fs.existsSync('/usr/bin/qpdf')) {
          execSync(
            `qpdf "${tempPdf.name}" --pages . ${chunk.first}-${chunk.last} -- "${chunkPath}"`,
            { timeout: 10000 }
          );
        } else {
          logger.warn('No PDF splitting tool found, using direct page extraction', { fileId });
          chunkPaths.push(tempPdf.name);
          continue;
        }

        chunkPaths.push(chunkPath);

      } catch (error) {
        logger.error('Failed to create PDF chunk, falling back to original', {
          fileId,
          chunkIndex: i,
          error: error instanceof Error ? error.message : String(error),
        });
        chunkPaths.push(tempPdf.name);
      }
    }


    return chunkPaths;
  }

  private createProcessingChunks(
    totalPages: number,
    fileId: string
  ): { first: number; last: number }[] {

    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      return [];
    }

    const maxWorkers = this.MAX_WORKERS;
    const chunks: { first: number; last: number }[] = [];

    if (totalPages <= maxWorkers) {
      for (let i = 1; i <= totalPages; i++) {
        chunks.push({ first: i, last: i });
      }
    } else if (totalPages <= maxWorkers * 2) {
      const pagesPerWorker = Math.ceil(totalPages / Math.min(maxWorkers, 5));
      for (let i = 0; i < totalPages; i += pagesPerWorker) {
        const first = i + 1;
        const last = Math.min(i + pagesPerWorker, totalPages);
        chunks.push({ first, last });
      }
    } else {
      const optimalChunkSize = Math.max(3, Math.ceil(totalPages / maxWorkers));
      for (let i = 0; i < totalPages; i += optimalChunkSize) {
        const first = i + 1;
        const last = Math.min(i + optimalChunkSize, totalPages);
        chunks.push({ first, last });
      }
    }



    return chunks;
  }

  private processOcrResults(ocrResults: string[][]): string {
    if (!ocrResults || ocrResults.length === 0) {
      return '';
    }

    const flattenedResults = ocrResults.flat();
    const allLines = flattenedResults.join('\n').split('\n');
    const lineCount = this.countLines(allLines);
    const filteredLines = this.filterOcrLines(allLines, lineCount, flattenedResults.length);


    return filteredLines.join('\n');
  }

  private countLines(allLines: string[]): Record<string, number> {
    const lineCount: Record<string, number> = {};
    allLines.forEach((line) => {
      const cleanLine = line.trim();
      if (cleanLine.length > 5) {
        lineCount[cleanLine] = (lineCount[cleanLine] || 0) + 1;
      }
    });
    return lineCount;
  }

  private filterOcrLines(
    allLines: string[],
    lineCount: Record<string, number>,
    totalChunks: number
  ): string[] {
    const preservePatterns = this.getPreservePatterns();
    const maxRepetitions = Math.ceil(totalChunks * OCR_SETTINGS.MAX_REPETITIONS_FACTOR);

    return allLines.filter((line) => {
      const cleanLine = line.trim();

      if (!cleanLine || cleanLine.length <= 3) {
        return true;
      }

      const hasImportantData = preservePatterns.some((pattern) => pattern.test(cleanLine));
      if (hasImportantData) {
        return true;
      }

      const isRepetitive = lineCount[cleanLine] > maxRepetitions;
      const isGeneric = this.isGenericLine(cleanLine);

      return !(isRepetitive && isGeneric);
    });
  }

  private getPreservePatterns(): RegExp[] {
    return [
      /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
      /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
      /\b\d{5}-?\d{3}\b/,
      /\bR\$\s*[\d.,]+/,
      /\b[A-ZÁÊÇÕ]{2,}\s+[A-ZÁÊÇÕ\s]+\b/,
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/,
      /\w+@\w+\.\w+/,
      /\(\d{2}\)\s*\d{4,5}-?\d{4}/,
      /\b\d+\b/,
      /[A-Z]{2,}\s+\d+/,
    ];
  }

  private isGenericLine(line: string): boolean {
    return (
      line.length < 20 &&
      (line.includes('Página') ||
        line.includes('página') ||
        Boolean(line.match(/^\d+$/)) ||
        Boolean(line.match(/^[-\s]+$/)) ||
        Boolean(line.match(/^\w+\s-\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}$/)))
    );
  }

  private combineTextResults(extractedText: string, ocrText: string, fileId: string): string {
    let combinedText = '';

    if (extractedText && extractedText.trim().length > 100) {
      combinedText = extractedText;
      if (ocrText && ocrText.trim().length > 100) {
        combinedText += `\n\n--- TEXTO ADICIONAL DO OCR ---\n\n${ocrText}`;
      }
    } else {
      combinedText = ocrText || extractedText || '';
    }

    const finalText = sanitize(combinedText);

    if (finalText.trim().length < 50) {
      logger.warn('Very little text extracted from PDF', {
        fileId,
        finalTextLength: finalText.length,
        extractedTextLength: extractedText ? extractedText.length : 0,
        ocrTextLength: ocrText ? ocrText.length : 0,
      });
    }

    return finalText;
  }


  private cleanupTempFiles(...tempObjects: Array<{ removeCallback: () => void } | undefined>) {
    tempObjects.forEach((obj) => obj?.removeCallback?.());
  }
}
