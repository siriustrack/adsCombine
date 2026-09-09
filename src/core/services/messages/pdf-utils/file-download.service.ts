import { isIP } from 'node:net'
import { PROCESSING_TIMEOUTS } from '@config/constants'
import { env } from '@config/env'
import { httpClient } from '@config/http'
import logger from '@lib/logger'
import { redactUrl } from '@lib/redact-url'
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types'
import type { AxiosRequestConfig } from 'axios'
import { SourceUrlPolicy } from './source-url-policy'

const MAX_REDIRECTS = 3

type DownloadHttpClient = {
  get(url: string, config: AxiosRequestConfig): Promise<DownloadResponse>
}

type DownloadResponse = {
  data: unknown
  headers: {
    'content-length'?: string
    location?: string
  }
  status: number
  statusText: string
}

const downloadHttpClient: DownloadHttpClient = {
  async get(url, config) {
    const response = await httpClient.get(url, config)
    return {
      data: response.data,
      headers: {
        'content-length': getResponseHeader(response.headers['content-length']),
        location: getResponseHeader(response.headers.location),
      },
      status: response.status,
      statusText: response.statusText,
    }
  },
}

export interface DownloadedFile {
  buffer: Buffer
  contentLength?: number
}

export class FileSizeLimitError extends Error {
  readonly code = 'FILE_LIMIT_EXCEEDED'

  constructor(
    readonly fileId: string,
    readonly limitBytes: number,
    readonly actualBytes?: number
  ) {
    super(
      actualBytes
        ? `Arquivo excede o limite configurado de ${limitBytes} bytes (${actualBytes} bytes recebidos).`
        : `Arquivo excede o limite configurado de ${limitBytes} bytes.`
    )
    this.name = 'FileSizeLimitError'
  }
}

export class FileDownloadService {
  constructor(
    private readonly sourceUrlPolicy = new SourceUrlPolicy({
      allowedPrefixes: getAllowedSourceUrlPrefixes(),
    }),
    private readonly client: DownloadHttpClient = downloadHttpClient
  ) {}

  async downloadFile(
    url: string,
    fileId: string,
    options: { maxBytes?: number } = {}
  ): Promise<Result<DownloadedFile, Error>> {
    const redactedUrl = redactUrl(url)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROCESSING_TIMEOUTS.DOWNLOAD)

    const { value: response, error } = await wrapPromiseResult<DownloadResponse, Error>(
      this.downloadWithValidatedRedirects(url, options.maxBytes, controller.signal).finally(() =>
        clearTimeout(timeoutId)
      )
    )

    if (error) {
      if (options.maxBytes && error.message.includes('maxContentLength')) {
        return errResult(new FileSizeLimitError(fileId, options.maxBytes))
      }

      logger.error('Error fetching file', {
        fileId,
        url: redactedUrl,
        error: error.message,
        stack: error.stack,
      })
      return errResult(new Error(`Failed to fetch file: ${error.message}`))
    }

    if (response.status === 404) {
      logger.warn('File not found in bucket', {
        fileId,
        url: redactedUrl,
        status: response.status,
      })
      return errResult(
        new Error('Arquivo não encontrado no bucket. Verifique se o arquivo existe.')
      )
    }

    if (response.status >= 400) {
      logger.error('HTTP error fetching file', {
        fileId,
        url: redactedUrl,
        status: response.status,
        statusText: response.statusText,
      })
      return errResult(new Error(`Erro HTTP ${response.status}: ${response.statusText}`))
    }

    const buffer = response.data as Buffer
    const contentLength = response.headers['content-length']
      ? parseInt(response.headers['content-length'], 10)
      : buffer.length

    if (options.maxBytes && contentLength > options.maxBytes) {
      return errResult(new FileSizeLimitError(fileId, options.maxBytes, contentLength))
    }

    if (options.maxBytes && buffer.length > options.maxBytes) {
      return errResult(new FileSizeLimitError(fileId, options.maxBytes, buffer.length))
    }

    return okResult({
      buffer,
      contentLength,
    })
  }

  private async downloadWithValidatedRedirects(
    initialUrl: string,
    maxBytes: number | undefined,
    signal: AbortSignal
  ): Promise<DownloadResponse> {
    let target = await this.sourceUrlPolicy.resolveSafeUrl(initialUrl)

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await this.client.get(target.url.href, {
        responseType: 'arraybuffer',
        validateStatus: status => status < 500,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        maxRedirects: 0,
        lookup: createPinnedLookup(target.addresses),
        proxy: false,
        signal,
      })

      if (!isRedirect(response.status)) return response
      if (redirectCount === MAX_REDIRECTS) throw new Error('Too many redirects while fetching file')

      const location = response.headers.location
      if (typeof location !== 'string')
        throw new Error('Redirect response did not include a location')
      target = await this.sourceUrlPolicy.resolveSafeUrl(new URL(location, target.url).href)
    }

    throw new Error('Too many redirects while fetching file')
  }
}

function getAllowedSourceUrlPrefixes(): string[] {
  const explicitPrefixes = env.FILE_DOWNLOAD_ALLOWED_URL_PREFIXES?.split(',')
    .map(prefix => prefix.trim())
    .filter(Boolean)

  const storageOrigins = [env.SUPABASE_URL, env.SUPABASE_STORAGE_URL, env.STORAGE_URL]
    .filter((url): url is string => Boolean(url))
    .map(url => new URL('/storage/v1/object/', url).href)

  return [...(explicitPrefixes ?? []), ...storageOrigins]
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function createPinnedLookup(addresses: string[]): NonNullable<AxiosRequestConfig['lookup']> {
  return (_hostname, _options, callback) => {
    const address = addresses[0]
    const family = isIP(address) === 6 ? 6 : 4
    callback(null, address, family)
  }
}

function getResponseHeader(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
