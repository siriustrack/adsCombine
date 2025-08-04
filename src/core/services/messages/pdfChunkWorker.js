const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const tmp = require('tmp');

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
    // Use faster PSM mode and optimizations for speed
    const text = execSync(`tesseract "${preprocessPath}" stdout -l por --oem 3 --psm 6 -c tessedit_do_invert=0`, {
      encoding: 'utf-8',
      timeout: 15000, // Reduced timeout
    });
    if (text && text.trim().length > 10) return text.trim();
  } catch (e) {
    console.error(`Error processing with PSM 6, trying PSM 3. Error: ${e.message}`);

    try {
      const text = execSync(`tesseract "${preprocessPath}" stdout -l por --oem 3 --psm 3`, {
        encoding: 'utf-8',
        timeout: 15000, // Reduced timeout
      });
      return text.trim();
    } catch (e2) {
      console.error(`Error processing with PSM 3 as well. Error: ${e2.message}`);
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

module.exports = async function worker({ pageRange, pdfPath, fileId, totalPages }) {
  const startTime = Date.now();
  let ocrResults = [];
  const tempDir = tmp.dirSync({ unsafeCleanup: true });
  const preprocessDir = tmp.dirSync({ unsafeCleanup: true });

  // Adaptive resolution based on document size
  const resolution = totalPages > 20 ? 200 : totalPages > 10 ? 250 : 300;
  
  logger.info(`[Worker ${process.pid}] Starting chunk processing`, {
    fileId,
    pageRange,
    startTime,
    resolution,
    totalPages,
    tempDir: tempDir.name,
    preprocessDir: preprocessDir.name
  });

  try {
    const pdfToPpmStart = Date.now();
    execSync(
      `pdftoppm -png -r ${resolution} -f ${pageRange.first} -l ${pageRange.last} "${pdfPath}" "${path.join(
        tempDir.name,
        'page'
      )}"`
    );
    const pdfToPpmEnd = Date.now();

    const pageFiles = fs.readdirSync(tempDir.name).filter((f) => f.endsWith('.png'));
    
    logger.info(`[Worker ${process.pid}] PDF to images conversion completed`, {
      fileId,
      pageRange,
      pdfToPpmDuration: pdfToPpmEnd - pdfToPpmStart,
      pagesGenerated: pageFiles.length,
      pageFiles
    });

    const ocrStart = Date.now();
    
    // Process pages in parallel instead of sequentially
    const concurrency = Math.min(pageFiles.length, 3); // Max 3 pages in parallel per worker
    const pageResults = [];
    
    for (let i = 0; i < pageFiles.length; i += concurrency) {
      const batch = pageFiles.slice(i, i + concurrency);
      const batchPromises = batch.map((pageFile, batchIndex) => {
        const pageStartTime = Date.now();
        const actualIndex = i + batchIndex;
        return processPage(pageFile, tempDir.name, preprocessDir.name).then(result => {
          const pageDuration = Date.now() - pageStartTime;
          logger.info(`[Worker ${process.pid}] Page OCR completed`, {
            fileId,
            pageFile,
            pageIndex: actualIndex,
            pageDuration,
            resultLength: result ? result.length : 0
          });
          return result;
        }).catch(error => {
          const pageDuration = Date.now() - pageStartTime;
          console.error(`[Worker ${process.pid}] Page OCR failed`, {
            fileId,
            pageFile,
            pageIndex: actualIndex,
            pageDuration,
            error: error.message
          });
          return null;
        });
      });
      
      const batchResults = await Promise.all(batchPromises);
      pageResults.push(...batchResults);
    }
    const ocrEnd = Date.now();
    
    ocrResults = pageResults.filter((text) => text !== null && text !== undefined);

    const totalDuration = Date.now() - startTime;
    logger.info(`[Worker ${process.pid}] Chunk processing completed`, {
      fileId,
      pageRange,
      totalDuration,
      breakdown: {
        pdfToPpm: pdfToPpmEnd - pdfToPpmStart,
        ocr: ocrEnd - ocrStart,
        cleanup: Date.now() - ocrEnd
      },
      pagesProcessed: pageFiles.length,
      successfulOcr: ocrResults.length,
      totalTextLength: ocrResults.join('').length,
      workerPid: process.pid
    });

    return ocrResults;
  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.error(`[Worker ${process.pid}] Chunk processing error:`, {
      fileId,
      pageRange,
      totalDuration,
      error: error.message,
      stack: error.stack,
      workerPid: process.pid
    });

    throw error;
  } finally {
    const cleanupStart = Date.now();
    tempDir.removeCallback();
    preprocessDir.removeCallback();
    const cleanupEnd = Date.now();
    
    logger.info(`[Worker ${process.pid}] Cleanup completed`, {
      fileId,
      pageRange,
      cleanupDuration: cleanupEnd - cleanupStart,
      workerPid: process.pid
    });
  }
};