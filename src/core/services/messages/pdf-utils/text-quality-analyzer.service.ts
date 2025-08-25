export interface TextQualityAnalysis {
  shouldSkipOcr: boolean;
  isHighQuality: boolean;
  isRepetitive: boolean;
  hasOcrIndicators: boolean;
  hasSubstantialContent: boolean;
  qualityScore: number;
}

export class TextQualityAnalyzer {
  private readonly QUALITY_THRESHOLDS = {
    MIN_TEXT_LENGTH: 2000,
    MAX_TEXT_FOR_OCR: 75000,
    MIN_WORD_DENSITY: 0.08,
    MAX_WORD_DENSITY: 0.25,
    MIN_ALPHANUMERIC_RATIO: 0.6,
    MAX_REPETITION_RATIO: 0.6,
    MAX_HEADER_RATIO: 0.4,
    MIN_SUBSTANTIAL_CONTENT_INDICATORS: 3,
    MIN_MEANINGFUL_SENTENCE_RATIO: 0.3,
  } as const;

  // Pré-compilar regex para melhor performance
  private readonly CONTENT_INDICATORS = [
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF
    /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/, // CNPJ
    /matrícula\s*n[°º]\s*\d+/i,
    /livro\s*n[°º]\s*\d+/i,
    /R\$\s*[\d.,]+/,
    /\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i,
    /\d{2}\/\d{2}\/\d{4}/,
    /certifico\s+(que|e\s+dou\s+fé)/i,
    /brasileiro\w*,?\s+\w+/i,
  ];

  private readonly HEADER_PATTERNS = [
    /REPÚBLICA FEDERATIVA DO BRASIL/i,
    /COMARCA DE/i,
    /REGISTROS CIVIS/i,
    /Página \d+ de \d+/i,
    /Certidão de/i,
    /Oficial Titular/i,
    /Telefone/i,
    /WhatsApp/i
  ];

  analyze(extractedText: string): TextQualityAnalysis {
    if (!extractedText || extractedText.trim().length === 0) {
      return {
        shouldSkipOcr: false,
        isHighQuality: false,
        isRepetitive: false,
        hasOcrIndicators: false,
        hasSubstantialContent: false,
        qualityScore: 0,
      };
    }

    const textLength = extractedText.length;
    
    // Early return para textos muito pequenos - sempre fazer OCR
    if (textLength < this.QUALITY_THRESHOLDS.MIN_TEXT_LENGTH) {
      return {
        shouldSkipOcr: false,
        isHighQuality: false,
        isRepetitive: false,
        hasOcrIndicators: true,
        hasSubstantialContent: false,
        qualityScore: 10,
      };
    }

    // Análise otimizada em uma passada
    const analysis = this.performSinglePassAnalysis(extractedText);
    
    // Decisão sobre OCR baseada na análise
    let shouldSkipOcr = false;
    
    if (analysis.isRepetitive || analysis.hasOcrIndicators) {
      shouldSkipOcr = false;
    } else if (textLength < 10000) {
      shouldSkipOcr = analysis.isHighQuality && analysis.hasSubstantialContent;
    } else if (textLength > this.QUALITY_THRESHOLDS.MAX_TEXT_FOR_OCR) {
      shouldSkipOcr = analysis.isHighQuality && analysis.hasSubstantialContent;
    } else {
      shouldSkipOcr = analysis.isHighQuality && analysis.hasSubstantialContent && !analysis.isRepetitive;
    }

    const qualityScore = this.calculateQualityScore(
      textLength,
      analysis.isHighQuality,
      analysis.isRepetitive,
      analysis.hasOcrIndicators,
      analysis.hasSubstantialContent
    );

    return {
      shouldSkipOcr,
      isHighQuality: analysis.isHighQuality,
      isRepetitive: analysis.isRepetitive,
      hasOcrIndicators: analysis.hasOcrIndicators,
      hasSubstantialContent: analysis.hasSubstantialContent,
      qualityScore,
    };
  }

  private performSinglePassAnalysis(text: string) {
    const cleanText = text.trim();
    
    // Verificações rápidas primeiro
    if (/[��]/.test(cleanText)) {
      return {
        isHighQuality: false,
        isRepetitive: false,
        hasOcrIndicators: true,
        hasSubstantialContent: false,
      };
    }

    const totalChars = cleanText.length;
    const lines = cleanText.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 5);
    
