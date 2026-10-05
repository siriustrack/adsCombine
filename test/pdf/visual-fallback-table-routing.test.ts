import { describe, expect, test } from 'bun:test'
import { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'
import { selectRiskyPages } from '../../src/core/services/messages/pdf-utils/visual-fallback-page-state'

describe('visual fallback table routing', () => {
  test('does not treat a tabular area heading as a missing measurement', () => {
    const selected = selectRiskyPages([
      {
        pageNumber: 1,
        text: [
          'QUADRO II - Cálculo das Áreas das Unidades Autônomas',
          '19 20 21 22 23 24 25 26 27 28',
          'Ap.n.º36 86,70 86,70 86,70 10,85 10,85 97,55',
        ].join('\n'),
        meanConfidence: 87.55,
        wordCount: 257,
        warnings: [],
        legalSignals: {
          registryMarkers: 0,
          legalMarkers: 0,
          cpfCnpj: 0,
          dates: 0,
          currency: 0,
          fractions: 0,
          squareMeters: 0,
          corruptedSymbols: 0,
          fragmentedNumbersOrMeasures: 0,
          duplicateLabels: 0,
          garbledSpans: 0,
        },
      },
    ])

    expect(selected[0]?.reasons).toEqual(['tabular-layout'])
  })

  test('keeps missing-measure risk for numeric legal prose', () => {
    const selected = selectRiskyPages([
      {
        pageNumber: 1,
        text: [
          'Área do imóvel 120 registrada no Livro 2, Folha 3, ato 4.',
          'Em 10/02/2020 conforme os registros 5, 6 e 7.',
        ].join('\n'),
        legalSignals: {
          registryMarkers: 0,
          legalMarkers: 0,
          cpfCnpj: 0,
          dates: 1,
          currency: 0,
          fractions: 0,
          squareMeters: 0,
          corruptedSymbols: 0,
          fragmentedNumbersOrMeasures: 0,
          duplicateLabels: 0,
          garbledSpans: 0,
        },
      },
    ])

    expect(selected[0]?.reasons).toEqual(['missing-measure'])
  })

  test('keeps prose measurement risk beside an unrelated numeric table', () => {
    const selected = selectRiskyPages([
      {
        pageNumber: 1,
        text: ['Área física do imóvel não informada.', '1 2 3 4 5', 'Linha-A 10 20 30 40 50'].join(
          '\n'
        ),
        tableCount: 1,
        legalSignals: {
          registryMarkers: 0,
          legalMarkers: 0,
          cpfCnpj: 0,
          dates: 0,
          currency: 0,
          fractions: 0,
          squareMeters: 0,
          corruptedSymbols: 0,
          fragmentedNumbersOrMeasures: 0,
          duplicateLabels: 0,
          garbledSpans: 0,
        },
      },
    ])

    expect(selected[0]?.reasons).toEqual(['tabular-layout', 'missing-measure'])
  })

  test('admits a structured table and sends the table profile to the provider', async () => {
    const text = [
      'QUADRO II - Cálculo das Áreas das Unidades Autônomas',
      '19 20 21 22 23 24 25 26 27 28',
      'Ap.n.º36 86,70 86,70 86,70 10,85 10,85 97,55',
    ].join('\n')
    let profileKind: string | undefined
    const service = new VisualFallbackService(
      {
        async renderPages(_buffer, pageNumbers) {
          return pageNumbers.map(pageNumber => ({ pageNumber, image: Buffer.from('page') }))
        },
      },
      {
        async transcribe({ documentProfile }) {
          profileKind = documentProfile?.kind
          return { status: 'transcribed', transcription: text }
        },
      },
      {
        enabled: true,
        shadowMode: false,
        contextualPairingShadowEnabled: false,
        provider: 'gemini',
        model: 'gemini-test',
        timeoutMs: 20,
        maxRetries: 0,
        concurrency: 1,
        maxAlignmentCells: 10_000_000,
        maxPagesPerPdf: 1,
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      }
    )

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'quadro-de-areas.pdf',
      pages: [
        {
          pageNumber: 1,
          text,
          legalSignals: {
            registryMarkers: 0,
            legalMarkers: 0,
            cpfCnpj: 0,
            dates: 0,
            currency: 0,
            fractions: 0,
            squareMeters: 0,
            corruptedSymbols: 0,
            fragmentedNumbersOrMeasures: 0,
            duplicateLabels: 0,
            garbledSpans: 0,
          },
        },
      ],
    })

    expect(profileKind).toBe('tabela')
    expect(result.selectedPageCount).toBe(1)
    expect(result.byPage.get(1)).toMatchObject({
      outcome: 'selected',
      reasons: ['tabular-layout'],
      selectedTextSource: 'visual',
    })
  })
})
