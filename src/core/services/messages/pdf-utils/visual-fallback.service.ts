import { env } from '@config/env'
import pLimit from 'p-limit'
import { buildDocumentFurnitureProfile, type PageFurnitureProfile } from './gemini-page-furniture'
import { PdfPageRendererService } from './pdf-page-renderer.service'
import { resolveVisualDocumentProfile } from './visual-document-profile'
import { createVisualFallbackConfig } from './visual-fallback.config'
import { createInitialMetadata } from './visual-fallback.metadata'
import type {
  PdfPageRenderer,
  VisualDocumentProfile,
  VisualFallbackConfig,
  VisualFallbackMetadata,
  VisualFallbackOcrPage,
  VisualTranscriptionProvider,
} from './visual-fallback.types'
import { GEMINI_WHOLE_PAGE_CRITICAL_POLICY_VERSION } from './visual-fallback.types'
import { processSelectedPage } from './visual-fallback-page-processor'
import {
  applyPageBudget,
  markBudgetExhaustedPages,
  markFailedPages,
  markPendingPages,
  markV2UnavailablePages,
  selectRiskyPages,
  type VisualFallbackPageBudget,
} from './visual-fallback-page-state'
import { createDefaultVisualProvider } from './visual-fallback-provider.factory'

export { createVisualFallbackConfig } from './visual-fallback.config'
export type { VisualTranscriptionProvider } from './visual-fallback.types'

type VisualFallbackInput = {
  buffer: Buffer
  fileName: string
  pages: VisualFallbackOcrPage[]
  signal?: AbortSignal
  pageBudget?: VisualFallbackPageBudget
  documentProfile?: VisualDocumentProfile
}

type VisualFallbackResult = {
  byPage: Map<number, VisualFallbackMetadata>
  acceptedVisualTextByPage: ReadonlyMap<number, string>
  selectedPageCount: number
  enabled: boolean
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
    markBudgetExhaustedPages(
      byPage,
      riskyPages.slice(this.config.maxPagesPerPdf),
      this.isV2Policy()
    )

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
    const documentProfile = resolveVisualDocumentProfile(input.fileName, input.documentProfile)
    await Promise.all(
      selectedPages.map(selection =>
        limit(() =>
          processSelectedPage({
            selection,
            renderedPage: renderedByPage.get(selection.page.pageNumber),
            byPage,
            acceptedVisualTextByPage,
            signal: input.signal,
            documentProfile,
            furnitureProfile: furnitureByPage.get(selection.page.pageNumber),
            config: this.config,
            provider: this.provider,
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
}
