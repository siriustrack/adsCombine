import { env } from '@config/env'
import logger from '@lib/logger'
import { sanitizePdfText } from 'utils/sanitize'
import type { PdfPageText } from './pdf-text-extractor.service'
import type {
  MixedPageDiagnostics,
  PageClassificationCounts,
  PageOcrDecisionReason,
} from './process-pdf.types'
import { PdfLimitError } from './process-pdf.types'
import type { TextQualityAnalysis, TextQualityAnalyzer } from './text-quality-analyzer.service'

export function shouldBypassOcr({
  extractedText,
  totalPages,
  qualityAnalysis,
}: {
  extractedText: string
  totalPages: number
  qualityAnalysis: TextQualityAnalysis
}) {
  const pages = Math.max(1, totalPages || 0)
  const charsPerPage = extractedText.length / pages
  const minCharsPerPage = pages <= 1 ? 300 : pages === 2 ? 650 : 900
  const hasStrongDirectText =
    qualityAnalysis.isHighQuality &&
    qualityAnalysis.hasSubstantialContent &&
    !qualityAnalysis.isRepetitive &&
    charsPerPage >= minCharsPerPage &&
    extractedText.length >= 8000

  return {
    charsPerPage,
    hasStrongDirectText,
    shouldSkipOcr:
      hasStrongDirectText || (qualityAnalysis.shouldSkipOcr && charsPerPage >= minCharsPerPage),
  }
}

export function logOcrDecision({
  fileId,
  extractedText,
  totalPages,
  qualityAnalysis,
  charsPerPage,
  hasStrongDirectText,
  ocrAlwaysThreshold,
}: {
  fileId: string
  extractedText: string
  totalPages: number
  qualityAnalysis: TextQualityAnalysis
  charsPerPage: number
  hasStrongDirectText: boolean
  ocrAlwaysThreshold: number
}) {
  logger.debug('PDF OCR decision evaluated', {
    fileId,
    totalPages,
    textLength: extractedText.length,
    charsPerPage: Math.round(charsPerPage),
    ocrAlwaysThreshold,
    hasStrongDirectText,
    shouldSkipOcr: qualityAnalysis.shouldSkipOcr,
    isHighQuality: qualityAnalysis.isHighQuality,
    isRepetitive: qualityAnalysis.isRepetitive,
    hasOcrIndicators: qualityAnalysis.hasOcrIndicators,
    hasSubstantialContent: qualityAnalysis.hasSubstantialContent,
    qualityScore: qualityAnalysis.qualityScore,
  })
}

export function validatePdfPageLimit(totalPages: number, maxPdfPages?: number): Error | null {
  if (!maxPdfPages || totalPages <= maxPdfPages) {
    return null
  }

  return new PdfLimitError(
    'PDF_PAGE_LIMIT_EXCEEDED',
    `PDF possui ${totalPages} páginas, acima do limite configurado de ${maxPdfPages}.`
  )
}

export function shouldUseDirectOcrForSmallImageOnlyPdf(textData: {
  text: string
  totalPages: number
}): boolean {
  if (textData.totalPages === 0 || textData.totalPages > env.MIXED_PAGE_OCR_DIRECT_MAX_PAGES) {
    return false
  }

  const charsPerPage = textData.text.trim().length / textData.totalPages
  return charsPerPage < env.MIXED_PAGE_MIN_NATIVE_CHARS_PER_PAGE
}

export function normalizePages(textData: {
  totalPages: number
  pages: PdfPageText[]
}): PdfPageText[] {
  const byPage = new Map(textData.pages.map(page => [page.pageNumber, page]))
  const pages: PdfPageText[] = []

  for (let pageNumber = 1; pageNumber <= textData.totalPages; pageNumber++) {
    pages.push(
      byPage.get(pageNumber) ?? {
        pageNumber,
        text: '',
        embeddedImageCount: 0,
        tableCount: 0,
        hasVisualContent: false,
      }
    )
  }

  return pages
}

export function createMixedPageDiagnosticsEntry({
  page,
  textDiagnostics,
  shouldOcr,
  ocrDecisionReason,
}: {
  page: PdfPageText
  textDiagnostics: MixedPageDiagnostics['textDiagnostics']
  shouldOcr: boolean
  ocrDecisionReason: PageOcrDecisionReason
}): MixedPageDiagnostics {
  return {
    pageNumber: page.pageNumber,
    embeddedImageCount: page.embeddedImageCount,
    tableCount: page.tableCount,
    hasVisualContent: page.hasVisualContent,
    shouldOcr,
    ocrDecisionReason,
    textDiagnostics,
  }
}

