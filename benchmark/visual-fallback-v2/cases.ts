import { parseBenchmarkCases } from './schema'

const MAX_ALIGNMENT_CELLS = 10_000_000

const parsedSyntheticCases = parseBenchmarkCases([
  {
    syntheticId: 'synthetic-v2-critical-cardinality-gemini-insertion',
    ocrText: 'synthetic source insertion value 10; value 20.',
    visualText: 'synthetic candidate insertion value 20; value 10; value 30.',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-critical-cardinality-gemini-removal',
    ocrText: 'synthetic removal context value 20; value 10; value 30. common ending',
    visualText: 'synthetic removal context value 10; value 20. common ending',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-region-pairing-repeated-marker-tie',
    ocrText: 'R.22 synthetic common act value 10; R.22 synthetic common act value 20;',
    visualText: 'R.22 synthetic common act value 20; R.22 synthetic common act value 10;',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-region-pairing-crossed-residual-slot',
    ocrText:
      'R.1 synthetic alpha anchor value 10; R.22 old residual value 20; AV.3 synthetic omega anchor value 30.',
    visualText:
      'R.23 revised residual value 21; R.1 synthetic alpha anchor value 10; AV.3 synthetic omega anchor value 30.',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-region-pairing-multiple-residuals',
    ocrText:
      'R.1 synthetic alpha anchor value 10; R.22 old residual value 20; AV.8 old residual value 40; AV.99 synthetic omega anchor value 90.',
    visualText:
      'R.1 synthetic alpha anchor value 10; R.23 revised residual value 21; AV.9 revised residual value 41; AV.99 synthetic omega anchor value 90.',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-region-pairing-no-shared-anchor',
    ocrText: 'R.22 old synthetic residual value 20.',
    visualText: 'R.23 revised synthetic residual value 21.',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-localized-number',
    ocrText: 'synthetic record value 10 confirmed.',
    visualText: 'synthetic record value 11 confirmed.',
    maxAlignmentCells: MAX_ALIGNMENT_CELLS,
  },
  {
    syntheticId: 'synthetic-v2-alignment-budget-rejection',
    ocrText: 'synthetic value 10',
    visualText: 'synthetic value 11',
    maxAlignmentCells: 4,
  },
])

export const SYNTHETIC_CASES = Object.freeze(
  parsedSyntheticCases.map(fixture => Object.freeze(fixture))
)

export const SYNTHETIC_CASE_IDS = Object.freeze(SYNTHETIC_CASES.map(item => item.syntheticId))
