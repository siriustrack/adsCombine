export type EnhancedOcrSignals = {
  registryMarkers: number
  legalMarkers: number
  cpfCnpj: number
  dates: number
  currency: number
  fractions: number
  squareMeters: number
  corruptedSymbols: number
  fragmentedNumbersOrMeasures: number
  duplicateLabels: number
  garbledSpans: number
}

export type EnhancedOcrPageMetadata = {
  pageNumber: number
  meanConfidence: number
  wordCount: number
  selectedAttempt: {
    label: string
    psm: number
    rotation?: { angle: number; baselineLabel: string; scoreGain: number }
  }
  legalSignals: EnhancedOcrSignals
  warnings: string[]
}
