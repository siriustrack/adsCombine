const REDACTED_QUERY_MARKER = '[redacted-query]'
const INVALID_URL_PLACEHOLDER = '[invalid-url]'

export function redactUrl(url: string): string {
  try {
    const parsedUrl = new URL(url)
    const query = parsedUrl.search ? `?${REDACTED_QUERY_MARKER}` : ''
    return `${parsedUrl.origin}/[redacted-path]${query}`
  } catch {
    return INVALID_URL_PLACEHOLDER
  }
}
