import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { PDFParse, type ImageResult, type TableResult, type TextResult } from 'pdf-parse';

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

export class PdfTextExtractorService {
  async extractTextFromPdf(buffer: Buffer, fileId: string): Promise<Result<PdfTextData, Error>> {
    const parser = new PDFParse({ data: buffer });
    const { value: data, error } = await wrapPromiseResult<TextResult, Error>(parser.getText());

    if (error) {
      await parser.destroy();
      logger.error('Erro ao extrair texto do PDF', { fileId, error: error.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${error.message}`));
    }

    const [imageResult, tableResult] = await Promise.all([
      this.extractImageMetadata(parser, fileId),
      this.extractTableMetadata(parser, fileId),
    ]);

    await parser.destroy();

    const imageCountByPage = this.mapImageCountsByPage(imageResult);
    const tableCountByPage = this.mapTableCountsByPage(tableResult);

    const pages = [...(data.pages ?? [])]
      .sort((a, b) => a.num - b.num)
      .map((page) => this.createPageText(page.num, page.text ?? '', imageCountByPage, tableCountByPage));
    const text = data.text?.trim() ?? '';
    const totalPages = data.total ?? 0;

    return okResult({ text, totalPages, pages });
  }

  private async extractImageMetadata(parser: PDFParse, fileId: string): Promise<ImageResult | null> {
    const { value, error } = await wrapPromiseResult<ImageResult, Error>(
      parser.getImage({ imageBuffer: false, imageDataUrl: false, imageThreshold: 100 })
    );

    if (error) {
      logger.warn('Erro ao extrair metadados de imagem do PDF', { fileId, error: error.message });
      return null;
    }

    return value;
  }

  private async extractTableMetadata(parser: PDFParse, fileId: string): Promise<TableResult | null> {
    const { value, error } = await wrapPromiseResult<TableResult, Error>(parser.getTable());

    if (error) {
      logger.warn('Erro ao extrair metadados de tabela do PDF', { fileId, error: error.message });
      return null;
    }

    return value;
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
