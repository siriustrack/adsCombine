import { describe, expect, test } from 'bun:test'
import { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

const legalSignals = {
  registryMarkers: 1,
  legalMarkers: 1,
  cpfCnpj: 0,
  dates: 0,
  currency: 0,
  fractions: 0,
  squareMeters: 1,
  corruptedSymbols: 0,
  fragmentedNumbersOrMeasures: 1,
  duplicateLabels: 0,
  garbledSpans: 0,
}

function createService(transcription: string) {
  return new VisualFallbackService(
    {
      async renderPages(_buffer, pageNumbers) {
        return pageNumbers.map(pageNumber => ({ pageNumber, image: Buffer.from('page') }))
      },
    },
    {
      async transcribe() {
        return { status: 'transcribed', transcription }
      },
    },
    {
      enabled: true,
      shadowMode: false,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 0,
      concurrency: 1,
      maxPagesPerPdf: 2,
    }
  )
}

describe('VisualFallbackService reconciliation', () => {
  test('returns promoted visual text only through the internal accepted-page map', async () => {
    const prefix = 'Registro descritivo do imóvel urbano localizado nesta comarca. '
    const visualText = `${prefix}Matrícula nº 12.345, área 408.737 m².`
    const result = await createService(visualText).execute({
      buffer: Buffer.from('pdf'),
      fileName: 'documento-generico.pdf',
      pages: [
        {
          pageNumber: 1,
          text: `${prefix}Matrícula nº 12.345, área 408.737 m ².`,
          meanConfidence: 85.12,
          legalSignals,
        },
      ],
    })

    expect(result.acceptedVisualTextByPage.get(1)).toBe(visualText)
    expect(result.byPage.get(1)).toMatchObject({
      state: 'reconciled',
      policyVersion: 'safe-visual-v1',
      decisionReason: 'safe_structural_repair',
      selectedTextSource: 'visual',
      comparison: { protectedFieldsMatch: true },
    })
    expect(result.byPage.get(1)).not.toHaveProperty('candidateText')
  })

  test('marks risky pages skipped by the shared budget as unresolved', async () => {
    const result = await createService('unused').execute({
      buffer: Buffer.from('pdf'),
      fileName: 'generic.pdf',
      pages: [{ pageNumber: 1, text: 'texto', legalSignals: { ...legalSignals, garbledSpans: 1 } }],
      pageBudget: { reserve: () => false, remaining: () => 0 },
    })

    expect(result.byPage.get(1)).toMatchObject({
      state: 'fallback_failed',
      decisionReason: 'budget_exhausted',
      reasons: ['fragmented-number-or-measure', 'garbled-spans'],
    })
  })
})
