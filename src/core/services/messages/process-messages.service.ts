// biome-ignore lint/style/noExcessiveLinesPerFile: file processors remain colocated because they share result and timeout handling.
import fs from 'node:fs'
import path, { join } from 'node:path'
import { PROCESSING_TIMEOUTS } from '@config/constants'
import { env } from '@config/env'
import { openaiClient, openaiConfig } from '@config/openai'
import logger from '@lib/logger'
import { errResult, okResult, type Result, wrapPromiseResult } from '@lib/result.types'
import type { ProcessMessage } from 'api/controllers/messages.controllers'
import { TEXTS_DIR } from 'config/dirs'
import mammoth from 'mammoth'
import type { Uploadable } from 'openai/uploads'
import pLimit from 'p-limit'
import { sanitize } from 'utils/sanitize'
import { sanitizeText } from 'utils/textSanitizer'
import WordExtractor from 'word-extractor'
import { FileDownloadService, FileSizeLimitError } from './pdf-utils/file-download.service'
import { ProcessPdfService } from './pdf-utils/process-pdf.service'
import type { VisualFallbackV2Metadata } from './pdf-utils/visual-fallback.types'
import type {
  EnhancedPdfMetadata,
  ProcessAndHandleFileOptions,
  ProcessFileOptions,
  ProcessMessagesOptions,
  ProcessWithTimeoutOptions,
  SaveProcessedTextOptions,
} from './process-messages.types'
import { processXLSXFile, xlsxToText } from './xlsx/xlsx-processor'

const MAX_INLINE_TRANSCRIPTION_BYTES = 1_000_000
const FILE_SEPARATOR = '\n\n---\n\n'

type SourceRange = { start: number; end: number }

type RebaseMetadataInput = {
  metadata: EnhancedPdfMetadata
  rawBody: string
  finalText: string
  fileUrl: string
  segmentSearchStart: number
  deterministicSegmentStart?: number
}

type RebaseMetadataResult = {
  metadata: EnhancedPdfMetadata
  nextSegmentSearchStart: number
}

type EnhancedOccurrence = {
  metadata: EnhancedPdfMetadata
  rawBody: string
  fileUrl: string
  segmentIndex?: number
}

type ProcessedFileOutcome = {
  success: boolean
  fileId: string
  error?: string
  extractedText?: string
  enhancedOccurrence?: EnhancedOccurrence
}

function rangeKey(range: SourceRange): string {
  return `${range.start}:${range.end}`
}

function createOrderedRangeMap(
  metadata: EnhancedPdfMetadata,
  rawBody: string,
  sanitizedBody: string
): ReadonlyMap<string, SourceRange> {
  const ranges: SourceRange[] = []
  for (const page of metadata.pageQuality ?? []) {
    if (page.visualFallback?.sourceRange) ranges.push(page.visualFallback.sourceRange)
    ranges.push(...(page.visualFallback?.riskySpans ?? []))
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end)

  const mappedRanges = new Map<string, SourceRange>()
  let searchStart = 0
  for (const range of ranges) {
    const key = rangeKey(range)
    if (mappedRanges.has(key)) continue
    const selectedText = sanitizeText(rawBody.slice(range.start, range.end))
    if (!selectedText) continue
    const start = sanitizedBody.indexOf(selectedText, searchStart)
    if (start < 0) continue
    mappedRanges.set(key, { start, end: start + selectedText.length })
    searchStart = start + selectedText.length
  }
  return mappedRanges
}

function isV2VisualMetadata(
  metadata: NonNullable<NonNullable<EnhancedPdfMetadata['pageQuality']>[number]['visualFallback']>
): metadata is Extract<typeof metadata, { policyVersion: 'gemini-whole-page-critical-v2' }> {
  return metadata.policyVersion === 'gemini-whole-page-critical-v2'
}

