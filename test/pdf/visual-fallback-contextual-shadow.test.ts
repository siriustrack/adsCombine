import { describe, expect, test } from 'bun:test'
import {
  type GeminiWholePageReconciliation,
  reconcileGeminiWholePage,
  reconcileGeminiWholePageCandidate,
} from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'
import {
  type ContextualPairingShadowDiagnostic,
  evaluateContextualPairingShadow,
} from '../../src/core/services/messages/pdf-utils/visual-fallback-contextual-shadow'

const MAX_CELLS = 10_000_000

type IncumbentEvaluation = Readonly<{
  reconciliation: GeminiWholePageReconciliation
  diagnostic: VisualFallbackV2Diagnostic
}>

function evaluateIncumbent(input: {
  readonly ocrText: string
  readonly visualText: string
  readonly maxAlignmentCells?: number
}): IncumbentEvaluation {
  const diagnostics: VisualFallbackV2Diagnostic[] = []
  const reconciliation = reconcileGeminiWholePage({
    ...input,
    maxAlignmentCells: input.maxAlignmentCells ?? MAX_CELLS,
    pageNumber: 7,
    diagnosticObserver: diagnostic => diagnostics.push(diagnostic),
  })
  const diagnostic = diagnostics.at(0)
  if (diagnostic === undefined) throw new Error('expected incumbent diagnostic')
  return { reconciliation, diagnostic }
}

function evaluateShadow(input: {
  readonly ocrText: string
  readonly candidateText: string
  readonly maxAlignmentCells?: number
  readonly candidateReconciler?: typeof reconcileGeminiWholePageCandidate
  readonly observer?: (diagnostic: ContextualPairingShadowDiagnostic) => void
}): ContextualPairingShadowDiagnostic {
  const incumbent = evaluateIncumbent({
    ocrText: input.ocrText,
    visualText: input.candidateText,
    maxAlignmentCells: input.maxAlignmentCells ?? MAX_CELLS,
  })
  return evaluateContextualPairingShadow({
    pageNumber: 7,
    ocrText: input.ocrText,
    candidateText: input.candidateText,
    maxAlignmentCells: input.maxAlignmentCells ?? MAX_CELLS,
    incumbent,
    candidateReconciler: input.candidateReconciler,
    observer: input.observer,
  })
}

describe('contextual pairing shadow evaluator', () => {
  test('classifies a safe multi-anchor candidate localization as narrower', () => {
    // Given
    const ocrText =
      'R.1 âncora alfa valor 10; R.22 cláusula antiga valor 20; AV.50 âncora central valor 50; AV.8 averbação antiga valor 40; AV.99 âncora ômega valor 90.'
    const candidateText =
      'R.1 âncora alfa valor 10; R.23 cláusula revisada valor 21; AV.50 âncora central valor 50; AV.9 averbação revisada valor 41; AV.99 âncora ômega valor 90.'

    // When
    const diagnostic = evaluateShadow({ ocrText, candidateText })

    // Then
    expect(diagnostic.status).toBe('narrower')
    expect(diagnostic.incumbent.uncertaintyScopes.page).toBe(1)
    expect(diagnostic.candidate.uncertaintyScopes.page).toBe(0)
    expect(diagnostic.candidate.uncertaintyScopes.token).toBeGreaterThan(0)
  })

  test('reports candidate ambiguity as an aggregate terminal status', () => {
    // Given
    const ocrText = 'valor 10 em cláusula antiga sem marcador.'
    const candidateText = 'valor 11 em trecho revisado sem referência.'

    // When
    const diagnostic = evaluateShadow({ ocrText, candidateText })

    // Then
    expect(diagnostic.status).toBe('ambiguous')
    expect(diagnostic.candidate.trigger).toBe('region_pairing_ambiguous')
  })

  test('reports an independent candidate alignment budget exhaustion', () => {
    // Given
    const ocrText = 'R.1 base valor 10; AV.2 fechamento valor 20.'
    const candidateText = 'R.1 base valor 11; AV.2 fechamento valor 20.'

    // When
    const diagnostic = evaluateShadow({ ocrText, candidateText, maxAlignmentCells: 4 })

    // Then
    expect(diagnostic.status).toBe('budget_exceeded')
    expect(diagnostic.candidate.trigger).toBe('alignment_budget_exceeded')
  })

  test('maps real candidate preprocessing exhaustion to the budget terminal status', () => {
    // Given
    const ocrText = 'R.1 base valor 10; AV.2 fim valor 20.'
    const candidateText = 'R.1 base valor 11; AV.2 fim valor 20.'
    const maxAlignmentCells = ocrText.length + candidateText.length + 29

    // When
    const diagnostic = evaluateShadow({ ocrText, candidateText, maxAlignmentCells })

    // Then
    expect(diagnostic.status).toBe('budget_exceeded')
    expect(diagnostic.candidate.trigger).toBe('alignment_budget_exceeded')
  })

  test('uses a fresh alignment budget for the candidate reconciliation', () => {
    // Given
    const ocrText = 'R.1 valor 10; AV.2 valor 20.'
    const candidateText = 'R.1 valor 11; AV.2 valor 20.'
    let candidateCalls = 0

    // When
    const diagnostic = evaluateShadow({
      ocrText,
      candidateText,
      maxAlignmentCells: 250,
      candidateReconciler(input) {
        candidateCalls++
        return reconcileGeminiWholePageCandidate(input)
      },
    })

    // Then
    expect(candidateCalls).toBe(1)
    expect(diagnostic.status).not.toBe('budget_exceeded')
  })

  test('isolates a candidate exception and emits one privacy-safe failed diagnostic', () => {
    // Given
    const observed: ContextualPairingShadowDiagnostic[] = []
    const ocrText = 'PRIVATE_RAW_OCR_SENTINEL valor 10 https://private.example'
    const candidateText = 'PRIVATE_NORMALIZED_CANDIDATE_SENTINEL valor 11 PRIVATE_HASH_SENTINEL'

    // When
    const diagnostic = evaluateShadow({
      ocrText,
      candidateText,
      candidateReconciler() {
        throw new Error('PRIVATE_EXCEPTION_MESSAGE_AND_STACK_SENTINEL')
      },
      observer: value => observed.push(value),
    })

    // Then
    expect(diagnostic.status).toBe('failed')
    expect(observed).toEqual([diagnostic])
    const serialized = JSON.stringify(diagnostic).toLocaleLowerCase('en-US')
    for (const forbidden of [
      'private_',
      'normalized',
      'filename',
      'https://',
      'prompt',
      'range',
      'hash',
      'message',
      'stack',
      'sentinel',
      ocrText.toLocaleLowerCase('en-US'),
      candidateText.toLocaleLowerCase('en-US'),
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test('isolates aggregate observer exceptions from the evaluation result', () => {
    // Given
    const input = {
      ocrText: 'R.1 valor 10; AV.2 valor 20.',
      candidateText: 'R.1 valor 11; AV.2 valor 20.',
    }
    const baseline = evaluateShadow(input)

    // When
    const observed = evaluateShadow({
      ...input,
      observer() {
        throw new Error('PRIVATE_OBSERVER_SENTINEL')
      },
    })

    // Then
    expect(observed).toEqual(baseline)
  })
})
