import { createHash } from 'node:crypto'
import { env } from '@config/env'
import pLimit from 'p-limit'
import { GeminiVisualTranscriptionProvider } from './gemini-visual-transcription.provider'
import { PdfPageRendererService } from './pdf-page-renderer.service'
import type {
  PdfPageRenderer,
  VisualFallbackConfig,
  VisualFallbackMetadata,
  VisualFallbackOcrPage,
  VisualFallbackReason,
  VisualTranscriptionProvider,
} from './visual-fallback.types'

export type { VisualTranscriptionProvider } from './visual-fallback.types'

type VisualFallbackInput = {
  buffer: Buffer
  fileName: string
  pages: VisualFallbackOcrPage[]
  signal?: AbortSignal
  pageBudget?: {
    reserve(pageCount: number): boolean
    remaining(): number
  }
}

type VisualFallbackResult = {
  byPage: Map<number, VisualFallbackMetadata>
  selectedPageCount: number
  enabled: boolean
}

type CreateMetadataOptions = {
  page: VisualFallbackOcrPage
  state: VisualFallbackMetadata['state']
  reasons: VisualFallbackReason[]
  provenance?: VisualFallbackMetadata['provenance']
}

function defaultConfig(): VisualFallbackConfig {
  return {
    enabled: env.VISUAL_FALLBACK_ENABLED && Boolean(env.GEMINI_API_KEY),
    shadowMode: env.VISUAL_FALLBACK_SHADOW_MODE,
    model: env.VISUAL_FALLBACK_MODEL,
    timeoutMs: env.VISUAL_FALLBACK_TIMEOUT_MS,
    maxRetries: env.VISUAL_FALLBACK_MAX_RETRIES,
    concurrency: env.VISUAL_FALLBACK_CONCURRENCY,
    maxPagesPerPdf: env.VISUAL_FALLBACK_MAX_PAGES_PER_PDF,
  }
}

function isMatriculaPdf(fileName: string): boolean {
  return /matr[ií]cula/iu.test(fileName)
}

function selectRiskReasons(page: VisualFallbackOcrPage): VisualFallbackReason[] {
  const signals = page.legalSignals
  if (!signals) return []

  const reasons: VisualFallbackReason[] = []
  if (signals.corruptedSymbols > 0) reasons.push('corrupted-symbols')
  if (signals.fragmentedNumbersOrMeasures > 0) reasons.push('fragmented-number-or-measure')
  if (signals.garbledSpans > 0) reasons.push('garbled-spans')

  const hasAreaReference = /(?:área|area|superf[ií]cie)/iu.test(page.text)
  if (hasAreaReference && signals.squareMeters === 0) reasons.push('missing-measure')

  const hasFragmentedMeasure = reasons.includes('fragmented-number-or-measure')
  if (hasFragmentedMeasure && signals.registryMarkers > 0 && signals.legalMarkers === 0) {
    reasons.push('missing-legal-marker')
  }

  return reasons
}

