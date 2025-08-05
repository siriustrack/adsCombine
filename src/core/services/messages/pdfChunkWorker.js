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

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf-8', ...opts });
}

function listFiles(dir, ext) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(ext))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function hasMagick() {
  try {
    sh('magick -version', { timeout: 2000 });
    return true;
  } catch {
    try {
      sh('convert -version', { timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
}

function magickCmd(inputGlob, outputPattern, op) {
  // Tenta com `magick`, cai para `convert` se necessário
  try {
    sh(`magick ${inputGlob} ${op} ${outputPattern}`);
  } catch {
    sh(`convert ${inputGlob} ${op} ${outputPattern}`);
  }
}

function rasterizeTiffGray({ pdfPath, outPrefix, resolution, from, to }) {
  // Gera TIFF grayscale com DPI correto; se `from/to` definidos, usa o range
  const base = `pdftoppm -tiff -gray -r ${resolution}`;
  if (from && to) {
    sh(`${base} -f ${from} -l ${to} "${pdfPath}" "${outPrefix}"`);
  } else {
    sh(`${base} "${pdfPath}" "${outPrefix}"`);
  }
}

module.exports = async function worker(payload) {
  const t0 = Date.now();
  const {
    pageRange,     // { first, last } no PDF original
    pdfPath,       // caminho do PDF (chunk físico ou original)
    fileId,
    totalPages,
  } = payload;

  // Pastas temporárias (auto-clean)
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const workDir = tempDir.name;

  // Heurística de DPI por tamanho de documento (ajuste se quiser)
  const resolution = totalPages > 20 ? 180 : totalPages > 10 ? 220 : 280;

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

    // 1) Rasteriza direto para TIFF grayscale com DPI correto (mata warnings de DPI)
    if (rasterFrom && rasterTo) {
      rasterizeTiffGray({ pdfPath, outPrefix: prefix, resolution, from: rasterFrom, to: rasterTo });
    } else {
      rasterizeTiffGray({ pdfPath, outPrefix: prefix, resolution });
    }

    // 2) (Opcional) Normalização de contraste em lote — leve e ajuda em scans ruins.
    if (hasMagick()) {
      // -contrast-stretch 1%x1% é conservador; ajuste se quiser (2%/2% etc.)
      const glob = `"${path.join(workDir, 'page')}-*.tif"`;
      const outPattern = `"${path.join(workDir, 'norm-%02d.tif')}"`;
      try {
        magickCmd(glob, outPattern, '-contrast-stretch 1%x1%');
      } catch (e) {
        console.warn(`[Worker ${process.pid}] ImageMagick step skipped: ${e.message}`);
      }
    }

    // 3) Seleciona os TIFFs a usar (originais ou normalizados)
    let tiffs = listFiles(workDir, '.tif')
      .filter((f) => f.startsWith('norm-') || f.startsWith('page-'))
      .map((f) => path.join(workDir, f));

    // Se houver normalizados, prioriza-os
    const hasNorm = tiffs.some((p) => path.basename(p).startsWith('norm-'));
    if (hasNorm) {
      tiffs = listFiles(workDir, '.tif')
        .filter((f) => f.startsWith('norm-'))
        .map((f) => path.join(workDir, f));
    }


    if (!tiffs || tiffs.length === 0) {
      console.warn(`[Worker ${process.pid}] [Thread ${threadId}] No TIFF pages produced to OCR`, {
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
    };
    const args = [
      // lista de arquivos
      ...tiffs.map((p) => `"${p}"`),
      'stdout',
      '-l', 'por',
      '--oem', '1',            // LSTM only: costuma ser mais rápido
      '--psm', '6',            // parágrafos — teste 4 se houver muitas colunas
      '-c', 'tessedit_do_invert=0',
      '-c', 'classify_enable_learning=0',
    ].join(' ');

    const t1 = Date.now();
    const text = sh(`tesseract ${args}`, { timeout: 30000, env });
    const t2 = Date.now();

    console.log(`[Worker ${process.pid}] [Thread ${threadId}] Chunk OCR completed`, {
      fileId,
      pageRange,
      pages: tiffs.length,
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
