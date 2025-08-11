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



function rasterizePngGray({ pdfPath, outPrefix, resolution, from, to }) {
  // Gera PNG grayscale otimizado para velocidade
  const base = `pdftoppm -png -gray -r ${resolution} -aa no -aaVector no`;
  if (from && to) {
    sh(`${base} -f ${from} -l ${to} "${pdfPath}" "${outPrefix}"`, { timeout: 120000 });
  } else {
    sh(`${base} "${pdfPath}" "${outPrefix}"`, { timeout: 120000 });
  }
}

module.exports = async function worker(payload) {
  const t0 = Date.now();
  const {
    pageRange,     // { first, last } no PDF original
    pdfPath,       // caminho do PDF (chunk físico ou original)
    fileId,
  } = payload;

  // Pastas temporárias (auto-clean)
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const workDir = tempDir.name;

  // Heurística de DPI otimizada para velocidade (150 DPI é suficiente para OCR)
  const resolution = 150;

  // Descobre se já é um chunk físico (arquivo com _chunk_)
  const isChunkPdf = path.basename(pdfPath).includes('_chunk_');

  let rasterFrom = null;
  let rasterTo = null;

  if (!isChunkPdf && pageRange && Number.isInteger(pageRange.first) && Number.isInteger(pageRange.last)) {
    rasterFrom = pageRange.first;
    rasterTo = pageRange.last;
  }

  try {
    const prefix = path.join(workDir, 'page');

    // 1) Rasteriza direto para PNG grayscale otimizado
    if (rasterFrom && rasterTo) {
      rasterizePngGray({ pdfPath, outPrefix: prefix, resolution, from: rasterFrom, to: rasterTo });
    } else {
      rasterizePngGray({ pdfPath, outPrefix: prefix, resolution });
    }

    // 2) Skip ImageMagick - maior gargalo de performance (economiza ~3-4s por chunk)

    // 3) Seleciona os PNGs gerados
    const pngs = listFiles(workDir, '.png')
      .filter((f) => f.startsWith('page-'))
      .map((f) => path.join(workDir, f));


    if (!pngs || pngs.length === 0) {
      console.warn(`[Worker ${process.pid}] [Thread ${threadId}] No PNG pages produced to OCR`, {
        fileId,
        pageRange,
      });
      return [];
    }

    // 4) Uma única chamada do Tesseract para o chunk inteiro (batch) — menos overhead.
    const env = {
      ...process.env,
      OMP_NUM_THREADS: '1',
      OMP_THREAD_LIMIT: '1',
      TESSERACT_NUM_THREADS: '1',
      LC_ALL: 'C',
    };

    // Estratégia otimizada: tenta batch primeiro, fallback sequencial se falhar
    const t1 = Date.now();
    let text = '';


    // Múltiplos arquivos - usa sequencial rápido com PSM otimizado
    const texts = [];
    for (const png of pngs) {
      const args = `"${png}" stdout -l por --oem 1 --psm 3`; // PSM 3 mais rápido para páginas
      try {
        const singleText = sh(`tesseract ${args}`, { timeout: 20000, env });
        if (singleText?.trim()) {
          texts.push(singleText.trim());
        }
      } catch (error) {
        console.warn(`[Worker ${process.pid}] Failed to OCR ${png}: ${error.message}`);
      }
    }
    text = texts.join('\n\n'); // Dupla quebra para preservar contexto

    const t2 = Date.now();

    console.log(`[Worker ${process.pid}] [Thread ${threadId}] Chunk OCR completed`, {
      fileId,
      pageRange,
      pages: pngs.length,
      resolution,
      ocrMs: t2 - t1,
      totalMs: t2 - t0,
    });

    const cleaned = text?.trim();
    return cleaned ? [cleaned] : [];
  } catch (error) {
    const dt = Date.now() - t0;
    console.error(`[Worker ${process.pid}] [Thread ${threadId}] Chunk processing error:`, {
      fileId,
      pageRange,
      totalDuration: dt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      workerPid: process.pid,
    });
    throw error;
  } finally {
    try {
      tempDir.removeCallback();
    } catch { }
  }
};
