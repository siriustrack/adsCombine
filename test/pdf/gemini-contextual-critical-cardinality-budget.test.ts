import { describe, expect, test } from 'bun:test'
import { analyzeContextualCriticalCardinality } from '../../src/core/services/messages/pdf-utils/gemini-contextual-critical-cardinality'
import { contextualCriticalCardinalityWork } from '../../src/core/services/messages/pdf-utils/gemini-contextual-critical-cardinality-budget'
import { AlignmentLedger } from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'
import {
  anchor,
  bodySection,
  critical,
  region,
} from './gemini-contextual-critical-cardinality.test-support'

function budgetSection(kind: 'top' | 'body' | 'bottom') {
  const ocr = region({ index: 0, markerKey: `${kind}-anchor`, critical: [critical('10')] })
  const gemini = region({
    index: 0,
    markerKey: `${kind}-anchor`,
    critical: [critical('11')],
  })
  return {
    section: { ...bodySection, kind },
    ocrRegions: [ocr],
    geminiRegions: [gemini],
    anchors: [anchor(ocr, gemini)],
  }
}

describe('contextual critical cardinality budget', () => {
  test('calculates the exact formula across sections', () => {
    // Given
    const sections = [
      { ocrTokenCount: 2, geminiTokenCount: 2, anchorCount: 1 },
      { ocrTokenCount: 2, geminiTokenCount: 2, anchorCount: 1 },
      { ocrTokenCount: 2, geminiTokenCount: 2, anchorCount: 1 },
    ]

    // When
    const work = contextualCriticalCardinalityWork(sections)

    // Then
    expect(work).toBe(45)
  })

  test('consumes exactly three times all tokens plus two per anchor and one per section', () => {
    // Given
    const ledger = new AlignmentLedger(15)

    // When
    const result = analyzeContextualCriticalCardinality({
      sections: [budgetSection('body')],
      ledger,
    })

    // Then
    expect(result.status).toBe('analyzed')
    expect(ledger.consume(1)).toBe(false)
  })

  test('returns budget_exceeded one unit below the contextual work boundary', () => {
    // Given
    const ledger = new AlignmentLedger(14)

    // When
    const result = analyzeContextualCriticalCardinality({
      sections: [budgetSection('body')],
      ledger,
    })

    // Then
    expect(result).toEqual({ status: 'budget_exceeded' })
  })

  test('accumulates contextual work across multiple sections before analysis', () => {
    // Given
    const ledger = new AlignmentLedger(44)

    // When
    const result = analyzeContextualCriticalCardinality({
      sections: [budgetSection('top'), budgetSection('body'), budgetSection('bottom')],
      ledger,
    })

    // Then
    expect(result).toEqual({ status: 'budget_exceeded' })
  })

  test.each([
    ['negative token count', [{ ocrTokenCount: -1, geminiTokenCount: 0, anchorCount: 0 }]],
    ['fractional token count', [{ ocrTokenCount: 0.5, geminiTokenCount: 0, anchorCount: 0 }]],
    [
      'unsafe token count',
      [{ ocrTokenCount: Number.MAX_SAFE_INTEGER + 1, geminiTokenCount: 0, anchorCount: 0 }],
    ],
    [
      'token sum overflow',
      [{ ocrTokenCount: Number.MAX_SAFE_INTEGER, geminiTokenCount: 1, anchorCount: 0 }],
    ],
    [
      'token product overflow',
      [{ ocrTokenCount: Number.MAX_SAFE_INTEGER, geminiTokenCount: 0, anchorCount: 0 }],
    ],
    [
      'anchor product overflow',
      [{ ocrTokenCount: 0, geminiTokenCount: 0, anchorCount: Number.MAX_SAFE_INTEGER }],
    ],
  ])('rejects %s arithmetic', (_label, sections) => {
    // When
    const work = contextualCriticalCardinalityWork(sections)

    // Then
    expect(work).toBeUndefined()
  })
})
