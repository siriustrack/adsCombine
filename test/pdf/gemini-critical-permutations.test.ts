import { describe, expect, test } from 'bun:test'
import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { CriticalDivergence } from '../../src/core/services/messages/pdf-utils/visual-fallback.types'

function expectMirroredPageFallback(ocrText: string, visualText: string) {
  const result = reconcileGeminiWholePage({ ocrText, visualText, maxAlignmentCells: 10_000_000 })

  expect(result.status).toBe('selected')
  if (result.status !== 'selected') throw new Error('expected selected candidate')
  expect(result.metadata.criticalUncertainties).toEqual([
    expect.objectContaining({
      start: 0,
      end: visualText.length,
      scope: 'page',
      divergences: ['duplicate_or_reordered'],
    }),
  ])
  expect(result.ocrCriticalUncertainties).toEqual([
    expect.objectContaining({
      start: 0,
      end: ocrText.length,
      scope: 'page',
      divergences: ['duplicate_or_reordered'],
    }),
  ])
}

describe('ambiguous critical permutations', () => {
  test('fails closed when critical values swap inside one unstructured region', () => {
    expectMirroredPageFallback('valor 10; valor 20.', 'valor 20; valor 10.')
  })

  test('fails closed when critical values swap between indistinguishable repeated acts', () => {
    expectMirroredPageFallback(
      'R.22 ato comum valor 10; R.22 ato comum valor 20;',
      'R.22 ato comum valor 20; R.22 ato comum valor 10;'
    )
  })

  test.each([
    [
      'unstructured',
      'valor 10; valor 10; valor 20.',
      'valor 10; valor 20; valor 10.',
    ],
    [
      'structured',
      'R.22 ato comum valor 10; R.22 ato comum valor 10; R.22 ato comum valor 20;',
      'R.22 ato comum valor 10; R.22 ato comum valor 20; R.22 ato comum valor 10;',
    ],
  ])('fails closed for an equal-cardinality duplicate permutation in %s text', (_label, ocrText, visualText) => {
    expectMirroredPageFallback(ocrText, visualText)
  })

  test.each([
    {
      label: 'Gemini insertion',
      ocrText: 'valor 10; valor 20.',
      visualText: 'valor 20; valor 10; valor 30.',
      divergences: ['duplicate_or_reordered', 'gemini_only'],
    },
    {
      label: 'Gemini removal',
      ocrText: 'contexto registral preservado valor 20; valor 10; valor 30. encerramento comum',
      visualText: 'contexto registral preservado valor 10; valor 20. encerramento comum',
      divergences: ['duplicate_or_reordered', 'ocr_only'],
    },
  ] as const)(
    'fails closed for shared inversion with %s',
    ({ ocrText, visualText, divergences }) => {
      const result = reconcileGeminiWholePage({
        ocrText,
        visualText,
        maxAlignmentCells: 10_000_000,
      })
      expect(result.status).toBe('selected')
      if (result.status !== 'selected') throw new Error('expected selected candidate')
      expect(result.metadata.criticalUncertainties).toEqual([
        expect.objectContaining({
          scope: 'page',
          categories: ['number'],
          divergences: [...divergences],
        }),
      ])
      expect(result.ocrCriticalUncertainties).toEqual([
        expect.objectContaining({
          scope: 'page',
          categories: ['number'],
          divergences: divergences.map<CriticalDivergence>(
            (divergence: CriticalDivergence): CriticalDivergence => {
              if (divergence === 'gemini_only') return 'ocr_only'
              if (divergence === 'ocr_only') return 'gemini_only'
              return divergence
            }
          ),
        }),
      ])
    }
  )

  test('rejects dense-marker preprocessing against the existing alignment budget', () => {
    const text = Array.from({ length: 2_000 }, (_, index) => `R.${index + 1} valor ${index};`).join(
      ' '
    )
    expect(
      reconcileGeminiWholePage({ ocrText: text, visualText: text, maxAlignmentCells: 20_000 })
    ).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })

  test('rejects oversized raw text before reading furniture or allocating alignment', () => {
    const furnitureProfile = new Proxy(
      {},
      {
        get() {
          throw new Error('furniture profile must not be read')
        },
      }
    )
    const text = ['H'.repeat(4_096), 'a', 'b', 'c', 'd', 'e'].join('\n')
    expect(
      reconcileGeminiWholePage({
        ocrText: text,
        visualText: text,
        maxAlignmentCells: 64,
        furnitureProfile: furnitureProfile as never,
      })
    ).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })
})
