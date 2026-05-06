import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'node:path';
import worker from '../../src/core/services/messages/pdfChunkWorker.js';

type OcrResult = {
  text: string;
  meanConfidence: number;
  wordCount: number;
};

type WorkerTestApi = {
  performOcrOnPages: (pngs: string[], env: Record<string, string>, options?: Record<string, unknown>) => string;
  setHooks: (hooks: {
    runTesseractTsv?: (imagePath: string) => OcrResult;
    rotatePngWithMagick?: (inputPng: string, outputPng: string, angle: number) => boolean;
  }) => void;
  resetHooks: () => void;
};

const workerTest = worker.__test as WorkerTestApi;
const pagePng = path.join(process.cwd(), 'test/pdf/fixtures/page-1.png');

function makeWords(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');
}

function makeResult(prefix: string, wordCount: number, meanConfidence: number): OcrResult {
  return {
    text: makeWords(prefix, wordCount),
    meanConfidence,
    wordCount,
  };
}

function runSinglePageOcr() {
  return workerTest.performOcrOnPages(
    [pagePng],
    {
      OMP_NUM_THREADS: '1',
      OMP_THREAD_LIMIT: '1',
      TESSERACT_NUM_THREADS: '1',
      LC_ALL: 'C',
    },
    {}
  );
}

describe('pdfChunkWorker OCR rotation fallback', () => {
  const previousEnv: Record<string, string | undefined> = {};
  const managedEnvKeys = [
    'PDF_OCR_LANG',
    'PDF_OCR_MAX_ATTEMPTS',
    'PDF_OCR_ROTATE_ENABLED',
    'PDF_OCR_ROTATE_ANGLES',
    'PDF_OCR_ROTATE_MAX_ATTEMPTS',
    'PDF_OCR_ROTATE_MIN_SCORE_GAIN',
    'PDF_OCR_ROTATE_MIN_WORDS',
  ];

  beforeEach(() => {
    for (const key of managedEnvKeys) {
      previousEnv[key] = process.env[key];
    }

    process.env.PDF_OCR_LANG = 'por';
    process.env.PDF_OCR_MAX_ATTEMPTS = '1';
    process.env.PDF_OCR_ROTATE_ANGLES = '90,270';
    delete process.env.PDF_OCR_ROTATE_ENABLED;
    delete process.env.PDF_OCR_ROTATE_MAX_ATTEMPTS;
    process.env.PDF_OCR_ROTATE_MIN_SCORE_GAIN = '8';
    process.env.PDF_OCR_ROTATE_MIN_WORDS = '10';
  });

  afterEach(() => {
    workerTest.resetHooks();

    for (const key of managedEnvKeys) {
      const previousValue = previousEnv[key];
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  });

  test('does not rotate when original OCR is already good enough', () => {
    process.env.PDF_OCR_ROTATE_ENABLED = 'true';
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: () => makeResult('upright', 60, 92),
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('upright0');
    expect(rotatedAngles).toEqual([]);
  });

  test('does not rotate by default even when weak OCR could improve with rotation', () => {
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('rot90', 45, 88);
        return makeResult('weak', 3, 22);
      },
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('weak0');
    expect(text).not.toContain('rot900');
    expect(rotatedAngles).toEqual([]);
  });

  test('does not rotate normal short confident OCR by default', () => {
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('rot90', 45, 88);
        return makeResult('shortconfident', 18, 91);
      },
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('shortconfident0');
    expect(text).not.toContain('rot900');
    expect(rotatedAngles).toEqual([]);
  });

  test('selects 90 degree rotation when it clearly beats weak baseline OCR', () => {
    process.env.PDF_OCR_ROTATE_ENABLED = 'true';
    process.env.PDF_OCR_ROTATE_MAX_ATTEMPTS = '2';
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('rot90', 45, 88);
        if (imagePath.includes('__rot_270')) return makeResult('rot270', 12, 45);
        return makeResult('weak', 3, 22);
      },
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('rot900');
    expect(text).not.toContain('weak0');
    expect(rotatedAngles).toEqual([90, 270]);
  });

  test('selects 270 degree rotation when it clearly beats weak baseline OCR', () => {
    process.env.PDF_OCR_ROTATE_ENABLED = 'true';
    process.env.PDF_OCR_ROTATE_MAX_ATTEMPTS = '2';
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('rot90', 12, 40);
        if (imagePath.includes('__rot_270')) return makeResult('rot270', 50, 91);
        return makeResult('weak', 2, 18);
      },
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('rot2700');
    expect(text).not.toContain('weak0');
    expect(rotatedAngles).toEqual([90, 270]);
  });

  test('rejects rotated candidates that miss minimum gain or minimum words', () => {
    process.env.PDF_OCR_ROTATE_ENABLED = 'true';
    process.env.PDF_OCR_ROTATE_MAX_ATTEMPTS = '2';
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('fewwords', 4, 99);
        if (imagePath.includes('__rot_270')) return makeResult('smallgain', 12, 24);
        return makeResult('baseline', 12, 20);
      },
      rotatePngWithMagick: () => true,
    });

    const text = runSinglePageOcr();

    expect(text).toContain('baseline0');
    expect(text).not.toContain('fewwords0');
    expect(text).not.toContain('smallgain0');
  });

  test('limits enabled rotation to one angle by default', () => {
    process.env.PDF_OCR_ROTATE_ENABLED = 'true';
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('rot90', 45, 88);
        if (imagePath.includes('__rot_270')) return makeResult('rot270', 50, 91);
        return makeResult('weak', 2, 18);
      },
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('rot900');
    expect(text).not.toContain('rot2700');
    expect(rotatedAngles).toEqual([90]);
  });

  test('respects PDF_OCR_ROTATE_ENABLED=false', () => {
    process.env.PDF_OCR_ROTATE_ENABLED = 'false';
    const rotatedAngles: number[] = [];
    workerTest.setHooks({
      runTesseractTsv: (imagePath) => {
        if (imagePath.includes('__rot_90')) return makeResult('rot90', 45, 90);
        return makeResult('weak', 2, 15);
      },
      rotatePngWithMagick: (_inputPng, _outputPng, angle) => {
        rotatedAngles.push(angle);
        return true;
      },
    });

    const text = runSinglePageOcr();

    expect(text).toContain('weak0');
    expect(text).not.toContain('rot900');
    expect(rotatedAngles).toEqual([]);
  });
});
