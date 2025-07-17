import fs from 'node:fs/promises';
import path from 'node:path';
import { wrapPromiseResult } from '@lib/result.types';
import type { DeleteTextsBody } from 'api/controllers/messages.controllers';
import { TEXTS_DIR } from 'config/dirs';
import logger from '../../../lib/logger';

interface FailedFile {
  file: string;
  error: string;
}

export class DeleteTextsService {
  async execute({ conversationId, filename }: DeleteTextsBody): Promise<{
    error: boolean;
    status: number;
    message: string;
    deletedFiles: string[];
    deletedCount: number;
  }> {
    logger.info('Received /delete-texts request', { filename, conversationId });

    const { value: allFiles, error } = await wrapPromiseResult<string[], Error>(
      fs.readdir(TEXTS_DIR)
    );

    if (error) {
      logger.error('Failed to read texts directory', { error: error.message });

      return {
        error: true,
        status: 500,
        message: 'Failed to read texts directory',
        deletedFiles: [],
        deletedCount: 0,
      };
    }

    const txtFiles = allFiles.filter((file) => file.endsWith('.txt'));

    if (txtFiles.length === 0) {
      logger.info('No txt files found in texts directory');
      return {
        error: true,
        status: 404,
        message: 'No txt files found to delete',
        deletedFiles: [],
        deletedCount: 0,
      };
    }

    let filesToDelete: string[] = [];

    if (filename) {
      if (txtFiles.includes(filename)) {
        filesToDelete = [filename];
      } else {
        logger.warn('Specific file not found', { filename });
        return {
          error: true,
          message: `File ${filename} not found`,
          status: 404,
          deletedFiles: [],
          deletedCount: 0,
        };
      }
    } else if (conversationId) {
      filesToDelete = txtFiles.filter((file) => file.startsWith(conversationId));
      if (filesToDelete.length === 0) {
        logger.warn('No files found for conversation', { conversationId });
        return {
          error: true,
          message: `No files found for conversation ${conversationId}`,
          status: 404,
          deletedFiles: [],
          deletedCount: 0,
        };
      }
    } else {
      filesToDelete = txtFiles;
    }

    const deletedFiles: string[] = [];
    const failedFiles: FailedFile[] = [];

    for (const file of filesToDelete) {
      const filePath = path.join(TEXTS_DIR, file);
      const { error } = await wrapPromiseResult<void, Error>(fs.unlink(filePath));

      if (error) {
        logger.error('Failed to delete file', { file, error: error.message });
        failedFiles.push({ file, error: error.message });
        continue;
      }

      deletedFiles.push(file);

      logger.info('File deleted successfully', { file });
    }

    const response: {
      message: string;
      deletedFiles: string[];
      deletedCount: number;
      failedFiles?: FailedFile[];
      error: false;
      status: 200;
    } = {
      message: `Successfully deleted ${deletedFiles.length} file(s)`,
      deletedFiles,
      deletedCount: deletedFiles.length,
      error: false,
      status: 200,
    };

    if (failedFiles.length > 0) {
      response.failedFiles = failedFiles;
      response.message += `. Failed to delete ${failedFiles.length} file(s)`;
    }

    logger.info('Delete operation completed', response);

    return response;
  }
}
