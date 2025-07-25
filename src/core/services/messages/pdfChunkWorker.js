import { execSync } from 'node:child_process';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

async function preprocessImage(imgPath, preprocessPath) {
  try {
    await sharp(imgPath)
      .resize(null, 2000, {
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .grayscale()
      .normalize()
      .sharpen()
      .linear(1.2, -(128 * 1.2) + 128)
      .toFile(preprocessPath);
  } catch (error) {
    console.error(`Sharp preprocessing error for ${imgPath}:`, error);
    throw new Error(`Sharp preprocessing failed: ${error.message}`);
  }
}

async function performOCR(preprocessPath, pageFile) {
  let text = '';
  const psmModes = [1, 3, 6];

  for (const psmMode of psmModes) {
    try {
      text = execSync(`tesseract "${preprocessPath}" stdout -l por --oem 1 --psm ${psmMode}`, {
        encoding: 'utf-8',
        timeout: 15000,
      });

      if (text && text.trim().length >= 50) {
        break;
      }
    } catch (e) {
      console.error(`Error processing ${pageFile} with PSM ${psmMode}:`, e);
      if (e instanceof Error) {
        console.error(e.message);
      }
    }
  }

  return text.trim();
}

function sortOcrResults(ocrResults) {
  ocrResults.sort((a, b) => {
    const matchA = RegExp(/\d+/).exec(a.page);
    const matchB = RegExp(/\d+/).exec(b.page);
    const pageNumA = matchA ? parseInt(matchA[0]) : 0;
    const pageNumB = matchB ? parseInt(matchB[0]) : 0;
    return pageNumA - pageNumB;
  });
}

async function processChunk() {
  const { pageFiles, chunkDir, preprocessDir } = workerData;
  const ocrResults = [];

  try {
    for (const pageFile of pageFiles) {
      const imgPath = path.join(chunkDir, pageFile);
      const preprocessPath = path.join(preprocessDir, pageFile);

      try {
        await preprocessImage(imgPath, preprocessPath);
        const cleanText = await performOCR(preprocessPath, pageFile);

        if (cleanText && cleanText.length > 10) {
          ocrResults.push({ page: pageFile, text: cleanText });
        }
      } catch (pageError) {
        console.error(`Error processing page ${pageFile}:`, pageError);
        // Continue with other pages even if one fails
      }
    }

    sortOcrResults(ocrResults);

    if (parentPort) {
      parentPort.postMessage(ocrResults.map((result) => result.text));
    }
  } catch (error) {
    console.error('Chunk processing error:', error);
    if (parentPort) {
      parentPort.postMessage({ error: error.message });
    }
  }
}

processChunk().catch((error) => {
  console.error('Fatal error in processChunk:', error);
  if (parentPort) {
    parentPort.postMessage({ error: error.message });
  }
});