function mapSanitizedBoundary(rawBody: string, boundary: number): number | undefined {
  if (!Number.isInteger(boundary) || boundary < 0 || boundary > rawBody.length) return undefined
  if (
    boundary > 0 &&
    boundary < rawBody.length &&
    /[\uD800-\uDBFF]/u.test(rawBody[boundary - 1]) &&
    /[\uDC00-\uDFFF]/u.test(rawBody[boundary])
  ) {
    return undefined
  }
  return sanitizeText(`${rawBody.slice(0, boundary)}x`).length - 1
}

function mapV2Range(rawBody: string, range: SourceRange): SourceRange | undefined {
  if (range.end <= range.start) return undefined
  const start = mapSanitizedBoundary(rawBody, range.start)
  const end = mapSanitizedBoundary(rawBody, range.end)
  if (start === undefined || end === undefined || end <= start) return undefined
  return { start, end }
}

function rebaseV2VisualMetadata({
  visualFallback,
  rawBody,
  header,
  segmentStart,
}: {
  visualFallback: Extract<
    NonNullable<NonNullable<EnhancedPdfMetadata['pageQuality']>[number]['visualFallback']>,
    { policyVersion: 'gemini-whole-page-critical-v2' }
  >
  rawBody: string
  header: string
  segmentStart: number
}): VisualFallbackV2Metadata {
  const rawSegment = header + rawBody
  const mapBodyRange = (range: SourceRange) => {
    if (range.start < 0 || range.end > rawBody.length) return undefined
    return mapV2Range(rawSegment, {
      start: header.length + range.start,
      end: header.length + range.end,
    })
  }
  if (!visualFallback.sourceRange) throw new Error('V2 metadata is missing its source page range')
  const originalSourceRange = visualFallback.sourceRange
  const sourceRange = mapBodyRange(originalSourceRange)
  if (!sourceRange) throw new Error('V2 source page range collapsed during sanitization')
  const criticalUncertainties = visualFallback.criticalUncertainties ?? []
  if (
    criticalUncertainties.some(
      range => range.start < originalSourceRange.start || range.end > originalSourceRange.end
    )
  ) {
    throw new Error('V2 critical uncertainty left its source page')
  }
  const riskySpans = visualFallback.riskySpans ?? []
  if (
    riskySpans.some(
      range =>
        range.start < originalSourceRange.start ||
        range.end > originalSourceRange.end ||
        mapBodyRange(range) === undefined
    )
  ) {
    throw new Error('V2 risky span failed deterministic rebase')
  }
  const mappedUncertainties = criticalUncertainties.map(range => ({
    range,
    mapped: mapBodyRange(range),
  }))
  if (mappedUncertainties.some(({ mapped }) => mapped === undefined)) {
    throw new Error('V2 critical uncertainty collapsed during sanitization')
  }
  const rebasedSourceRange = {
    start: segmentStart + sourceRange.start,
    end: segmentStart + sourceRange.end,
  }
  const rebasedUncertainties = mappedUncertainties.map(({ range, mapped }) => ({
    start: segmentStart + (mapped?.start ?? 0),
    end: segmentStart + (mapped?.end ?? 0),
    scope: range.scope,
    categories: range.categories,
    divergences: range.divergences,
  }))
  if (
    rebasedUncertainties.some(
      range => range.start < rebasedSourceRange.start || range.end > rebasedSourceRange.end
    )
  ) {
    throw new Error('Rebased V2 critical uncertainty left its source page')
  }
  if (visualFallback.outcome === 'unavailable') {
    return {
      ...visualFallback,
      sourceRange: rebasedSourceRange,
      riskySpans: [rebasedSourceRange],
    }
  }
  if (visualFallback.outcome === 'rejected') {
    return {
      ...visualFallback,
      sourceRange: rebasedSourceRange,
      criticalUncertainties: rebasedUncertainties,
      riskySpans: [rebasedSourceRange],
    }
  }
  return {
    ...visualFallback,
    sourceRange: rebasedSourceRange,
    criticalUncertainties: rebasedUncertainties,
    riskySpans: rebasedUncertainties.map(({ start, end }) => ({ start, end })),
  }
}

