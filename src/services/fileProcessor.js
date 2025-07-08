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
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const os = require('os');

// Número máximo de workers baseado nos cores disponíveis (deixando alguns cores livres para o sistema)
const MAX_WORKERS = Math.max(1, Math.floor(os.cpus().length * 0.75));

const openai = new OpenAI({ apiKey: openaiConfig.apiKey });

async function processTxt(file) {
  const { fileId, url } = file;
  logger.info('Processing TXT file', { fileId, url });
  
  // Define um timeout para garantir processamento rápido
  const TXT_TIMEOUT = 10000; // 10 segundos para processamento de TXT
  
  try {
    // Criar uma promessa com timeout para o processamento do arquivo TXT
    const processTxtWithTimeout = Promise.race([
      (async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const textContent = Buffer.from(response.data).toString('utf-8');
        return sanitize(textContent);
      })(),
      
      // Promessa de timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TXT processing timed out')), TXT_TIMEOUT)
      )
    ]);
    
    const finalText = await processTxtWithTimeout;
    
    logger.info('Successfully processed TXT file', { 
      fileId,
      textLength: finalText.length,
      processingTime: 'under 10s'
    });
    
    return finalText;
  } catch (error) {
    logger.error('Error processing TXT file', { 
      fileId, 
      error: error.message,
      stack: error.stack
    });
    
    // Em caso de timeout, retornar mensagem informativa
    if (error.message.includes('timed out')) {
      return 'O processamento deste arquivo de texto excedeu o tempo limite.';
    }
    
    throw error;
  }
}

async function processImage(file) {
  const { fileId, url } = file;
  logger.info('Processing image file', { fileId, url });
  
  // Define um timeout global para garantir que o processamento termine em tempo hábil
  const IMAGE_TIMEOUT = 30000; // 30 segundos para processamento de imagem
  
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);
    
    // Criar uma promessa com timeout para o processamento da imagem
    const processImageWithTimeout = Promise.race([
      (async () => {
        // Converter para base64
        const base64Image = imageBuffer.toString('base64');

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
          timeout: 25000, // Timeout específico para a API OpenAI
        });

        return aiResponse.choices[0].message.content;
      })(),
      
      // Promessa de timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Image processing timed out')), IMAGE_TIMEOUT)
      )
    ]);
    
    const description = await processImageWithTimeout;
    
    // Aplicar sanitização básica
    const finalDescription = sanitize(description);
    
    logger.info('Successfully processed image file', { 
      fileId, 
      descriptionLength: finalDescription.length,
      processingTime: 'under 30s'
    });
    
    return finalDescription;
  } catch (error) {
    logger.error('Error processing image file', { 
      fileId, 
      error: error.message,
      stack: error.stack 
    });
    
    // Em caso de timeout, retornar uma descrição padrão
    if (error.message.includes('timed out')) {
      const defaultDescription = 'Não foi possível processar a descrição completa desta imagem dentro do tempo limite.';
      logger.warn('Returning default description due to timeout', { fileId });
      return defaultDescription;
    }
    
    throw error;
  }
}

