import { createHash } from 'node:crypto'
import { env, type envSchema } from '@config/env'
import pLimit from 'p-limit'
import type z from 'zod'
import { DeepSeekVisualTranscriptionProvider } from './deepseek-visual-transcription.provider'
import { GeminiVisualTranscriptionProvider } from './gemini-visual-transcription.provider'
import { PdfPageRendererService } from './pdf-page-renderer.service'
import type {
  PdfPageRenderer,
  RenderedPdfPage,
  VisualDocumentProfile,
  VisualFallbackConfig,
  VisualFallbackMetadata,
  VisualFallbackOcrPage,
  VisualFallbackProvider,
  VisualFallbackReason,
  VisualTranscriptionProvider,
} from './visual-fallback.types'
import { reconcileVisualText } from './visual-reconciliation.policy'

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
  documentProfile?: VisualDocumentProfile
}

type VisualFallbackResult = {
  byPage: Map<number, VisualFallbackMetadata>
  acceptedVisualTextByPage: ReadonlyMap<number, string>
  selectedPageCount: number
  enabled: boolean
}

type CreateMetadataOptions = {
  page: VisualFallbackOcrPage
  state: VisualFallbackMetadata['state']
  reasons: VisualFallbackReason[]
  provenance?: VisualFallbackMetadata['provenance']
  decisionReason?: string
  selectedTextSource?: VisualFallbackMetadata['selectedTextSource']
  shadowDecision?: VisualFallbackMetadata['shadowDecision']
  comparison?: VisualFallbackMetadata['comparison']
  policyVersion?: VisualFallbackMetadata['policyVersion']
}

type TranscriptionAttemptInput = {
  image: Buffer
  pageNumber: number
  signal?: AbortSignal
  documentProfile?: VisualDocumentProfile
}

type SelectedPage = {
  page: VisualFallbackOcrPage
  reasons: VisualFallbackReason[]
}

type ProcessSelectedPageInput = {
  selection: SelectedPage
  renderedPage?: RenderedPdfPage
  byPage: Map<number, VisualFallbackMetadata>
  acceptedVisualTextByPage: Map<number, string>
  signal?: AbortSignal
  documentProfile?: VisualDocumentProfile
}

type VisualFallbackEnvironment = Pick<
  z.infer<typeof envSchema>,
  | 'DEEPSEEK_API_KEY'
  | 'GEMINI_API_KEY'
  | 'MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB'
  | 'VISUAL_FALLBACK_CONCURRENCY'
  | 'VISUAL_FALLBACK_ENABLED'
  | 'VISUAL_FALLBACK_MAX_PAGES_PER_PDF'
  | 'VISUAL_FALLBACK_MAX_RETRIES'
  | 'VISUAL_FALLBACK_MODEL'
  | 'VISUAL_FALLBACK_PROVIDER'
  | 'VISUAL_FALLBACK_SHADOW_MODE'
  | 'VISUAL_FALLBACK_TIMEOUT_MS'
>

export function createVisualFallbackConfig(
  environment: VisualFallbackEnvironment
): VisualFallbackConfig {
  const provider = environment.VISUAL_FALLBACK_PROVIDER
  return {
    enabled:
      environment.VISUAL_FALLBACK_ENABLED &&
      Boolean(provider === 'gemini' ? environment.GEMINI_API_KEY : environment.DEEPSEEK_API_KEY),
    shadowMode: environment.VISUAL_FALLBACK_SHADOW_MODE,
    provider,
    model:
      environment.VISUAL_FALLBACK_MODEL ??
      (provider === 'deepseek' ? 'deepseek-v4-flash-vision-exp' : 'gemini-2.5-flash'),
    timeoutMs: environment.VISUAL_FALLBACK_TIMEOUT_MS,
    maxRetries: environment.VISUAL_FALLBACK_MAX_RETRIES,
    concurrency: environment.VISUAL_FALLBACK_CONCURRENCY,
    maxPagesPerPdf: environment.VISUAL_FALLBACK_MAX_PAGES_PER_PDF,
  }
}

function defaultProvider(provider: VisualFallbackProvider): VisualTranscriptionProvider {
  if (provider === 'deepseek') {
    return new DeepSeekVisualTranscriptionProvider(env.DEEPSEEK_API_KEY ?? '')
  }
  return new GeminiVisualTranscriptionProvider(env.GEMINI_API_KEY ?? '')
}

function inferDocumentProfile(fileName: string): VisualDocumentProfile | undefined {
  if (!/matr[ií]cula/iu.test(fileName)) return undefined
  return {
    kind: 'matricula',
    transcriptionHints: ['Preserve marcadores R. e AV. exatamente como visíveis.'],
  }
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
  decisionReason,
  selectedTextSource,
  shadowDecision,
  comparison,
  policyVersion,
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
    ...(policyVersion !== undefined ? { policyVersion } : {}),
    ...(decisionReason !== undefined ? { decisionReason } : {}),
    ...(selectedTextSource !== undefined ? { selectedTextSource } : {}),
    ...(shadowDecision !== undefined ? { shadowDecision } : {}),
    ...(comparison !== undefined ? { comparison } : {}),
  }
}