function hash(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeForComparison(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function createInitialMetadata(
  pages: VisualFallbackOcrPage[]
): Map<number, VisualFallbackMetadata> {
  return new Map(
    pages.map(page => [page.pageNumber, createMetadata({ page, state: 'ocr_only', reasons: [] })])
  )
}

function createMetadata({
  page,
  state,
  reasons,
  provenance,
}: CreateMetadataOptions): VisualFallbackMetadata {
  const unresolved =
    state === 'fallback_pending' || state === 'fallback_failed' || state === 'conflict'

  return {
    state,
    reasons,
    offsetEncoding: 'utf16_code_units',
    ...(page.sourceRange !== undefined ? { sourceRange: page.sourceRange } : {}),
    ...(unresolved && page.sourceRange !== undefined ? { riskySpans: [page.sourceRange] } : {}),
    ...(provenance !== undefined ? { provenance } : {}),
  }
}

export class VisualFallbackService {
  constructor(
    private readonly renderer: PdfPageRenderer = new PdfPageRendererService(),
    private readonly provider: VisualTranscriptionProvider = new GeminiVisualTranscriptionProvider(
      env.GEMINI_API_KEY ?? ''
    ),
    private readonly config: VisualFallbackConfig = defaultConfig()
  ) {}

  async execute(input: VisualFallbackInput): Promise<VisualFallbackResult> {
    const byPage = createInitialMetadata(input.pages)
    if (!this.config.enabled || !isMatriculaPdf(input.fileName)) {
      return { byPage, selectedPageCount: 0, enabled: this.config.enabled }
    }
    if (input.signal?.aborted) return { byPage, selectedPageCount: 0, enabled: true }

    let selectedPages = input.pages
      .map(page => ({ page, reasons: selectRiskReasons(page) }))
      .filter(({ reasons }) => reasons.length > 0)
      .slice(0, this.config.maxPagesPerPdf)

    if (input.pageBudget) {
      selectedPages = selectedPages.slice(0, input.pageBudget.remaining())
      if (selectedPages.length > 0 && !input.pageBudget.reserve(selectedPages.length)) {
        selectedPages = []
      }
    }

    if (selectedPages.length === 0) return { byPage, selectedPageCount: 0, enabled: true }

    for (const { page, reasons } of selectedPages) {
      byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_pending', reasons }))
    }

    let renderedPages: Awaited<ReturnType<PdfPageRenderer['renderPages']>>
    try {
      renderedPages = await this.renderer.renderPages(
        input.buffer,
        selectedPages.map(({ page }) => page.pageNumber),
        input.signal
      )
    } catch {
      for (const { page, reasons } of selectedPages) {
        byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
      }
      return { byPage, selectedPageCount: selectedPages.length, enabled: true }
    }

    const selectionByPage = new Map(
      selectedPages.map(selection => [selection.page.pageNumber, selection])
    )
    const renderedByPage = new Map(
      renderedPages.map(renderedPage => [renderedPage.pageNumber, renderedPage])
    )
    const limit = pLimit(this.config.concurrency)
    await Promise.all(
      selectedPages.map(({ page, reasons }) =>
        limit(async () => {
          if (input.signal?.aborted) return
          const renderedPage = renderedByPage.get(page.pageNumber)
          if (!renderedPage) {
            byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
            return
          }

          const candidate = await this.transcribeWithRetries(
            renderedPage.image,
            page.pageNumber,
            input.signal
          )
          if (input.signal?.aborted) return
          if (!candidate) {
            byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
            return
          }

          const provenance = {
            provider: 'gemini' as const,
            model: this.config.model,
            imageSha256: hash(renderedPage.image),
            candidateSha256: hash(candidate),
          }
          const state = this.config.shadowMode
            ? 'ocr_plus_visual_candidate'
            : normalizeForComparison(page.text) === normalizeForComparison(candidate)
              ? 'reconciled'
              : 'conflict'
          byPage.set(page.pageNumber, createMetadata({ page, state, reasons, provenance }))
        })
      )
    )

    for (const { page, reasons } of selectedPages) {
      if (byPage.get(page.pageNumber)?.state === 'fallback_pending') {
        byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
      }
    }

    return { byPage, selectedPageCount: selectionByPage.size, enabled: true }
  }

  private async transcribeWithRetries(
    image: Buffer,
    pageNumber: number,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (signal?.aborted) return undefined
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs)
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        const response = await this.provider.transcribe({
          image,
          pageNumber,
          model: this.config.model,
          signal: controller.signal,
        })
        if (signal?.aborted) return undefined
        if (response.status === 'abstain') return undefined
        return response.transcription
      } catch {
        if (signal?.aborted) return undefined
        if (attempt === this.config.maxRetries) return undefined
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', abort)
      }
    }

    return undefined
  }
}
