import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import pdf from 'pdf-parse';

export interface PdfTextData {
  text: string;
  totalPages: number;
}

export class PdfTextExtractorService {
  async extractTextFromPdf(buffer: Buffer, fileId: string): Promise<Result<PdfTextData, Error>> {
    const { value: data, error } = await wrapPromiseResult<pdf.Result, Error>(pdf(buffer));

    if (error) {
      logger.error('Erro ao extrair texto do PDF', { fileId, error: error.message });
      return errResult(new Error(`Erro ao extrair texto do PDF: ${error.message}`));
    }

    const text = data.text?.trim() ?? '';
    const totalPages = data.numpages ?? 0;

    return okResult({ text, totalPages });
  }
}