function rebaseVisualMetadata({
  metadata,
  rawBody,
  finalText,
  fileUrl,
  segmentSearchStart,
  deterministicSegmentStart,
}: RebaseMetadataInput): RebaseMetadataResult {
  const fileName = path.basename(new URL(fileUrl).pathname)
  const header = `## Transcricao do arquivo: ${fileName}:\n\n`
  const sanitizedSegment = sanitizeText(header + rawBody)
  const hasV2Metadata = metadata.pageQuality?.some(page => {
    const visualFallback = page.visualFallback
    return visualFallback ? isV2VisualMetadata(visualFallback) : false
  })
  if (hasV2Metadata) {
    if (deterministicSegmentStart === undefined) {
      throw new Error('V2 deterministic segment offset is unavailable')
    }
    return {
      metadata: {
        ...metadata,
        pageQuality: metadata.pageQuality?.map(page => {
          const visualFallback = page.visualFallback
          if (!visualFallback || !isV2VisualMetadata(visualFallback)) return page
          return {
            ...page,
            visualFallback: rebaseV2VisualMetadata({
              visualFallback,
              rawBody,
              header,
              segmentStart: deterministicSegmentStart,
            }),
          }
        }),
      },
      nextSegmentSearchStart: deterministicSegmentStart + sanitizedSegment.length,
    }
  }
  const segmentStart = finalText.indexOf(sanitizedSegment, segmentSearchStart)
  const sanitizedBody = sanitizeText(rawBody)
  const bodyStartWithinSegment = sanitizedSegment.indexOf(
    sanitizedBody,
    sanitizeText(header).length
  )
  if (segmentStart < 0 || bodyStartWithinSegment < 0) {
    return { metadata, nextSegmentSearchStart: segmentSearchStart }
  }
  const bodyStart = segmentStart + bodyStartWithinSegment
  const orderedRangeMap = createOrderedRangeMap(metadata, rawBody, sanitizedBody)

  return {
    metadata: {
      ...metadata,
      pageQuality: metadata.pageQuality?.map(page => {
        const visualFallback = page.visualFallback
        if (!visualFallback) return page
        const sourceRange = visualFallback.sourceRange
          ? orderedRangeMap.get(rangeKey(visualFallback.sourceRange))
          : undefined
        const riskySpans = visualFallback.riskySpans
          ?.map(range => orderedRangeMap.get(rangeKey(range)))
          .filter((range): range is SourceRange => range !== undefined)
        const rebasedVisualFallback = { ...visualFallback }
        delete rebasedVisualFallback.sourceRange
        delete rebasedVisualFallback.riskySpans
        return {
          ...page,
          visualFallback: {
            ...rebasedVisualFallback,
            ...(sourceRange
              ? {
                  sourceRange: {
                    start: bodyStart + sourceRange.start,
                    end: bodyStart + sourceRange.end,
                  },
                }
              : {}),
            ...(riskySpans
              ? {
                  riskySpans: riskySpans.map(range => ({
                    start: bodyStart + range.start,
                    end: bodyStart + range.end,
                  })),
                }
              : {}),
          },
        }
      }),
    },
    nextSegmentSearchStart: segmentStart + sanitizedSegment.length,
  }
}

export interface FileInput {
  fileId: string
  url: string
  mimeType: string
  fileName?: string
}

export class OcrPageBudget {
  private usedPages = 0

  constructor(private readonly maxPages: number) {}

  reserve(pageCount: number): boolean {
    if (this.usedPages + pageCount > this.maxPages) {
      return false
    }

    this.usedPages += pageCount
    return true
  }

  remaining(): number {
    return Math.max(0, this.maxPages - this.usedPages)
  }
}

export type ProcessMessagesResponse = {
  conversationId: string
  processedFiles: string[]
  failedFiles: { fileId: string; error: string }[]
  filename: string
  downloadUrl: string
  transcriptionText?: string
  enhancedResult?: {
    summary?: string
    files: EnhancedPdfMetadata[]
  }
}

