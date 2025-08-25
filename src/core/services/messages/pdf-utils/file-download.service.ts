import logger from '@lib/logger';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import axios, { type AxiosResponse } from 'axios';

export interface DownloadedFile {
  buffer: Buffer;
  contentLength?: number;
}

export class FileDownloadService {
  async downloadFile(url: string, fileId: string): Promise<Result<DownloadedFile, Error>> {
    const { value: response, error } = await wrapPromiseResult<AxiosResponse, Error>(
      axios.get(url, { responseType: 'arraybuffer', validateStatus: (status) => status < 500 })
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

    if (response.status === 404) {
      logger.warn('File not found in bucket', {
        fileId,
        url,
        status: response.status,
      });
      return errResult(
        new Error('Arquivo não encontrado no bucket. Verifique se o arquivo existe.')
      );
    }

    if (response.status >= 400) {
      logger.error('HTTP error fetching file', {
        fileId,
        url,
        status: response.status,
        statusText: response.statusText,
      });
      return errResult(new Error(`Erro HTTP ${response.status}: ${response.statusText}`));
    }

    const buffer = Buffer.from(response.data);
    const contentLength = response.headers['content-length'] 
      ? parseInt(response.headers['content-length'], 10) 
      : buffer.length;

    return okResult({
      buffer,
      contentLength,
    });
  }
}
