const logger = require('../lib/logger');

/**
 * Sanitiza texto removendo caracteres Unicode de controle prejudiciais
 * Preserva caracteres úteis como quebras de linha, tabs, espaços
 * @param {string} text - Texto a ser sanitizado
 * @returns {string} - Texto sanitizado
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove caracteres de controle Unicode (exceto alguns úteis)
  // Mantém: \n (10), \r (13), \t (9) - quebras de linha e tabs
  // Remove: \u0000-\u0008, \u000B-\u000C, \u000E-\u001F
  let sanitized = text.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '');
  
  // Remove zero-width characters e outros caracteres invisíveis problemáticos
  sanitized = sanitized.replace(/[\u200B-\u200F\uFEFF\u00A0]/g, ' ');
  
  // Remove caracteres de controle raros mas problemáticos
  sanitized = sanitized.replace(/[\u2028\u2029\u0085\u000A\u000D]/g, '\n');
  
  // Remove caracteres de símbolos que frequentemente causam problemas em extrações de PDF
  sanitized = sanitized.replace(/[^\x20-\x7E\xC0-\xFF\u00A1-\u017F\u0400-\u04FF\n\r\t]/g, ' ');
  
  // Remove sequências de símbolos indesejados que aparecem frequentemente em PDFs mal extraídos
  sanitized = sanitized.replace(/[\!\@\#\$\%\^\&\*\(\)\_\+\-\=\{\}\[\]\|\\\:\;\"\'\<\>\,\.\?\/]{3,}/g, ' ');
  
  // Remove sequências excessivas de espaços/quebras de linha
  sanitized = sanitized.replace(/\s{3,}/g, ' '); // Múltiplos espaços -> 1 espaço
  sanitized = sanitized.replace(/\n{4,}/g, '\n\n\n'); // Múltiplas quebras -> máximo 3
  
  // Limpa início e fim
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * Sanitiza arquivo de texto completo
 * @param {string} filePath - Caminho do arquivo
 * @returns {string} - Conteúdo sanitizado
 */
function sanitizeTextFile(filePath) {
  const fs = require('fs');
  const path = require('path');
  
  try {
    if (!fs.existsSync(filePath)) {
      logger.warn(`Arquivo não encontrado: ${filePath}`);
      return '';
    }
    
    // Lê o arquivo
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Sanitiza o conteúdo
    const sanitized = sanitizeText(content);
    
    // Se houve mudanças significativas, salva uma versão sanitizada
    if (content.length - sanitized.length > 100) {
      const dir = path.dirname(filePath);
      const name = path.basename(filePath, '.txt');
      const sanitizedPath = path.join(dir, `${name}_sanitized.txt`);
      
      fs.writeFileSync(sanitizedPath, sanitized, 'utf8');
      logger.info(`Arquivo sanitizado salvo: ${sanitizedPath} (removidos ${content.length - sanitized.length} caracteres)`);
    }
    
    return sanitized;
    
  } catch (error) {
    logger.error(`Erro ao sanitizar arquivo ${filePath}:`, error);
    return '';
  }
}

/**
 * Sanitiza todos os arquivos .txt em uma pasta
 * @param {string} folderPath - Caminho da pasta
 */
function sanitizeAllTextFiles(folderPath) {
  const fs = require('fs');
  const path = require('path');
  
  try {
    if (!fs.existsSync(folderPath)) {
      logger.warn(`Pasta não encontrada: ${folderPath}`);
      return;
    }
    
    const files = fs.readdirSync(folderPath);
    const txtFiles = files.filter(file => file.endsWith('.txt'));
    
    logger.info(`Iniciando sanitização de ${txtFiles.length} arquivos .txt em ${folderPath}`);
    
    let processedCount = 0;
    let errorCount = 0;
    
    for (const file of txtFiles) {
      try {
        const filePath = path.join(folderPath, file);
        const originalContent = fs.readFileSync(filePath, 'utf8');
        const sanitizedContent = sanitizeText(originalContent);
        
        // Se houve mudanças, sobrescreve o arquivo original
        if (originalContent !== sanitizedContent) {
          fs.writeFileSync(filePath, sanitizedContent, 'utf8');
          logger.info(`Sanitizado: ${file} (removidos ${originalContent.length - sanitizedContent.length} caracteres)`);
        }
        
        processedCount++;
        
      } catch (error) {
        logger.error(`Erro ao processar ${file}:`, error);
        errorCount++;
      }
    }
    
    logger.info(`Sanitização concluída: ${processedCount} arquivos processados, ${errorCount} erros`);
    
  } catch (error) {
    logger.error(`Erro ao sanitizar pasta ${folderPath}:`, error);
  }
}

/**
 * Detecta se um texto contém caracteres problemáticos
 * @param {string} text - Texto a verificar
 * @returns {object} - Relatório de problemas encontrados
 */
function analyzeTextProblems(text) {
  if (!text || typeof text !== 'string') {
    return { hasProblems: false };
  }
  
  const problems = {
    hasProblems: false,
    controlChars: 0,
    zeroWidthChars: 0,
    nonPrintableSymbols: 0,
    repetitiveSymbols: 0,
    excessiveSpaces: 0,
    totalLength: text.length,
    examples: []
  };
  
  // Conta caracteres de controle
  const controlMatches = text.match(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g);
  if (controlMatches) {
    problems.controlChars = controlMatches.length;
    problems.hasProblems = true;
    problems.examples.push(`Caracteres de controle: ${controlMatches.slice(0, 5).map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(', ')}`);
  }
  
  // Conta zero-width characters e outros invisíveis
  const zeroWidthMatches = text.match(/[\u200B-\u200F\uFEFF\u00A0]/g);
  if (zeroWidthMatches) {
    problems.zeroWidthChars = zeroWidthMatches.length;
    problems.hasProblems = true;
    problems.examples.push(`Zero-width e invisíveis: ${zeroWidthMatches.length}`);
  }
  
  // Conta caracteres não imprimíveis ou raros
  const nonPrintableMatches = text.match(/[^\x20-\x7E\xC0-\xFF\u00A1-\u017F\u0400-\u04FF\n\r\t]/g);
  if (nonPrintableMatches) {
    problems.nonPrintableSymbols = nonPrintableMatches.length;
    problems.hasProblems = true;
    problems.examples.push(`Símbolos não-imprimíveis: ${nonPrintableMatches.length}`);
  }
  
  // Conta sequências repetitivas de símbolos (comuns em PDFs mal extraídos)
  const repetitiveSymbolMatches = text.match(/[\!\@\#\$\%\^\&\*\(\)\_\+\-\=\{\}\[\]\|\\\:\;\"\'\<\>\,\.\?\/]{3,}/g);
  if (repetitiveSymbolMatches) {
    problems.repetitiveSymbols = repetitiveSymbolMatches.length;
    problems.hasProblems = true;
    problems.examples.push(`Sequências de símbolos repetitivos: ${repetitiveSymbolMatches.length}`);
  }
  
  // Conta espaços excessivos
  const excessiveSpaceMatches = text.match(/\s{3,}/g);
  if (excessiveSpaceMatches) {
    problems.excessiveSpaces = excessiveSpaceMatches.length;
    problems.examples.push(`Sequências de espaços excessivos: ${excessiveSpaceMatches.length}`);
  }
  
  return problems;
}

module.exports = {
  sanitizeText,
  sanitizeTextFile,
  sanitizeAllTextFiles,
  analyzeTextProblems
};
