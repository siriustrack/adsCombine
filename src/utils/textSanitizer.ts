import fs from 'node:fs';
import path from 'node:path';
import logger from '../lib/logger';

/**
 * Sanitiza texto removendo caracteres Unicode de controle prejudiciais
 * Preserva caracteres úteis como quebras de linha, tabs, espaços
 * @param {string} text - Texto a ser sanitizado
 * @returns {string} - Texto sanitizado
 */
export function sanitizeText(text: string | undefined | null): string {
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
  sanitized = sanitized.replace(/[!@#$%^&*()_+\-={}[\]|\\:;"'<>,.?/]{3,}/g, ' ');

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
export function sanitizeTextFile(filePath: string): string {
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
      logger.info(
        `Arquivo sanitizado salvo: ${sanitizedPath} (removidos ${content.length - sanitized.length} caracteres)`
      );
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
export function sanitizeAllTextFiles(folderPath: string): void {
  try {
    if (!fs.existsSync(folderPath)) {
      logger.warn(`Pasta não encontrada: ${folderPath}`);
      return;
    }

    const files = fs.readdirSync(folderPath);
    const txtFiles = files.filter((file) => file.endsWith('.txt'));

    logger.info(`Iniciando sanitização de ${txtFiles.length} arquivos .txt em ${folderPath}`);

    let processedCount = 0;
    let errorCount = 0;

    for (const file of txtFiles) {
      const filePath = path.join(folderPath, file);
      try {
        sanitizeTextFile(filePath);
        processedCount++;
      } catch (error) {
        logger.error(`Erro ao processar ${file}:`, error);
        errorCount++;
      }
    }

    logger.info(
      `Sanitização concluída. ${processedCount} arquivos processados, ${errorCount} com erros.`
    );
  } catch (error) {
    logger.error(`Erro ao sanitizar pasta ${folderPath}:`, error);
  }
}

/**
 * Remove arquivos de texto que contêm apenas "TEXTO" após sanitização
 * @param {string} folderPath - Caminho da pasta
 */
export function deleteSanitizedTextFilesWithOnlyText(folderPath: string): void {
  try {
    if (!fs.existsSync(folderPath)) {
      logger.warn(`Pasta não encontrada para limpeza: ${folderPath}`);
      return;
    }

    const files = fs.readdirSync(folderPath);
    const sanitizedFiles = files.filter((file) => file.endsWith('_sanitized.txt'));

    let deletedCount = 0;

    for (const file of sanitizedFiles) {
      const filePath = path.join(folderPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8').trim().toUpperCase();
        if (content === 'TEXTO') {
          fs.unlinkSync(filePath);
          logger.info(`Arquivo removido (apenas 'TEXTO'): ${file}`);
          deletedCount++;
        }
      } catch (error) {
        logger.error(`Erro ao verificar/remover ${file}:`, error);
      }
    }

    if (deletedCount > 0) {
      logger.info(`${deletedCount} arquivos sanitizados contendo apenas "TEXTO" foram removidos.`);
    }
  } catch (error) {
    logger.error(`Erro na limpeza de arquivos sanitizados em ${folderPath}:`, error);
  }
}
