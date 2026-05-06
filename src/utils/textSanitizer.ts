import fs from 'node:fs';
import path from 'node:path';
import logger from '../lib/logger';

const RE_CONTROL_CHARS = /[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g;
const RE_ZERO_WIDTH = /[\u200B-\u200F\uFEFF\u00A0]/g;
const RE_LINE_SEPS = /[\u2028\u2029\u0085\u000A\u000D]/g;
const RE_NON_PRINTABLE = /[^\x20-\x7E\xC0-\xFF\u00A1-\u017F\u0400-\u04FF\n\r\t]/g;
const RE_SYMBOL_SEQUENCES = /[!@#$%^&*()_+\-={}[\]|\\:;"'<>,.?/]{3,}/g;
const RE_MULTI_SPACES = /\s{3,}/g;
const RE_MULTI_NEWLINES = /\n{4,}/g;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeText(text: string | undefined | null): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  let sanitized = text.replace(RE_CONTROL_CHARS, '');
  sanitized = sanitized.replace(RE_ZERO_WIDTH, ' ');
  sanitized = sanitized.replace(RE_LINE_SEPS, '\n');
  sanitized = sanitized.replace(RE_NON_PRINTABLE, ' ');
  sanitized = sanitized.replace(RE_SYMBOL_SEQUENCES, ' ');
  sanitized = sanitized.replace(RE_MULTI_SPACES, ' ');
  sanitized = sanitized.replace(RE_MULTI_NEWLINES, '\n\n\n');

  return sanitized.trim();
}

export async function sanitizeTextFile(filePath: string): Promise<string> {
  try {
    if (!(await pathExists(filePath))) {
      logger.warn(`Arquivo nao encontrado: ${filePath}`);
      return '';
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    const sanitized = sanitizeText(content);

    if (content.length - sanitized.length > 100) {
      const dir = path.dirname(filePath);
      const name = path.basename(filePath, '.txt');
      const sanitizedPath = path.join(dir, `${name}_sanitized.txt`);

      await fs.promises.writeFile(sanitizedPath, sanitized, 'utf8');
      logger.debug(
        `Arquivo sanitizado salvo: ${sanitizedPath} (removidos ${content.length - sanitized.length} caracteres)`
      );
    }

    return sanitized;
  } catch (error) {
    logger.error(`Erro ao sanitizar arquivo ${filePath}:`, error);
    return '';
  }
}

export async function sanitizeAllTextFiles(folderPath: string): Promise<void> {
  try {
    if (!(await pathExists(folderPath))) {
      logger.warn(`Pasta nao encontrada: ${folderPath}`);
      return;
    }

    const files = await fs.promises.readdir(folderPath);
    const txtFiles = files.filter((file) => file.endsWith('.txt'));

    logger.debug(`Iniciando sanitizacao de ${txtFiles.length} arquivos .txt em ${folderPath}`);

    let processedCount = 0;
    let errorCount = 0;

    for (const file of txtFiles) {
      const filePath = path.join(folderPath, file);

      try {
        await sanitizeTextFile(filePath);
        processedCount++;
      } catch (error) {
        logger.error(`Erro ao processar ${file}:`, error);
        errorCount++;
      }
    }

    logger.debug(
      `Sanitizacao concluida. ${processedCount} arquivos processados, ${errorCount} com erros.`
    );
  } catch (error) {
    logger.error(`Erro ao sanitizar pasta ${folderPath}:`, error);
  }
}

export async function deleteSanitizedTextFilesWithOnlyText(folderPath: string): Promise<void> {
  try {
    if (!(await pathExists(folderPath))) {
      logger.warn(`Pasta nao encontrada para limpeza: ${folderPath}`);
      return;
    }

    const files = await fs.promises.readdir(folderPath);
    const sanitizedFiles = files.filter((file) => file.endsWith('_sanitized.txt'));

    let deletedCount = 0;

    for (const file of sanitizedFiles) {
      const filePath = path.join(folderPath, file);

      try {
        const content = (await fs.promises.readFile(filePath, 'utf8')).trim().toUpperCase();

        if (content === 'TEXTO') {
          await fs.promises.unlink(filePath);
          logger.debug(`Arquivo removido (apenas 'TEXTO'): ${file}`);
          deletedCount++;
        }
      } catch (error) {
        logger.error(`Erro ao verificar/remover ${file}:`, error);
      }
    }

    if (deletedCount > 0) {
      logger.debug(`${deletedCount} arquivos sanitizados contendo apenas "TEXTO" foram removidos.`);
    }
  } catch (error) {
    logger.error(`Erro na limpeza de arquivos sanitizados em ${folderPath}:`, error);
  }
}
