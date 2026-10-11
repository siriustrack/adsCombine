export interface TextQualityAnalysis {
  shouldSkipOcr: boolean
  isHighQuality: boolean
  isRepetitive: boolean
  hasOcrIndicators: boolean
  hasSubstantialContent: boolean
  qualityScore: number
}

export type PageTextClassification =
  | 'empty'
  | 'short-text'
  | 'corrupted-text'
  | 'repetitive-text'
  | 'native-text'
  | 'ocr-candidate'

export interface PageTextDiagnostics {
  textLength: number
  trimmedLength: number
  wordCount: number
  alphanumericRatio: number
  whitespaceRatio: number
  spaceDensity: number
  repetitionRatio: number
  hasReplacementCharacters: boolean
  classification: PageTextClassification
  qualityAnalysis: TextQualityAnalysis
}
