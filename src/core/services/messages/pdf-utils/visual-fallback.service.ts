import { createHash } from 'node:crypto'
import { env } from '@config/env'
import pLimit from 'p-limit'
import { buildDocumentFurnitureProfile, type PageFurnitureProfile } from './gemini-page-furniture'
import { PdfPageRendererService } from './pdf-page-renderer.service'
import { createVisualFallbackConfig } from './visual-fallback.config'
import {
  createInitialMetadata,
  createV1Metadata,
  createV2FullPageMetadata,
  reconcileV2Candidate,
} from './visual-fallback.metadata'
import type {
  PdfPageRenderer,
  RenderedPdfPage,
  VisualDocumentProfile,
  VisualFallbackConfig,
  VisualFallbackMetadata,
  VisualFallbackOcrPage,
  VisualFallbackReason,
  VisualTranscriptionProvider,
} from './visual-fallback.types'
import { GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION } from './visual-fallback.types'
import { createDefaultVisualProvider } from './visual-fallback-provider.factory'
import { reconcileVisualText } from './visual-reconciliation.policy'
import { transcribeWithRetries } from './visual-transcription-retry'

export { createVisualFallbackConfig } from './visual-fallback.config'
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
  furnitureProfile?: PageFurnitureProfile
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

function selectRiskyPages(pages: VisualFallbackOcrPage[]): SelectedPage[] {
  return pages
    .map(page => ({ page, reasons: selectRiskReasons(page) }))
    .filter(({ reasons }) => reasons.length > 0)
}

function markV2UnavailablePages(
  byPage: Map<number, VisualFallbackMetadata>,
  pages: SelectedPage[],
  reason: 'aborted' | 'budget_exhausted'
): void {
  for (const { page, reasons } of pages) {
    byPage.set(
      page.pageNumber,
      createV2FullPageMetadata({ page, reasons, outcome: { kind: 'unavailable', reason } })
    )
  }
}

function applyPageBudget({
  pages,
  pageBudget,
  byPage,
  isV2Policy,
}: {
  pages: SelectedPage[]
  pageBudget: NonNullable<VisualFallbackInput['pageBudget']>
  byPage: Map<number, VisualFallbackMetadata>
  isV2Policy: boolean
}): SelectedPage[] {
  let selectedPages = pages.slice(0, pageBudget.remaining())
  if (selectedPages.length > 0 && !pageBudget.reserve(selectedPages.length)) selectedPages = []
  const selectedNumbers = new Set(selectedPages.map(({ page }) => page.pageNumber))

  for (const { page, reasons } of pages) {
    if (selectedNumbers.has(page.pageNumber)) continue
    byPage.set(
      page.pageNumber,
      isV2Policy
        ? createV2FullPageMetadata({
            page,
            reasons,
            outcome: { kind: 'unavailable', reason: 'budget_exhausted' },
          })
        : createV1Metadata({
            page,
            state: 'fallback_failed',
            reasons,
            decisionReason: 'budget_exhausted',
          })
    )
  }
  return selectedPages
}

function markPendingPages(
  byPage: Map<number, VisualFallbackMetadata>,
  pages: SelectedPage[]
): void {
  for (const { page, reasons } of pages) {
    byPage.set(page.pageNumber, createV1Metadata({ page, state: 'fallback_pending', reasons }))
  }
}

function markFailedPages({
  byPage,
  pages,
  isV2Policy,
  reason,
}: {
  byPage: Map<number, VisualFallbackMetadata>
  pages: SelectedPage[]
  isV2Policy: boolean
  reason: 'render_failed' | 'aborted'
}): void {
  for (const { page, reasons } of pages) {
    if (reason === 'aborted' && byPage.get(page.pageNumber)?.state !== 'fallback_pending') continue
    byPage.set(
      page.pageNumber,
      isV2Policy
        ? createV2FullPageMetadata({
            page,
            reasons,
            outcome: { kind: 'unavailable', reason },
          })
        : createV1Metadata({ page, state: 'fallback_failed', reasons })
    )
  }
}

export class VisualFallbackService {
  constructor(
    private readonly renderer: PdfPageRenderer = new PdfPageRendererService(),
    provider?: VisualTranscriptionProvider,
    config: VisualFallbackConfig = createVisualFallbackConfig(env)
  ) {
    this.config = config
    this.provider = provider ?? createDefaultVisualProvider(config.provider)
  }

  private readonly provider: VisualTranscriptionProvider
  private readonly config: VisualFallbackConfig

  private isV2Policy(): boolean {
    return this.config.reconciliationPolicyVersion === GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION
  }

