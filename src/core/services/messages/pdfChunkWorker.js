// pdfChunkWorker.js
/* eslint-disable no-console */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const tmp = require('tmp');
const { threadId } = require('node:worker_threads');

tmp.setGracefulCleanup();

// Limita paralelismo interno do Tesseract/OpenMP (cada worker = 1 thread CPU do OCR)
process.env.OMP_NUM_THREADS = '1';
process.env.OMP_THREAD_LIMIT = '1';
process.env.TESSERACT_NUM_THREADS = '1';

// Detecta caminho correto do tessdata (dev vs produção)
if (!process.env.TESSDATA_PREFIX) {
  if (fs.existsSync('/usr/share/tesseract-ocr/4.00/tessdata')) {
    process.env.TESSDATA_PREFIX = '/usr/share/tesseract-ocr/4.00/tessdata';
  } else if (fs.existsSync('/usr/share/tessdata')) {
    process.env.TESSDATA_PREFIX = '/usr/share/tessdata';
  }
}

process.env.LC_ALL = 'C';

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function listFiles(dir, ext) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(ext))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function generatePngPages(pdfPath, workDir, resolution, rasterFrom, rasterTo) {
  const prefix = path.join(workDir, 'page');

  if (rasterFrom && rasterTo) {
    rasterizePng({ pdfPath, outPrefix: prefix, resolution, from: rasterFrom, to: rasterTo });
  } else {
    rasterizePng({ pdfPath, outPrefix: prefix, resolution });
  }

  return listFiles(workDir, '.png')
    .filter((f) => f.startsWith('page-'))
    .map((f) => path.join(workDir, f));
}

function preprocessImage(imagePath) {
  const tempPath = `${imagePath}.processed.png`;
  try {
    // Converte para escala de cinza, aprimora contraste e binariza a imagem
    sh(
      `convert "${imagePath}" -colorspace gray -normalize -negate -threshold 60% -negate "${tempPath}"`
    );
    return tempPath;
  } catch (error) {
    console.warn(
      `[Worker ${process.pid}] Image preprocessing failed for ${imagePath}: ${error.message}. Skipping.`
    );
    return imagePath; // Retorna o caminho original se o processamento falhar
  }
}

function performOcrOnPages(pngs, env) {
  const texts = [];
  for (const png of pngs) {
    const processedPng = preprocessImage(png);
    const args = `"${processedPng}" stdout -l por --oem 1 --psm 4`;
    try {
      const singleText = sh(`tesseract ${args}`, { env });
      if (singleText?.trim()) {
        texts.push(singleText.trim());
      }
    } catch (error) {
      console.warn(`[Worker ${process.pid}] Failed to OCR ${png}: ${error.message}`);
    } finally {
      if (processedPng !== png && fs.existsSync(processedPng)) {
        fs.unlinkSync(processedPng); // Limpa a imagem processada
      }
    }
  }

  return texts.join('\n\n');
}

function logProgress(fileId, pageRange, pngs, resolution, ocrMs, totalMs) {
  console.log(`[Worker ${process.pid}] [Thread ${threadId}] Chunk OCR completed`, {
    fileId,
    pageRange,
    pages: pngs.length,
    resolution,
    ocrMs,
    totalMs,
  });
}

function logError(fileId, pageRange, totalDuration, error) {
  console.error(`[Worker ${process.pid}] [Thread ${threadId}] Chunk processing error:`, {
    fileId,
    pageRange,
    totalDuration,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    workerPid: process.pid,
  });
}

function rasterizePng({ pdfPath, outPrefix, resolution, from, to }) {
  const base = `pdftoppm -png -r ${resolution} -aa no -aaVector no`;
  if (from && to) {
    sh(`${base} -f ${from} -l ${to} "${pdfPath}" "${outPrefix}"`);
  } else {
    sh(`${base} "${pdfPath}" "${outPrefix}"`);
  }
}

module.exports = async function worker(payload) {
  const t0 = Date.now();
  const { pageRange, pdfPath, fileId } = payload;

  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const workDir = tempDir.name;
  const resolution = 150;

  try {
    const { from: rasterFrom, to: rasterTo } = { from: pageRange.first, to: pageRange.last };
    const pngs = generatePngPages(pdfPath, workDir, resolution, rasterFrom, rasterTo);

    if (!pngs || pngs.length === 0) {
      console.warn(`[Worker ${process.pid}] [Thread ${threadId}] No PNG pages produced to OCR`, {
        fileId,
        pageRange,
      });
      return [];
    }

    const env = {
      ...process.env,
      OMP_NUM_THREADS: '1',
      OMP_THREAD_LIMIT: '1',
      TESSERACT_NUM_THREADS: '1',
      LC_ALL: 'C',
    };

    const t1 = Date.now();
    const text = performOcrOnPages(pngs, env);
    const t2 = Date.now();

    logProgress(fileId, pageRange, pngs, resolution, t2 - t1, t2 - t0);

    const cleaned = text?.trim();
    return cleaned ? [cleaned] : [];
  } catch (error) {
    const dt = Date.now() - t0;
    logError(fileId, pageRange, dt, error);
    throw error;
  } finally {
    try {
      tempDir.removeCallback();
    } catch {
      // Ignore cleanup errors
    }
  }
};
