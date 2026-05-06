import { describe, expect, test } from 'bun:test';
import logger from '@lib/logger';

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
  extractionOptions: unknown[];
  ocrOrchestrator: {
    selectedCalls: number;
    directCalls: number;
    selectedPageNumbers: number[][];
    processPagesWithOcr: (
      buffer: Buffer,
      totalPages: number,
      fileId: string,
      selectedPages: number[]
    ) => Promise<unknown>;
    processWithOcr: () => Promise<unknown>;
  };
};

type CapturedInfoLog = {
  message: string;
  metadata?: unknown;
};

type MixedPageDiagnosticsLogMetadata = {
  totalPages: number;
  normalizedPages: number;
  pagesSelectedForOcr: number;
  pagesWithVisualContent: number;
  pagesWithEmbeddedImages: number;
  pagesWithTables: number;
  classificationCounts: Record<string, number>;
  pages: Array<{
    pageNumber: number;
    embeddedImageCount: number;
    tableCount: number;
    hasVisualContent: boolean;
    shouldOcr: boolean;
    ocrDecisionReason: string;
    textDiagnostics: {
      textLength: number;
      trimmedLength: number;
      classification: string;
      qualityAnalysis: {
        shouldSkipOcr: boolean;
        isHighQuality: boolean;
        hasOcrIndicators: boolean;
      };
    };
  }>;
};

function captureInfoLogs() {
  const originalWrite = logger.write;
  const calls: CapturedInfoLog[] = [];

  logger.write = ((info: unknown, ...args: unknown[]) => {
    if (isLogInfo(info)) {
      const metadata = Object.fromEntries(
        Object.entries(info).filter(([key]) => !['level', 'message', 'timestamp'].includes(key))
      );
      calls.push({ message: info.message, metadata });
    }

    return (originalWrite as (...writeArgs: unknown[]) => unknown).apply(logger, [info, ...args]);
  }) as typeof logger.write;

  return {
    calls,
    restore() {
      logger.write = originalWrite;
    },
  };
}