    // Early return se muito poucas linhas
    if (nonEmptyLines.length < 3) {
      return {
        isHighQuality: false,
        isRepetitive: false,
        hasOcrIndicators: true,
        hasSubstantialContent: false,
      };
    }

    // Análise de repetitividade
    const uniqueLines = new Set(nonEmptyLines.map(line => line.trim()));
    const isRepetitive = ((nonEmptyLines.length - uniqueLines.size) / nonEmptyLines.length) > this.QUALITY_THRESHOLDS.MAX_REPETITION_RATIO;

    // Análise de conteúdo e cabeçalhos
    const { contentMatches, headerMatches } = this.analyzeLineContent(nonEmptyLines);
    
    // Análise de caracteres
    const { spaceCount, alphanumericCount } = this.analyzeCharacters(cleanText);
    
    // Análise de indicadores OCR
    const { fragmentedWords, isolatedNumbers } = this.analyzeOcrIndicators(cleanText);

    // Cálculos finais
    const spaceDensity = spaceCount / totalChars;
    const alphanumericRatio = alphanumericCount / totalChars;
    const headerRatio = headerMatches / nonEmptyLines.length;
    const approximateWords = Math.max(1, totalChars / 5);
    const wordDensity = approximateWords / totalChars;

    const isHighQuality = 
      alphanumericRatio > this.QUALITY_THRESHOLDS.MIN_ALPHANUMERIC_RATIO &&
      wordDensity >= this.QUALITY_THRESHOLDS.MIN_WORD_DENSITY &&
      wordDensity <= this.QUALITY_THRESHOLDS.MAX_WORD_DENSITY;

    const hasOcrIndicators = 
      fragmentedWords > 10 ||
      isolatedNumbers > 20 ||
      spaceDensity > 0.4;

    const hasSubstantialContent = 
      contentMatches >= this.QUALITY_THRESHOLDS.MIN_SUBSTANTIAL_CONTENT_INDICATORS &&
      headerRatio <= this.QUALITY_THRESHOLDS.MAX_HEADER_RATIO;

    return {
      isHighQuality,
      isRepetitive,
      hasOcrIndicators,
      hasSubstantialContent,
    };
  }

  private analyzeLineContent(lines: string[]) {
    let contentMatches = 0;
    let headerMatches = 0;
    
    for (const line of lines) {
      // Verificar indicadores de conteúdo
      for (const pattern of this.CONTENT_INDICATORS) {
        if (pattern.test(line)) {
          contentMatches++;
          break;
        }
      }
      
      // Verificar cabeçalhos
      for (const pattern of this.HEADER_PATTERNS) {
        if (pattern.test(line)) {
          headerMatches++;
          break;
        }
      }
    }
    
    return { contentMatches, headerMatches };
  }

  private analyzeCharacters(text: string) {
    let spaceCount = 0;
    let alphanumericCount = 0;
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === ' ') spaceCount++;
      if (/[a-zA-Z0-9À-ÿ]/.test(char)) alphanumericCount++;
    }
    
    return { spaceCount, alphanumericCount };
  }

  private analyzeOcrIndicators(text: string) {
    const fragmentedMatches = text.match(/\b[a-zA-ZÀ-ÿ]\s+[a-zA-ZÀ-ÿ]\s+[a-zA-ZÀ-ÿ]/g);
    const isolatedNumberMatches = text.match(/\b\d\b/g);
    
    return {
      fragmentedWords: fragmentedMatches ? fragmentedMatches.length : 0,
      isolatedNumbers: isolatedNumberMatches ? isolatedNumberMatches.length : 0,
    };
  }

  private calculateQualityScore(
    textLength: number,
    isHighQuality: boolean,
    isRepetitive: boolean,
    hasOcrIndicators: boolean,
    hasSubstantialContent: boolean
  ): number {
    let score = 0;

    if (isHighQuality) score += 40;
    if (hasSubstantialContent) score += 30;
    if (!isRepetitive) score += 20;
    if (!hasOcrIndicators) score += 10;

    // Bonus por tamanho adequado
    if (textLength > 1000 && textLength < 50000) {
      score += 10;
    }

    return Math.min(100, score);
  }
}
