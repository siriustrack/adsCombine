import { describe, expect, test } from 'bun:test'
import { pairCandidateRegions } from '../../src/core/services/messages/pdf-utils/gemini-candidate-region-pairing'
import {
  candidatePairingWork,
  input,
  marked,
  region,
} from './gemini-candidate-region-pairing.test-support'

describe('candidate multi-anchor region pairing', () => {
  test('propagates contextual exhaustion one unit below the combined budget', () => {
    // Given
    const ocr = [marked(0, 'a'), marked(1, 'b'), marked(2, 'c')]
    const gemini = [marked(0, 'a'), marked(1, 'b'), marked(2, 'c')]

    // When
    const work = candidatePairingWork(ocr, gemini, 3)
    const result = pairCandidateRegions(input(ocr, gemini, work - 1))

    // Then
    expect(result).toEqual({ status: 'budget_exceeded' })
  })

  test('succeeds deterministically at the exact combined budget boundary', () => {
    // Given
    const ocr = [marked(0, 'a'), marked(1, 'b'), marked(2, 'c')]
    const gemini = [marked(0, 'a'), marked(1, 'b'), marked(2, 'c')]

    // When
    const work = candidatePairingWork(ocr, gemini, 3)
    const forward = pairCandidateRegions(input(ocr, gemini, work))
    const reverse = pairCandidateRegions(input([...ocr].reverse(), [...gemini].reverse(), work))

    // Then
    expect(work).toBe(79)
    expect(forward).toMatchObject({ status: 'paired', ambiguous: false })
    expect(reverse).toEqual(forward)
  })

  test('bounds adversarial repeated marker and signature ties', () => {
    // Given
    const ocr = Array.from({ length: 64 }, (_, index) =>
      region({ index, markerKey: 'tie', signature: 'tie' })
    )
    const gemini = Array.from({ length: 64 }, (_, index) =>
      region({ index, markerKey: 'tie', signature: 'tie' })
    )

    // When
    const work = candidatePairingWork(ocr, gemini, 0)
    const result = pairCandidateRegions(input(ocr, gemini, work))

    // Then
    expect(work).toBe(2_305)
    expect(result).toEqual({ status: 'paired', pairs: [], ambiguous: true })
  })
})
