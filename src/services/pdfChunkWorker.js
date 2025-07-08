const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { execSync } = require('child_process');
const tmp = require('tmp');

async function processChunk() {
  const { pageFiles, chunkDir, preprocessDir, fileId } = workerData;
  const ocrResults = [];
  
  for (const pageFile of pageFiles) {
    const imgPath = path.join(chunkDir, pageFile);
    const preprocessPath = path.join(preprocessDir, pageFile);
    
    // Pré-processamento para melhorar a qualidade do OCR
    await sharp(imgPath)
      .resize(null, 2000, { 
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3 
      })
      .grayscale()
      .normalize()
      .sharpen()
      .linear(1.2, -(128 * 1.2) + 128) // Aumenta contraste
      .toFile(preprocessPath);
    
    // Múltiplas tentativas com diferentes configurações PSM
    let text = '';
    const psmModes = [1, 3, 6];
    
    // Tenta diferentes modos PSM até obter um resultado satisfatório
    for (const psmMode of psmModes) {
      try {
        text = execSync(
          `tesseract "${preprocessPath}" stdout -l por --oem 1 --psm ${psmMode}`,
          { encoding: 'utf-8', timeout: 15000 } // Timeout reduzido para 15s por página
        );
        
        if (text && text.trim().length >= 50) {
          break; // Se temos texto suficiente, pare de tentar outros modos
        }
      } catch (e) {
        // Falha silenciosa, tenta o próximo modo
      }
    }
    
    const cleanText = text.trim();
    if (cleanText && cleanText.length > 10) {
      ocrResults.push({ page: pageFile, text: cleanText });
    }
  }
  
  // Ordenar resultados pelo nome do arquivo para manter a ordem correta
  ocrResults.sort((a, b) => {
    // Extrair o número da página do nome do arquivo
    const pageNumA = parseInt(a.page.match(/\d+/)[0]);
    const pageNumB = parseInt(b.page.match(/\d+/)[0]);
    return pageNumA - pageNumB;
  });
  
  // Retornar apenas o texto, mantendo a ordem
  parentPort.postMessage(ocrResults.map(result => result.text));
}

// Inicia o processamento
processChunk();
