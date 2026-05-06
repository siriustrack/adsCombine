const REDACTED_QUERY_MARKER = '[redacted-query]';
const INVALID_URL_PLACEHOLDER = '[invalid-url]';

export function redactUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);

    if (!parsedUrl.search) {
      return parsedUrl.toString();
    }

    return `${parsedUrl.origin}${parsedUrl.pathname}?${REDACTED_QUERY_MARKER}${parsedUrl.hash}`;
  } catch {
    return INVALID_URL_PLACEHOLDER;
  }
}
