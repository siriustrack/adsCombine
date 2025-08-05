export function sanitize(input: string | undefined | null): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/\s+/g, ' ') 
    .trim();
}