function isLogInfo(info: unknown): info is { message: string; level?: string; timestamp?: string } {
  return typeof info === 'object' && info !== null && 'message' in info;
}

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
  const extractionOptions: unknown[] = [];

  service.fileDownloadService = {
    async downloadFile() {
      return { value: { buffer: Buffer.from('pdf'), contentLength: 3 }, error: null };
    },
  };
  service.textExtractorService = {
    async extractTextFromPdf(_buffer: Buffer, _fileId: string, options?: unknown) {
      extractionOptions.push(options);
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
  service.extractionOptions = extractionOptions;
  service.ocrOrchestrator = {
    selectedCalls: 0,
    directCalls: 0,
    selectedPageNumbers: [],
    async processPagesWithOcr(
      _buffer: Buffer,
      _totalPages: number,
      _fileId: string,
      selectedPages: number[]
    ) {
      this.selectedCalls++;
      this.selectedPageNumbers.push(selectedPages);
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
  test('disables visual metadata extraction for default and legacy modes', async () => {
    const defaultService = await createService({
      totalPages: 1,
      pages: [{ pageNumber: 1, text: strongNativeText }],
    });

    await defaultService.execute({
      fileId: 'default-pdf',
      url: 'https://example.com/default.pdf',
      mimeType: 'application/pdf',
    });

    expect(defaultService.extractionOptions).toEqual([{ includePageVisualMetadata: false }]);

    const legacyService = await createService({
      totalPages: 1,
      pages: [{ pageNumber: 1, text: strongNativeText }],
    });

    await legacyService.execute(
      { fileId: 'legacy-pdf', url: 'https://example.com/legacy.pdf', mimeType: 'application/pdf' },
      { mode: 'legacy' }
    );

    expect(legacyService.extractionOptions).toEqual([{ includePageVisualMetadata: false }]);
  });

  test('enables visual metadata extraction for mixed-page mode', async () => {
    const service = await createService({
      totalPages: 1,
      pages: [{ pageNumber: 1, text: strongNativeText }],
    });

    await service.execute(
      { fileId: 'mixed-options-pdf', url: 'https://example.com/mixed.pdf', mimeType: 'application/pdf' },
      { mode: 'mixed-page' }
    );

    expect(service.extractionOptions).toEqual([{ includePageVisualMetadata: true }]);
  });

  test('logs redacted URL metadata when PDF processing starts', async () => {
    const service = await createService({
      totalPages: 1,
      pages: [{ pageNumber: 1, text: strongNativeText }],
    });
    const logs = captureInfoLogs();

    try {
      const result = await service.execute(
        {
          fileId: 'redacted-pdf',
          url: 'https://storage.example.com/documents/redacted.pdf?token=secret-token&X-Amz-Signature=secret-signature',
          mimeType: 'application/pdf',
        },
        { mode: 'mixed-page' }
      );

      expect(result.error).toBeNull();
      const startLog = logs.calls.find((call) => call.message === 'Starting PDF processing');
      expect(startLog).toBeDefined();
      expect(startLog?.metadata).toEqual({
        fileId: 'redacted-pdf',
        url: 'https://storage.example.com/documents/redacted.pdf?[redacted-query]',
      });
      expect(JSON.stringify(startLog?.metadata)).not.toContain('secret-token');
      expect(JSON.stringify(startLog?.metadata)).not.toContain('secret-signature');
    } finally {
      logs.restore();
    }
  });

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
    const rawNativeMarker = 'SEGREDO_TEXTO_NATIVO_NAO_LOGAR';
    const service = await createService({
      totalPages: 3,
      pages: [
        { pageNumber: 1, text: `PAGINA NATIVA 1 ${rawNativeMarker} ${strongNativeText}` },
        { pageNumber: 2, text: '' },
        { pageNumber: 3, text: `PAGINA NATIVA 3 ${strongNativeText}` },
      ],
      ocrPages: [{ pageNumber: 2, text: 'PAGINA OCR 2' }],
    });
    const logs = captureInfoLogs();

    try {
      const result = await service.execute(
        { fileId: 'mixed-pdf', url: 'https://example.com/mixed.pdf', mimeType: 'application/pdf' },
        { mode: 'mixed-page' }
      );

      expect(result.error).toBeNull();
      const text = result.value ?? '';
      expect(text.indexOf('PAGINA NATIVA 1')).toBeLessThan(text.indexOf('PAGINA OCR 2'));
      expect(text.indexOf('PAGINA OCR 2')).toBeLessThan(text.indexOf('PAGINA NATIVA 3'));
      expect(text).toContain(rawNativeMarker);
      expect(service.ocrOrchestrator.selectedCalls).toBe(1);
      expect(service.ocrOrchestrator.selectedPageNumbers).toEqual([[2]]);
      expect(service.ocrOrchestrator.directCalls).toBe(0);

      const diagnosticsLog = logs.calls.find(
        (call) => call.message === 'Mixed-page PDF diagnostics evaluated'
      );
      expect(diagnosticsLog).toBeDefined();

      const metadata = diagnosticsLog?.metadata as MixedPageDiagnosticsLogMetadata;
      expect(metadata.totalPages).toBe(3);
      expect(metadata.normalizedPages).toBe(3);
      expect(metadata.pagesSelectedForOcr).toBe(1);
      expect(metadata.pagesWithVisualContent).toBe(0);
      expect(metadata.pagesWithEmbeddedImages).toBe(0);
      expect(metadata.pagesWithTables).toBe(0);
      expect(metadata.classificationCounts['native-text']).toBe(2);
      expect(metadata.classificationCounts.empty).toBe(1);
      expect(metadata.pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
      expect(metadata.pages.map((page) => page.shouldOcr)).toEqual([false, true, false]);
      expect(metadata.pages[0]?.textDiagnostics.classification).toBe('native-text');
      expect(metadata.pages[1]?.textDiagnostics.classification).toBe('empty');
      expect(metadata.pages[1]?.ocrDecisionReason).toBe('insufficient-native-text');
      expect(metadata.pages[2]?.textDiagnostics.qualityAnalysis.shouldSkipOcr).toBe(true);
      expect(JSON.stringify(logs.calls.map((call) => call.metadata))).not.toContain(
        rawNativeMarker
      );
      expect(JSON.stringify(diagnosticsLog?.metadata)).not.toContain('PAGINA NATIVA 1');
    } finally {
      logs.restore();
    }
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
    expect(service.ocrOrchestrator.selectedCalls).toBe(1);
    expect(service.ocrOrchestrator.selectedPageNumbers).toEqual([[1]]);
    expect(service.ocrOrchestrator.directCalls).toBe(0);
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
