import {
  sanitizeInput,
  validateUUID,
  estimateTokens,
  validateDate,
  parseDate,
  parseEnum,
  deepClone,
  isEmpty,
} from '../utils';

describe('Utils', () => {
  describe('sanitizeInput', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeInput('<script>alert("xss")</script>Hello <b>world</b>')).toBe('Hello world');
    });

    it('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    it('should return empty string for non-string input', () => {
      expect(sanitizeInput(123 as any)).toBe('');
    });
  });

  describe('validateUUID', () => {
    it('should validate correct UUID', () => {
      expect(validateUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    });

    it('should invalidate incorrect UUID', () => {
      expect(validateUUID('invalid-uuid')).toBe(false);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens correctly', () => {
      expect(estimateTokens('hello')).toBe(2); // 5 chars / 4 ≈ 1.25, ceil to 2
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('validateDate', () => {
    it('should validate correct date', () => {
      expect(validateDate('2023-12-25')).toBe(true);
    });

    it('should invalidate incorrect date', () => {
      expect(validateDate('2023-13-45')).toBe(false); // Moment pode aceitar isso, vamos testar com uma string claramente inválida
      expect(validateDate('not-a-date')).toBe(false);
    });
  });

  describe('parseDate', () => {
    it('should parse DD/MM/YYYY format', () => {
      expect(parseDate('25/12/2023')).toBe('2023-12-25');
    });

    it('should parse YYYY-MM-DD format', () => {
      expect(parseDate('2023-12-25')).toBe('2023-12-25');
    });

    it('should return null for invalid date', () => {
      expect(parseDate('not-a-date')).toBe(null);
      expect(parseDate('99/99/9999')).toBe(null);
    });
  });

  describe('parseEnum', () => {
    enum TestEnum {
      A = 'a',
      B = 'b',
    }

    it('should parse valid enum value', () => {
      expect(parseEnum('a', TestEnum)).toBe('a');
    });

    it('should return null for invalid enum value', () => {
      expect(parseEnum('c', TestEnum)).toBe(null);
    });
  });

  describe('deepClone', () => {
    it('should deep clone object', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });
  });

  describe('isEmpty', () => {
    it('should detect empty values', () => {
      expect(isEmpty(null)).toBe(true);
      expect(isEmpty(undefined)).toBe(true);
      expect(isEmpty('')).toBe(true);
      expect(isEmpty([])).toBe(true);
      expect(isEmpty({})).toBe(true);
    });

    it('should detect non-empty values', () => {
      expect(isEmpty('hello')).toBe(false);
      expect(isEmpty([1])).toBe(false);
      expect(isEmpty({ a: 1 })).toBe(false);
    });
  });
});