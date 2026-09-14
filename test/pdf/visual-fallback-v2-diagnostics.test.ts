import { describe, expect, test } from 'bun:test'
import {
  buildDocumentFurnitureProfile,
  type PageFurnitureProfile,
} from '../../src/core/services/messages/pdf-utils/gemini-page-furniture'
import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'
import type { VisualFallbackV2Diagnostic } from '../../src/core/services/messages/pdf-utils/visual-fallback.diagnostics'
import logger from '../../src/lib/logger'
import { createVisualFallbackService, visualFallbackPage } from './visual-fallback.test-support'

const MAX_CELLS = 10_000_000

function reconcileWithDiagnostics(input: {
  ocrText: string
  visualText: string
  maxAlignmentCells?: number
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

function rangeFixture(count: number) {
  return {
    ocrText: Array.from(
      { length: count },
      (_, index) => `R.${index + 1} item${index} valor 100`
    ).join('; '),
    visualText: Array.from(
      { length: count },
      (_, index) => `R.${index + 1} item${index} valor ${index + 200}`
    ).join('; '),
  }
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

function expectPrivateContentAbsent(diagnostic: VisualFallbackV2Diagnostic, sentinels: string[]) {
  const serialized = JSON.stringify(diagnostic)
  for (const forbidden of [
    ...sentinels,
    'candidateText',
    'prompt',
    'marker',
    'signature',
    'normalized',
    'fileName',
    'url',
    'Sha256',
  ]) {
    expect(serialized).not.toContain(forbidden)
  }
}

describe('privacy-safe V2 reconciliation diagnostics', () => {
  test.each([
    {
      label: 'region pairing ambiguity',
      expected: 'region_pairing_ambiguous',
      ocrText: 'R.22 ato comum valor 10; R.22 ato comum valor 20;',
      visualText: 'R.22 ato comum valor 20; R.22 ato comum valor 10;',
    },
    {
      label: 'critical order with unequal cardinality',
      expected: 'critical_cardinality_mismatch',
      ocrText: 'valor 10; valor 20.',
      visualText: 'valor 20; valor 10; valor 30.',
    },
  ] as const)('reports the exact full-page cause for $label', fixture => {
    const { result, diagnostic } = reconcileWithDiagnostics(fixture)

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'page' }),
    ])
    expect(diagnostic.trigger).toBe(fixture.expected)
    expect(diagnostic).toMatchObject({ pageNumber: 2, section: 'body' })
  })

  test('reports range aggregation overflow without exposing range contents', () => {
    const { diagnostic } = reconcileWithDiagnostics(rangeFixture(33))

    expect(diagnostic).toMatchObject({
      trigger: 'range_limit_exceeded',
      rangesBeforeAggregation: 33,
      rangesAfterAggregation: 1,
    })
  })

  test('reports alignment budget rejection once', () => {
    const { result, diagnostic } = reconcileWithDiagnostics({
      ocrText: 'valor 10',
      visualText: 'valor 11',
      maxAlignmentCells: 4,
    })

    expect(result).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
    expect(diagnostic.trigger).toBe('alignment_budget_exceeded')
  })

  test('reports active furniture on body-local granular success', () => {
    const pages = [1, 2, 3].map(pageNumber => ({
      pageNumber,
      text: [
        'CABEÇALHO FIXO',
        `Página ${pageNumber} de 3`,
        `R.${pageNumber} corpo valor ${pageNumber * 10}.`,
        'linha final',
        'base fixa',
        'rodapé fixo',
      ].join('\n'),
    }))
    const ocrText = pages[1].text
    const { diagnostic } = reconcileWithDiagnostics({
      ocrText,
      visualText: ocrText.replace('valor 20', 'valor 21'),
      furnitureProfile: buildDocumentFurnitureProfile(pages).get(2),
    })

    expect(diagnostic).toMatchObject({
      trigger: 'localized',
      furnitureActive: true,
      confirmedTopCount: 2,
      confirmedBottomCount: 2,
    })
  })

  test('localizes one marked residual pair forced into the same monotonic anchor slot', () => {
    // Given
    const ocrBody =
      'R.1 âncora 🧾 alfa valor 10; R.22 cláusula antiga valor 20; AV.3 âncora ômega valor 30.'
    const visualBody =
      'R.1 âncora 🧾 alfa valor 10; R.23 cláusula revisada valor 21; AV.3 âncora ômega valor 30.'
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
      confirmedTopCount: 2,
      confirmedBottomCount: 2,
      pairedRegionCount: 5,
      unpairedOcrRegionCount: 0,
      unpairedGeminiRegionCount: 0,
    })
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toEqual(['R.23', '21'])
    expect(
      result.ocrCriticalUncertainties.map(range => ocrText.slice(range.start, range.end))
    ).toEqual(['R.22', '20'])
  })

  test('fails closed when single marked residuals occupy different anchor slots', () => {
    // Given
    const ocrBody =
      'R.1 âncora alfa valor 10; R.22 cláusula antiga valor 20; AV.3 âncora ômega valor 30.'
    const visualBody =
      'R.23 cláusula revisada valor 21; R.1 âncora alfa valor 10; AV.3 âncora ômega valor 30.'
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
      unpairedOcrRegionCount: 1,
      unpairedGeminiRegionCount: 1,
    })
  })

  test('fails closed when a monotonic anchor slot contains multiple residuals', () => {
    // Given
    const ocrBody =
      'R.1 âncora alfa valor 10; R.22 cláusula antiga valor 20; AV.8 averbação antiga valor 40; AV.99 âncora ômega valor 90.'
    const visualBody =
      'R.1 âncora alfa valor 10; R.23 cláusula revisada valor 21; AV.9 averbação revisada valor 41; AV.99 âncora ômega valor 90.'
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
      unpairedOcrRegionCount: 2,
      unpairedGeminiRegionCount: 2,
    })
  })

  test('fails closed for a marked residual one-to-one without an established anchor', () => {
    // Given
    const ocrText = 'R.22 cláusula antiga valor 20.'
    const visualText = 'R.23 cláusula revisada valor 21.'

    // When
    const { result, diagnostic } = reconcileWithDiagnostics({ ocrText, visualText })

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
      pairedRegionCount: 0,
      unpairedOcrRegionCount: 1,
      unpairedGeminiRegionCount: 1,
    })
  })

  test('keeps a structurally unique top cardinality mismatch localized', () => {
    const pages = furniturePages('PRIVATE_TOP_BODY valor 30.')
    const ocrText = pages[1].text
    const { result, diagnostic } = reconcileWithDiagnostics({
      ocrText,
      visualText: ocrText.replace('CABEÇALHO valor 10', 'CABEÇALHO valor 11 e 20'),
      furnitureProfile: buildDocumentFurnitureProfile(pages).get(2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'clause' }),
    ])
    expect(diagnostic).toMatchObject({ trigger: 'localized', section: 'page' })
    expectPrivateContentAbsent(diagnostic, ['PRIVATE_TOP_BODY', 'CABEÇALHO valor 10'])
  })

  test('preserves the body section for an unsafe-hunk page projection', () => {
    const pages = furniturePages('não PRIVATE_BODY existe saldo fim.')
    const ocrText = pages[1].text
    const { result, diagnostic } = reconcileWithDiagnostics({
      ocrText,
      visualText: ocrText.replace(
        'não PRIVATE_BODY existe saldo fim.',
        'PRIVATE_VISUAL_BODY existe saldo fim.'
      ),
      furnitureProfile: buildDocumentFurnitureProfile(pages).get(2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'page' }),
    ])
    expect(diagnostic).toMatchObject({ trigger: 'unsafe_hunk_projection', section: 'body' })
    expectPrivateContentAbsent(diagnostic, ['PRIVATE_BODY', 'PRIVATE_VISUAL_BODY'])
  })

  test('reports unavailable furniture evidence without changing reconciliation', () => {
    const { result, diagnostic } = reconcileWithDiagnostics({
      ocrText: 'corpo valor 10.',
      visualText: 'corpo valor 11.',
      furnitureProfile: { top: [], bottom: [] },
    })

    expect(result.status).toBe('selected')
    expect(diagnostic).toMatchObject({
      trigger: 'furniture_profile_unavailable_or_ambiguous',
      furnitureActive: false,
      confirmedTopCount: 0,
      confirmedBottomCount: 0,
    })
  })

  test('isolates observer exceptions from reconciliation decisions', () => {
    const input = { ocrText: 'valor 10.', visualText: 'valor 11.', maxAlignmentCells: MAX_CELLS }
    const baseline = reconcileGeminiWholePage(input)

    expect(
      reconcileGeminiWholePage({
        ...input,
        diagnosticObserver() {
          throw new Error('PRIVATE_OBSERVER_SENTINEL')
        },
      })
    ).toEqual(baseline)
  })

  test('logs exactly one bounded terminal event per evaluated page without private content', async () => {
    const captured: unknown[] = []
    const originalWrite = logger.write
    logger.write = ((info: unknown, ...args: unknown[]) => {
      if (
        typeof info === 'object' &&
        info !== null &&
        'message' in info &&
        info.message === 'Visual fallback V2 reconciliation evaluated'
      ) {
        captured.push(info)
      }
      return (originalWrite as (...writeArgs: unknown[]) => unknown).apply(logger, [info, ...args])
    }) as typeof logger.write
    try {
      const pages = [1, 2, 3].map(pageNumber =>
        visualFallbackPage({
          pageNumber,
          text: `PRIVATE_OCR_${pageNumber} valor ${pageNumber * 10}.`,
          legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
        })
      )
      const { service } = createVisualFallbackService(
        {
          async transcribe({ pageNumber }) {
            return {
              status: 'transcribed',
              transcription: `PRIVATE_GEMINI_${pageNumber} valor 99.`,
            }
          },
        },
        {
          reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
          maxPagesPerPdf: 3,
          concurrency: 2,
        }
      )
      await service.execute({
        buffer: Buffer.from('PRIVATE_IMAGE_SENTINEL'),
        fileName: 'PRIVATE_FILENAME_SENTINEL.pdf',
        pages,
      })
    } finally {
      logger.write = originalWrite
    }

    expect(captured).toHaveLength(3)
    expect(
      captured.map(event => (event as { pageNumber: number }).pageNumber).sort((a, b) => a - b)
    ).toEqual([1, 2, 3])
    const serialized = JSON.stringify(captured)
    for (const forbidden of [
      'PRIVATE_OCR_',
      'PRIVATE_GEMINI_',
      'PRIVATE_IMAGE_SENTINEL',
      'PRIVATE_FILENAME_SENTINEL',
      'candidateText',
      'prompt',
      'imageSha256',
      'candidateSha256',
      'normalized',
      'url',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
