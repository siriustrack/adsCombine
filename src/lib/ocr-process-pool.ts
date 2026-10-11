import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OcrPageResult } from '../core/services/messages/pdf-utils/ocr-orchestrator.service'
import logger from './logger'
import { processingContext } from './processing-context'

type Payload = {
  readonly pdfPath: string
  readonly fileId: string
  readonly totalPages: number
  readonly pageRange: { readonly first: number; readonly last: number }
  readonly structuredPages?: boolean
  readonly enhancedOcr?: boolean
}
type WorkerResult = string | { pages: OcrPageResult[] }
type Reply = { result: WorkerResult } | { error: string }
type Options = { readonly signal?: AbortSignal }

/** Linux process groups keep Poppler, ImageMagick and Tesseract inside the task lifetime. */
export class OcrProcessPool {
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(
    private readonly filename: string,
    private readonly concurrency: number
  ) {}

  run(
    payload: Payload & { structuredPages: true },
    options?: Options
  ): Promise<{ pages: OcrPageResult[] }>
  run(payload: Payload, options?: Options): Promise<string>
  run(payload: Payload, { signal }: Options = {}): Promise<WorkerResult> {
    if (signal?.aborted) return Promise.reject(signal.reason)
    if (this.queue.length >= 1000) return Promise.reject(new Error('OCR queue is full'))
    const queuedAt = performance.now()
    const jobId = processingContext.getStore()?.jobId
    return new Promise((resolve, reject) => {
      const cancelQueued = () => {
        const index = this.queue.indexOf(start)
        if (index < 0) return
        this.queue.splice(index, 1)
        reject(signal?.reason ?? new DOMException('OCR cancelled', 'AbortError'))
      }
      const start = () => {
        signal?.removeEventListener('abort', cancelQueued)
        const startedAt = performance.now()
        const context = {
          ...(jobId ? { jobId } : {}),
          fileId: payload.fileId,
          firstPage: payload.pageRange.first,
          lastPage: payload.pageRange.last,
        }
        logger.debug('OCR chunk execution started', {
          ...context,
          queueWaitMs: Math.max(0, startedAt - queuedAt),
        })
        void this.execute(payload, signal)
          .then(resolve, reject)
          .finally(() => {
            logger.debug('OCR chunk execution finished', {
              ...context,
              executionMs: Math.max(0, performance.now() - startedAt),
              aborted: signal?.aborted ?? false,
            })
            this.active--
            this.drain()
          })
      }
      signal?.addEventListener('abort', cancelQueued, { once: true })
      this.queue.push(start)
      this.drain()
    })
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const start = this.queue.shift()
      if (!start) return
      this.active++
      start()
    }
  }

  private async execute(payload: Payload, signal?: AbortSignal): Promise<WorkerResult> {
    signal?.throwIfAborted()
    const directory = await mkdtemp(path.join(tmpdir(), 'ads-ocr-process-'))
    try {
      signal?.throwIfAborted()
      return await new Promise<WorkerResult>((resolve, reject) => {
        let result: WorkerResult | undefined
        let failure: Error | undefined
        const child = fork(this.filename, [], {
          detached: true,
          env: { ...process.env, TMPDIR: directory },
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          serialization: 'json',
        })
        const abort = () => {
          failure =
            signal?.reason instanceof Error
              ? signal.reason
              : new DOMException('OCR cancelled', 'AbortError')
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch (error) {
              if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
                throw error
              }
            }
          }
        }
        child.once('message', (reply: Reply) => {
          if ('error' in reply) failure = new Error(reply.error)
          else result = reply.result
        })
        child.once('error', error => {
          failure = error
        })
        child.once('close', code => {
          signal?.removeEventListener('abort', abort)
          if (failure) reject(failure)
          else if (code !== 0 || result === undefined)
            reject(new Error('OCR process exited without a result'))
          else resolve(result)
        })
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        else
          child.send(payload, error => {
            if (error) failure = error
          })
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
