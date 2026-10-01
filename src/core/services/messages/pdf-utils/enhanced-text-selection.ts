import { sanitizePdfText } from 'utils/sanitize'
import { shouldBypassOcr, shouldPreferNativePdfTextOverOcr } from './process-pdf-helpers'
import type { TextQualityAnalysis } from './text-quality-analyzer.service'

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
