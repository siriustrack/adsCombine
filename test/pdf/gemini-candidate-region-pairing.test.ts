import { describe, expect, test } from 'bun:test'
import { pairCandidateRegions } from '../../src/core/services/messages/pdf-utils/gemini-candidate-region-pairing'
import {
  critical,
  input,
  marked,
  pairedCandidateRegions,
  pairKeys,
  region,
} from './gemini-candidate-region-pairing.test-support'

describe('candidate multi-anchor region pairing', () => {
  test('accepts two distinct marked residual slots after marker anchors', () => {
    const ocr = [
      marked(0, 'a'),
      marked(1, 'old-1'),
      marked(2, 'b'),
      marked(3, 'old-2'),
      marked(4, 'c'),
    ]
    const gemini = [
      marked(0, 'a'),
      marked(1, 'new-1'),
      marked(2, 'b'),
      marked(3, 'new-2'),
      marked(4, 'c'),
    ]

    const result = pairedCandidateRegions(input(ocr, gemini))

    expect(result.ambiguous).toBe(false)
    expect(pairKeys(result.pairs)).toEqual([
      ['a', 'a', true],
      ['b', 'b', true],
      ['c', 'c', true],
      ['old-1', 'new-1', false],
      ['old-2', 'new-2', false],
    ])
  })

  test('accepts three marked residuals in distinct prefix, middle, and suffix slots', () => {
    const ocr = [
      marked(0, 'old-prefix'),
      marked(1, 'a'),
      marked(2, 'old-middle'),
      marked(3, 'b'),
      marked(4, 'old-suffix'),
    ]
    const gemini = [
      marked(0, 'new-prefix'),
      marked(1, 'a'),
      marked(2, 'new-middle'),
      marked(3, 'b'),
      marked(4, 'new-suffix'),
    ]

    const result = pairedCandidateRegions(input(ocr, gemini))

    expect(result.ambiguous).toBe(false)
    expect(pairKeys(result.pairs).slice(2)).toEqual([
      ['old-prefix', 'new-prefix', false],
      ['old-middle', 'new-middle', false],
      ['old-suffix', 'new-suffix', false],
    ])
  })

  test('preserves the supported single marked residual case', () => {
    const result = pairedCandidateRegions(
      input(
        [marked(0, 'a'), marked(1, 'old'), marked(2, 'b')],
        [marked(0, 'a'), marked(1, 'new'), marked(2, 'b')]
      )
    )

    expect(result.ambiguous).toBe(false)
    expect(pairKeys(result.pairs).at(-1)).toEqual(['old', 'new', false])
  })

  test('keeps unique marker anchors before unique signature anchors', () => {
    const result = pairedCandidateRegions(
      input(
        [
          marked(0, 'a'),
          region({ index: 1, markerKey: 'old', signature: 'shared' }),
          marked(2, 'b'),
        ],
        [
          marked(0, 'a'),
          region({ index: 1, markerKey: 'new', signature: 'shared' }),
          marked(2, 'b'),
        ]
      )
    )

    expect(result.ambiguous).toBe(false)
    expect(pairKeys(result.pairs)).toEqual([
      ['a', 'a', true],
      ['b', 'b', true],
      ['old', 'new', true],
    ])
  })

  test('accepts a residual signature duplicated only by a marker-paired region', () => {
    const result = pairedCandidateRegions(
      input(
        [
          region({ index: 0, markerKey: 'a', signature: 'shared' }),
          region({ index: 1, markerKey: 'old', signature: 'shared' }),
        ],
        [
          region({ index: 0, markerKey: 'a', signature: 'shared' }),
          region({ index: 1, markerKey: 'new', signature: 'shared' }),
        ]
      )
    )

    expect(result.ambiguous).toBe(false)
    expect(pairKeys(result.pairs)).toEqual([
      ['a', 'a', true],
      ['old', 'new', true],
    ])
  })

  test('rejects a signature repeated inside the marker-unpaired residuals', () => {
    const result = pairedCandidateRegions(
      input(
        [
          region({ index: 0, markerKey: 'a', signature: 'shared' }),
          region({ index: 1, markerKey: 'old-1', signature: 'shared' }),
          region({ index: 2, markerKey: 'old-2', signature: 'shared' }),
        ],
        [
          region({ index: 0, markerKey: 'a', signature: 'shared' }),
          region({ index: 1, markerKey: 'new-1', signature: 'shared' }),
          region({ index: 2, markerKey: 'new-2', signature: 'shared' }),
        ]
      )
    )

    expect(result.ambiguous).toBe(true)
    expect(pairKeys(result.pairs)).toEqual([['a', 'a', true]])
  })

  test('preserves only the supported unmarked prefix residual case', () => {
    const result = pairedCandidateRegions(
      input(
        [region({ index: 0, signature: 'old-prefix' }), marked(1, 'a')],
        [region({ index: 0, signature: 'new-prefix' }), marked(1, 'a')]
      )
    )

    expect(result.ambiguous).toBe(false)
    expect(pairKeys(result.pairs).at(-1)).toEqual(['unmarked', 'unmarked', false])
  })

  test.each([
    {
      label: 'multiple residuals in one slot',
      value: input(
        [marked(0, 'a'), marked(1, 'old-1'), marked(2, 'old-2'), marked(3, 'b')],
        [marked(0, 'a'), marked(1, 'new-1'), marked(2, 'new-2'), marked(3, 'b')]
      ),
    },
    {
      label: 'crossed anchors',
      value: input([marked(0, 'a'), marked(1, 'b')], [marked(0, 'b'), marked(1, 'a')]),
    },
    {
      label: 'residuals in different anchor slots',
      value: input(
        [marked(0, 'a'), marked(1, 'old'), marked(2, 'b')],
        [marked(0, 'new'), marked(1, 'a'), marked(2, 'b')]
      ),
    },
    {
      label: 'asymmetric residual counts',
      value: input(
        [marked(0, 'a'), marked(1, 'old'), marked(2, 'b')],
        [marked(0, 'a'), marked(1, 'b')]
      ),
    },
    {
      label: 'an unmarked residual outside the prefix slot',
      value: input(
        [marked(0, 'a'), region({ index: 1, signature: 'old' }), marked(2, 'b')],
        [marked(0, 'a'), region({ index: 1, signature: 'new' }), marked(2, 'b')]
      ),
    },
    {
      label: 'no shared anchor',
      value: input([marked(0, 'old')], [marked(0, 'new')]),
    },
    {
      label: 'repeated marker and signature ties',
      value: input(
        [
          region({ index: 0, markerKey: 'tie', signature: 'tie' }),
          region({ index: 1, markerKey: 'tie', signature: 'tie' }),
        ],
        [
          region({ index: 0, markerKey: 'tie', signature: 'tie' }),
          region({ index: 1, markerKey: 'tie', signature: 'tie' }),
        ]
      ),
    },
  ])('rejects $label without accepting residual pairs', ({ value }) => {
    const result = pairedCandidateRegions(value)

    expect(result.ambiguous).toBe(true)
    expect(result.pairs.every(pair => pair.structurallyUnique)).toBe(true)
  })

  test('rejects contextual critical-order ambiguity in an otherwise safe slot', () => {
    const result = pairedCandidateRegions(
      input(
        [marked(0, 'a'), marked(1, 'old', [critical('10'), critical('20')]), marked(2, 'b')],
        [marked(0, 'a'), marked(1, 'new', [critical('20'), critical('10')]), marked(2, 'b')]
      )
    )

    expect(result.ambiguous).toBe(true)
    expect(result.pairs.every(pair => pair.structurallyUnique)).toBe(true)
  })

  test('is deterministic under supplied region and key discovery order', () => {
    const ocr = [
      marked(0, 'a'),
      marked(1, 'old-1'),
      marked(2, 'b'),
      marked(3, 'old-2'),
      marked(4, 'c'),
    ]
    const gemini = [
      marked(0, 'a'),
      marked(1, 'new-1'),
      marked(2, 'b'),
      marked(3, 'new-2'),
      marked(4, 'c'),
    ]

    const forward = pairedCandidateRegions(input(ocr, gemini))
    const reverse = pairedCandidateRegions(input([...ocr].reverse(), [...gemini].reverse()))

    expect(pairKeys(reverse.pairs)).toEqual(pairKeys(forward.pairs))
    expect(reverse.ambiguous).toBe(forward.ambiguous)
  })

  test('does not mutate supplied arrays or regions', () => {
    const ocr = [marked(0, 'a'), marked(1, 'old'), marked(2, 'b')]
    const gemini = [marked(0, 'a'), marked(1, 'new'), marked(2, 'b')]
    const before = JSON.stringify({ ocr, gemini })

    pairCandidateRegions(input(ocr, gemini))

    expect(JSON.stringify({ ocr, gemini })).toBe(before)
  })
})
