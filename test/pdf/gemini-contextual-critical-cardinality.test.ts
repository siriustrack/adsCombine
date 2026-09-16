import { describe, expect, test } from 'bun:test'
import {
  analyze,
  anchor,
  bodySection,
  critical,
  region,
} from './gemini-contextual-critical-cardinality.test-support'

describe('contextual critical cardinality', () => {
  test('analyzes monotonic structurally unique anchors', () => {
    // Given
    const ocrFirst = region({ index: 0, markerKey: 'r.1' })
    const ocrSecond = region({ index: 1, markerKey: 'r.2' })
    const geminiFirst = region({ index: 0, markerKey: 'r.1' })
    const geminiSecond = region({ index: 1, markerKey: 'r.2' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrFirst, ocrSecond],
      geminiRegions: [geminiFirst, geminiSecond],
      anchors: [anchor(ocrFirst, geminiFirst), anchor(ocrSecond, geminiSecond)],
    })

    // Then
    expect(result.status).toBe('analyzed')
  })

  test('returns ambiguity for crossed anchors', () => {
    // Given
    const ocrFirst = region({ index: 0, markerKey: 'r.1' })
    const ocrSecond = region({ index: 1, markerKey: 'r.2' })
    const geminiSecond = region({ index: 0, markerKey: 'r.2' })
    const geminiFirst = region({ index: 1, markerKey: 'r.1' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrFirst, ocrSecond],
      geminiRegions: [geminiSecond, geminiFirst],
      anchors: [anchor(ocrFirst, geminiFirst), anchor(ocrSecond, geminiSecond)],
    })

    // Then
    expect(result).toMatchObject({ status: 'ambiguous', reason: 'crossed_anchors' })
  })

  test('returns ambiguity without a shared anchor in an unstructured section', () => {
    // Given
    const ocr = region({ index: 0, signature: 'ocr-only' })
    const gemini = region({ index: 0, signature: 'gemini-only' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocr],
      geminiRegions: [gemini],
      anchors: [],
    })

    // Then
    expect(result).toMatchObject({ status: 'ambiguous', reason: 'no_shared_anchor' })
  })

  test('returns ambiguity for repeated or tied anchors', () => {
    // Given
    const ocrFirst = region({ index: 0, markerKey: 'r.1', signature: 'tied' })
    const ocrSecond = region({ index: 1, markerKey: 'r.1', signature: 'tied' })
    const geminiFirst = region({ index: 0, markerKey: 'r.1', signature: 'tied' })
    const geminiSecond = region({ index: 1, markerKey: 'r.1', signature: 'tied' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrFirst, ocrSecond],
      geminiRegions: [geminiFirst, geminiSecond],
      anchors: [anchor(ocrFirst, geminiFirst)],
    })

    // Then
    expect(result).toMatchObject({ status: 'ambiguous', reason: 'anchor_not_unique' })
  })

  test('proves a direct signature anchor within marker-unpaired residuals', () => {
    // Given
    const ocrMarker = region({ index: 0, markerKey: 'r.1', signature: 'shared' })
    const ocrResidual = region({ index: 1, markerKey: 'old', signature: 'shared' })
    const geminiMarker = region({ index: 0, markerKey: 'r.1', signature: 'shared' })
    const geminiResidual = region({ index: 1, markerKey: 'new', signature: 'shared' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrMarker, ocrResidual],
      geminiRegions: [geminiMarker, geminiResidual],
      anchors: [anchor(ocrMarker, geminiMarker), anchor(ocrResidual, geminiResidual)],
    })

    // Then
    expect(result.status).toBe('analyzed')
  })

  test('rejects a direct signature anchor repeated within marker-unpaired residuals', () => {
    // Given
    const ocrMarker = region({ index: 0, markerKey: 'r.1', signature: 'shared' })
    const ocrFirstResidual = region({ index: 1, markerKey: 'old-1', signature: 'shared' })
    const ocrSecondResidual = region({ index: 2, markerKey: 'old-2', signature: 'shared' })
    const geminiMarker = region({ index: 0, markerKey: 'r.1', signature: 'shared' })
    const geminiFirstResidual = region({ index: 1, markerKey: 'new-1', signature: 'shared' })
    const geminiSecondResidual = region({ index: 2, markerKey: 'new-2', signature: 'shared' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrMarker, ocrFirstResidual, ocrSecondResidual],
      geminiRegions: [geminiMarker, geminiFirstResidual, geminiSecondResidual],
      anchors: [anchor(ocrMarker, geminiMarker), anchor(ocrFirstResidual, geminiFirstResidual)],
    })

    // Then
    expect(result).toMatchObject({ status: 'ambiguous', reason: 'anchor_not_unique' })
  })

  test('returns ambiguity when an anchor-bounded slot is one-to-many', () => {
    // Given
    const ocrFirst = region({ index: 0, markerKey: 'r.1' })
    const ocrResidual = region({ index: 1, signature: 'ocr-residual' })
    const ocrSecond = region({ index: 2, markerKey: 'r.2' })
    const geminiFirst = region({ index: 0, markerKey: 'r.1' })
    const geminiResidual = region({ index: 1, signature: 'gemini-residual-a' })
    const otherGeminiResidual = region({ index: 2, signature: 'gemini-residual-b' })
    const geminiSecond = region({ index: 3, markerKey: 'r.2' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocrFirst, ocrResidual, ocrSecond],
      geminiRegions: [geminiFirst, geminiResidual, otherGeminiResidual, geminiSecond],
      anchors: [anchor(ocrFirst, geminiFirst), anchor(ocrSecond, geminiSecond)],
    })

    // Then
    expect(result).toMatchObject({ status: 'ambiguous', reason: 'slot_not_unique' })
  })

  test('returns ambiguity for an equal-cardinality reorder inside one slot', () => {
    // Given
    const ocr = region({
      index: 0,
      markerKey: 'r.1',
      critical: [critical('10'), critical('20')],
    })
    const gemini = region({
      index: 0,
      markerKey: 'r.1',
      critical: [critical('20'), critical('10')],
    })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocr],
      geminiRegions: [gemini],
      anchors: [anchor(ocr, gemini)],
    })

    // Then
    expect(result).toMatchObject({ status: 'ambiguous', reason: 'critical_order_ambiguous' })
  })

  test('is deterministic regardless of supplied anchor order', () => {
    // Given
    const ocrFirst = region({ index: 0, markerKey: 'r.1', critical: [critical('10')] })
    const ocrSecond = region({ index: 1, markerKey: 'r.2', critical: [critical('20')] })
    const geminiFirst = region({ index: 0, markerKey: 'r.1', critical: [critical('11')] })
    const geminiSecond = region({ index: 1, markerKey: 'r.2', critical: [critical('20')] })
    const firstAnchor = anchor(ocrFirst, geminiFirst)
    const secondAnchor = anchor(ocrSecond, geminiSecond)
    const sharedInput = {
      section: bodySection,
      ocrRegions: [ocrFirst, ocrSecond],
      geminiRegions: [geminiFirst, geminiSecond],
    }

    // When
    const forward = analyze({ ...sharedInput, anchors: [firstAnchor, secondAnchor] })
    const reverse = analyze({ ...sharedInput, anchors: [secondAnchor, firstAnchor] })

    // Then
    expect(reverse).toEqual(forward)
  })

  test('does not return normalized identities or raw token text', () => {
    // Given
    const secretIdentity = 'sensitive-normalized-identity'
    const ocr = region({ index: 0, markerKey: 'r.1', critical: [critical(secretIdentity)] })
    const gemini = region({ index: 0, markerKey: 'r.1' })

    // When
    const result = analyze({
      section: bodySection,
      ocrRegions: [ocr],
      geminiRegions: [gemini],
      anchors: [anchor(ocr, gemini)],
    })
    const serialized = JSON.stringify(result)

    // Then
    expect(serialized).not.toContain(secretIdentity)
    expect(serialized).not.toContain(`raw-${secretIdentity}`)
  })
})
