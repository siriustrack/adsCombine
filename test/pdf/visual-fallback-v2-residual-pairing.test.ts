import { describe, expect, test } from 'bun:test'
import {
  buildDocumentFurnitureProfile,
  type PageFurnitureProfile,
} from '../../src/core/services/messages/pdf-utils/gemini-page-furniture'
import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'

const MAX_CELLS = 10_000_000

function reconcileWithDiagnostics(input: {
  ocrText: string
  visualText: string
  furnitureProfile?: PageFurnitureProfile
}) {
  const diagnostics: VisualFallbackV2Diagnostic[] = []
  const result = reconcileGeminiWholePage({
    maxAlignmentCells: MAX_CELLS,
    pageNumber: 2,
    ...input,
    diagnosticObserver: diagnostic => diagnostics.push(diagnostic),
  })
  expect(diagnostics).toHaveLength(1)
  return { result, diagnostic: diagnostics[0] }
}

function furniturePages(body: string) {
  return [1, 2, 3].map(pageNumber => ({
    pageNumber,
    text: [
      'CABEÇALHO valor 10',
      `Página ${pageNumber} de 3`,
      body,
      'linha final',
      'base fixa',
      'rodapé fixo',
    ].join('\n'),
  }))
}

describe('V2 residual region pairing', () => {
  test('localizes one unmarked prefix residual forced into the same monotonic anchor slot', () => {
    // Given
    const ocrBody = 'preamble legacy valor 10; R.1 anchor alpha; AV.3 anchor omega.'
    const visualBody = 'preamble revised valor 11; R.1 anchor alpha; AV.3 anchor omega.'
    const pages = furniturePages(ocrBody)
    const ocrText = pages[1].text
    const visualText = ocrText.replace(ocrBody, visualBody)
    const furnitureProfile = buildDocumentFurnitureProfile(pages).get(2)

    // When
    const { result, diagnostic } = reconcileWithDiagnostics({
      ocrText,
      visualText,
      furnitureProfile,
    })

    // Then
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(diagnostic).toMatchObject({
      trigger: 'localized',
      furnitureActive: true,
      pairedRegionCount: 5,
      unpairedOcrRegionCount: 0,
      unpairedGeminiRegionCount: 0,
    })
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toEqual(['11'])
    expect(
      result.ocrCriticalUncertainties.map(range => ocrText.slice(range.start, range.end))
    ).toEqual(['10'])
  })

  test('fails closed for asymmetric prefix residual cardinality', () => {
    // Given
    const ocrBody = 'preamble legacy valor 10; R.1 anchor alpha; AV.3 anchor omega.'
    const visualBody =
      'preamble revised valor 11; R.1 anchor alpha; AV.3 anchor omega; AV.9 extra marker.'
    const pages = furniturePages(ocrBody)
    const ocrText = pages[1].text
    const visualText = ocrText.replace(ocrBody, visualBody)

    // When
    const { result, diagnostic } = reconcileWithDiagnostics({
      ocrText,
      visualText,
      furnitureProfile: buildDocumentFurnitureProfile(pages).get(2),
    })

    // Then
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ start: 0, end: visualText.length, scope: 'page' }),
    ])
    expect(result.ocrCriticalUncertainties).toEqual([
      expect.objectContaining({ start: 0, end: ocrText.length, scope: 'page' }),
    ])
    expect(diagnostic).toMatchObject({
      trigger: 'region_pairing_ambiguous',
      section: 'body',
      furnitureActive: true,
      pairedRegionCount: 4,
      unpairedOcrRegionCount: 1,
      unpairedGeminiRegionCount: 2,
    })
  })
})
