import { describe, expect, test } from 'bun:test'
import {
  selectEnhancedDocumentText,
  selectEnhancedPageText,
} from '../../src/core/services/messages/pdf-utils/enhanced-text-selection'

const strongNativeQuality = {
  shouldSkipOcr: true,
  isHighQuality: true,
  isRepetitive: false,
  hasOcrIndicators: false,
  hasSubstantialContent: true,
  qualityScore: 100,
}

describe('enhanced document text selection', () => {
  test('preserves a high-quality native page before considering OCR warnings', () => {
    const nativeText = `APRESENTAÇÃO\n${'Texto normativo nativo com acentuação preservada. '.repeat(80)}`
    const enhancedText = nativeText.replaceAll('acentuação', 'acentuacao')

    expect(
      selectEnhancedPageText({
        nativeText,
        enhancedText,
        enhancedWarnings: [],
        nativeQuality: strongNativeQuality,
      })
    ).toMatchObject({
      text: nativeText.trim(),
      selection: {
        source: 'native',
        reason: 'native_page_high_quality',
      },
    })
  })

  test('keeps more complete OCR when a high-quality native page omits content', () => {
    const nativeText = `Art. 1 Texto nativo.\n${'conteúdo confiável '.repeat(80)}`
    const enhancedText = `${nativeText}\nArt. 2 Obrigação adicional de pagamento de R$ 1.000,00.\n${'conteúdo adicional '.repeat(30)}`

    expect(
      selectEnhancedPageText({
        nativeText,
        enhancedText,
        enhancedWarnings: [],
        nativeQuality: strongNativeQuality,
      }).selection
    ).toMatchObject({ source: 'enhanced', reason: 'enhanced_selected' })
  })

  test('preserves a materially more complete native page when OCR remains garbled', () => {
    const nativeText = [
      '6',
      ...Array.from(
        { length: 80 },
        (_, index) => `CAPÍTULO ${index + 1} ${'.'.repeat(40)} ${index + 40}`
      ),
    ].join('\n')
    const enhancedText = [
      'CAPITULO |',
      'PROCEDIMENTOS ADMINISTRATIVOS EM ESPÉCIE...',
      'CAPITULO || PORN',
      'REGULAMENTAGAO ......csccsecscscscsscecsscscsececsesessesecs',
    ].join('\n')

    expect(
      selectEnhancedPageText({
        nativeText,
        enhancedText,
        enhancedWarnings: ['garbled-spans'],
        nativeQuality: {
          ...strongNativeQuality,
          shouldSkipOcr: false,
          isHighQuality: false,
          hasSubstantialContent: true,
          qualityScore: 70,
        },
      })
    ).toMatchObject({
      text: nativeText,
      selection: {
        source: 'native',
        reason: 'ocr_materially_less_complete',
      },
    })
  })

  test('does not preserve longer native text without readable quality or TOC structure', () => {
    const nativeText = Array.from(
      { length: 80 },
      (_, index) => `${index} §§§ ### ??? ${String.fromCharCode(65 + (index % 26))}`
    ).join('\n')

    expect(
      selectEnhancedPageText({
        nativeText,
        enhancedText: 'Texto OCR legível e completo para a página.',
        enhancedWarnings: ['garbled-spans'],
        nativeQuality: {
          ...strongNativeQuality,
          shouldSkipOcr: false,
          isHighQuality: false,
          hasSubstantialContent: true,
          qualityScore: 70,
        },
      }).selection
    ).toMatchObject({ source: 'enhanced', reason: 'enhanced_selected' })
  })

  test('keeps OCR page text without a corruption warning', () => {
    expect(
      selectEnhancedPageText({
        nativeText: 'conteúdo nativo '.repeat(100),
        enhancedText: 'conteúdo OCR '.repeat(30),
        enhancedWarnings: [],
        nativeQuality: {
          ...strongNativeQuality,
          shouldSkipOcr: false,
          isHighQuality: false,
          hasSubstantialContent: true,
          qualityScore: 70,
        },
      }).selection
    ).toMatchObject({ source: 'enhanced', reason: 'enhanced_selected' })
  })

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
