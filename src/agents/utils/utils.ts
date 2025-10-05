// Utilitários para validações e sanitização
import moment from 'moment';

export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return '';
  // Remover scripts e HTML
  return input.replace(/<script[^>]*>.*?<\/script>/gis, '').replace(/<[^>]+>/g, '').trim();
}

export function validateUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

export function validateDate(dateStr: string): boolean {
  return moment(dateStr, 'YYYY-MM-DD', true).isValid();
}

export function parseDate(dateStr: string): string | null {
  const parsed = moment(dateStr, ['DD/MM/YYYY', 'YYYY-MM-DD'], true);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

export function parseEnum<T extends Record<string, string | number>>(value: string, enumObj: T): T[keyof T] | null {
  const values = Object.values(enumObj) as (string | number)[];
  return values.includes(value) ? (value as T[keyof T]) : null;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function isEmpty(value: any): boolean {
  if (value == null) return true;
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}