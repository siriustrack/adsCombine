import { describe, expect, test } from 'bun:test'
import { countCriticalCardinality } from '../../src/core/services/messages/pdf-utils/gemini-critical-cardinality'
import {
  createRegions,
  filterIgnoredTokens,
} from '../../src/core/services/messages/pdf-utils/gemini-critical-regions'
import { tokenize } from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'
import {
  analyze,
  anchor,
  bodySection,
  critical,
  region,
} from './gemini-contextual-critical-cardinality.test-support'

describe('contextual critical cardinality', () => {
  test('preserves the approved aggregate directional counts', () => {
    // Given
    const ocr = region({ index: 0, markerKey: 'r.1', critical: [critical('10')] })
    const gemini = region({ index: 0, markerKey: 'r.1', critical: [critical('11')] })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocr],
      geminiRegions: [gemini],
      anchors: [anchor(ocr, gemini)],
    })

    // Then
    expect(result.aggregate).toEqual(countCriticalCardinality(ocr.tokens, gemini.tokens))
  })

  test('keeps equal normalized values in different categories as different identities', () => {
    // Given
    const ocr = region({ index: 0, markerKey: 'r.1', critical: [critical('10', 'number')] })
    const gemini = region({
      index: 0,
      markerKey: 'r.1',
      critical: [critical('10', 'registry_identifier')],
    })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocr],
      geminiRegions: [gemini],
      anchors: [anchor(ocr, gemini)],
    })

    // Then
    expect(result.aggregate).toEqual({
      ocrOnlyCriticalTokenCount: 1,
      geminiOnlyCriticalTokenCount: 1,
    })
  })

  test('exposes slot-local insertion and removal when the global multiset is equal', () => {
    // Given
    const ocrFirst = region({ index: 0, markerKey: 'r.1', critical: [critical('10')] })
    const ocrSecond = region({ index: 1, markerKey: 'r.2', critical: [critical('20')] })
    const geminiFirst = region({
      index: 0,
      markerKey: 'r.1',
      critical: [critical('10'), critical('20')],
    })
    const geminiSecond = region({ index: 1, markerKey: 'r.2' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrFirst, ocrSecond],
      geminiRegions: [geminiFirst, geminiSecond],
      anchors: [anchor(ocrFirst, geminiFirst), anchor(ocrSecond, geminiSecond)],
    })

    // Then
    expect(result).toEqual({
      status: 'analyzed',
      aggregate: { ocrOnlyCriticalTokenCount: 0, geminiOnlyCriticalTokenCount: 0 },
      slots: [
        {
          section: 'body',
          slot: 0,
          counts: { ocrOnlyCriticalTokenCount: 0, geminiOnlyCriticalTokenCount: 1 },
        },
        {
          section: 'body',
          slot: 1,
          counts: { ocrOnlyCriticalTokenCount: 1, geminiOnlyCriticalTokenCount: 0 },
        },
      ],
    })
  })

  test('reports one slot-local excess in each direction for a replacement', () => {
    // Given
    const ocr = region({ index: 0, markerKey: 'r.1', critical: [critical('10')] })
    const gemini = region({ index: 0, markerKey: 'r.1', critical: [critical('11')] })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocr],
      geminiRegions: [gemini],
      anchors: [anchor(ocr, gemini)],
    })

    // Then
    expect(result).toMatchObject({
      status: 'analyzed',
      slots: [
        {
          counts: { ocrOnlyCriticalTokenCount: 1, geminiOnlyCriticalTokenCount: 1 },
        },
      ],
    })
  })

  test('uses only caller-provided furniture-filtered regions', () => {
    // Given
    const ocrText = 'Página 2 de 3\ncorpo valor 10'
    const geminiText = 'Página 9 de 3\ncorpo valor 11'
    const ocrTokens = filterIgnoredTokens(tokenize(ocrText), [
      { start: 0, end: ocrText.indexOf('\n') },
    ])
    const geminiTokens = filterIgnoredTokens(tokenize(geminiText), [
      { start: 0, end: geminiText.indexOf('\n') },
    ])
    const section = { ...bodySection, structurallyUnique: true }

    // When
    const result = analyze({
      section,
      ocrRegions: createRegions(ocrText, ocrTokens),
      geminiRegions: createRegions(geminiText, geminiTokens),
      anchors: [],
    })

    // Then
    expect(result.aggregate).toEqual({
      ocrOnlyCriticalTokenCount: 1,
      geminiOnlyCriticalTokenCount: 1,
    })
  })
})