export function getPageOcrDecisionReason(
  shouldOcr: boolean,
  qualityAnalysis: TextQualityAnalysis
): PageOcrDecisionReason {
  if (shouldOcr) {
    return qualityAnalysis.hasOcrIndicators ? 'ocr-indicators' : 'insufficient-native-text'
  }

  return qualityAnalysis.shouldSkipOcr ? 'quality-analysis-skip' : 'native-text-sufficient'
}

export function shouldOcrPage(analyzer: TextQualityAnalyzer, page: PdfPageText): boolean {
  if (page.hasVisualContent) return true

  const analysis = analyzer.analyzePage(page.text)
  return !analysis.shouldSkipOcr && (!analysis.isHighQuality || analysis.hasOcrIndicators)
}

export function createMixedPageDiagnostics(
  analyzer: TextQualityAnalyzer,
  page: PdfPageText
): MixedPageDiagnostics {
  const textDiagnostics = analyzer.analyzePageDiagnostics(page.text)
  const { qualityAnalysis } = textDiagnostics
  const shouldOcr =
    page.hasVisualContent ||
    (!qualityAnalysis.shouldSkipOcr &&
      (!qualityAnalysis.isHighQuality || qualityAnalysis.hasOcrIndicators))

  return createMixedPageDiagnosticsEntry({
    page,
    textDiagnostics,
    shouldOcr,
    ocrDecisionReason: page.hasVisualContent
      ? 'visual-content'
      : getPageOcrDecisionReason(shouldOcr, qualityAnalysis),
  })
}

function hasLegalChangeMarker(text: string, marker: RegExp): boolean {
  return marker.test(text)
}

export function shouldPreferNativePdfTextOverOcr({
  nativeText,
  ocrText,
}: {
  nativeText: string
  ocrText: string
}): boolean {
  const legalChangeMarkers = [
    /revogad[oa]/iu,
    /acrescid[oa]/iu,
    /alterad[oa]/iu,
    /reda[cç][aã]o\s+dada/iu,
    /inclu[ií]d[oa]/iu,
  ]

  return legalChangeMarkers.some(
    marker => hasLegalChangeMarker(nativeText, marker) && !hasLegalChangeMarker(ocrText, marker)
  )
}

function countPageClassifications(
  pageDiagnostics: MixedPageDiagnostics[]
): PageClassificationCounts {
  const counts: PageClassificationCounts = {
    empty: 0,
    'short-text': 0,
    'corrupted-text': 0,
    'repetitive-text': 0,
    'native-text': 0,
    'ocr-candidate': 0,
  }

  for (const page of pageDiagnostics) {
    counts[page.textDiagnostics.classification]++
  }

  return counts
}

export function logMixedPageDiagnostics(
  fileId: string,
  totalPages: number,
  pageDiagnostics: MixedPageDiagnostics[]
) {
  const classificationCounts = countPageClassifications(pageDiagnostics)

  logger.debug('Mixed-page PDF diagnostics evaluated', {
    fileId,
    totalPages,
    normalizedPages: pageDiagnostics.length,
    pagesSelectedForOcr: pageDiagnostics.filter(page => page.shouldOcr).length,
    pagesWithVisualContent: pageDiagnostics.filter(page => page.hasVisualContent).length,
    pagesWithEmbeddedImages: pageDiagnostics.filter(page => page.embeddedImageCount > 0).length,
    pagesWithTables: pageDiagnostics.filter(page => page.tableCount > 0).length,
    classificationCounts,
    pages: pageDiagnostics.map(page => ({
      pageNumber: page.pageNumber,
      embeddedImageCount: page.embeddedImageCount,
      tableCount: page.tableCount,
      hasVisualContent: page.hasVisualContent,
      shouldOcr: page.shouldOcr,
      ocrDecisionReason: page.ocrDecisionReason,
      textDiagnostics: page.textDiagnostics,
    })),
  })
}

export function combineTextResults(
  ocrText: string,
  fileId: string,
  ocrResult: { chunksProcessed: number; processingTime: number }
): string {
  const finalText = sanitizePdfText(ocrText)

  logger.debug('PDF processing completed', {
    fileId,
    finalTextLength: finalText.length,
    ocrTextLength: ocrText ? ocrText.length : 0,
    chunksProcessed: ocrResult.chunksProcessed,
    processingTime: ocrResult.processingTime,
  })

  if (finalText.trim().length < 50) {
    logger.warn('Very little text extracted from PDF', {
      fileId,
      finalTextLength: finalText.length,
      ocrTextLength: ocrText ? ocrText.length : 0,
    })
  }

  return finalText
}
