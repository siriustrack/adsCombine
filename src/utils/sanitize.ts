export function sanitize(input: string | undefined | null): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\s+/g, ' ') // Replace multiple whitespace chars with a single space
    .trim();
}
