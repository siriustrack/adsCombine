import { VisualFallbackService } from '../../src/core/services/messages/pdf-utils/visual-fallback.service'

export const legalSignals = {
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

export function createService(transcription: string) {
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
      contextualPairingShadowEnabled: false,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 0,
      concurrency: 1,
      maxAlignmentCells: 10_000_000,
      maxPagesPerPdf: 2,
    }
  )
}

export function createV2Service(
  transcription: string,
  options: { shadowMode?: boolean; provider?: 'gemini' | 'deepseek' } = {}
) {
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
      shadowMode: options.shadowMode ?? false,
      contextualPairingShadowEnabled: false,
      provider: options.provider ?? 'gemini',
      model: 'gemini-2.5-flash',
      timeoutMs: 20,
      maxRetries: 0,
      concurrency: 1,
      maxAlignmentCells: 10_000_000,
      maxPagesPerPdf: 2,
      reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
    }
  )
}
