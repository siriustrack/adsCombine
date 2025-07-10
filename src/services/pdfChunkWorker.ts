import { execSync } from 'node:child_process';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';

interface WorkerData {
  pageFiles: string[];
  chunkDir: string;
  preprocessDir: string;
  fileId: string;
}

interface OcrResult {
  page: string;
  text: string;
}

async function processChunk() {
  const { pageFiles, chunkDir, preprocessDir }: WorkerData = workerData;
  const ocrResults: OcrResult[] = [];

  for (const pageFile of pageFiles) {
    const imgPath = path.join(chunkDir, pageFile);
    const preprocessPath = path.join(preprocessDir, pageFile);

    await sharp(imgPath)
      .resize(null, 2000, {
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3
      })
      .grayscale()
      .normalize()
      .sharpen()
      .linear(1.2, -(128 * 1.2) + 128)
      .toFile(preprocessPath);


    let text = '';
    const psmModes = [1, 3, 6];


    for (const psmMode of psmModes) {
      try {
        text = execSync(
          `tesseract "${preprocessPath}" stdout -l por --oem 1 --psm ${psmMode}`,
          { encoding: 'utf-8', timeout: 15000 }
        );

        if (text && text.trim().length >= 50) {
          break;
        }
      } catch (e) {

      }
    }

    const cleanText = text.trim();
    if (cleanText && cleanText.length > 10) {
      ocrResults.push({ page: pageFile, text: cleanText });
    }
  }

  ocrResults.sort((a, b) => {
    const matchA = a.page.match(/\d+/);
    const matchB = b.page.match(/\d+/);
    const pageNumA = matchA ? parseInt(matchA[0]) : 0;
    const pageNumB = matchB ? parseInt(matchB[0]) : 0;
    return pageNumA - pageNumB;
  });


  if (parentPort) {
    parentPort.postMessage(ocrResults.map(result => result.text));
  }
}


processChunk();
