import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import { PDFParse, type TextResult } from 'pdf-parse';

export interface PdfTextData {
  text: string;
  totalPages: number;
  pages: PdfPageText[];
}

export interface PdfPageText {
  pageNumber: number;
  text: string;
}

export class PdfTextExtractorService {
  async extractTextFromPdf(buffer: Buffer, fileId: string): Promise<Result<PdfTextData, Error>> {
    const parser = new PDFParse({ data: buffer });
    const { value: data, error } = await wrapPromiseResult<TextResult, Error>(parser.getText());
    await parser.destroy();

    if (error) {
      logger.error('Erro ao extrair texto do PDF', { fileId, error: error.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${error.message}`));
    }

    const pages = [...(data.pages ?? [])]
      .sort((a, b) => a.num - b.num)
      .map((page) => ({ pageNumber: page.num, text: page.text ?? '' }));
    const text = data.text?.trim() ?? '';
    const totalPages = data.total ?? 0;

    return okResult({ text, totalPages, pages });
  }
}
