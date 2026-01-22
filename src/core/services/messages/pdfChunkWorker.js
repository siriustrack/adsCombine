// pdfChunkWorker.js
/* eslint-disable no-console */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const tmp = require('tmp');
const { threadId } = require('node:worker_threads');

// -----------------------------------------------------------------------------
// Runtime setup
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Env helpers
// -----------------------------------------------------------------------------
function getEnvInt(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

function getEnvFloat(name, defaultValue) {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function getEnvStr(name, defaultValue) {
  const raw = process.env[name];
  return raw && String(raw).trim() ? String(raw).trim() : defaultValue;
}

// -----------------------------------------------------------------------------
// Tool detection
// -----------------------------------------------------------------------------
function hasCmd(cmd) {
  try {
    sh(`command -v ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

function magickCmd() {
  return hasCmd('magick') ? 'magick' : 'convert';
}

const HAS_MAGICK = hasCmd('magick') || hasCmd('convert');

function magickHelp() {
  try {
    return sh(`${magickCmd()} -help`);
  } catch {
    return '';
  }
}

const MAGICK_HELP = HAS_MAGICK ? String(magickHelp()) : '';
const HAS_MAGICK_ADAPTIVE_THRESHOLD = /-adaptive-threshold\b/i.test(MAGICK_HELP);
const HAS_MAGICK_LAT = /-lat\b/i.test(MAGICK_HELP);

// -----------------------------------------------------------------------------
// Tesseract language selection
// -----------------------------------------------------------------------------
let cachedLangs;
function getAvailableTesseractLangs() {
  if (cachedLangs) return cachedLangs;
  try {
    const out = sh('tesseract --list-langs');
    const lines = String(out)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const langs = lines
      .filter((l) => !l.toLowerCase().includes('list of available languages'))
      .map((l) => l.split(/\s+/)[0])
      .filter(Boolean);
    cachedLangs = new Set(langs);
  } catch {
    cachedLangs = new Set();
  }
  return cachedLangs;
}

function pickLanguage() {
  const preferred = getEnvStr('PDF_OCR_LANG', '').trim();
  if (preferred) return preferred;

  const langs = getAvailableTesseractLangs();
  // Prefer por+eng if present; fallback to por
  if (langs.has('por') && langs.has('eng')) return 'por+eng';
  if (langs.has('por')) return 'por';
  return 'por';
}

function parseTsvToTextAndConfidence(tsv) {
  const lines = String(tsv).split(/\r?\n/);
  let totalConf = 0;
  let confCount = 0;
  let wordCount = 0;
  let out = '';
  let lastKey = '';

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split('\t');
    if (cols.length < 12) continue;

    const level = cols[0];
    if (level !== '5') continue;

    const pageNum = cols[1];
    const blockNum = cols[2];
    const parNum = cols[3];
    const lineNum = cols[4];
    const confStr = cols[10];
    const word = (cols[11] || '').trim();
    if (!word) continue;

    const key = `${pageNum}.${blockNum}.${parNum}.${lineNum}`;
    if (lastKey && key !== lastKey) {
      out = `${out.trimEnd()}\n`;
    } else if (out && !out.endsWith('\n')) {
      out += ' ';
    }

    out += word;
    lastKey = key;

    const conf = Number.parseFloat(confStr);
    if (Number.isFinite(conf) && conf >= 0) {
      totalConf += conf;
      confCount++;
    }
    wordCount++;
  }

  const meanConfidence = confCount > 0 ? totalConf / confCount : 0;
  return {
    text: out.trim(),
    meanConfidence,
    wordCount,
  };
}

function scoreOcrResult({ text, meanConfidence, wordCount }) {
  const length = text ? text.length : 0;
  const lengthScore = Math.min(35, length / 120); // saturates around ~4.2k chars
  const wordsScore = Math.min(25, Math.log10(wordCount + 1) * 12);
  const confScore = Math.min(100, Math.max(0, meanConfidence));
  // Heavily favor confidence, but break ties with useful volume.
  return confScore * 1.0 + lengthScore * 1.0 + wordsScore * 1.2;
}

function runTesseractTsv(imagePath, { lang, oem, psm, dpi, env }) {
  // Use TSV output to get confidence; we also reconstruct text from the TSV.
  // Note: `--dpi` exists in tesseract 5.x and helps some scans.
  const cmd = `tesseract "${imagePath}" stdout -l ${lang} --oem ${oem} --psm ${psm} --dpi ${dpi} tsv`;
  const tsv = sh(cmd, { env });
  return parseTsvToTextAndConfidence(tsv);
}

function preprocessWithMagick(inputPng, outputPng, { scalePercent, threshold }) {
  if (!HAS_MAGICK) return false;

  // Pipeline tuned for small fonts + scanned docs:
  // - deskew to fix slight rotations
  // - normalize/contrast-stretch to improve separation
  // - upscale + sharpen to help tesseract on tiny glyphs
  // - optional adaptive threshold for washed-out scans
  const cmd = magickCmd();
  const deskew = getEnvFloat('PDF_OCR_DESKEW', 40);
  const stretch = getEnvStr('PDF_OCR_CONTRAST_STRETCH', '0x12%');
  const sharpen = getEnvStr('PDF_OCR_SHARPEN', '0x1.0');
  const thresholdArgs = threshold
    ? {
        adaptive: getEnvStr('PDF_OCR_ADAPTIVE_THRESHOLD', '35x35+10%'),
        lat: getEnvStr('PDF_OCR_LAT', '20x20+10%'),
        hard: getEnvStr('PDF_OCR_THRESHOLD', '55%'),
      }
    : null;

  const parts = [
    cmd,
    `"${inputPng}"`,
    '-colorspace',
    'Gray',
    '-alpha',
    'off',
    '-deskew',
    `${deskew}%`,
    '-normalize',
    '-contrast-stretch',
    stretch,
    '-filter',
    'Lanczos',
    '-resize',
    `${scalePercent}%`,
    '-sharpen',
    sharpen,
  ];

  if (thresholdArgs) {
    // Some ImageMagick builds don't ship -adaptive-threshold; prefer -lat when available.
    if (HAS_MAGICK_ADAPTIVE_THRESHOLD) {
      parts.push('-adaptive-threshold', thresholdArgs.adaptive);
    } else if (HAS_MAGICK_LAT) {
      parts.push('-lat', thresholdArgs.lat);
    } else {
      // Last-resort: global threshold
      parts.push('-threshold', thresholdArgs.hard);
    }
  }

  parts.push(`"${outputPng}"`);

  sh(parts.join(' '));
  return true;
}

// -----------------------------------------------------------------------------
// PDF rasterization
// -----------------------------------------------------------------------------
function listFiles(dir, ext) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(ext))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function rasterizePng({ pdfPath, outPrefix, resolution, from, to }) {
  // Generate grayscale PNGs at higher DPI for better OCR (small fonts benefit a lot).
  // Keep antialiasing default (usually helps readability); preprocessing will handle sharpening.
  const base = `pdftoppm -gray -png -r ${resolution}`;
  if (from && to) {
    sh(`${base} -f ${from} -l ${to} "${pdfPath}" "${outPrefix}"`);
  } else {
    sh(`${base} "${pdfPath}" "${outPrefix}"`);
  }
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

function performOcrOnPages(pngs, env) {
  const texts = [];
  const lang = pickLanguage();
  const oem = getEnvInt('PDF_OCR_OEM', 1);
  const dpi = getEnvInt('PDF_OCR_DPI', 300);
  // In practice, registry scans with margins/columns often work better with PSM 4.
  // Keep a fallback to PSM 6 for more "single-block" pages.
  const preferredPsm = getEnvInt('PDF_OCR_PSM', 4);
  const fallbackPsm = getEnvInt('PDF_OCR_PSM_FALLBACK', 6);
  const maxAttempts = getEnvInt('PDF_OCR_MAX_ATTEMPTS', 3);
  const goodEnoughConfidence = getEnvInt('PDF_OCR_GOOD_CONF', 84);
  const goodEnoughMinChars = getEnvInt('PDF_OCR_GOOD_MIN_CHARS', 350);
  const goodEnoughMinWords = getEnvInt('PDF_OCR_GOOD_MIN_WORDS', 40);

  for (let pageIndex = 0; pageIndex < pngs.length; pageIndex++) {
    const png = pngs[pageIndex];

    // Upscale a bit even after rasterization to help tiny fonts.
    // Default tuned to be faster while still helping small fonts.
    const defaultScale = dpi >= 320 ? 130 : 140;
    const scalePercent = getEnvInt('PDF_OCR_SCALE', defaultScale);

    // Lazy preprocessing (only if needed) to reduce time.
    const workDir = path.dirname(png);
    const base = path.basename(png, '.png');
    const pre1 = path.join(workDir, `${base}__prep.png`);
    const pre2 = path.join(workDir, `${base}__prep_thr.png`);
    let prepReady = false;
    let prepThrReady = false;

    function ensurePrep() {
      if (prepReady) return true;
      try {
        prepReady = preprocessWithMagick(png, pre1, { scalePercent, threshold: false });
      } catch (error) {
        const errorDetails = error.stderr ? `\nSTDERR: ${error.stderr.toString()}` : '';
        console.warn(
          `[Worker ${process.pid}] Preprocess failed for page ${pageIndex + 1}: ${error?.message || String(error)}${errorDetails}`
        );
        prepReady = false;
      }
      return prepReady;
    }

    function ensurePrepThreshold() {
      if (prepThrReady) return true;
      try {
        prepThrReady = preprocessWithMagick(png, pre2, { scalePercent, threshold: true });
      } catch (error) {
        const errorDetails = error.stderr ? `\nSTDERR: ${error.stderr.toString()}` : '';
        console.warn(
          `[Worker ${process.pid}] Threshold preprocess failed for page ${pageIndex + 1}: ${error?.message || String(error)}${errorDetails}`
        );
        prepThrReady = false;
      }
      return prepThrReady;
    }

    const attempts = [];
    // 1) Try original first (fastest path)
    attempts.push({ label: 'orig', path: png, psm: preferredPsm });

    let best = { text: '', meanConfidence: 0, wordCount: 0 };
    let bestScore = -Infinity;
    let bestMeta = { label: 'none', psm: preferredPsm };

    function isGoodEnough(result) {
      return (
        result.meanConfidence >= goodEnoughConfidence &&
        result.wordCount >= goodEnoughMinWords &&
        result.text.length >= goodEnoughMinChars
      );
    }

    function maybeQueueMoreAttempts(result) {
      // If the first attempt isn't good enough, try a preprocessed version.
      if (attempts.length < maxAttempts && !isGoodEnough(result)) {
        if (ensurePrep()) {
          attempts.push({ label: 'prep', path: pre1, psm: preferredPsm });
        }
      }

      // Still weak? try fallback PSM (no extra preprocessing)
      if (attempts.length < maxAttempts && !isGoodEnough(result)) {
        attempts.push({ label: 'orig', path: png, psm: fallbackPsm });
      }

      // Last resort: thresholded preprocess + fallback PSM (most expensive)
      if (attempts.length < maxAttempts && !isGoodEnough(result)) {
        if (ensurePrepThreshold()) {
          attempts.push({ label: 'prep_thr', path: pre2, psm: fallbackPsm });
        }
      }
    }

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        const result = runTesseractTsv(attempt.path, {
          lang,
          oem,
          psm: attempt.psm,
          dpi,
          env,
        });
        const score = scoreOcrResult(result);
        if (score > bestScore) {
          bestScore = score;
          best = result;
          bestMeta = { label: attempt.label, psm: attempt.psm };
        }

        // If not good enough, queue the next best attempts lazily.
        maybeQueueMoreAttempts(result);

        // Early stop if quality is clearly good.
        if (isGoodEnough(result)) {
          best = result;
          bestMeta = { label: attempt.label, psm: attempt.psm };
          break;
        }
      } catch (error) {
        // Keep trying other candidates
        console.warn(
          `[Worker ${process.pid}] OCR attempt failed (${attempt.label}, psm=${attempt.psm}) on page ${
            pageIndex + 1
          }: ${error.message}`
        );
      }
    }

    if (best?.text?.trim()) {
      console.log(`[Worker ${process.pid}] Best OCR selected`, {
        pageIndex: pageIndex + 1,
        selected: bestMeta,
        meanConfidence: Number(best.meanConfidence?.toFixed?.(2) ?? best.meanConfidence),
        wordCount: best.wordCount,
        textLength: best.text.length,
      });
      texts.push(best.text.trim());
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

// -----------------------------------------------------------------------------
// Worker entrypoint
// -----------------------------------------------------------------------------
module.exports = async function worker(payload) {
  const t0 = Date.now();
  const { pageRange, pdfPath, fileId } = payload;

  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const workDir = tempDir.name;
  const resolution = getEnvInt('PDF_RASTER_DPI', 300);

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

    // Propagate DPI default to tesseract unless explicitly set.
    if (!env.PDF_OCR_DPI) {
      env.PDF_OCR_DPI = String(resolution);
    }

    const t1 = Date.now();
    const text = performOcrOnPages(pngs, env);
    const t2 = Date.now();

    logProgress(fileId, pageRange, pngs, resolution, t2 - t1, t2 - t0);

    const cleaned = text?.trim();
    return cleaned;
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
