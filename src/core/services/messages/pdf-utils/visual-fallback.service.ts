import { env } from '@config/env'
import logger from '@lib/logger'
import pLimit from 'p-limit'
import { buildDocumentFurnitureProfile, type PageFurnitureProfile } from './gemini-page-furniture'
import { PdfPageRendererService } from './pdf-page-renderer.service'
import { resolveVisualDocumentProfile } from './visual-document-profile'
import { createVisualFallbackConfig } from './visual-fallback.config'
import { createInitialMetadata } from './visual-fallback.metadata'
import type { VisualFallbackFileSummary } from '../process-messages.types'
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
  fileId?: string
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
  summary?: VisualFallbackFileSummary
}

function createSummary({
  byPage,
  acceptedVisualTextByPage,
  status,
  eligiblePageCount,
  admittedPageCount,
  renderAttemptedPageCount,
  providerAttemptedPageCount,
  pdfSkipped,
  jobSkipped,
}: {
  byPage: ReadonlyMap<number, VisualFallbackMetadata>
  acceptedVisualTextByPage: ReadonlyMap<number, string>
  status: VisualFallbackFileSummary['status']
  eligiblePageCount: number
  admittedPageCount: number
  renderAttemptedPageCount: number
  providerAttemptedPageCount: number
  pdfSkipped: number
  jobSkipped: number
}): VisualFallbackFileSummary {
  const admitted = [...byPage.values()].filter(metadata => metadata.state !== 'fallback_skipped')
  return {
    status,
    eligiblePageCount,
    admittedPageCount,
    renderAttemptedPageCount,
    providerAttemptedPageCount,
    selectedVisualPageCount: acceptedVisualTextByPage.size,
    reconciledPageCount: admitted.filter(metadata => metadata.state === 'reconciled').length,
    shadowPageCount: admitted.filter(metadata => metadata.state === 'ocr_plus_visual_candidate')
      .length,
    conflictPageCount: admitted.filter(metadata => metadata.state === 'conflict').length,
    unavailablePageCount: admitted.filter(metadata => metadata.state === 'fallback_failed').length,
    budgetSkippedPageCount: pdfSkipped + jobSkipped,
    budgetSkippedByScope: { pdf: pdfSkipped, job: jobSkipped },
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
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: 0,
        enabled: false,
        summary: createSummary({
          byPage,
          acceptedVisualTextByPage,
          status: 'disabled',
          eligiblePageCount: 0,
          admittedPageCount: 0,
          renderAttemptedPageCount: 0,
          providerAttemptedPageCount: 0,
          pdfSkipped: 0,
          jobSkipped: 0,
        }),
      }
    }
    if (!this.config.enabled) {
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: 0,
        enabled: false,
        summary: createSummary({
          byPage,
          acceptedVisualTextByPage,
          status: 'disabled',
          eligiblePageCount: 0,
          admittedPageCount: 0,
          renderAttemptedPageCount: 0,
          providerAttemptedPageCount: 0,
          pdfSkipped: 0,
          jobSkipped: 0,
        }),
      }
    }
    if (input.signal?.aborted && !this.isV2Policy()) {
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: 0,
        enabled: true,
        summary: createSummary({
          byPage,
          acceptedVisualTextByPage,
          status: 'aborted',
          eligiblePageCount: 0,
          admittedPageCount: 0,
          renderAttemptedPageCount: 0,
          providerAttemptedPageCount: 0,
          pdfSkipped: 0,
          jobSkipped: 0,
        }),
      }
    }
    if (input.signal?.aborted) {
      const riskyPages = selectRiskyPages(input.pages)
      const selectedPages = riskyPages.slice(0, this.config.maxPagesPerPdf)
      const pdfSkipped = riskyPages.length - selectedPages.length
      markV2UnavailablePages(byPage, selectedPages, 'aborted')
      markBudgetExhaustedPages(byPage, riskyPages.slice(this.config.maxPagesPerPdf), true)
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: selectedPages.length,
        enabled: true,
        summary: createSummary({
          byPage,
          acceptedVisualTextByPage,
          status: 'aborted',
          eligiblePageCount: riskyPages.length,
          admittedPageCount: selectedPages.length,
          renderAttemptedPageCount: 0,
          providerAttemptedPageCount: 0,
          pdfSkipped,
          jobSkipped: 0,
        }),
      }
    }

    const riskyPages = selectRiskyPages(input.pages)
    let selectedPages = riskyPages.slice(0, this.config.maxPagesPerPdf)
    const pdfSkipped = riskyPages.length - selectedPages.length
    markBudgetExhaustedPages(
      byPage,
      riskyPages.slice(this.config.maxPagesPerPdf),
      this.isV2Policy()
    )

    const beforeJobBudget = selectedPages.length
    if (input.pageBudget) {
      selectedPages = applyPageBudget({
        pages: selectedPages,
        pageBudget: input.pageBudget,
        byPage,
        isV2Policy: this.isV2Policy(),
      })
    }
    const jobSkipped = beforeJobBudget - selectedPages.length

    if (selectedPages.length === 0) {
      return {
        byPage,
        acceptedVisualTextByPage,
        selectedPageCount: 0,
        enabled: true,
        summary: createSummary({
          byPage,
          acceptedVisualTextByPage,
          status: 'evaluated',
          eligiblePageCount: riskyPages.length,
          admittedPageCount: 0,
          renderAttemptedPageCount: 0,
          providerAttemptedPageCount: 0,
          pdfSkipped,
          jobSkipped,
        }),
      }
    }

    markPendingPages(byPage, selectedPages)

    let renderedPages: Awaited<ReturnType<PdfPageRenderer['renderPages']>>
    const renderingStartedAt = Date.now()
    try {
      renderedPages = await this.renderer.renderPages(
        input.buffer,
        selectedPages.map(({ page }) => page.pageNumber),
        input.signal
      )
      logger.debug('Visual fallback rendering completed', {
        ...(input.fileId !== undefined ? { fileId: input.fileId } : {}),
        selectedPageCount: selectedPages.length,
        renderedPageCount: renderedPages.length,
        durationMs: Date.now() - renderingStartedAt,
      })
    } catch {
      logger.warn('Visual fallback rendering failed', {
        ...(input.fileId !== undefined ? { fileId: input.fileId } : {}),
        selectedPageCount: selectedPages.length,
        durationMs: Date.now() - renderingStartedAt,
      })
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
        summary: createSummary({
          byPage,
          acceptedVisualTextByPage,
          status: 'evaluated',
          eligiblePageCount: riskyPages.length,
          admittedPageCount: selectedPages.length,
          renderAttemptedPageCount: selectedPages.length,
          providerAttemptedPageCount: 0,
          pdfSkipped,
          jobSkipped,
        }),
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
    const providerAttempts = await Promise.all(
      selectedPages.map(selection =>
        limit(() =>
          processSelectedPage({
            fileId: input.fileId,
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
      summary: createSummary({
        byPage,
        acceptedVisualTextByPage,
        status: 'evaluated',
        eligiblePageCount: riskyPages.length,
        admittedPageCount: selectedPages.length,
        renderAttemptedPageCount: selectedPages.length,
        providerAttemptedPageCount: providerAttempts.filter(Boolean).length,
        pdfSkipped,
        jobSkipped,
      }),
    }
  }
}
