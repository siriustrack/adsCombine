import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import tmp from 'tmp';

sharp.cache(false);

async function preprocessImage(imgPath, preprocessDirName) {
  const outputPath = path.join(preprocessDirName, `${path.basename(imgPath, '.png')}.tif`);
  try {
    await sharp(imgPath)
      .grayscale()
      .normalize()
      .linear(1.2, -(128 * 1.2) + 128)
      .tiff({
        compression: 'lzw',
        quality: 100,
      })
      .toFile(outputPath);
    return outputPath;
  } catch (error) {
    console.error(`Sharp preprocessing error for ${imgPath}:`, error);
    throw new Error(`Sharp preprocessing failed: ${error.message}`);
  }
}

async function performOCR(preprocessPath) {

  try {
    const text = execSync(`tesseract "${preprocessPath}" stdout -l por --oem 1 --psm 3`, {
      encoding: 'utf-8',
      timeout: 20000,
    });
    if (text && text.trim().length > 10) return text.trim();
  } catch (e) {
    console.error(`Error processing with PSM 3, trying PSM 6. Error: ${e.message}`);

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
  return '';
}

async function processPage(pageFile, tempDirName, preprocessDirName) {
  const imgPath = path.join(tempDirName, pageFile);
  try {

    const processedImgPath = await preprocessImage(imgPath, preprocessDirName);
    return await performOCR(processedImgPath);
  } catch (pageError) {
    console.error(`Error processing page ${pageFile}:`, pageError);
    return null;
  }
}



module.exports = async ({ pageRange, pdfPath }) => {
  let ocrResults = [];
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const preprocessDir = tmp.dirSync({ unsafeCleanup: true });

  try {
    execSync(
      `pdftoppm -png -r 300 -f ${pageRange.first} -l ${pageRange.last} "${pdfPath}" "${path.join(
        tempDir.name,
        'page'
      )}"`
    );

    const pageFiles = fs.readdirSync(tempDir.name).filter((f) => f.endsWith('.png'));
    const pagePromises = pageFiles.map((pageFile) =>
      processPage(pageFile, tempDir.name, preprocessDir.name)
    );
    const resultsFromPages = await Promise.all(pagePromises);
    ocrResults = resultsFromPages.filter((text) => text);

    return ocrResults;
  } catch (error) {
    console.error('Chunk processing error:', error);

    throw error;
  } finally {
    tempDir.removeCallback();
    preprocessDir.removeCallback();
  }
};