import { describe, expect, test } from 'bun:test'
import { countCriticalCardinality } from '../../src/core/services/messages/pdf-utils/gemini-critical-cardinality'
import { tokenize } from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'

function count(ocrText: string, geminiText: string) {
  return countCriticalCardinality(tokenize(ocrText), tokenize(geminiText))
}

describe('critical cardinality counts', () => {
  test('reports zero OCR-only and one Gemini-only occurrence for a Gemini insertion', () => {
    // Given
    const ocrText = 'valor 10; valor 20.'
    const geminiText = 'valor 10; valor 20; valor 30.'

    // When
    const result = count(ocrText, geminiText)

    // Then
    expect(result).toEqual({ ocrOnlyCriticalTokenCount: 0, geminiOnlyCriticalTokenCount: 1 })
  })

  test('reports one OCR-only and zero Gemini-only occurrences for a Gemini removal', () => {
    // Given
    const ocrText = 'valor 10; valor 20; valor 30.'
    const geminiText = 'valor 10; valor 20.'

    // When
    const result = count(ocrText, geminiText)

    // Then
    expect(result).toEqual({ ocrOnlyCriticalTokenCount: 1, geminiOnlyCriticalTokenCount: 0 })
  })

  test('reports one occurrence in each direction for a replacement', () => {
    // Given
    const ocrText = 'valor 10.'
    const geminiText = 'valor 11.'

    // When
    const result = count(ocrText, geminiText)

    // Then
    expect(result).toEqual({ ocrOnlyCriticalTokenCount: 1, geminiOnlyCriticalTokenCount: 1 })
  })

  test('reports zero in both directions for equal reordered multisets', () => {
    // Given
    const ocrText = 'valor 10; valor 20.'
    const geminiText = 'valor 20; valor 10.'

    // When
    const result = count(ocrText, geminiText)

    // Then
    expect(result).toEqual({ ocrOnlyCriticalTokenCount: 0, geminiOnlyCriticalTokenCount: 0 })
  })

  test('counts excess repeated occurrences rather than distinct identities', () => {
    // Given
    const ocrText = 'valor 10; valor 10; valor 10.'
    const geminiText = 'valor 10.'

    // When
    const result = count(ocrText, geminiText)

    // Then
    expect(result).toEqual({ ocrOnlyCriticalTokenCount: 2, geminiOnlyCriticalTokenCount: 0 })
  })

  test('ignores non-critical tokens', () => {
    // Given
    const ocrText = 'texto antigo completo.'
    const geminiText = 'texto novo revisado.'

    // When
    const result = count(ocrText, geminiText)

    // Then
    expect(result).toEqual({ ocrOnlyCriticalTokenCount: 0, geminiOnlyCriticalTokenCount: 0 })
  })
})
