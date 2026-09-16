import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { SYNTHETIC_CASES } from '../../benchmark/visual-fallback-v2/cases'
import {
  createRegions,
  pairRegions,
} from '../../src/core/services/messages/pdf-utils/gemini-critical-regions'
import { pairIncumbentRegions } from '../../src/core/services/messages/pdf-utils/gemini-critical-section-pairing'
import {
  AlignmentLedger,
  tokenize,
} from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'
import type { FurnitureAlignmentSection } from '../../src/core/services/messages/pdf-utils/gemini-page-furniture'

const REGION_PAIRING_FIXTURES = SYNTHETIC_CASES.filter(fixture =>
  fixture.syntheticId.includes('region-pairing')
)

const EXPECTED_INCUMBENT_SHA256: Readonly<Record<string, string>> = {
  'synthetic-v2-region-pairing-repeated-marker-tie':
    '2a1d55b837f37149cfbc0d3c9fbc1374d2b798501b201609dbbb5328ada8822e',
  'synthetic-v2-region-pairing-crossed-residual-slot':
    'fd14a2efd066871faeeb0b7be423b7aae447a8aa78f248b87c62eeade7d73d79',
  'synthetic-v2-region-pairing-multiple-residuals':
    'e070dbe961bd6642bcf45ce166c353260cdb2e448a20cfd41d68faf692f26d57',
  'synthetic-v2-region-pairing-no-shared-anchor':
    '2a1d55b837f37149cfbc0d3c9fbc1374d2b798501b201609dbbb5328ada8822e',
}

const BODY_SECTION: FurnitureAlignmentSection = {
  kind: 'body',
  ocrStart: 0,
  ocrEnd: 1_000,
  geminiStart: 0,
  geminiEnd: 1_000,
}

function incumbentBytes(ocrText: string, visualText: string): string {
  return JSON.stringify(
    pairRegions(
      createRegions(ocrText, tokenize(ocrText)),
      createRegions(visualText, tokenize(visualText))
    )
  )
}

describe('incumbent region pairing stability', () => {
  test('is byte-stable on every existing synthetic region-pairing fixture', () => {
    const hashes = Object.fromEntries(
      REGION_PAIRING_FIXTURES.map(fixture => [
        fixture.syntheticId,
        createHash('sha256')
          .update(incumbentBytes(fixture.ocrText, fixture.visualText))
          .digest('hex'),
      ])
    )

    expect(REGION_PAIRING_FIXTURES).toHaveLength(4)
    expect(hashes).toEqual(EXPECTED_INCUMBENT_SHA256)
  })

  test('matches pairRegions directly without consuming the supplied ledger', () => {
    // Given
    const ocrRegions = createRegions('R.1 valor 10.', tokenize('R.1 valor 10.'))
    const geminiRegions = createRegions('R.1 valor 11.', tokenize('R.1 valor 11.'))
    const ledger = new AlignmentLedger(1)

    // When
    const result = pairIncumbentRegions({
      section: BODY_SECTION,
      ocrRegions,
      geminiRegions,
      ledger,
    })

    // Then
    expect(result).toEqual({ status: 'paired', ...pairRegions(ocrRegions, geminiRegions) })
    expect(ledger.consume(1)).toBe(true)
  })
})
