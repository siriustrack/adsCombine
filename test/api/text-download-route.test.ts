import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import type { Server } from 'node:http'
import path from 'node:path'
import { env } from '../../src/config/env'
import express from 'express'
import { createSignedTextDownload } from '../../src/core/services/texts/signed-text-download'

const configuredBaseUrl = env.BASE_URL
const signingSecret = env.TEXTS_SIGNING_SECRET
const signingToken = env.TOKEN

process.env.BASE_URL = configuredBaseUrl
process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.OPENAI_MODEL_TEXT = 'gpt-test'
process.env.TOKEN = 'main-token'
process.env.JOBS_TOKEN = 'jobs-token'
if (signingSecret) process.env.TEXTS_SIGNING_SECRET = signingSecret
else delete process.env.TEXTS_SIGNING_SECRET
process.env.TEXTS_URL_TTL_SECONDS = '900'

const conversationId = 'signed-route-test'
const filename = 'artifact-1.txt'
const artifactDirectory = path.join(process.cwd(), 'public', 'texts', conversationId)
const artifactPath = path.join(artifactDirectory, filename)
let server: Server
let origin: string

beforeAll(async () => {
  await fs.mkdir(artifactDirectory, { recursive: true })
  await fs.writeFile(artifactPath, 'conteúdo assinado', 'utf8')
  const { default: textsRouter } = await import('../../src/api/routes/texts.routes')
  const app = express()
  app.use('/texts', textsRouter)
  server = app.listen(0)
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close(error => (error ? reject(error) : resolve()))
  })
  await fs.rm(artifactDirectory, { recursive: true, force: true })
})

function signedTarget(nowSeconds = Math.floor(Date.now() / 1000)) {
  const signed = createSignedTextDownload({
    baseUrl: configuredBaseUrl,
    secret: signingSecret,
    token: signingToken,
    ttlSeconds: 900,
    conversationId,
    filename,
    nowSeconds,
  })
  const url = new URL(signed.url)
  return `${origin}${url.pathname}${url.search}`
}

describe('signed text download route', () => {
  test('serves an authorized text artifact with hardened headers', async () => {
    const response = await fetch(signedTarget())

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('conteúdo assinado')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toContain(filename)
  })

  test('supports HEAD without returning the artifact body', async () => {
    const response = await fetch(signedTarget(), { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
  })

  test('rejects tampered and expired links before reading a file', async () => {
    const tampered = signedTarget().replace(filename, 'artifact-2.txt')
    const expired = signedTarget(1)

    expect((await fetch(tampered)).status).toBe(403)
    expect((await fetch(expired)).status).toBe(403)
  })

  test('returns not found only after a valid signature', async () => {
    const signed = createSignedTextDownload({
      baseUrl: configuredBaseUrl,
      secret: signingSecret,
      token: signingToken,
      ttlSeconds: 900,
      conversationId,
      filename: 'missing.txt',
    })
    const url = new URL(signed.url)

    expect((await fetch(`${origin}${url.pathname}${url.search}`)).status).toBe(404)
  })
})