export class ProcessMessagesService {
  constructor(
    private readonly processPdfService: Pick<
      ProcessPdfService,
      'execute' | 'executeEnhanced'
    > = new ProcessPdfService(),
    private readonly wordExtractor = new WordExtractor(),
    private readonly fileDownloadService: Pick<
      FileDownloadService,
      'downloadFile'
    > = new FileDownloadService()
  ) {}

  async execute(
    {
      messages,
      host,
      protocol,
    }: {
      messages: ProcessMessage
      protocol: string
      host: string
    },
    options: ProcessMessagesOptions = {}
  ): Promise<ProcessMessagesResponse> {
    const processedFiles: string[] = []
    const failedFiles: { fileId: string; error: string }[] = []
    const extractedTexts: string[] = []
    const enhancedOccurrences: EnhancedOccurrence[] = []
    const requestedFiles = messages.flatMap(message => message.body.files ?? [])
    const requestExceedsFileLimit =
      options.limits?.maxFiles !== undefined && requestedFiles.length > options.limits.maxFiles
    const ocrPageBudget = options.limits?.maxTotalOcrPagesPerJob
      ? new OcrPageBudget(options.limits.maxTotalOcrPagesPerJob)
      : undefined
    const visualFallbackPageBudget = options.limits?.maxTotalVisualFallbackPagesPerJob
      ? new OcrPageBudget(options.limits.maxTotalVisualFallbackPagesPerJob)
      : undefined

    for (const message of messages) {
      const { body } = message
      const { files } = body

      if (files && files.length > 0) {
        if (requestExceedsFileLimit) {
          const errorMessage = `A requisição contém ${requestedFiles.length} arquivos, acima do limite configurado de ${options.limits?.maxFiles}.`
          failedFiles.push(...files.map(file => ({ fileId: file.fileId, error: errorMessage })))

          if (options.includeReadableErrorBlocks) {
            extractedTexts.push(
              this.createReadableErrorBlock('request-files-limit', new Error(errorMessage))
            )
          }

          continue
        }

        const limit = pLimit(env.PROCESSING_CONCURRENCY)
        const promises = files.map(file =>
          limit(() =>
            this.processAndHandleFile({
              file,
              options,
              ocrPageBudget,
              visualFallbackPageBudget,
            })
          )
        )
        const results = await Promise.all(promises)

        results.forEach(result => {
          const segmentIndex = extractedTexts.length
          if (result.extractedText !== undefined) extractedTexts.push(result.extractedText)
          if (result.enhancedOccurrence) {
            enhancedOccurrences.push({ ...result.enhancedOccurrence, segmentIndex })
          }
          if (result.success) {
            processedFiles.push(result.fileId)
          } else {
            failedFiles.push({ fileId: result.fileId, error: result.error || 'Unknown error' })
          }
        })
      }
    }

    const sanitizedText = sanitizeText(extractedTexts.join(FILE_SEPARATOR).trim())
    let rebasedMetadata: EnhancedPdfMetadata[] | undefined
    if (options.enhancedOcr) {
      rebasedMetadata = []
      let segmentSearchStart = 0
      const sanitizedSeparator = sanitizeText(`a${FILE_SEPARATOR}b`).slice(1, -1)
      const deterministicSegmentStarts: number[] = []
      let deterministicOffset = 0
      for (const extractedText of extractedTexts) {
        deterministicSegmentStarts.push(deterministicOffset)
        deterministicOffset += sanitizeText(extractedText).length + sanitizedSeparator.length
      }
      for (const occurrence of enhancedOccurrences) {
        const rebased = rebaseVisualMetadata({
          ...occurrence,
          finalText: sanitizedText,
          segmentSearchStart,
          ...(occurrence.segmentIndex !== undefined
            ? { deterministicSegmentStart: deterministicSegmentStarts[occurrence.segmentIndex] }
            : {}),
        })
        rebasedMetadata.push(rebased.metadata)
        segmentSearchStart = rebased.nextSegmentSearchStart
      }
    }

    const response = await this.saveProcessedText({
      sanitizedText,
      conversationId: messages[0].conversationId,
      protocol,
      host,
      processedFiles,
      failedFiles,
    })
    if (rebasedMetadata) {
      return { ...response, enhancedResult: { files: rebasedMetadata } }
    }

    return response
  }

