import { describe, expect, test } from 'bun:test';
import { sanitize, sanitizePdfText } from '../../src/utils/sanitize';

describe('sanitize', () => {
  test('keeps generic whitespace normalization unchanged', () => {
    expect(sanitize('  campo\n\nvalor\tfinal  ')).toBe('campo valor final');
  });

  test('preserves meaningful PDF line and page breaks', () => {
    expect(sanitizePdfText('  R.18\tCompra\r\n\r\n\r\nAV.20  Área  ')).toBe(
      'R.18 Compra\n\nAV.20 Área'
    );
  });
});
