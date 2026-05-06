import { afterEach, describe, expect, mock, test } from 'bun:test';
import { PROCESSING_TIMEOUTS } from '../../src/config/constants';

type MockTextResult = {
  text: string;
  total: number;
  pages: Array<{ num: number; text: string }>;
};

type MockImageResult = {
  pages: Array<{ pageNumber: number; images: unknown[] }>;
};

type MockTableResult = {
  pages: Array<{ num: number; tables: unknown[] }>;
};

type MockPdfParseBehavior = {
  getText: () => Promise<MockTextResult>;
  getImage: () => Promise<MockImageResult>;
  getTable: () => Promise<MockTableResult>;
  destroy: () => Promise<void>;
};

const originalTimeouts = {
  PDF_NATIVE_TEXT: PROCESSING_TIMEOUTS.PDF_NATIVE_TEXT,
  PDF_METADATA: PROCESSING_TIMEOUTS.PDF_METADATA,
  PDF_PARSER_DESTROY: PROCESSING_TIMEOUTS.PDF_PARSER_DESTROY,
};

const never = () => new Promise<never>(() => undefined);
const parserInstances: MockPDFParse[] = [];

let parserBehavior: MockPdfParseBehavior = createDefaultBehavior();

class MockPDFParse {
  destroyCalls = 0;
  getImageCalls = 0;
  getTableCalls = 0;

  constructor() {
    parserInstances.push(this);
  }

  getText() {
    return parserBehavior.getText();
  }

  getImage() {
    this.getImageCalls++;
    return parserBehavior.getImage();
  }

  getTable() {
    this.getTableCalls++;
    return parserBehavior.getTable();
  }

  async destroy() {
    this.destroyCalls++;
    return parserBehavior.destroy();
  }
}

mock.module('pdf-parse', () => ({
  PDFParse: MockPDFParse,
}));

afterEach(() => {
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_NATIVE_TEXT', {
    value: originalTimeouts.PDF_NATIVE_TEXT,
    configurable: true,
  });
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_METADATA', {
    value: originalTimeouts.PDF_METADATA,
    configurable: true,
  });
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_PARSER_DESTROY', {
    value: originalTimeouts.PDF_PARSER_DESTROY,
    configurable: true,
  });

  parserInstances.length = 0;
  parserBehavior = createDefaultBehavior();
});

describe('PdfTextExtractorService timeouts', () => {
  test('returns an error and destroys parser when native text extraction times out', async () => {
    setPdfParseTimeouts({ nativeText: 5, metadata: 5, destroy: 5 });
    parserBehavior = {
      ...createDefaultBehavior(),
      getText: never,
    };

    const { PdfTextExtractorService } = await import(
      '../../src/core/services/messages/pdf-utils/pdf-text-extractor.service'
    );
    const service = new PdfTextExtractorService();

    const result = await service.extractTextFromPdf(Buffer.from('pdf'), 'native-timeout-pdf');

    expect(result.value).toBeNull();
    expect(result.error?.message).toContain('native PDF text extraction exceeded timeout');
    expect(parserInstances[0]?.destroyCalls).toBe(1);
  });

  test('continues without image metadata when metadata extraction times out', async () => {
    setPdfParseTimeouts({ nativeText: 50, metadata: 5, destroy: 5 });
    parserBehavior = {
      ...createDefaultBehavior(),
      getImage: never,
      getTable: async () => ({
        pages: [{ num: 1, tables: [{}] }],
      }),
    };

    const { PdfTextExtractorService } = await import(
      '../../src/core/services/messages/pdf-utils/pdf-text-extractor.service'
    );
    const service = new PdfTextExtractorService();

    const result = await service.extractTextFromPdf(Buffer.from('pdf'), 'metadata-timeout-pdf');

    expect(result.error).toBeNull();
    expect(result.value?.text).toBe('Texto nativo extraído');
    expect(result.value?.pages).toEqual([
      {
        pageNumber: 1,
        text: 'Texto nativo extraído',
        embeddedImageCount: 0,
        tableCount: 1,
        hasVisualContent: true,
      },
    ]);
    expect(parserInstances[0]?.destroyCalls).toBe(1);
  });

  test('skips image and table metadata extraction when visual metadata is disabled', async () => {
    const { PdfTextExtractorService } = await import(
      '../../src/core/services/messages/pdf-utils/pdf-text-extractor.service'
    );
    const service = new PdfTextExtractorService();

    const result = await service.extractTextFromPdf(Buffer.from('pdf'), 'metadata-disabled-pdf', {
      includePageVisualMetadata: false,
    });

    expect(result.error).toBeNull();
    expect(result.value?.pages).toEqual([
      {
        pageNumber: 1,
        text: 'Texto nativo extraído',
        embeddedImageCount: 0,
        tableCount: 0,
        hasVisualContent: false,
      },
    ]);
    expect(parserInstances[0]?.getImageCalls).toBe(0);
    expect(parserInstances[0]?.getTableCalls).toBe(0);
    expect(parserInstances[0]?.destroyCalls).toBe(1);
  });

  test('extracts image and table metadata when visual metadata is enabled', async () => {
    parserBehavior = {
      ...createDefaultBehavior(),
      getImage: async () => ({
        pages: [{ pageNumber: 1, images: [{}, {}] }],
      }),
      getTable: async () => ({
        pages: [{ num: 1, tables: [{}] }],
      }),
    };

    const { PdfTextExtractorService } = await import(
      '../../src/core/services/messages/pdf-utils/pdf-text-extractor.service'
    );
    const service = new PdfTextExtractorService();

    const result = await service.extractTextFromPdf(Buffer.from('pdf'), 'metadata-enabled-pdf', {
      includePageVisualMetadata: true,
    });

    expect(result.error).toBeNull();
    expect(result.value?.pages).toEqual([
      {
        pageNumber: 1,
        text: 'Texto nativo extraído',
        embeddedImageCount: 2,
        tableCount: 1,
        hasVisualContent: true,
      },
    ]);
    expect(parserInstances[0]?.getImageCalls).toBe(1);
    expect(parserInstances[0]?.getTableCalls).toBe(1);
    expect(parserInstances[0]?.destroyCalls).toBe(1);
  });
});

function createDefaultBehavior(): MockPdfParseBehavior {
  return {
    getText: async () => ({
      text: 'Texto nativo extraído',
      total: 1,
      pages: [{ num: 1, text: 'Texto nativo extraído' }],
    }),
    getImage: async () => ({ pages: [] }),
    getTable: async () => ({ pages: [] }),
    destroy: async () => undefined,
  };
}

function setPdfParseTimeouts({
  nativeText,
  metadata,
  destroy,
}: {
  nativeText: number;
  metadata: number;
  destroy: number;
}) {
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_NATIVE_TEXT', {
    value: nativeText,
    configurable: true,
  });
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_METADATA', {
    value: metadata,
    configurable: true,
  });
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_PARSER_DESTROY', {
    value: destroy,
    configurable: true,
  });
}
