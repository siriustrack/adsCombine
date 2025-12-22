import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import pdf from 'pdf-parse';

export interface PdfTextData {
  text: string;
  totalPages: number;
  pageInfo?: Array<{
    pageNumber: number;
    estimatedCharStart: number;
  }>;
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

    // Detect page breaks using multi-strategy approach
    const pageInfo = this.detectPageBreaksFromText(text, totalPages, fileId);

    return okResult({ text, totalPages, pageInfo });
  }

  /**
   * Detect page breaks in extracted text using multiple strategies
   * Strategy 1 (Primary): Look for form feed characters (\f) - most accurate
   * Strategy 2 (Fallback): Estimate based on uniform character distribution
   */
  private detectPageBreaksFromText(
    text: string,
    totalPages: number,
    fileId: string
  ): Array<{ pageNumber: number; estimatedCharStart: number }> {
    const pageInfo: Array<{ pageNumber: number; estimatedCharStart: number }> = [];

    // Always add page 1 starting at index 0
    pageInfo.push({ pageNumber: 1, estimatedCharStart: 0 });

    if (totalPages <= 1) {
      return pageInfo;
    }

    // Strategy 1: Look for form feed characters (\f)
    let currentPageNum = 1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\f') {
        currentPageNum++;
        pageInfo.push({
          pageNumber: currentPageNum,
          estimatedCharStart: i + 1, // Start after the form feed
        });
      }
    }

    // Check if we found enough form feeds (within reasonable margin)
    const additionalPagesFound = pageInfo.length - 1; // Subtract page 1
    const expectedFormFeeds = totalPages - 1;

    if (additionalPagesFound >= expectedFormFeeds * 0.8) {
      // Found at least 80% of expected page breaks - use this data
      logger.debug('Page breaks detected using form feeds', {
        fileId,
        totalPages,
        formFeedsFound: additionalPagesFound,
        accuracy: 'high',
      });
      return pageInfo;
    }

    // Strategy 2: Fallback to uniform distribution
    logger.debug('Form feeds insufficient, using uniform distribution', {
      fileId,
      totalPages,
      formFeedsFound,
      accuracy: 'estimated',
    });

    // Reset and use uniform distribution
    const uniformPageInfo: Array<{ pageNumber: number; estimatedCharStart: number }> = [];
    uniformPageInfo.push({ pageNumber: 1, estimatedCharStart: 0 });

    const avgCharsPerPage = Math.floor(text.length / totalPages);

    for (let page = 2; page <= totalPages; page++) {
      uniformPageInfo.push({
        pageNumber: page,
        estimatedCharStart: (page - 1) * avgCharsPerPage,
      });
    }

    return uniformPageInfo;
  }
}