  private async processAndHandleFile({
    file,
    options,
    ocrPageBudget,
    visualFallbackPageBudget,
  }: Omit<ProcessAndHandleFileOptions, 'extractedTexts'> & {
    visualFallbackPageBudget?: OcrPageBudget
  }): Promise<ProcessedFileOutcome> {
    const enhancedPdfMetadata: EnhancedPdfMetadata[] = []
    const result = await this.processFile({
      file,
      options,
      ocrPageBudget,
      enhancedPdfMetadata,
      visualFallbackPageBudget,
    })

    if (result.error) {
      logger.error('Failed to process file', {
        fileId: file.fileId,
        error: result.error.message,
      })

      if (options.includeReadableErrorBlocks) {
        return {
          success: false,
          fileId: file.fileId,
          error: result.error.message,
          extractedText: this.createReadableErrorBlock(
            path.basename(new URL(file.url).pathname),
            result.error
          ),
        }
      }

      return { success: false, fileId: file.fileId, error: result.error.message }
    }

    const fileName = path.basename(new URL(file.url).pathname)
    const header = `## Transcricao do arquivo: ${fileName}:\n\n`

    return {
      success: true,
      fileId: file.fileId,
      extractedText: header + result.value,
      ...(options.enhancedOcr && enhancedPdfMetadata[0]
        ? {
            enhancedOccurrence: {
              metadata: enhancedPdfMetadata[0],
              rawBody: result.value,
              fileUrl: file.url,
            },
          }
        : {}),
    }
  }

  private async processFile({
    file,
    options = {},
    ocrPageBudget,
    visualFallbackPageBudget,
    enhancedPdfMetadata,
  }: ProcessFileOptions): Promise<Result<string, Error>> {
    const fileType = file.mimeType.split('/')[1]

    if (file.mimeType.startsWith('audio/')) {
      return this.processAudio(file, options.limits?.maxFileBytes)
    }

    const fileTypeMap: Record<string, () => Promise<Result<string, Error>>> = {
      plain: () => this.processTxt(file, options.limits?.maxFileBytes),
      pdf: () =>
        this.processWithTimeout({
          processor: async signal => {
            const pdfOptions = {
              signal,
              maxFileBytes: options.limits?.maxFileBytes,
              maxPdfPages: options.limits?.maxPdfPages,
              maxOcrPagesPerPdf: options.limits?.maxOcrPagesPerPdf,
              ocrPageBudget,
              visualFallbackPageBudget,
              onEnhancedMetadata: (metadata: EnhancedPdfMetadata) => {
                enhancedPdfMetadata?.push(metadata)
              },
            }
            const result = options.enhancedOcr
              ? await this.processPdfService.executeEnhanced(file, pdfOptions)
              : await this.processPdfService.execute(file, { ...pdfOptions, mode: options.pdfMode })

            if (result.error) {
              throw result.error
            }

            return result.value
          },
          timeout: PROCESSING_TIMEOUTS.PDF_GLOBAL,
          fileId: file.fileId,
          fileType: 'pdf',
          signal: options.signal,
        }),
      jpeg: () => this.processImage(file, options.limits?.maxFileBytes),
      jpg: () => this.processImage(file, options.limits?.maxFileBytes),
      png: () => this.processImage(file, options.limits?.maxFileBytes),
      'vnd.openxmlformats-officedocument.wordprocessingml.document': () =>
        this.processDocx(file, options.limits?.maxFileBytes),
      msword: () => this.processDoc(file, options.limits?.maxFileBytes), // .doc files are not supported
      'vnd.openxmlformats-officedocument.spreadsheetml.sheet': () =>
        this.processXlsx(file, options.limits?.maxFileBytes),
      'vnd.ms-excel': () => this.processXlsx(file, options.limits?.maxFileBytes), // Added support for .xls files
    }

    const processor = fileTypeMap[fileType]

    if (!processor) {
      logger.warn('Unsupported file type, skipping', {
        fileType,
        fileId: file.fileId,
      })
      return errResult(new Error(`Unsupported file type: ${fileType}`))
    }

    return processor()
  }

