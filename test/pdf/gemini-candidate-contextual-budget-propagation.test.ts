import { describe, expect, test } from 'bun:test'
import { createRegions } from '../../src/core/services/messages/pdf-utils/gemini-critical-regions'
import { tokenize } from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'
import {
  type GeminiWholePageReconciliation,
  reconcileGeminiWholePage,
  reconcileGeminiWholePageCandidate,
} from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'
import { evaluateContextualPairingShadow } from '../../src/core/services/messages/pdf-utils/visual-fallback-contextual-shadow'
import { candidatePairingWork } from './gemini-candidate-region-pairing.test-support'

const OCR_TEXT = 'R.1 base valor 10; AV.2 fim valor 20.'
const CANDIDATE_TEXT = 'R.1 base valor 11; AV.2 fim valor 20.'

function contextualOneUnderBudget(): number {
  const ocrRegions = createRegions(OCR_TEXT, tokenize(OCR_TEXT))
  const geminiRegions = createRegions(CANDIDATE_TEXT, tokenize(CANDIDATE_TEXT))
  return (
    OCR_TEXT.length + CANDIDATE_TEXT.length + candidatePairingWork(ocrRegions, geminiRegions, 2) - 1
  )
}

function incumbentEvaluation(maxAlignmentCells: number): Readonly<{
  reconciliation: GeminiWholePageReconciliation
  diagnostic: VisualFallbackV2Diagnostic
}> {
  const diagnostics: VisualFallbackV2Diagnostic[] = []
  const reconciliation = reconcileGeminiWholePage({
    ocrText: OCR_TEXT,
    visualText: CANDIDATE_TEXT,
    maxAlignmentCells,
    pageNumber: 7,
    diagnosticObserver: diagnostic => diagnostics.push(diagnostic),
  })
  const diagnostic = diagnostics.at(0)
  if (diagnostic === undefined) throw new Error('expected incumbent diagnostic')
  return { reconciliation, diagnostic }
}

describe('candidate contextual budget propagation', () => {
  test('maps contextual analysis exhaustion to whole-page alignment_budget_exceeded', () => {
    // Given
    const maxAlignmentCells = contextualOneUnderBudget()

    // When
    const result = reconcileGeminiWholePageCandidate({
      ocrText: OCR_TEXT,
      visualText: CANDIDATE_TEXT,
      maxAlignmentCells,
    })

    // Then
    expect(result).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })

  test('maps contextual analysis exhaustion to the shadow budget terminal status', () => {
    // Given
    const maxAlignmentCells = contextualOneUnderBudget()

    // When
    const diagnostic = evaluateContextualPairingShadow({
      pageNumber: 7,
      ocrText: OCR_TEXT,
      candidateText: CANDIDATE_TEXT,
      maxAlignmentCells,
      incumbent: incumbentEvaluation(maxAlignmentCells),
    })

    // Then
    expect(diagnostic.status).toBe('budget_exceeded')
    expect(diagnostic.candidate.trigger).toBe('alignment_budget_exceeded')
  })
})
