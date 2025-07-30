import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import tmp from 'tmp';

sharp.cache(false);

async function preprocessImage(imgPath, preprocessPath) {
  try {
    // Removemos o resize, pois o pdftoppm já gera a imagem com 300 DPI.
    // O sharpen() também foi removido por ser muito lento. O contraste (linear) é mais importante.
    await sharp(imgPath)
      .grayscale()
      .normalize()
      .linear(1.2, -(128 * 1.2) + 128)
      .toFile(preprocessPath);
  } catch (error) {
    console.error(`Sharp preprocessing error for ${imgPath}:`, error);
    throw new Error(`Sharp preprocessing failed: ${error.message}`);
  }
}

async function performOCR(preprocessPath) {
  // Tenta o modo 3 (padrão, mais confiável) primeiro.
  try {
    const text = execSync(`tesseract "${preprocessPath}" stdout -l por --oem 1 --psm 3`, {
      encoding: 'utf-8',
      timeout: 20000, // 20 segundos de timeout
    });
    if (text && text.trim().length > 10) return text.trim();
  } catch (e) {
    console.error(`Error processing with PSM 3, trying PSM 6. Error: ${e.message}`);
    // Se o modo 3 falhar, tenta o modo 6 (assume um único bloco de texto).
    try {
      const text = execSync(`tesseract "${preprocessPath}" stdout -l por --oem 1 --psm 6`, {
        encoding: 'utf-8',
        timeout: 20000,
      });
      return text.trim();
    } catch (e2) {
      console.error(`Error processing with PSM 6 as well. Error: ${e2.message}`);
    }
  }
  return ''; // Retorna vazio se ambos falharem
}

async function processPage(pageFile, tempDirName, preprocessDirName) {
  const imgPath = path.join(tempDirName, pageFile);
  const preprocessPath = path.join(preprocessDirName, pageFile);
  try {
    await preprocessImage(imgPath, preprocessPath);
    return await performOCR(preprocessPath);
  } catch (pageError) {
    console.error(`Error processing page ${pageFile}:`, pageError);
    return null; // Retorna nulo em caso de erro para não quebrar o Promise.all
  }
}

async function processChunk() {
  const { pageRange, pdfPath } = workerData;
  let ocrResults = [];

  // Cria diretórios temporários dentro do worker
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const preprocessDir = tmp.dirSync({ unsafeCleanup: true });

  try {
    // 1. Converte apenas as páginas deste chunk com 300 DPI
    execSync(
      `pdftoppm -png -r 300 -f ${pageRange.first} -l ${pageRange.last} "${pdfPath}" "${path.join(
        tempDir.name,
        'page'
      )}"`
    );

    const pageFiles = fs.readdirSync(tempDir.name).filter((f) => f.endsWith('.png'));

    // 2. Processa todas as páginas do chunk em paralelo
    const pagePromises = pageFiles.map((pageFile) =>
      processPage(pageFile, tempDir.name, preprocessDir.name)
    );
    const resultsFromPages = await Promise.all(pagePromises);

    // Filtra resultados nulos (de erros) e adiciona ao resultado final
    ocrResults = ocrResults.concat(resultsFromPages.filter((text) => text));

    if (parentPort) {
      parentPort.postMessage(ocrResults);
    }
  } catch (error) {
    console.error('Chunk processing error:', error);
    if (parentPort) {
      parentPort.postMessage({ error: error.message });
    }
  } finally {
    // Limpa os diretórios temporários
    tempDir.removeCallback();
    preprocessDir.removeCallback();
  }
}

processChunk().catch((error) => {
  console.error('Fatal error in processChunk:', error);
  if (parentPort) {
    parentPort.postMessage({ error: error.message });
  }
});