  async execute(input: VisualFallbackInput): Promise<VisualFallbackResult> {
    const byPage = createInitialMetadata(input.pages)
    const acceptedVisualTextByPage = new Map<number, string>()
    if (this.isV2Policy() && this.config.provider !== 'gemini') {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: false }
    }
    if (!this.config.enabled) {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: false }
    }
    if (input.signal?.aborted && !this.isV2Policy()) {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: true }
    }
    if (input.signal?.aborted) {
      const riskyPages = selectRiskyPages(input.pages)
      const selectedPages = riskyPages.slice(0, this.config.maxPagesPerPdf)
      markV2UnavailablePages(byPage, selectedPages, 'aborted')
      markV2UnavailablePages(
        byPage,
        riskyPages.slice(this.config.maxPagesPerPdf),
        'budget_exhausted'
      )
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: selectedPages.length,
        enabled: true,
      }
    }

    const riskyPages = selectRiskyPages(input.pages)
    let selectedPages = riskyPages.slice(0, this.config.maxPagesPerPdf)
    if (this.isV2Policy()) {
      markV2UnavailablePages(
        byPage,
        riskyPages.slice(this.config.maxPagesPerPdf),
        'budget_exhausted'
      )
    }

    if (input.pageBudget) {
      selectedPages = applyPageBudget({
        pages: selectedPages,
        pageBudget: input.pageBudget,
        byPage,
        isV2Policy: this.isV2Policy(),
      })
    }

    if (selectedPages.length === 0) {
      return { byPage, acceptedVisualTextByPage, selectedPageCount: 0, enabled: true }
    }

    markPendingPages(byPage, selectedPages)

    let renderedPages: Awaited<ReturnType<PdfPageRenderer['renderPages']>>
    try {
      renderedPages = await this.renderer.renderPages(
        input.buffer,
        selectedPages.map(({ page }) => page.pageNumber),
        input.signal
      )
    } catch {
      markFailedPages({
        byPage,
        pages: selectedPages,
        isV2Policy: this.isV2Policy(),
        reason: 'render_failed',
      })
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: selectedPages.length,
        enabled: true,
      }
    }

    const renderedByPage = new Map(
      renderedPages.map(renderedPage => [renderedPage.pageNumber, renderedPage])
    )
    const limit = pLimit(this.config.concurrency)
    const furnitureByPage = this.isV2Policy()
      ? buildDocumentFurnitureProfile(
          selectedPages.map(({ page }) => ({ pageNumber: page.pageNumber, text: page.text })),
          this.config.maxAlignmentCells
        )
      : new Map<number, PageFurnitureProfile>()
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
            furnitureProfile: furnitureByPage.get(selection.page.pageNumber),
          })
        )
      )
    )

    markFailedPages({
      byPage,
      pages: selectedPages,
      isV2Policy: this.isV2Policy(),
      reason: 'aborted',
    })

    return {
      byPage,
      acceptedVisualTextByPage,
      selectedPageCount: selectedPages.length,
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
    furnitureProfile,
  }: ProcessSelectedPageInput): Promise<void> {
    if (signal?.aborted) return
    if (!renderedPage) {
      byPage.set(
        page.pageNumber,
        this.isV2Policy()
          ? createV2FullPageMetadata({
              page,
              reasons,
              outcome: { kind: 'unavailable', reason: 'render_failed' },
            })
          : createV1Metadata({ page, state: 'fallback_failed', reasons })
      )
      return
    }

    const transcription = await transcribeWithRetries({
      image: renderedPage.image,
      pageNumber: page.pageNumber,
      signal,
      documentProfile,
      model: this.config.model,
      maxRetries: this.config.maxRetries,
      timeoutMs: this.config.timeoutMs,
      provider: this.provider,
    })
    if (signal?.aborted) return
    if (transcription.status === 'unavailable') {
      byPage.set(
        page.pageNumber,
        this.isV2Policy()
          ? createV2FullPageMetadata({
              page,
              reasons,
              outcome: { kind: 'unavailable', reason: transcription.reason },
            })
          : createV1Metadata({ page, state: 'fallback_failed', reasons })
      )
      return
    }
    const candidate = transcription.text

    if (this.isV2Policy()) {
      const reconciliation = reconcileV2Candidate({
        page,
        reasons,
        candidate,
        maxAlignmentCells: this.config.maxAlignmentCells,
        shadowMode: this.config.shadowMode,
        provenance: {
          provider: this.config.provider,
          model: this.config.model,
          imageSha256: hash(renderedPage.image),
          candidateSha256: hash(candidate),
        },
        furnitureProfile,
      })
      byPage.set(page.pageNumber, reconciliation.metadata)
      if (reconciliation.acceptedText !== undefined) {
        acceptedVisualTextByPage.set(page.pageNumber, reconciliation.acceptedText)
      }
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
      createV1Metadata({
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
}