  private async processWithTimeout<T>({
    processor,
    timeout,
    fileId,
    fileType,
    signal,
  }: ProcessWithTimeoutOptions<T>): Promise<Result<T, Error>> {
    const timeoutError = `${fileType.toUpperCase()} processing timed out after ${timeout / 1000} seconds`
    const userErrorMessage = `O processamento deste arquivo ${fileType.toUpperCase()} excedeu o tempo limite de ${
      timeout / 1000
    } segundos.`
    let timer: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    let removeAbortListener: (() => void) | undefined

    if (signal?.aborted) {
      return errResult(
        signal.reason instanceof Error
          ? signal.reason
          : new Error(`${fileType.toUpperCase()} processing aborted`)
      )
    }

    const abortPromise = signal
      ? new Promise<T>((_, reject) => {
          const abort = () => {
            const error =
              signal.reason instanceof Error
                ? signal.reason
                : new Error(`${fileType.toUpperCase()} processing aborted`)
            controller.abort(error)
            reject(error)
          }
          signal.addEventListener('abort', abort, { once: true })
          removeAbortListener = () => signal.removeEventListener('abort', abort)
        })
      : undefined

    const { value, error } = await wrapPromiseResult<T, Error>(
      Promise.race([
        processor(controller.signal),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(timeoutError)
            controller.abort(error)
            reject(error)
          }, timeout)
        }),
        ...(abortPromise ? [abortPromise] : []),
      ]).finally(() => {
        if (timer) {
          clearTimeout(timer)
        }
        removeAbortListener?.()
      })
    )

    if (error) {
      logger.error(`Error processing ${fileType} file`, {
        fileId,
        error: error.message,
        stack: error.stack,
      })

      if (error.message.includes('timed out')) {
        return errResult(new Error(userErrorMessage))
      }

      return errResult(error)
    }

    return okResult(value)
  }

  private async saveProcessedText({
    sanitizedText,
    conversationId,
    protocol,
    host,
    processedFiles,
    failedFiles,
  }: SaveProcessedTextOptions): Promise<ProcessMessagesResponse> {
    const filename = `${conversationId}-${Date.now()}.txt`

    const { error: mkdirError } = await wrapPromiseResult(
      fs.promises.mkdir(join(TEXTS_DIR, conversationId), { recursive: true })
    )

    if (mkdirError) {
      logger.error('Failed to create texts directory', { error: mkdirError, conversationId })
      throw new Error('Failed to create texts directory')
    }

    const filePath = path.join(TEXTS_DIR, conversationId, filename)
    await fs.promises.writeFile(filePath, sanitizedText)

    const downloadUrl = `${protocol}://${host}/texts/${conversationId}/${filename}`

    const inlineTranscriptionText =
      Buffer.byteLength(sanitizedText, 'utf8') <= MAX_INLINE_TRANSCRIPTION_BYTES
        ? sanitizedText
        : undefined

    return {
      conversationId,
      processedFiles,
      failedFiles,
      filename,
      downloadUrl,
      ...(inlineTranscriptionText !== undefined
        ? { transcriptionText: inlineTranscriptionText }
        : {}),
    }
  }

  private createReadableErrorBlock(fileName: string, error: Error): string {
    const code = error instanceof FileSizeLimitError ? error.code : 'FILE_PROCESSING_ERROR'

    return `## Transcricao do arquivo: ${fileName}:\n\n[${code}]\nEste arquivo não foi processado integralmente.\nMotivo: ${error.message}\nOriente o usuário a reduzir, dividir ou reenviar uma versão compatível do arquivo, se necessário.`
  }

  private async processTxt(file: FileInput, maxFileBytes?: number): Promise<Result<string, Error>> {
    const { fileId } = file

    return this.processWithTimeout({
      processor: async () => {
        const textContent = (await this.downloadSourceFile(file, maxFileBytes)).toString('utf-8')
        return sanitize(textContent)
      },
      timeout: PROCESSING_TIMEOUTS.TXT,
      fileId,
      fileType: 'txt',
    })
  }

  private async processImage(
    file: FileInput,
    maxFileBytes?: number
  ): Promise<Result<string, Error>> {
    const { fileId } = file

    return this.processWithTimeout({
      processor: async () => {
        const imageBuffer = await this.downloadSourceFile(file, maxFileBytes)
        const base64Image = imageBuffer.toString('base64')

        const aiResponse = await openaiClient.chat.completions.create(
          {
            model: openaiConfig.models.vision,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Describe this image in detail. Return in PT_BR.' },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${file.mimeType};base64,${base64Image}`,
                    },
                  },
                ],
              },
            ],
          },
          { timeout: PROCESSING_TIMEOUTS.OPENAI }
        )

        const description = aiResponse.choices[0].message.content || 'No description generated.'
        return sanitize(description)
      },
      timeout: PROCESSING_TIMEOUTS.IMAGE,
      fileId,
      fileType: 'image',
    })
  }

  private async processDocx(
    file: FileInput,
    maxFileBytes?: number
  ): Promise<Result<string, Error>> {
    const { fileId } = file
    return this.processWithTimeout({
      processor: async () => {
        const buffer = await this.downloadSourceFile(file, maxFileBytes)
        const result = await mammoth.extractRawText({ buffer })
        return sanitize(result.value)
      },
      timeout: PROCESSING_TIMEOUTS.DOCX,
      fileId,
      fileType: 'docx',
    })
  }

  private async processDoc(file: FileInput, maxFileBytes?: number): Promise<Result<string, Error>> {
    const { fileId } = file

    return this.processWithTimeout({
      processor: async () => {
        const buffer = await this.downloadSourceFile(file, maxFileBytes)
        const doc = await this.wordExtractor.extract(buffer)
        return sanitize(doc.getBody())
      },
      timeout: PROCESSING_TIMEOUTS.DOCX, // Reusing DOCX timeout for now
      fileId,
      fileType: 'doc',
    })
  }

  private async processXlsx(
    file: FileInput,
    maxFileBytes?: number
  ): Promise<Result<string, Error>> {
    const { fileId } = file

    return this.processWithTimeout({
      processor: async () => {
        const buffer = await this.downloadSourceFile(file, maxFileBytes)
        const xlsxResult = processXLSXFile(
          buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          ) as ArrayBuffer
        )
        return xlsxToText(xlsxResult)
      },
      timeout: PROCESSING_TIMEOUTS.XLSX,
      fileId,
      fileType: 'xlsx',
    })
  }

  private async processAudio(
    file: FileInput,
    maxFileBytes?: number
  ): Promise<Result<string, Error>> {
    const { fileId } = file

    return this.processWithTimeout({
      processor: async () => {
        const buffer = await this.downloadSourceFile(file, maxFileBytes)

        const arrayBuffer = buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer

        const fileName = path.basename(new URL(file.url).pathname) || 'audio'
        const audioFile = new File([arrayBuffer], fileName, {
          type: file.mimeType,
        }) as Uploadable

        const transcription = await openaiClient.audio.transcriptions.create(
          {
            file: audioFile,
            model: openaiConfig.models.audio,
            language: 'pt',
            response_format: 'json',
          },
          { timeout: PROCESSING_TIMEOUTS.OPENAI }
        )

        return sanitize(transcription.text || '')
      },
      timeout: PROCESSING_TIMEOUTS.AUDIO,
      fileId,
      fileType: 'audio',
    })
  }

  private async downloadSourceFile(file: FileInput, maxFileBytes?: number): Promise<Buffer> {
    const { value, error } = await this.fileDownloadService.downloadFile(file.url, file.fileId, {
      maxBytes: maxFileBytes,
    })
    if (error) throw error
    return value.buffer
  }
}
