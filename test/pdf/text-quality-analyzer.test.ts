import { describe, expect, test } from 'bun:test';
import { TextQualityAnalyzer } from '../../src/core/services/messages/pdf-utils/text-quality-analyzer.service';

const readablePage = [
  'Certifico que a matrícula número 12345 contém averbação regular em 01/02/2026.',
  'O imóvel possui descrição, qualificação das partes e valor declarado de R$ 1.234,56.',
  'Esta página tem texto nativo legível suficiente para ser usada sem OCR adicional.',
]
  .join(' ')
  .repeat(6);

describe('TextQualityAnalyzer page calibration', () => {
  const analyzer = new TextQualityAnalyzer();

  test('accepts readable native page text without OCR', () => {
    const analysis = analyzer.analyzePage(readablePage);

    expect(analysis.shouldSkipOcr).toBe(true);
    expect(analysis.isHighQuality).toBe(true);
    expect(analysis.hasOcrIndicators).toBe(false);
  });

  test('returns page diagnostics while preserving analyzePage compatibility', () => {
    const diagnostics = analyzer.analyzePageDiagnostics(readablePage);

    expect(diagnostics.textLength).toBe(readablePage.length);
    expect(diagnostics.trimmedLength).toBe(readablePage.trim().length);
    expect(diagnostics.wordCount).toBeGreaterThanOrEqual(80);
    expect(diagnostics.alphanumericRatio).toBeGreaterThan(0.55);
    expect(diagnostics.whitespaceRatio).toBeGreaterThan(0);
    expect(diagnostics.spaceDensity).toBeGreaterThan(0);
    expect(diagnostics.repetitionRatio).toBe(0);
    expect(diagnostics.hasReplacementCharacters).toBe(false);
    expect(diagnostics.classification).toBe('native-text');
    expect(diagnostics.qualityAnalysis).toEqual(analyzer.analyzePage(readablePage));
  });

  test('requires OCR for empty or very short pages', () => {
    const analysis = analyzer.analyzePage('Assinatura');

    expect(analysis.shouldSkipOcr).toBe(false);
    expect(analysis.hasOcrIndicators).toBe(true);

    const diagnostics = analyzer.analyzePageDiagnostics('Assinatura');
    expect(diagnostics.classification).toBe('short-text');
    expect(diagnostics.trimmedLength).toBe('Assinatura'.length);
    expect(diagnostics.qualityAnalysis).toEqual(analysis);
  });

  test('classifies empty pages without changing OCR selection analysis', () => {
    const diagnostics = analyzer.analyzePageDiagnostics('   \n\t');

    expect(diagnostics.classification).toBe('empty');
    expect(diagnostics.textLength).toBe(5);
    expect(diagnostics.trimmedLength).toBe(0);
    expect(diagnostics.wordCount).toBe(0);
    expect(diagnostics.qualityAnalysis).toEqual(analyzer.analyzePage('   \n\t'));
  });

  test('requires OCR for corrupted native text', () => {
    const analysis = analyzer.analyzePage(`${readablePage} �� ��`);

    expect(analysis.shouldSkipOcr).toBe(false);
    expect(analysis.hasOcrIndicators).toBe(true);

    const diagnostics = analyzer.analyzePageDiagnostics(`${readablePage} �� ��`);
    expect(diagnostics.classification).toBe('corrupted-text');
    expect(diagnostics.hasReplacementCharacters).toBe(true);
    expect(diagnostics.qualityAnalysis).toEqual(analysis);
  });

  test('classifies repetitive page text as an OCR candidate signal', () => {
    const repetitiveText = Array.from(
      { length: 80 },
      () => 'LINHA REPETIDA COM CONTEUDO NATIVO 12345'
    ).join('\n');
    const diagnostics = analyzer.analyzePageDiagnostics(repetitiveText);

    expect(diagnostics.classification).toBe('repetitive-text');
    expect(diagnostics.repetitionRatio).toBeGreaterThan(0.65);
    expect(diagnostics.qualityAnalysis.isRepetitive).toBe(true);
    expect(diagnostics.qualityAnalysis).toEqual(analyzer.analyzePage(repetitiveText));
  });
});
