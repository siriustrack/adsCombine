import { createHmac, timingSafeEqual } from 'node:crypto'

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const TEXT_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*\.txt$/
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SIGNING_SECRET_PATTERN = /^[a-fA-F0-9]{64}$/
const SIGNATURE_VERSION = '1'
const SIGNATURE_SCOPE = 'texts:v1'
const SIGNATURE_METHOD = 'READ'
const FALLBACK_KEY_DERIVATION_SCOPE = 'adscombine:text-download-signing-key:v1'

type SigningConfig = {
  readonly baseUrl: string
  readonly secret?: string
  readonly token?: string
  readonly ttlSeconds: number
}

type TextArtifact = {
  readonly conversationId: string
  readonly filename: string
}

type CreateSignedTextDownloadInput = SigningConfig &
  TextArtifact & {
    readonly nowSeconds?: number
  }

type VerifySignedTextDownloadInput = SigningConfig & {
  readonly method: string
  readonly requestTarget: string
  readonly nowSeconds?: number
}

type TextDownloadVerification =
  | { readonly authorized: true; readonly artifact: TextArtifact }
  | {
      readonly authorized: false
      readonly reason: 'expired' | 'invalid_method' | 'invalid_path' | 'invalid_query'
    }

function getCanonicalOrigin(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('BASE_URL must be an HTTP(S) origin without credentials, path, query, or hash')
  }
  return url.origin
}

function createSignature({
  origin,
  path,
  expires,
  secret,
}: {
  readonly origin: string
  readonly path: string
  readonly expires: number
  readonly secret: string
}): string {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${SIGNATURE_SCOPE}\n${SIGNATURE_METHOD}\n${origin}\n${path}\n${expires}`)
    .digest('base64url')
}

export function resolveTextSigningSecret({
  secret,
  token,
}: {
  readonly secret?: string
  readonly token?: string
}): string {
  if (secret !== undefined) {
    if (!SIGNING_SECRET_PATTERN.test(secret)) {
      throw new Error('TEXTS_SIGNING_SECRET must contain exactly 64 hexadecimal characters')
    }
    return secret
  }
  if (!token) throw new Error('TOKEN is required when TEXTS_SIGNING_SECRET is not configured')
  return createHmac('sha256', Buffer.from(token, 'utf8'))
    .update(FALLBACK_KEY_DERIVATION_SCOPE)
    .digest('hex')
}

export function parseTextArtifactPath(pathname: string): TextArtifact | undefined {
  if (pathname.includes('%') || pathname.includes('\0')) return undefined
  const parts = pathname.split('/')
  if (parts.length !== 4 || parts[0] !== '' || parts[1] !== 'texts') return undefined
  const conversationId = parts[2]
  const filename = parts[3]
  if (
    !CONVERSATION_ID_PATTERN.test(conversationId) ||
    filename.length > 255 ||
    !TEXT_FILENAME_PATTERN.test(filename)
  ) {
    return undefined
  }
  return { conversationId, filename }
}

export function createSignedTextDownload(input: CreateSignedTextDownloadInput): {
  readonly url: string
  readonly expiresAt: string
} {
  const artifact = parseTextArtifactPath(`/texts/${input.conversationId}/${input.filename}`)
  if (!artifact) throw new Error('Invalid text artifact reference')
  const origin = getCanonicalOrigin(input.baseUrl)
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const expires = nowSeconds + input.ttlSeconds
  const path = `/texts/${artifact.conversationId}/${artifact.filename}`
  const signature = createSignature({
    origin,
    path,
    expires,
    secret: resolveTextSigningSecret(input),
  })
  const query = new URLSearchParams({
    v: SIGNATURE_VERSION,
    exp: String(expires),
    sig: signature,
  })
  return {
    url: `${origin}${path}?${query.toString()}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  }
}

export function verifySignedTextDownload(
  input: VerifySignedTextDownloadInput
): TextDownloadVerification {
  if (input.method !== 'GET' && input.method !== 'HEAD') {
    return { authorized: false, reason: 'invalid_method' }
  }

  const rawPath = input.requestTarget.split('?', 1)[0]
  const artifact = parseTextArtifactPath(rawPath)
  if (!artifact) return { authorized: false, reason: 'invalid_path' }

  let requestUrl: URL
  try {
    requestUrl = new URL(input.requestTarget, getCanonicalOrigin(input.baseUrl))
  } catch {
    return { authorized: false, reason: 'invalid_query' }
  }

  const allowedKeys = new Set(['v', 'exp', 'sig'])
  if ([...requestUrl.searchParams.keys()].some(key => !allowedKeys.has(key))) {
    return { authorized: false, reason: 'invalid_query' }
  }
  const versions = requestUrl.searchParams.getAll('v')
  const expiries = requestUrl.searchParams.getAll('exp')
  const signatures = requestUrl.searchParams.getAll('sig')
  if (
    versions.length !== 1 ||
    versions[0] !== SIGNATURE_VERSION ||
    expiries.length !== 1 ||
    signatures.length !== 1
  ) {
    return { authorized: false, reason: 'invalid_query' }
  }

  const expiresText = expiries[0]
  if (!/^[1-9]\d*$/.test(expiresText)) {
    return { authorized: false, reason: 'invalid_query' }
  }
  const expires = Number(expiresText)
  if (!Number.isSafeInteger(expires)) {
    return { authorized: false, reason: 'invalid_query' }
  }
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (nowSeconds >= expires) return { authorized: false, reason: 'expired' }

  const signature = signatures[0]
  if (!SIGNATURE_PATTERN.test(signature)) {
    return { authorized: false, reason: 'invalid_query' }
  }
  const expected = createSignature({
    origin: getCanonicalOrigin(input.baseUrl),
    path: requestUrl.pathname,
    expires,
    secret: resolveTextSigningSecret(input),
  })
  const suppliedBytes = Buffer.from(signature, 'base64url')
  const expectedBytes = Buffer.from(expected, 'base64url')
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return { authorized: false, reason: 'invalid_query' }
  }

  return { authorized: true, artifact }
}
