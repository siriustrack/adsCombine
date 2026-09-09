import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export type SourceUrlResolver = (hostname: string) => Promise<string[]>

export type ResolvedSourceUrl = {
  url: URL
  addresses: string[]
}

export class SourceUrlPolicyError extends Error {
  constructor() {
    super('URL de origem não permitida')
    this.name = 'SourceUrlPolicyError'
  }
}

export class SourceUrlPolicy {
  private readonly allowedPrefixes: URL[]

  constructor({
    allowedPrefixes,
    resolveHostname = resolvePublicHostname,
  }: {
    allowedPrefixes: string[]
    resolveHostname?: SourceUrlResolver
  }) {
    this.allowedPrefixes = allowedPrefixes.map(normalizeAllowedPrefix)
    this.resolveHostname = resolveHostname
  }

  private readonly resolveHostname: SourceUrlResolver

  async assertSafeUrl(value: string): Promise<URL> {
    return (await this.resolveSafeUrl(value)).url
  }

  async resolveSafeUrl(value: string): Promise<ResolvedSourceUrl> {
    const url = this.parseAndAuthorize(value)
    const addresses = await this.resolvePublicAddresses(url.hostname)

    return { url, addresses }
  }

  private parseAndAuthorize(value: string): URL {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new SourceUrlPolicyError()
    }

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !this.matchesAllowedPrefix(url)
    ) {
      throw new SourceUrlPolicyError()
    }

    return url
  }

  private matchesAllowedPrefix(url: URL): boolean {
    if (this.allowedPrefixes.length === 0) return true

    return this.allowedPrefixes.some(prefix => url.href.startsWith(prefix.href))
  }

  private async resolvePublicAddresses(hostname: string): Promise<string[]> {
    const addresses = isIP(hostname) ? [hostname] : await this.resolveHostname(hostname)

    if (addresses.length === 0 || addresses.some(address => !isPublicIpAddress(address))) {
      throw new SourceUrlPolicyError()
    }

    return addresses
  }
}

function normalizeAllowedPrefix(value: string): URL {
  const prefix = new URL(value)
  if (prefix.protocol !== 'https:' || prefix.username || prefix.password) {
    throw new Error('Configured file download URL prefixes must use HTTPS without credentials')
  }

  return new URL(prefix.href.endsWith('/') ? prefix.href : `${prefix.href}/`)
}

async function resolvePublicHostname(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true })
  return records.map(record => record.address)
}

function isPublicIpAddress(address: string): boolean {
  const normalizedAddress = address.replace(/^\[|\]$/g, '').toLowerCase()
  const family = isIP(normalizedAddress)
  if (family === 4) return !isPrivateIpv4(normalizedAddress)
  if (family !== 6) return false

  const mappedIpv4 = getMappedIpv4(normalizedAddress)
  if (mappedIpv4) return !isPrivateIpv4(mappedIpv4)

  return !(
    normalizedAddress === '::' ||
    normalizedAddress === '::1' ||
    normalizedAddress.startsWith('fc') ||
    normalizedAddress.startsWith('fd') ||
    normalizedAddress.startsWith('fe8') ||
    normalizedAddress.startsWith('fe9') ||
    normalizedAddress.startsWith('fea') ||
    normalizedAddress.startsWith('feb') ||
    normalizedAddress.startsWith('ff')
  )
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  const [first, second] = octets

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

function getMappedIpv4(address: string): string | undefined {
  if (address.includes('.')) {
    const dottedAddress = address.slice(address.lastIndexOf(':') + 1)
    return isIP(dottedAddress) === 4 ? dottedAddress : undefined
  }

  const groups = expandIpv6(address)
  if (!groups?.slice(0, 5).every(group => group === 0)) return undefined
  if (!groups.slice(5, 6).every(group => group === 0 || group === 0xffff)) return undefined

  const high = groups[6]
  const low = groups[7]
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`
}

function expandIpv6(address: string): number[] | undefined {
  const [start, end] = address.split('::')
  const startGroups = start ? start.split(':') : []
  const endGroups = end ? end.split(':') : []
  const missingGroups = 8 - startGroups.length - endGroups.length

  if (missingGroups < 0 || (address.includes('::') && missingGroups < 1)) return undefined
  const groups = [...startGroups, ...Array(missingGroups).fill('0'), ...endGroups]
  if (groups.length !== 8 || groups.some(group => !/^[\da-f]{1,4}$/i.test(group))) {
    return undefined
  }

  return groups.map(group => Number.parseInt(group, 16))
}
