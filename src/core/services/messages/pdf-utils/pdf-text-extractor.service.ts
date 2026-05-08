import { PROCESSING_TIMEOUTS } from '@config/constants';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { type ImageResult, PDFParse, type TableResult } from 'pdf-parse';

export interface PdfTextData {
  text: string;
  totalPages: number;
  pages: PdfPageText[];
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
  embeddedImageCount: number;
  tableCount: number;
  hasVisualContent: boolean;
}

export interface PdfTextExtractorOptions {
  includePageVisualMetadata?: boolean;
}

export class PdfTextExtractorService {
  async extractTextFromPdf(
    buffer: Buffer,
    fileId: string,
    options: PdfTextExtractorOptions = {}
  ): Promise<Result<PdfTextData, Error>> {
    const parser = new PDFParse({ data: buffer });
    const startedAt = Date.now();
    const includePageVisualMetadata = options.includePageVisualMetadata ?? true;

    try {
      logger.debug('Starting native PDF text extraction', {
        fileId,
        bytes: buffer.byteLength,
        timeoutMs: PROCESSING_TIMEOUTS.PDF_NATIVE_TEXT,
      });

      const data = await this.withTimeout(
        parser.getText(),
        PROCESSING_TIMEOUTS.PDF_NATIVE_TEXT,
        'native PDF text extraction'
      );

      logger.debug('Native PDF text extraction completed', {
        fileId,
        totalPages: data.total ?? 0,
        textLength: data.text?.trim().length ?? 0,
        durationMs: Date.now() - startedAt,
      });

      const { imageCountByPage, tableCountByPage } = await this.extractPageVisualMetadata(
        parser,
        fileId,
        includePageVisualMetadata
      );

      const pages = [...(data.pages ?? [])]
        .sort((a, b) => a.num - b.num)
        .map((page) =>
          this.createPageText(page.num, page.text ?? '', imageCountByPage, tableCountByPage)
        );
      const text = data.text?.trim() ?? '';
      const totalPages = data.total ?? 0;

      return okResult({ text, totalPages, pages });
    } catch (error) {
      const extractionError = error instanceof Error ? error : new Error(String(error));
      logger.error('Erro ao extrair texto do PDF', { fileId, error: extractionError.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${extractionError.message}`));
    } finally {
      await this.destroyParser(parser, fileId);
    }
  }

  private async extractPageVisualMetadata(
    parser: PDFParse,
    fileId: string,
    includePageVisualMetadata: boolean
  ): Promise<{ imageCountByPage: Map<number, number>; tableCountByPage: Map<number, number> }> {
    if (!includePageVisualMetadata) {
      return {
        imageCountByPage: new Map(),
        tableCountByPage: new Map(),
      };
    }

    const [imageResult, tableResult] = await Promise.all([
      this.extractImageMetadata(parser, fileId),
      this.extractTableMetadata(parser, fileId),
    ]);

    return {
      imageCountByPage: this.mapImageCountsByPage(imageResult),
      tableCountByPage: this.mapTableCountsByPage(tableResult),
    };
  }

  private async extractImageMetadata(
    parser: PDFParse,
    fileId: string
  ): Promise<ImageResult | null> {
    const startedAt = Date.now();

    logger.debug('Starting PDF image metadata extraction', {
      fileId,
      timeoutMs: PROCESSING_TIMEOUTS.PDF_METADATA,
    });

    const { value, error } = await wrapPromiseResult<ImageResult, Error>(
      this.withTimeout(
        parser.getImage({ imageBuffer: false, imageDataUrl: false, imageThreshold: 100 }),
        PROCESSING_TIMEOUTS.PDF_METADATA,
        'PDF image metadata extraction'
      )
    );

    if (error) {
      logger.warn('Erro ao extrair metadados de imagem do PDF', {
        fileId,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }

    logger.debug('PDF image metadata extraction completed', {
      fileId,
      pagesWithImages: value.pages.length,
      durationMs: Date.now() - startedAt,
    });

    return value;
  }

  private async extractTableMetadata(
    parser: PDFParse,
    fileId: string
  ): Promise<TableResult | null> {
    const startedAt = Date.now();

    logger.debug('Starting PDF table metadata extraction', {
      fileId,
      timeoutMs: PROCESSING_TIMEOUTS.PDF_METADATA,
    });

    const { value, error } = await wrapPromiseResult<TableResult, Error>(
      this.withTimeout(
        parser.getTable(),
        PROCESSING_TIMEOUTS.PDF_METADATA,
        'PDF table metadata extraction'
      )
    );

    if (error) {
      logger.warn('Erro ao extrair metadados de tabela do PDF', {
        fileId,
        error: error.message,
        durationMs: Date.now() - startedAt,
      });
      return null;
    }

    logger.debug('PDF table metadata extraction completed', {
      fileId,
      pagesWithTables: value.pages.length,
      durationMs: Date.now() - startedAt,
    });

    return value;
  }

  private async destroyParser(parser: PDFParse, fileId: string): Promise<void> {
    const { error } = await wrapPromiseResult<void, Error>(
      this.withTimeout(
        parser.destroy(),
        PROCESSING_TIMEOUTS.PDF_PARSER_DESTROY,
        'PDF parser cleanup'
      )
    );

    if (error) {
      logger.warn('PDF parser cleanup did not complete normally', { fileId, error: error.message });
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} exceeded timeout of ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private mapImageCountsByPage(result: ImageResult | null): Map<number, number> {
    return new Map(result?.pages.map((page) => [page.pageNumber, page.images.length]) ?? []);
  }

  private mapTableCountsByPage(result: TableResult | null): Map<number, number> {
    return new Map(result?.pages.map((page) => [page.num, page.tables.length]) ?? []);
  }

  private createPageText(
    pageNumber: number,
    text: string,
    imageCountByPage: Map<number, number>,
    tableCountByPage: Map<number, number>
  ): PdfPageText {
    const embeddedImageCount = imageCountByPage.get(pageNumber) ?? 0;
    const tableCount = tableCountByPage.get(pageNumber) ?? 0;

    return {
      pageNumber,
      text,
      embeddedImageCount,
      tableCount,
      hasVisualContent: embeddedImageCount > 0 || tableCount > 0,
    };
  }
}