export class VisualFallbackService {
  constructor(
    private readonly renderer: PdfPageRenderer = new PdfPageRendererService(),
    provider?: VisualTranscriptionProvider,
    config: VisualFallbackConfig = createVisualFallbackConfig(env)
  ) {
    this.config = config
    this.provider = provider ?? defaultProvider(config.provider)
  }

  private readonly provider: VisualTranscriptionProvider
  private readonly config: VisualFallbackConfig

  async execute(input: VisualFallbackInput): Promise<VisualFallbackResult> {
    const byPage = createInitialMetadata(input.pages)
    const acceptedVisualTextByPage = new Map<number, string>()
    if (!this.config.enabled) {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: false }
    }
    if (input.signal?.aborted) {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: true }
    }

    const riskyPages = input.pages
      .map(page => ({ page, reasons: selectRiskReasons(page) }))
      .filter(({ reasons }) => reasons.length > 0)
    let selectedPages = riskyPages.slice(0, this.config.maxPagesPerPdf)

    if (input.pageBudget) {
      const eligibleBeforeBudget = selectedPages
      selectedPages = eligibleBeforeBudget.slice(0, input.pageBudget.remaining())
      if (selectedPages.length > 0 && !input.pageBudget.reserve(selectedPages.length)) {
        selectedPages = []
      }
      const selectedNumbers = new Set(selectedPages.map(({ page }) => page.pageNumber))
      for (const { page, reasons } of eligibleBeforeBudget) {
        if (!selectedNumbers.has(page.pageNumber)) {
          byPage.set(
            page.pageNumber,
            createMetadata({
              page,
              state: 'fallback_failed',
              reasons,
              decisionReason: 'budget_exhausted',
            })
          )
        }
      }
    }

    if (selectedPages.length === 0) {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: true }
    }

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
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: selectedPages.length,
        enabled: true,
      }
    }

    const selectionByPage = new Map(
      selectedPages.map(selection => [selection.page.pageNumber, selection])
    )
    const renderedByPage = new Map(
      renderedPages.map(renderedPage => [renderedPage.pageNumber, renderedPage])
    )
    const limit = pLimit(this.config.concurrency)
    await Promise.all(
      selectedPages.map(selection =>
        limit(() =>
          this.processSelectedPage({
            selection,
            renderedPage: renderedByPage.get(selection.page.pageNumber),
            byPage,
            acceptedVisualTextByPage,
            signal: input.signal,
            documentProfile: input.documentProfile ?? inferDocumentProfile(input.fileName),
          })
        )
      )
    )

    for (const { page, reasons } of selectedPages) {
      if (byPage.get(page.pageNumber)?.state === 'fallback_pending') {
        byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
      }
    }

    return {
      byPage,
      acceptedVisualTextByPage,
      selectedPageCount: selectionByPage.size,
      enabled: true,
    }
  }

  private async processSelectedPage({
    selection: { page, reasons },
    renderedPage,
    byPage,
    acceptedVisualTextByPage,
    signal,
    documentProfile,
  }: ProcessSelectedPageInput): Promise<void> {
    if (signal?.aborted) return
    if (!renderedPage) {
      byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
      return
    }

    const candidate = await this.transcribeWithRetries({
      image: renderedPage.image,
      pageNumber: page.pageNumber,
      signal,
      documentProfile,
    })
    if (signal?.aborted) return
    if (!candidate) {
      byPage.set(page.pageNumber, createMetadata({ page, state: 'fallback_failed', reasons }))
      return
    }

    const reconciliation = reconcileVisualText({
      ocrText: page.text,
      visualText: candidate,
      ocrConfidence: page.meanConfidence,
    })
    const selectedTextSource =
      !this.config.shadowMode && reconciliation.decision === 'promote_visual' ? 'visual' : 'ocr'
    if (selectedTextSource === 'visual') {
      acceptedVisualTextByPage.set(page.pageNumber, candidate)
    }
    const state = this.config.shadowMode
      ? 'ocr_plus_visual_candidate'
      : reconciliation.decision === 'conflict'
        ? 'conflict'
        : 'reconciled'
    byPage.set(
      page.pageNumber,
      createMetadata({
        page,
        state,
        reasons,
        provenance: {
          provider: this.config.provider,
          model: this.config.model,
          imageSha256: hash(renderedPage.image),
          candidateSha256: hash(candidate),
        },
        policyVersion: reconciliation.policyVersion,
        decisionReason: reconciliation.decisionReason,
        selectedTextSource,
        ...(this.config.shadowMode ? { shadowDecision: reconciliation.decision } : {}),
        comparison: reconciliation.comparison,
      })
    )
  }

  private async transcribeWithRetries({
    image,
    pageNumber,
    signal,
    documentProfile,
  }: TranscriptionAttemptInput): Promise<string | undefined> {
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
          ...(documentProfile !== undefined ? { documentProfile } : {}),
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
