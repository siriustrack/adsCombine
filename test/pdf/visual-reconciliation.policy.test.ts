import { describe, expect, test } from 'bun:test'
import {
  measureBoundedEditDistanceForTest,
  reconcileVisualText,
  SAFE_VISUAL_POLICY_VERSION,
} from '../../src/core/services/messages/pdf-utils/visual-reconciliation.policy'

const stablePrefix = 'Registro descritivo do imóvel urbano localizado nesta comarca. '

describe('safe-visual-v1 reconciliation policy', () => {
  test('retains OCR when texts are equal after conservative normalization', () => {
    const result = reconcileVisualText({
      ocrText: 'Cafe\u0301\r\nR.22\u00ad',
      visualText: 'Café\nR.22',
      ocrConfidence: 87.47,
    })

    expect(result).toEqual({
      policyVersion: SAFE_VISUAL_POLICY_VERSION,
      decision: 'retain_ocr',
      decisionReason: 'equal_normalized_text',
      comparison: { similarityBps: 10_000, editDistance: 0, protectedFieldsMatch: true },
    })
  })

  test('promotes only a high-alignment structural fragmentation repair', () => {
    const result = reconcileVisualText({
      ocrText: `${stablePrefix}Matrícula nº 12.345, área 408.737 m ².`,
      visualText: `${stablePrefix}Matrícula nº 12.345, área 408.737 m².`,
      ocrConfidence: 85.12,
    })

    expect(result.decision).toBe('promote_visual')
    expect(result.decisionReason).toBe('safe_structural_repair')
    expect(result.comparison.protectedFieldsMatch).toBe(true)
    expect(result.comparison.similarityBps).toBeGreaterThanOrEqual(9_900)
  })

  test.each([
    ['number', 'Matrícula nº 12.345 em 10/09/2026.', 'Matrícula nº 12.346 em 10/09/2026.'],
    ['date', 'Matrícula nº 12.345 em 10/09/2026.', 'Matrícula nº 12.345 em 11/09/2026.'],
    ['negation', 'O imóvel não possui ônus.', 'O imóvel possui ônus.'],
    ['registry marker', 'R.22 - compra e venda.', 'AV.22 - compra e venda.'],
  ])('returns conflict for a protected %s change', (_label, ocrText, visualText) => {
    const result = reconcileVisualText({ ocrText, visualText, ocrConfidence: 99 })

    expect(result.decision).toBe('conflict')
    expect(result.comparison.protectedFieldsMatch).toBe(false)
  })

  test.each([
    ['truncation', `${stablePrefix}texto final obrigatório`, stablePrefix],
    ['addition', stablePrefix, `${stablePrefix}conteúdo visual adicionado`],
  ])('rejects candidate content %s', (_label, ocrText, visualText) => {
    expect(reconcileVisualText({ ocrText, visualText, ocrConfidence: 99 }).decision).toBe(
      'conflict'
    )
  })

  test('does not promote changed text below alignment confidence', () => {
    const result = reconcileVisualText({
      ocrText: `${stablePrefix}área 408.737 m ²`,
      visualText: `${stablePrefix}área 408.737 m²`,
      ocrConfidence: 69.99,
    })

    expect(result.decision).toBe('conflict')
    expect(result.decisionReason).toBe('ocr_confidence_below_alignment_floor')
  })

  test('bounds edit-distance work by the configured band for 32 KiB inputs', () => {
    const left = `${'a'.repeat(32_767)}x`
    const right = `${'a'.repeat(32_767)}y`
    const maximumDistance = 20

    const measured = measureBoundedEditDistanceForTest(left, right, maximumDistance)

    expect(measured.distance).toBe(1)
    expect(measured.operations).toBeLessThanOrEqual(left.length * (maximumDistance * 2 + 1))
    expect(measureBoundedEditDistanceForTest(left, left, maximumDistance).operations).toBe(0)
  })
})
