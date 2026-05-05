import { describe, expect, test } from 'bun:test';

process.env.BASE_URL = 'http://localhost:3000';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_MODEL_TEXT = 'gpt-test';
process.env.TOKEN = 'main-token';
process.env.JOBS_TOKEN = 'jobs-token';

const strongNativeText = [
  'Certifico que o CPF 123.456.789-10 consta na matrícula nº 12345.',
  'O valor do ato é R$ 1.234,56 e foi registrado em 01/02/2026.',
  'Este conteúdo contém dados substanciais do documento para extração nativa.',
]
  .join(' ')
  .repeat(35);

type ProcessPdfServiceInstance = {
  execute: (...args: unknown[]) => Promise<{ value?: string; error?: Error }>;
  fileDownloadService: unknown;
  textExtractorService: unknown;
  ocrOrchestrator: {
    selectedCalls: number;
    directCalls: number;
    processPagesWithOcr: (...args: unknown[]) => Promise<unknown>;
    processWithOcr: (...args: unknown[]) => Promise<unknown>;
  };
};

async function createService({
  totalPages,
  pages,
  ocrPages = [],
  directOcrText = 'TEXTO OCR DIRETO',
}: {
  totalPages: number;
  pages: Array<{
    pageNumber: number;
    text: string;
    embeddedImageCount?: number;
    tableCount?: number;
    hasVisualContent?: boolean;
  }>;
  ocrPages?: Array<{ pageNumber: number; text: string }>;
  directOcrText?: string;
}) {
  const { ProcessPdfService } = await import(
    '../../src/core/services/messages/pdf-utils/process-pdf.service'
  );
  const service = new ProcessPdfService() as unknown as ProcessPdfServiceInstance;

  service.fileDownloadService = {
    async downloadFile() {
      return { value: { buffer: Buffer.from('pdf'), contentLength: 3 }, error: null };
    },
  };
  service.textExtractorService = {
    async extractTextFromPdf() {
      return {
        value: {
          text: pages.map((page) => page.text).join('\n\n'),
          totalPages,
          pages: pages.map((page) => ({
            embeddedImageCount: 0,
            tableCount: 0,
            hasVisualContent: false,
            ...page,
          })),
        },
        error: null,
      };
    },
  };
  service.ocrOrchestrator = {
    selectedCalls: 0,
    directCalls: 0,
    async processPagesWithOcr(
      _buffer: Buffer,
      _totalPages: number,
      _fileId: string,
      selectedPages: number[]
    ) {
      this.selectedCalls++;
      return {
        value: {
          pages: ocrPages.filter((page) => selectedPages.includes(page.pageNumber)),
          chunksProcessed: selectedPages.length,
          processingTime: 1,
        },
        error: null,
      };
    },
    async processWithOcr() {
      this.directCalls++;
      return {
        value: {
          ocrText: directOcrText,
          chunksProcessed: totalPages,
          processingTime: 1,
        },
        error: null,
      };
    },
  };

  return service;
}

describe('ProcessPdfService mixed-page mode', () => {
  test('keeps strong native pages without invoking OCR text replacement', async () => {
    const service = await createService({
      totalPages: 1,
      pages: [{ pageNumber: 1, text: strongNativeText }],
    });

    const result = await service.execute(
      { fileId: 'native-pdf', url: 'https://example.com/native.pdf', mimeType: 'application/pdf' },
      { mode: 'mixed-page' }
    );

    expect(result.error).toBeNull();
    expect(result.value).toContain('matrícula nº 12345');
  });

  test('merges native and OCR text in page order for mixed PDFs', async () => {
    const service = await createService({
      totalPages: 3,
      pages: [
        { pageNumber: 1, text: `PAGINA NATIVA 1 ${strongNativeText}` },
        { pageNumber: 2, text: '' },
        { pageNumber: 3, text: `PAGINA NATIVA 3 ${strongNativeText}` },
      ],
      ocrPages: [{ pageNumber: 2, text: 'PAGINA OCR 2' }],
    });

    const result = await service.execute(
      { fileId: 'mixed-pdf', url: 'https://example.com/mixed.pdf', mimeType: 'application/pdf' },
      { mode: 'mixed-page' }
    );

    expect(result.error).toBeNull();
    const text = result.value ?? '';
    expect(text.indexOf('PAGINA NATIVA 1')).toBeLessThan(text.indexOf('PAGINA OCR 2'));
    expect(text.indexOf('PAGINA OCR 2')).toBeLessThan(text.indexOf('PAGINA NATIVA 3'));
  });

  test('uses direct OCR for small PDFs with insufficient native text', async () => {
    const service = await createService({
      totalPages: 7,
      pages: Array.from({ length: 7 }, (_, index) => ({
        pageNumber: index + 1,
        text: '',
        embeddedImageCount: 1,
        hasVisualContent: true,
      })),
      directOcrText: 'TEXTO OCR PURO DO PDF INTEIRO',
    });

    const result = await service.execute(
      {
        fileId: 'small-scanned-pdf',
        url: 'https://example.com/scanned.pdf',
        mimeType: 'application/pdf',
      },
      { mode: 'mixed-page' }
    );

    expect(result.error).toBeNull();
    expect(result.value).toContain('TEXTO OCR PURO DO PDF INTEIRO');
    expect(service.ocrOrchestrator.directCalls).toBe(1);
    expect(service.ocrOrchestrator.selectedCalls).toBe(0);
  });

  test('runs OCR on pages with visual content even when native text is strong', async () => {
    const service = await createService({
      totalPages: 1,
      pages: [
        {
          pageNumber: 1,
          text: `PAGINA COM TABELA VISUAL ${strongNativeText}`,
          embeddedImageCount: 1,
          hasVisualContent: true,
        },
      ],
      ocrPages: [{ pageNumber: 1, text: 'VALORES EXTRAIDOS DA TABELA VISUAL' }],
    });

    const result = await service.execute(
      {
        fileId: 'visual-table-pdf',
        url: 'https://example.com/visual.pdf',
        mimeType: 'application/pdf',
      },
      { mode: 'mixed-page' }
    );

    expect(result.error).toBeNull();
    expect(result.value).toContain('VALORES EXTRAIDOS DA TABELA VISUAL');
  });

  test('fails before OCR when PDF page limit is exceeded', async () => {
    const service = await createService({
      totalPages: 301,
      pages: [{ pageNumber: 1, text: strongNativeText }],
    });

    const result = await service.execute(
      { fileId: 'large-pdf', url: 'https://example.com/large.pdf', mimeType: 'application/pdf' },
      { mode: 'mixed-page', maxPdfPages: 300 }
    );

    expect(result.value).toBeNull();
    expect(result.error?.message).toContain('acima do limite configurado de 300');
  });
});
