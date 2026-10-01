import { sanitizePdfText } from 'utils/sanitize'
import { shouldBypassOcr, shouldPreferNativePdfTextOverOcr } from './process-pdf-helpers'
import type { TextQualityAnalysis } from './text-quality-analyzer.service'

const PAGE_CORRUPTION_WARNINGS = new Set(['duplicate-labels', 'garbled-spans', 'no-text-detected'])

function hasTableOfContentsStructure(text: string): boolean {
  return text.split('\n').filter(line => /\.{3,}\s*\d+\s*$/u.test(line)).length >= 3
}

export type EnhancedTextSelection =
  | {
      readonly source: 'native'
      readonly reason:
        | 'ocr_empty'
        | 'ocr_failed'
        | 'ocr_materially_less_complete'
        | 'ocr_lost_legal_marker'
      readonly nativeLength: number
      readonly enhancedLength: number
      readonly pageMapping: 'unavailable'
    }
  | {
      readonly source: 'enhanced'
      readonly reason: 'enhanced_selected'
      readonly nativeLength: number
      readonly enhancedLength: number
      readonly pageMapping: 'complete'
    }
  | {
      readonly source: 'hybrid'
      readonly reason: 'native_pages_preserved'
      readonly nativeLength: number
      readonly enhancedLength: number
      readonly pageMapping: 'complete'
      readonly nativePageCount: number
      readonly enhancedPageCount: number
      readonly visualPageCount: number
    }

export type EnhancedPageTextSelection = {
  readonly source: 'native' | 'enhanced'
  readonly reason:
    | 'native_page_high_quality'
    | 'ocr_empty'
    | 'ocr_materially_less_complete'
    | 'enhanced_selected'
}

export function selectEnhancedPageText({
  nativeText,
  enhancedText,
  enhancedWarnings,
  nativeQuality,
}: {
  readonly nativeText: string
  readonly enhancedText: string
  readonly enhancedWarnings: readonly string[]
  readonly nativeQuality: TextQualityAnalysis
}): { readonly text: string; readonly selection: EnhancedPageTextSelection } {
  const native = sanitizePdfText(nativeText)
  const enhanced = sanitizePdfText(enhancedText)
  if (native && !enhanced) {
    return { text: native, selection: { source: 'native', reason: 'ocr_empty' } }
  }
  const nativeLength = native.replace(/\s/gu, '').length
  const enhancedLength = enhanced.replace(/\s/gu, '').length
  const nativeCoversEnhanced = nativeLength * 20 >= enhancedLength * 19
  if (
    native &&
    nativeQuality.shouldSkipOcr &&
    !nativeQuality.hasOcrIndicators &&
    !nativeQuality.isRepetitive &&
    nativeCoversEnhanced
  ) {
    return {
      text: native,
      selection: { source: 'native', reason: 'native_page_high_quality' },
    }
  }

  const nativeIsUsable =
    (nativeQuality.isHighQuality || hasTableOfContentsStructure(native)) &&
    nativeQuality.hasSubstantialContent &&
    !nativeQuality.hasOcrIndicators &&
    !nativeQuality.isRepetitive
  const enhancedIsCorrupted = enhancedWarnings.some(warning =>
    PAGE_CORRUPTION_WARNINGS.has(warning)
  )
  const enhancedIsMateriallyLessComplete =
    nativeLength - enhancedLength >= 500 && enhancedLength * 5 <= nativeLength * 4

  if (nativeIsUsable && enhancedIsCorrupted && enhancedIsMateriallyLessComplete) {
    return {
      text: native,
      selection: { source: 'native', reason: 'ocr_materially_less_complete' },
    }
  }

  return {
    text: enhanced,
    selection: { source: 'enhanced', reason: 'enhanced_selected' },
  }
}

export function selectEnhancedDocumentText({
  nativeText,
  enhancedText,
  totalPages,
  nativeQuality,
}: {
  readonly nativeText: string
  readonly enhancedText: string
  readonly totalPages: number
  readonly nativeQuality: TextQualityAnalysis
}): { readonly text: string; readonly selection: EnhancedTextSelection } {
  const native = sanitizePdfText(nativeText)
  const enhanced = sanitizePdfText(enhancedText)
  const nativeLength = native.replace(/\s/gu, '').length
  const enhancedLength = enhanced.replace(/\s/gu, '').length
  if (native.length > 0 && enhanced.length === 0) {
    return {
      text: native,
      selection: {
        source: 'native',
        reason: 'ocr_empty',
        nativeLength,
        enhancedLength,
        pageMapping: 'unavailable',
      },
    }
  }
  const strongNative =
    !nativeQuality.hasOcrIndicators &&
    shouldBypassOcr({
      extractedText: native,
      totalPages,
      qualityAnalysis: nativeQuality,
    }).hasStrongDirectText

  if (strongNative) {
    const materiallyLessComplete =
      nativeLength - enhancedLength >= 1_000 && enhancedLength * 5 <= nativeLength * 4
    if (materiallyLessComplete) {
      return {
        text: native,
        selection: {
          source: 'native',
          reason: 'ocr_materially_less_complete',
          nativeLength,
          enhancedLength,
          pageMapping: 'unavailable',
        },
      }
    }
    if (shouldPreferNativePdfTextOverOcr({ nativeText: native, ocrText: enhanced })) {
      return {
        text: native,
        selection: {
          source: 'native',
          reason: 'ocr_lost_legal_marker',
          nativeLength,
          enhancedLength,
          pageMapping: 'unavailable',
        },
      }
    }
  }

  return {
    text: enhanced,
    selection: {
      source: 'enhanced',
      reason: 'enhanced_selected',
      nativeLength,
      enhancedLength,
      pageMapping: 'complete',
    },
  }
}
