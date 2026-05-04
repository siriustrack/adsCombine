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

  test('requires OCR for empty or very short pages', () => {
    const analysis = analyzer.analyzePage('Assinatura');

    expect(analysis.shouldSkipOcr).toBe(false);
    expect(analysis.hasOcrIndicators).toBe(true);
  });

  test('requires OCR for corrupted native text', () => {
    const analysis = analyzer.analyzePage(`${readablePage} �� ��`);

    expect(analysis.shouldSkipOcr).toBe(false);
    expect(analysis.hasOcrIndicators).toBe(true);
  });
});
