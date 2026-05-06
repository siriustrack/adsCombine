import { afterEach, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { PROCESSING_TIMEOUTS } from '../../src/config/constants';

process.env.BASE_URL = 'http://localhost:3000';
process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.OPENAI_MODEL_TEXT = 'gpt-test';
process.env.TOKEN = 'main-token';
process.env.JOBS_TOKEN = 'jobs-token';

type NeverResolvingPdfService = {
  execute: () => Promise<{ value?: string; error?: Error }>;
};

type ProcessMessagesServiceInstance = {
  processPdfService: NeverResolvingPdfService;
};

const originalPdfTimeout = PROCESSING_TIMEOUTS.PDF_GLOBAL;

afterEach(() => {
  Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_GLOBAL', {
    value: originalPdfTimeout,
    configurable: true,
  });
  rmSync(join(process.cwd(), 'public', 'texts', 'pdf-timeout-conversation'), {
    recursive: true,
    force: true,
  });
});

describe('ProcessMessagesService PDF timeout', () => {
  test('returns a failedFiles entry when PDF processing never resolves', async () => {
    Object.defineProperty(PROCESSING_TIMEOUTS, 'PDF_GLOBAL', {
      value: 5,
      configurable: true,
    });

    const { ProcessMessagesService } = await import(
      '../../src/core/services/messages/process-messages.service'
    );
    const service = new ProcessMessagesService();
    const serviceInternals = service as unknown as ProcessMessagesServiceInstance;
    serviceInternals.processPdfService = {
      execute: () => new Promise(() => {}),
    };

    const response = await service.execute({
      protocol: 'http',
      host: 'localhost:3000',
      messages: [
        {
          conversationId: 'pdf-timeout-conversation',
          body: {
            files: [
              {
                fileId: 'pdf-timeout-file',
                url: 'https://storage.example.com/documents/timeout.pdf?token=secret-token',
                mimeType: 'application/pdf',
              },
            ],
          },
        },
      ],
    });

    expect(response.processedFiles).toEqual([]);
    expect(response.failedFiles).toEqual([
      {
        fileId: 'pdf-timeout-file',
        error: 'O processamento deste arquivo PDF excedeu o tempo limite de 0.005 segundos.',
      },
    ]);
  });
});
