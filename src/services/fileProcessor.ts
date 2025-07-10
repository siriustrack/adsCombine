import axios from 'axios';
import mammoth from 'mammoth';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { OpenAI } from 'openai';
import pdf from 'pdf-parse';
import tmp from 'tmp';
import { openaiConfig } from '../config/openai';
import logger from '../lib/logger';
import { sanitize } from '../utils/sanitize';

const MAX_WORKERS = Math.max(1, Math.floor(os.cpus().length * 0.75));

const openai = new OpenAI({ apiKey: openaiConfig.apiKey });

interface FileInput {
  fileId: string;
  url: string;
  mimeType: string;
}

export async function processTxt(file: FileInput): Promise<string> {
  const { fileId, url } = file;
  logger.info('Processing TXT file', { fileId, url });
  const TXT_TIMEOUT = 10000;
  try {
    const processTxtWithTimeout = Promise.race([
      (async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const textContent = Buffer.from(response.data).toString('utf-8');
        return sanitize(textContent);
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TXT processing timed out')), TXT_TIMEOUT)
      )
    ]);
    const finalText = await processTxtWithTimeout as string;
    logger.info('Successfully processed TXT file', {
      fileId,
      textLength: finalText.length,
      processingTime: 'under 10s'
    });
    return finalText;
  } catch (error: any) {
    logger.error('Error processing TXT file', {
      fileId,
      error: error.message,
      stack: error.stack
    });
    if (error.message.includes('timed out')) {
      return 'O processamento deste arquivo de texto excedeu o tempo limite.';
    }
    throw error;
  }
}

export async function processImage(file: FileInput): Promise<string> {
  const { fileId, url } = file;
  logger.info('Processing image file', { fileId, url });
  const IMAGE_TIMEOUT = 30000;
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);
    const processImageWithTimeout = Promise.race([
      (async () => {
        const base64Image = imageBuffer.toString('base64');
        const aiResponse = await openai.chat.completions.create({
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
        }, { timeout: 25000 });
        return aiResponse.choices[0].message.content || 'No description generated.';
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Image processing timed out')), IMAGE_TIMEOUT)
      )
    ]);
    const description = await processImageWithTimeout as string;
    const finalDescription = sanitize(description);
    logger.info('Successfully processed image file', {
      fileId,
      descriptionLength: finalDescription.length,
      processingTime: 'under 30s'
    });
    return finalDescription;
  } catch (error: any) {
    logger.error('Error processing image file', {
      fileId,
      error: error.message,
      stack: error.stack
    });
    if (error.message.includes('timed out')) {
      return 'Não foi possível processar a descrição completa desta imagem dentro do tempo limite.';
    }
    throw error;
  }
}

