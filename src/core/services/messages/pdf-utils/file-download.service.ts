import { PROCESSING_TIMEOUTS } from '@config/constants';
import { httpClient } from '@config/http';
import logger from '@lib/logger';
import { redactUrl } from '@lib/redact-url';
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types';
import type { AxiosResponse } from 'axios';

export interface DownloadedFile {
  buffer: Buffer;
  contentLength?: number;
}

export class FileSizeLimitError extends Error {
  readonly code = 'FILE_LIMIT_EXCEEDED';

  constructor(
    readonly fileId: string,
    readonly limitBytes: number,
    readonly actualBytes?: number
  ) {
    super(
      actualBytes
        ? `Arquivo excede o limite configurado de ${limitBytes} bytes (${actualBytes} bytes recebidos).`
        : `Arquivo excede o limite configurado de ${limitBytes} bytes.`
    );
    this.name = 'FileSizeLimitError';
  }
}

export class FileDownloadService {
  async downloadFile(
    url: string,
    fileId: string,
    options: { maxBytes?: number } = {}
  ): Promise<Result<DownloadedFile, Error>> {
    const redactedUrl = redactUrl(url);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROCESSING_TIMEOUTS.DOWNLOAD);

    const { value: response, error } = await wrapPromiseResult<AxiosResponse, Error>(
      httpClient.get(url, {
        responseType: 'arraybuffer',
        validateStatus: (status) => status < 500,
        maxContentLength: options.maxBytes,
        maxBodyLength: options.maxBytes,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))
    );

    if (error) {
      if (options.maxBytes && error.message.includes('maxContentLength')) {
        return errResult(new FileSizeLimitError(fileId, options.maxBytes));
      }

      logger.error('Error fetching file', {
        fileId,
        url: redactedUrl,
        error: error.message,
        stack: error.stack,
      });
      return errResult(new Error(`Failed to fetch file: ${error.message}`));
    }

    if (response.status === 404) {
      logger.warn('File not found in bucket', {
        fileId,
        url: redactedUrl,
        status: response.status,
      });
      return errResult(
        new Error('Arquivo não encontrado no bucket. Verifique se o arquivo existe.')
      );
    }

    if (response.status >= 400) {
      logger.error('HTTP error fetching file', {
        fileId,
        url: redactedUrl,
        status: response.status,
        statusText: response.statusText,
      });
      return errResult(new Error(`Erro HTTP ${response.status}: ${response.statusText}`));
    }

    const buffer = response.data as Buffer;
    const contentLength = response.headers['content-length']
      ? parseInt(response.headers['content-length'], 10)
      : buffer.length;

    if (options.maxBytes && contentLength > options.maxBytes) {
      return errResult(new FileSizeLimitError(fileId, options.maxBytes, contentLength));
    }

    if (options.maxBytes && buffer.length > options.maxBytes) {
      return errResult(new FileSizeLimitError(fileId, options.maxBytes, buffer.length));
    }

    return okResult({
      buffer,
      contentLength,
    });
  }
}
