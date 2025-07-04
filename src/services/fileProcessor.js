const axios = require('axios');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const { OpenAI } = require('openai');
const logger = require('../lib/logger');
const { sanitize } = require('../utils/sanitize');
const { openaiConfig } = require('../config/openai');
const tmp = require('tmp');
const { execSync } = require('child_process');
const sharp = require('sharp');

const openai = new OpenAI({ apiKey: openaiConfig.apiKey });

async function processTxt(file) {
  const { fileId, url } = file;
  logger.info('Processing TXT file', { fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const textContent = Buffer.from(response.data).toString('utf-8');
    
    // Aplicar apenas sanitização básica de HTML/caracteres gerais
    const finalText = sanitize(textContent);
    
    logger.info('Successfully processed TXT file', { fileId });
    return finalText;
  } catch (error) {
    logger.error('Error processing TXT file', { fileId, error: error.message });
    throw error;
  }
}

async function processImage(file) {
  const { fileId, url } = file;
  logger.info('Processing image file', { fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(response.data).toString('base64');

    const aiResponse = await openai.chat.completions.create({
      model: openaiConfig.models.image,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image in detail. Return in PT_BR.' },
            {
              type: 'image_url',
              image_url: {
                url: `data:${file.mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    });

    const description = aiResponse.choices[0].message.content;
    
    // Aplicar apenas sanitização básica de HTML/caracteres gerais
    const finalDescription = sanitize(description);
    
    logger.info('Successfully processed image file', { fileId });
    return finalDescription;
  } catch (error) {
    logger.error('Error processing image file', { fileId, error: error.message });
    throw error;
  }
}

async function processPdf(file) {
  const { fileId, url } = file;
  logger.info('Processing PDF file', { fileId, url });

  try {
    // 1. Download PDF into a buffer
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // 2. Extrair texto direto primeiro
    const data = await pdf(buffer);
    let extractedText = '';
    
    if (data.text && data.text.trim().length > 100) {
      extractedText = data.text;
      logger.info('PDF contém texto extraível', { fileId });
    }

    // 3. Usar OCR para garantir extração completa, mesmo que já tenha texto
    logger.info('Aplicando OCR em todas as páginas para extração completa', { fileId });
    const fs = require('fs');
    const path = require('path');
    const tmp = require('tmp');
    const { execSync } = require('child_process');
    const sharp = require('sharp');

    // Write PDF buffer to temp file
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);
    // Create temp dir for images
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    // Convert PDF to PNG pages via pdftoppm
    execSync(`pdftoppm -png "${tempPdf.name}" "${path.join(tempDir.name, 'page')}"`);
    // Read generated PNGs
    const pages = fs.readdirSync(tempDir.name)
      .filter(f => f.endsWith('.png'))
      .sort();

    // Preprocess images and run local Tesseract OCR with improved settings
    const preprocessDir = tmp.dirSync({ unsafeCleanup: true });
    const ocrResults = [];
    
    for (const pageFile of pages) {
      const imgPath = path.join(tempDir.name, pageFile);
      const preprocessPath = path.join(preprocessDir.name, pageFile);
      
      // Melhor pré-processamento para documentos escaneados
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
      
      try {
        // Múltiplas tentativas com diferentes configurações PSM
        let text = '';
        
        // PSM 1: Automatic page segmentation with OSD
        try {
          text = execSync(
            `tesseract "${preprocessPath}" stdout -l por --oem 1 --psm 1`,
            { encoding: 'utf-8', timeout: 30000 }
          );
        } catch (e) {
          logger.warn(`PSM 1 failed for ${pageFile}, trying PSM 3`, { fileId });
        }
        
        // Se PSM 1 não funcionou ou retornou pouco texto, tenta PSM 3
        if (!text || text.trim().length < 50) {
          try {
            text = execSync(
              `tesseract "${preprocessPath}" stdout -l por --oem 1 --psm 3`,
              { encoding: 'utf-8', timeout: 30000 }
            );
          } catch (e) {
            logger.warn(`PSM 3 failed for ${pageFile}, trying PSM 6`, { fileId });
          }
        }
        
        // Se ainda não funcionou, tenta PSM 6
        if (!text || text.trim().length < 50) {
          try {
            text = execSync(
              `tesseract "${preprocessPath}" stdout -l por --oem 1 --psm 6`,
              { encoding: 'utf-8', timeout: 30000 }
            );
          } catch (e) {
            logger.warn(`All PSM modes failed for ${pageFile}`, { fileId });
          }
        }
        
        const cleanText = text.trim();
        if (cleanText && cleanText.length > 10) {
          ocrResults.push(cleanText);
          logger.info(`Successfully extracted text from ${pageFile}`, { 
            fileId, 
            textLength: cleanText.length,
            preview: cleanText.substring(0, 100)
          });
        } else {
          logger.warn(`Little or no text extracted from ${pageFile}`, { fileId });
        }
        
      } catch (error) {
        logger.error(`OCR failed for ${pageFile}`, { fileId, error: error.message });
      }
    }
    // Cleanup tmp files
    preprocessDir.removeCallback();
    tempPdf.removeCallback();
    tempDir.removeCallback();

    // Processar e limpar o texto do OCR
    let ocrText = '';
    if (ocrResults.length > 0) {
      // Filtrar linhas muito repetitivas preservando dados importantes
      const allLines = ocrResults.join('\n').split('\n');
      const lineCount = {};
      
      // Contar frequência de cada linha
      allLines.forEach(line => {
        const cleanLine = line.trim();
        if (cleanLine.length > 5) {
          lineCount[cleanLine] = (lineCount[cleanLine] || 0) + 1;
        }
      });
      
      // Padrões que NÃO devem ser removidos mesmo se repetitivos
      const preservePatterns = [
        /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,           // CPF
        /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,   // CNPJ
        /\b\d{5}-?\d{3}\b/,                        // CEP
        /\bR\$\s*[\d.,]+/,                         // Valores monetários
        /\b[A-ZÁÊÇÕ]{2,}\s+[A-ZÁÊÇÕ\s]+\b/,      // Nomes próprios (maiúsculas)
        /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,            // Datas
        /\b\d{4}-\d{2}-\d{2}\b/,                  // Datas ISO
        /\w+@\w+\.\w+/,                           // E-mails
        /\(\d{2}\)\s*\d{4,5}-?\d{4}/,             // Telefones
        /\b\d+\b/,                                // Números importantes
        /[A-Z]{2,}\s+\d+/,                        // Códigos alfanuméricos
      ];
      
      // Só remover se for muito repetitivo E não contiver dados importantes
      const maxRepetitions = Math.ceil(ocrResults.length * 0.8); // Aumentei para 80%
      const filteredLines = allLines.filter(line => {
        const cleanLine = line.trim();
        
        // Sempre manter linhas vazias e muito curtas
        if (!cleanLine || cleanLine.length <= 3) {
          return true;
        }
        
        // Verificar se contém padrões importantes
        const hasImportantData = preservePatterns.some(pattern => pattern.test(cleanLine));
        
        // Se contém dados importantes, sempre preservar
        if (hasImportantData) {
          return true;
        }
        
        // Se é uma linha genérica repetitiva (cabeçalho/rodapé), remover
        const isRepetitive = lineCount[cleanLine] > maxRepetitions;
        const isGeneric = cleanLine.length < 20 && 
                         (cleanLine.includes('Página') || 
                          cleanLine.includes('página') || 
                          cleanLine.match(/^\d+$/) || // apenas números
                          cleanLine.match(/^[-\s]+$/) || // apenas traços/espaços
                          cleanLine.match(/^\w+\s-\s\d{2}\/\d{2}\/\d{4}\s\d{2}:\d{2}:\d{2}$/)); // timestamp pattern
        
        return !(isRepetitive && isGeneric);
      });
      
      ocrText = filteredLines.join('\n');
      
      logger.info('OCR text processing completed', { 
        fileId,
        totalPages: ocrResults.length,
        originalLines: allLines.length,
        filteredLines: filteredLines.length,
        removedLines: allLines.length - filteredLines.length,
        preservedImportantData: true
      });
    }

    // Combinar o texto extraído diretamente com o resultado do OCR
    let combinedText = '';
    if (extractedText && extractedText.trim().length > 100) {
      // Se já temos bom texto extraído diretamente, usar ele como base
      combinedText = extractedText;
      if (ocrText && ocrText.trim().length > 100) {
        combinedText += '\n\n--- TEXTO ADICIONAL DO OCR ---\n\n' + ocrText;
      }
    } else {
      // Se texto direto é insuficiente, usar OCR como principal
      combinedText = ocrText || extractedText || '';
    }
    
    const finalText = sanitize(combinedText);
    
    if (finalText.trim().length < 50) {
      logger.warn('Very little text extracted from PDF', { 
        fileId, 
        finalTextLength: finalText.length,
        extractedTextLength: extractedText.length,
        ocrTextLength: ocrText.length
      });
    }
    
    logger.info('Successfully processed PDF combining direct extraction and OCR', { 
      fileId,
      finalTextLength: finalText.length,
      hasDirectText: extractedText.length > 100,
      hasOcrText: ocrText.length > 100
    });
    
    return finalText;

  } catch (error) {
    logger.error('Error processing PDF file', { fileId, error: error.message });
    throw error;
  }
}

async function processDocx(file) {
  const { fileId, url } = file;
  logger.info('Processing DOCX file', { fileId, url });
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    const result = await mammoth.extractRawText({ buffer });
    const textContent = result.value;

    let extractedText = '';
    if (textContent && textContent.trim()) {
      extractedText = sanitize(textContent);
      logger.info('Successfully processed DOCX file', { fileId });
    } else {
      logger.warn('DOCX content is empty or could not be extracted.', { fileId });
    }
    return extractedText;
  } catch (error) {
    logger.error('Error processing DOCX file', { fileId, error: error.message });
    throw error;
  }
}

module.exports = {
  processTxt,
  processImage,
  processPdf,
  processDocx,
};
