import { describe, expect, test } from 'bun:test'
import { selectEnhancedDocumentText } from '../../src/core/services/messages/pdf-utils/enhanced-text-selection'

const strongNativeQuality = {
  shouldSkipOcr: true,
  isHighQuality: true,
  isRepetitive: false,
  hasOcrIndicators: false,
  hasSubstantialContent: true,
  qualityScore: 100,
}

describe('enhanced document text selection', () => {
  test('preserves strong native text when enhanced OCR is materially less complete', () => {
    const nativeText = `Art. 1 Texto normativo integral.\n${'conteúdo válido '.repeat(500)}`
    const enhancedText = nativeText.slice(0, Math.floor(nativeText.length * 0.7))

    expect(
      selectEnhancedDocumentText({
        nativeText,
        enhancedText,
        totalPages: 3,
        nativeQuality: strongNativeQuality,
      })
    ).toMatchObject({
      text: nativeText.trim(),
      selection: {
        source: 'native',
        reason: 'ocr_materially_less_complete',
      },
    })
  })

  test('preserves strong native legal status markers omitted by OCR', () => {
    const nativeText = `Art. 1 Dispositivo revogado.\n${'conteúdo normativo '.repeat(500)}`
    const enhancedText = nativeText.replace('revogado', 'vigente')

    expect(
      selectEnhancedDocumentText({
        nativeText,
        enhancedText,
        totalPages: 3,
        nativeQuality: strongNativeQuality,
      }).selection
    ).toMatchObject({ source: 'native', reason: 'ocr_lost_legal_marker' })
  })

  test('preserves strong native text when one repeated legal status is changed', () => {
    const nativeText = [
      'Art. 1 Dispositivo revogado.',
      'Art. 2 Dispositivo revogado.',
      'conteúdo normativo válido '.repeat(500),
    ].join('\n')
    const enhancedText = nativeText.replace(
      'Art. 1 Dispositivo revogado.',
      'Art. 1 Dispositivo vigente.'
    )

    expect(
      selectEnhancedDocumentText({
        nativeText,
        enhancedText,
        totalPages: 1,
        nativeQuality: strongNativeQuality,
      }).selection
    ).toMatchObject({ source: 'native', reason: 'ocr_lost_legal_marker' })
  })

  test('reports an explicit native selection when enhanced OCR is empty', () => {
    expect(
      selectEnhancedDocumentText({
        nativeText: 'texto nativo disponível',
        enhancedText: '',
        totalPages: 1,
        nativeQuality: {
          ...strongNativeQuality,
          shouldSkipOcr: false,
          isHighQuality: false,
          hasSubstantialContent: false,
        },
      }).selection
    ).toMatchObject({ source: 'native', reason: 'ocr_empty' })
  })

  test('keeps enhanced text when native extraction is not strong', () => {
    expect(
      selectEnhancedDocumentText({
        nativeText: 'texto nativo curto',
        enhancedText: 'texto OCR completo',
        totalPages: 1,
        nativeQuality: {
          ...strongNativeQuality,
          shouldSkipOcr: false,
          isHighQuality: false,
          hasSubstantialContent: false,
        },
      })
    ).toMatchObject({
      text: 'texto OCR completo',
      selection: { source: 'enhanced', reason: 'enhanced_selected' },
    })
  })
})
