import fs from 'node:fs/promises';
import { join } from 'node:path';
import { wrapPromiseResult } from '@lib/result.types';
import type { DeleteTextsBody } from 'api/controllers/messages.controllers';
import { TEXTS_DIR } from 'config/dirs';
import logger from '../../../lib/logger';

interface FailedFile {
  file: string;
  error: string;
}

export class DeleteTextsService {
  async execute({ conversationId }: DeleteTextsBody): Promise<{
    error: boolean;
    status: number;
    message: string;
    deletedFiles: string[];
    deletedCount: number;
  }> {
    logger.info('Received /delete-texts request', { conversationId });

    const { value: allFiles, error } = await wrapPromiseResult<string[], Error>(
      fs.readdir(join(TEXTS_DIR, conversationId!))
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

    logger.info('Found files to delete', { count: allFiles.length });

    await wrapPromiseResult<void, Error>(
      fs.rmdir(join(TEXTS_DIR, conversationId!), { recursive: true })
    )

    const response: {
      message: string;
      deletedFiles: string[];
      deletedCount: number;
      failedFiles?: FailedFile[];
      error: false;
      status: 200;
    } = {
      message: `Successfully deleted ${allFiles.length} file(s)`,
      deletedFiles: allFiles,
      deletedCount: allFiles.length,
      error: false,
      status: 200,
    };

    logger.info('Delete operation completed', response);

    return response;
  }
}
