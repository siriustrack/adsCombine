import { PROCESSING_TIMEOUTS } from '@config/constants';
import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import axios, { type AxiosResponse } from 'axios';

export interface DownloadedFile {
  buffer: Buffer;
  contentLength?: number;
}

export class FileDownloadService {
  async downloadFile(url: string, fileId: string): Promise<Result<DownloadedFile, Error>> {
    try {
      const { value: response, error } = await wrapPromiseResult<AxiosResponse, Error>(
        axios.get(url, {
          responseType: 'arraybuffer',
          validateStatus: (status) => status < 500,
          timeout: PROCESSING_TIMEOUTS.FILE_DOWNLOAD,
        })
      );

      if (error) {
        logger.error('Error fetching file', {
          fileId,
          url,
          error: error.message,
          stack: error.stack,
        });
        return errResult(new Error(`Failed to fetch file: ${error.message}`));
      }

      if (!response) {
        logger.error('No response received from file download', {
          fileId,
          url,
        });
        return errResult(new Error('No response received from file download'));
      }

      if (response.status === 404) {
        logger.error('File not found (404)', {
          fileId,
          url,
          status: response.status,
        });
        return errResult(
          new Error(
            'File download returned status 404: Arquivo não encontrado. Verifique se o arquivo existe e a URL está correta.'
          )
        );
      }

      if (response.status >= 400) {
        logger.error('HTTP error fetching file', {
          fileId,
          url,
          status: response.status,
          statusText: response.statusText,
        });
        return errResult(
          new Error(`File download returned status ${response.status}: ${response.statusText}`)
        );
      }

      if (!response.data) {
        logger.error('Empty response data from file download', {
          fileId,
          url,
          status: response.status,
        });
        return errResult(new Error('Empty response data from file download'));
      }

      const buffer = Buffer.from(response.data);
      const contentLength = response.headers['content-length']
        ? parseInt(response.headers['content-length'], 10)
        : buffer.length;

      logger.debug('File downloaded successfully', {
        fileId,
        url,
        contentLength,
        bufferSize: buffer.length,
      });

      return okResult({
        buffer,
        contentLength,
      });
    } catch (err) {
      const error = err as Error;
      logger.error('Unexpected error in file download', {
        fileId,
        url,
        error: error.message,
        stack: error.stack,
      });
      return errResult(new Error(`Unexpected error downloading file: ${error.message}`));
    }
  }
}