async function processPdf(file) {
  const { fileId, url } = file;
  logger.info('Processing PDF file', { fileId, url });
  
  // Definir um timeout global para garantir que o processamento termine em 60 segundos
  const GLOBAL_TIMEOUT = 58000; // 58 segundos (para dar uma margem de 2 segundos para finalização)
  
  // Criar uma promise que será rejeitada após o timeout global
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('PDF processing timed out after 60 seconds')), GLOBAL_TIMEOUT);
  });

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

    // Se o texto extraído é suficiente e de boa qualidade, podemos retorná-lo imediatamente
    if (extractedText && extractedText.trim().length > 1000 && !extractedText.includes('�')) {
      logger.info('PDF contém texto extraível de alta qualidade, pulando OCR', { fileId });
      return sanitize(extractedText);
    }

    // 3. Usar OCR paralelo para processamento rápido
    logger.info('Iniciando processamento OCR paralelo', { fileId });

    // Criar diretórios temporários
    const tempPdf = tmp.fileSync({ postfix: '.pdf' });
    fs.writeFileSync(tempPdf.name, buffer);
    const tempDir = tmp.dirSync({ unsafeCleanup: true });
    
    // Converter PDF para PNGs
    execSync(`pdftoppm -png "${tempPdf.name}" "${path.join(tempDir.name, 'page')}"`);
    
    // Ler as páginas geradas e ordená-las corretamente
    const pages = fs.readdirSync(tempDir.name)
      .filter(f => f.endsWith('.png'))
      .sort((a, b) => {
        // Extrair números das páginas para ordenação numérica
        const pageNumA = parseInt(a.match(/\d+/)[0]);
        const pageNumB = parseInt(b.match(/\d+/)[0]);
        return pageNumA - pageNumB;
      });
    
    const totalPages = pages.length;
    logger.info(`PDF com ${totalPages} páginas`, { fileId });
    
    if (totalPages === 0) {
      logger.warn('Nenhuma página extraída do PDF', { fileId });
      tempPdf.removeCallback();
      tempDir.removeCallback();
      return extractedText ? sanitize(extractedText) : '';
    }
    
    // Dividir as páginas em chunks para processamento paralelo
    const numChunks = Math.min(5, totalPages, MAX_WORKERS);
    const pagesPerChunk = Math.ceil(totalPages / numChunks);
    const chunks = [];
    
    for (let i = 0; i < numChunks; i++) {
      const start = i * pagesPerChunk;
      const end = Math.min(start + pagesPerChunk, totalPages);
      chunks.push(pages.slice(start, end));
    }
    
    logger.info(`Dividindo PDF em ${chunks.length} chunks para processamento paralelo`, { 
      fileId, 
      numChunks: chunks.length, 
      pagesPerChunk,
      maxWorkers: MAX_WORKERS
    });
    
    // Criar diretório para pré-processamento
    const preprocessDir = tmp.dirSync({ unsafeCleanup: true });
    
    // Função para processar um chunk usando worker thread
    const processChunk = (chunkPages) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker('./src/services/pdfChunkWorker.js', {
          workerData: {
            pageFiles: chunkPages,
            chunkDir: tempDir.name,
            preprocessDir: preprocessDir.name,
            fileId
          }
        });
        
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      });
    };
    
    // Processar todos os chunks em paralelo com timeout global
    const ocrPromise = Promise.all(chunks.map(processChunk));
    const ocrResults = await Promise.race([ocrPromise, timeoutPromise])
      .catch(error => {
        if (error.message.includes('timed out')) {
          logger.warn('OCR processamento atingiu timeout de 60 segundos, retornando resultados parciais', { fileId });
          // Retornar o que temos até agora ou texto extraído diretamente
          return extractedText ? [extractedText] : [];
        }
        throw error;
      });
    
    // Limpar arquivos temporários
    preprocessDir.removeCallback();
    tempPdf.removeCallback();
    tempDir.removeCallback();
    
    // Processar e limpar o texto do OCR (flatten os resultados dos chunks)
    let ocrText = '';
    if (ocrResults && ocrResults.length > 0) {
      // Achatar a matriz de resultados - cada item em ocrResults é um array de textos de um chunk
      const flattenedResults = ocrResults.flat();
      
      // Filtrar linhas muito repetitivas preservando dados importantes
      const allLines = flattenedResults.join('\n').split('\n');
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
      const maxRepetitions = Math.ceil(flattenedResults.length * 0.8);
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
        totalPages,
        chunksProcessed: ocrResults.length,
        originalLines: allLines.length,
        filteredLines: filteredLines.length,
        removedLines: allLines.length - filteredLines.length
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
        extractedTextLength: extractedText ? extractedText.length : 0,
        ocrTextLength: ocrText ? ocrText.length : 0
      });
    }
    
    logger.info('Successfully processed PDF with parallel OCR', { 
      fileId,
      finalTextLength: finalText.length,
      processingTime: 'under 60s',
      hasDirectText: extractedText && extractedText.length > 100,
      hasOcrText: ocrText && ocrText.length > 100
    });
    
    return finalText;

  } catch (error) {
    logger.error('Error processing PDF file', { 
      fileId, 
      error: error.message,
      stack: error.stack
    });
    
    // Se tiver algum texto extraído diretamente, retorne-o em caso de erro no OCR
    if (extractedText && extractedText.trim().length > 0) {
      logger.info('Returning direct extracted text due to OCR failure', { fileId });
      return sanitize(extractedText);
    }
    
    throw error;
  }
}

async function processDocx(file) {
  const { fileId, url } = file;
  logger.info('Processing DOCX file', { fileId, url });
  
  // Define um timeout para garantir processamento rápido
  const DOCX_TIMEOUT = 20000; // 20 segundos para processamento de DOCX
  
  try {
    // Criar uma promessa com timeout para o processamento do arquivo DOCX
    const processDocxWithTimeout = Promise.race([
      (async () => {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      })(),
      
      // Promessa de timeout
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('DOCX processing timed out')), DOCX_TIMEOUT)
      )
    ]);
    
    const textContent = await processDocxWithTimeout;

    let extractedText = '';
    if (textContent && textContent.trim()) {
      extractedText = sanitize(textContent);
      logger.info('Successfully processed DOCX file', { 
        fileId,
        textLength: extractedText.length,
        processingTime: 'under 20s'
      });
    } else {
      logger.warn('DOCX content is empty or could not be extracted.', { fileId });
    }
    return extractedText;
  } catch (error) {
    logger.error('Error processing DOCX file', { 
      fileId, 
      error: error.message,
      stack: error.stack
    });
    
    // Em caso de timeout, retornar mensagem informativa
    if (error.message.includes('timed out')) {
      return 'O processamento deste arquivo DOCX excedeu o tempo limite.';
    }
    
    throw error;
  }
}

module.exports = {
  processTxt,
  processImage,
  processPdf,
  processDocx,
};
