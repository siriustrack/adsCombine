import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path, { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { FileInfo, ProcessMessage } from 'api/controllers/messages.controllers';
import axios, { type AxiosResponse } from 'axios';
import { TEXTS_DIR } from 'config/dirs';
import { openaiConfig } from 'config/openai';
import mammoth from 'mammoth';
import { OpenAI } from 'openai';
import pdf from 'pdf-parse';
import tmp from 'tmp';
import { sanitize } from 'utils/sanitize';
import { sanitizeText } from 'utils/textSanitizer';

interface FileInput {
  fileId: string;
  url: string;
  mimeType: string;
}

export class ProcessMessagesService {
  private readonly openai = new OpenAI({ apiKey: openaiConfig.apiKey });
  private readonly MAX_WORKERS = Math.max(1, Math.floor(os.cpus().length * 0.75));

  async execute({
    messages,
    host,
    protocol,
  }: {
    messages: ProcessMessage;
    protocol: string;
    host: string;
  }) {
    let allExtractedText = '';
    const processedFiles: string[] = [];
    const failedFiles: { fileId: string; error: string }[] = [];

    for (const message of messages) {
      const { body } = message;
      const { files, userId } = body;



      if (files && files.length > 0) {
        const processingPromises = files.map(file => this.updateURLForFile(file, userId!)).map(async (file) => {
          let result: Result<string, Error>;

          switch (file.fileType) {
            case 'txt':
              result = await this.processTxt(file);
              break;
            case 'pdf':
              result = await this.processPdf(file);
              break;
            case 'jpeg':
            case 'jpg':
            case 'png':
            case 'image':
              result = await this.processImage(file);
              break;
            case 'docx':
              result = await this.processDocx(file);
              break;
            default:
              logger.warn('Unsupported file type, skipping', {
                fileType: file.fileType,
                fileId: file.fileId,
              });
              result = errResult(new Error('Unsupported file type'));
          }

          const { value: textContent, error } = result;

          if (error) {
            logger.error('Failed to process file', { fileId: file.fileId, error: error.message });
            failedFiles.push({ fileId: file.fileId, error: error.message });
            return null;
          }

          processedFiles.push(file.fileId);

          const fileName = path.basename(new URL(file.url).pathname);
          const header = `## Transcricao do arquivo: ${fileName}:\n\n`;

          return header + textContent;
        });

        const results = await Promise.all(processingPromises);

        results.forEach((text) => {
          if (text) {
            allExtractedText += `${text}\n\n---\n\n`;
          }
        });
      }
    }

    const conversationId = messages[0].conversationId;
    const filename = `${conversationId}-${Date.now()}.txt`;

    await fs.promises.mkdir(join(TEXTS_DIR, conversationId), { recursive: true });

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
    const currentUrl = file.url
    if (currentUrl.includes('/storage/v1/object/public/conversation-files')) {
      const filePath = currentUrl.split('/storage/v1/object/public/conversation-files/')[1]


      const updatedFileInfo = {
        ...file,
        url: `${process.env.SUPABASE_GET_FILE_CONTENT_URL}?file_path=${filePath}&user_id=${userId}`,
      };

      logger.info('Updated file URL for processing', {
        fileId: file.fileId,
        originalUrl: currentUrl,
        updatedUrl: updatedFileInfo.url,
      });

      return updatedFileInfo
    }
    return file;
  }

  private async processTxt(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    logger.info('Processing TXT file', { fileId, url });

    const TXT_TIMEOUT = 10000;

    const { value: finalText, error } = await wrapPromiseResult<string, Error>(
      Promise.race([
        (async () => {
          const response = await axios.get(url, {
            responseType: 'arraybuffer',
            params: {
              token: process.env.SUPABASE_TOKEN,
            },
          });
          const textContent = Buffer.from(response.data).toString('utf-8');
          return sanitize(textContent);
        })(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('TXT processing timed out')), TXT_TIMEOUT)
        ),
      ])
    );

    if (error) {
      logger.error('Error processing TXT file', {
        fileId,
        error: error.message,
        stack: error.stack,
      });

      if (error.message.includes('timed out')) {
        return errResult(
          new Error('O processamento deste arquivo de texto excedeu o tempo limite.')
        );
      }

      return errResult(error);
    }

    logger.info('Successfully processed TXT file', {
      fileId,
      textLength: finalText.length,
      processingTime: 'under 10s',
    });

    return okResult(finalText);
  }

  private async processImage(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;

    logger.info('Processing image file', { fileId, url });

    const IMAGE_TIMEOUT = 30000;

    const { error, value: response } = await wrapPromiseResult<AxiosResponse, Error>(
      axios.get(url, {
        responseType: 'arraybuffer',
        params: {
          token: process.env.SUPABASE_TOKEN,
        },
      })
    );

    if (error) {
      logger.error('Error fetching image file', {
        fileId,
        error: error.message,
        stack: error.stack,
      });
      return errResult(new Error(`Failed to fetch image file: ${error.message}`));
    }

    const imageBuffer = Buffer.from(response.data);

    const { value: description, error: descriptionError } = await wrapPromiseResult<string, Error>(
      Promise.race([
        (async () => {
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
            { timeout: 25000 }
          );
          return aiResponse.choices[0].message.content || 'No description generated.';
        })(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Image processing timed out')), IMAGE_TIMEOUT)
        ),
      ])
    );

    if (descriptionError) {
      logger.error('Error processing image file', {
        fileId,
        error: descriptionError.message,
        stack: descriptionError.stack,
      });

      if (descriptionError.message.includes('timed out')) {
        return errResult(new Error('O processamento desta imagem excedeu o tempo limite.'));
      }

      return errResult(descriptionError);
    }

    const finalDescription = sanitize(description);

    logger.info('Successfully processed image file', {
      fileId,
      descriptionLength: finalDescription.length,
      processingTime: 'under 30s',
    });

    return okResult(finalDescription);
  }

  private async processDocx({ fileId, url }: FileInput): Promise<Result<string, Error>> {
    logger.info('Processing DOCX file', { fileId, url });

    const DOCX_TIMEOUT = 20000;

    const { value: textContent, error } = await wrapPromiseResult<string, Error>(
      Promise.race([
        (async () => {
          const response = await axios.get(url, {
            responseType: 'arraybuffer',
            params: {
              token: process.env.SUPABASE_TOKEN,
            },
          });
          const buffer = Buffer.from(response.data);
          const result = await mammoth.extractRawText({ buffer });
          return result.value;
        })(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('DOCX processing timed out')), DOCX_TIMEOUT)
        ),
      ])
    );

    if (error) {
      logger.error('Error processing DOCX file', {
        fileId,
        error: error.message,
        stack: error.stack,
      });

      if (error.message.includes('timed out')) {
        return errResult(new Error('O processamento deste arquivo DOCX excedeu o tempo limite.'));
      }

      return errResult(error);
    }

    let extractedText = '';

    if (textContent?.trim()) {
      extractedText = sanitize(textContent);

      logger.info('Successfully processed DOCX file', {
        fileId,
        textLength: extractedText.length,
        processingTime: 'under 20s',
      });
    } else {
      logger.warn('DOCX content is empty or could not be extracted.', { fileId });
    }

    return okResult(extractedText);
  }

  private async processPdf(file: FileInput): Promise<Result<string, Error>> {
    const { fileId, url } = file;
    const GLOBAL_TIMEOUT = 58000;

    logger.info('Processing PDF file', { fileId, url });

    const timeoutPromise = this.createTimeoutPromise(GLOBAL_TIMEOUT);
    const { value: response, error } = await wrapPromiseResult<AxiosResponse, Error>(
      axios.get(url, { responseType: 'arraybuffer', params: { token: process.env.SUPABASE_TOKEN } })
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

    if (this.isHighQualityText(extractedText)) {
      logger.info('PDF contém texto extraível de alta qualidade, pulando OCR', { fileId });
      return okResult(sanitize(extractedText));
    }

    const ocrResult = await this.performOcrProcessing(buffer, fileId, timeoutPromise);

    if (ocrResult.error) {
      return ocrResult.error.message.includes('timed out')
        ? okResult(sanitize(extractedText))
        : ocrResult;
    }

    const finalText = this.combineTextResults(extractedText, ocrResult.value, fileId);

    this.logProcessingCompletion(fileId, finalText, extractedText, ocrResult.value);

    return okResult(finalText);
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
      logger.info('PDF contém texto extraível', { fileId });
      return okResult(data.text);
    }

    return okResult('');
  }

  private isHighQualityText(text: string): boolean {
    return Boolean(text && text.trim().length > 1000 && !text.includes('�'));
  }

  private async performOcrProcessing(
    buffer: Buffer,
    fileId: string,
    timeoutPromise: Promise<never>
  ): Promise<Result<string, Error>> {
    logger.info('Iniciando processamento OCR paralelo', { fileId });

    const { tempPdf, tempDir, pages } = this.preparePdfForOcr(buffer);

    if (pages.length === 0) {
      this.cleanupTempFiles(tempPdf, tempDir);
      return okResult('');
    }

    const chunks = this.createProcessingChunks(pages, fileId);
    const preprocessDir = tmp.dirSync({ unsafeCleanup: true });

    const ocrPromise = Promise.all(
      chunks.map((chunk) => this.processChunk(chunk, fileId, tempDir.name, preprocessDir.name))
    );

    const { value: ocrResults, error } = await wrapPromiseResult<string[][], Error>(
      Promise.race([ocrPromise, timeoutPromise])
    );

    this.cleanupTempFiles(tempPdf, tempDir, preprocessDir);

    if (error) {
      return errResult(new Error(`Erro ao processar PDF: ${error.message}`));
    }

    return okResult(this.processOcrResults(ocrResults, fileId));
  }

  private preparePdfForOcr(buffer: Buffer) {
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);
    const tempDir = tmp.dirSync({ unsafeCleanup: true });

    execSync(`pdftoppm -png "${tempPdf.name}" "${path.join(tempDir.name, 'page')}"`);

    const pages = fs
      .readdirSync(tempDir.name)
      .filter((f) => f.endsWith('.png'))
      .sort((a, b) => {
        const matchA = a.match(/\d+/);
        const matchB = b.match(/\d+/);
        const pageNumA = matchA ? parseInt(matchA[0]) : 0;
        const pageNumB = matchB ? parseInt(matchB[0]) : 0;
        return pageNumA - pageNumB;
      });

    return { tempPdf, tempDir, pages };
  }

  private createProcessingChunks(pages: string[], fileId: string): string[][] {
    const totalPages = pages.length;
    logger.info(`PDF com ${totalPages} páginas`, { fileId });

    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      return [];
    }

    const numChunks = Math.min(5, totalPages, this.MAX_WORKERS);
    const pagesPerChunk = Math.ceil(totalPages / numChunks);
    const chunks: string[][] = [];

    for (let i = 0; i < numChunks; i++) {
      const start = i * pagesPerChunk;
      const end = Math.min(start + pagesPerChunk, totalPages);
      chunks.push(pages.slice(start, end));
    }

    logger.info(`Dividindo PDF em ${chunks.length} chunks para processamento paralelo`, {
      fileId,
      numChunks: chunks.length,
      pagesPerChunk,
      maxWorkers: this.MAX_WORKERS,
    });

    return chunks;
  }

  private processOcrResults(ocrResults: string[][], fileId: string): string {
    if (!ocrResults || ocrResults.length === 0) {
      return '';
    }

    const flattenedResults = ocrResults.flat();
    const allLines = flattenedResults.join('\n').split('\n');
    const lineCount = this.countLines(allLines);
    const filteredLines = this.filterOcrLines(allLines, lineCount, flattenedResults.length);

    logger.info('OCR text processing completed', {
      fileId,
      chunksProcessed: ocrResults.length,
      originalLines: allLines.length,
      filteredLines: filteredLines.length,
      removedLines: allLines.length - filteredLines.length,
    });

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
    const maxRepetitions = Math.ceil(totalChunks * 0.8);

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

  private logProcessingCompletion(
    fileId: string,
    finalText: string,
    extractedText: string,
    ocrText: string
  ): void {
    logger.info('Successfully processed PDF with parallel OCR', {
      fileId,
      finalTextLength: finalText.length,
      processingTime: 'under 60s',
      hasDirectText: extractedText && extractedText.length > 100,
      hasOcrText: ocrText && ocrText.length > 100,
    });
  }

  private cleanupTempFiles(...tempObjects: Array<{ removeCallback: () => void }>) {
    tempObjects.forEach((obj) => obj?.removeCallback?.());
  }

  private processChunk(
    chunkPages: string[],
    fileId: string,
    chunkDir: string,
    preprocessDir: string
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const workerPath = path.resolve(__dirname, 'pdfChunkWorker.js');

      const worker = new Worker(workerPath, {
        workerData: {
          pageFiles: chunkPages,
          chunkDir,
          preprocessDir,
          fileId,
        },
      });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });
    });
  }
}