export async function processPdf(file: FileInput): Promise<string> {
  const { fileId, url } = file;
  const GLOBAL_TIMEOUT = 58000;

  logger.info('Processing PDF file', { fileId, url });

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('PDF processing timed out after 60 seconds')), GLOBAL_TIMEOUT);
  });

  let extractedText = '';

  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    const data = await pdf(buffer);
    if (data.text && data.text.trim().length > 100) {
      extractedText = data.text;
      logger.info('PDF contém texto extraível', { fileId });
    }

    if (extractedText && extractedText.trim().length > 1000 && !extractedText.includes('�')) {
      logger.info('PDF contém texto extraível de alta qualidade, pulando OCR', { fileId });
      return sanitize(extractedText);
    }

    logger.info('Iniciando processamento OCR paralelo', { fileId });

    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);
    const tempDir = tmp.dirSync({ unsafeCleanup: true });

    execSync(`pdftoppm -png "${tempPdf.name}" "${path.join(tempDir.name, 'page')}"`);

    const pages = fs.readdirSync(tempDir.name)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => {
        const matchA = a.match(/\d+/);
        const matchB = b.match(/\d+/);
        const pageNumA = matchA ? parseInt(matchA[0]) : 0;
        const pageNumB = matchB ? parseInt(matchB[0]) : 0;
        return pageNumA - pageNumB;
      });
    const totalPages = pages.length;
    logger.info(`PDF com ${totalPages} páginas`, { fileId });
    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      tempPdf.removeCallback();
      tempDir.removeCallback();
      return extractedText ? sanitize(extractedText) : '';
    }

    const numChunks = Math.min(5, totalPages, MAX_WORKERS);
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
      maxWorkers: MAX_WORKERS
    });

    const preprocessDir = tmp.dirSync({ unsafeCleanup: true });

    const processChunk = (chunkPages: string[]) => {
      return new Promise<string[]>((resolve, reject) => {
        const worker = new Worker('./src/services/pdfChunkWorker.js', {
          workerData: {
            pageFiles: chunkPages,
            chunkDir: tempDir.name,
            preprocessDir: preprocessDir.name,
            fileId
          }
        });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    };

    const ocrPromise = Promise.all(chunks.map(processChunk));
    const ocrResults = await Promise.race([ocrPromise, timeoutPromise])
      .catch((error: any) => {
        if (error.message.includes('timed out')) {
          logger.warn('OCR processamento atingiu timeout de 60 segundos, retornando resultados parciais', { fileId });
          return extractedText ? [extractedText] : [];
        }
        throw error;
      });

    preprocessDir.removeCallback();
    tempPdf.removeCallback();
    tempDir.removeCallback();

    let ocrText = '';
    if (ocrResults && ocrResults.length > 0) {
      const flattenedResults = ocrResults.flat();

      const allLines = flattenedResults.join('\n').split('\n');
      const lineCount: Record<string, number> = {};

      allLines.forEach(line => {
        const cleanLine = line.trim();
        if (cleanLine.length > 5) {
          lineCount[cleanLine] = (lineCount[cleanLine] || 0) + 1;
        }
      });

      const preservePatterns = [
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

      const maxRepetitions = Math.ceil(flattenedResults.length * 0.8);
      const filteredLines = allLines.filter(line => {
        const cleanLine = line.trim();

        if (!cleanLine || cleanLine.length <= 3) {
          return true;
        }

        const hasImportantData = preservePatterns.some(pattern => pattern.test(cleanLine));

        if (hasImportantData) {
          return true;
        }

        const isRepetitive = lineCount[cleanLine] > maxRepetitions;
        const isGeneric = cleanLine.length < 20 &&
          (cleanLine.includes('Página') ||
            cleanLine.includes('página') ||
            cleanLine.match(/^\d+$/) ||
            cleanLine.match(/^[-\s]+$/) ||
            cleanLine.match(/^\w+\s-\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}$/));
        return !(isRepetitive && isGeneric);
      });
      ocrText = filteredLines.join('\n');
      logger.info('OCR text processing completed', {
        fileId,
        totalPages,
        chunksProcessed: ocrResults.length,
        originalLines: allLines.length,
        filteredLines: filteredLines.length,
        removedLines: allLines.length - filteredLines.length
      });
    }

    let combinedText = '';
    if (extractedText && extractedText.trim().length > 100) {
      combinedText = extractedText;
      if (ocrText && ocrText.trim().length > 100) {
        combinedText += '\n\n--- TEXTO ADICIONAL DO OCR ---\n\n' + ocrText;
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
        ocrTextLength: ocrText ? ocrText.length : 0
      });
    }
    logger.info('Successfully processed PDF with parallel OCR', {
      fileId,
      finalTextLength: finalText.length,
      processingTime: 'under 60s',
      hasDirectText: extractedText && extractedText.length > 100,
      hasOcrText: ocrText && ocrText.length > 100
    });
    return finalText;
  } catch (error: any) {
    logger.error('Error processing PDF file', {
      fileId,
      error: error.message,
      stack: error.stack
    });


    if (extractedText && extractedText.trim().length > 0) {
      logger.info('Returning direct extracted text due to OCR failure', { fileId });
      return sanitize(extractedText);
    }
    throw error;
  }
}

export async function processDocx(file: FileInput): Promise<string> {
  const { fileId, url } = file;
  logger.info('Processing DOCX file', { fileId, url });
  const DOCX_TIMEOUT = 20000;
  try {
    const processDocxWithTimeout = Promise.race([
      (async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DOCX processing timed out')), DOCX_TIMEOUT)
      )
    ]);
    const textContent = await processDocxWithTimeout as string;
    let extractedText = '';
    if (textContent && textContent.trim()) {
      extractedText = sanitize(textContent);
      logger.info('Successfully processed DOCX file', {
        fileId,
        textLength: extractedText.length,
        processingTime: 'under 20s'
      });
    } else {
      logger.warn('DOCX content is empty or could not be extracted.', { fileId });
    }
    return extractedText;
  } catch (error: any) {
    logger.error('Error processing DOCX file', {
      fileId,
      error: error.message,
      stack: error.stack
    });
    if (error.message.includes('timed out')) {
      return 'O processamento deste arquivo DOCX excedeu o tempo limite.';
    }
    throw error;
  }
}
