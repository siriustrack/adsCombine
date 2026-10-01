export function sanitize(input: string | undefined | null): string {
  if (typeof input !== 'string') return ''
  return input.replace(/\s+/g, ' ').trim()
}

export function sanitizePdfText(input: string | undefined | null): string {
  if (typeof input !== 'string') return ''

  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\p{Cc}/gu, character => (character === '\n' || character === '\t' ? character : ''))
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
