import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ProcessMessageJobRecord } from '../../src/core/services/jobs/job.types'
import { JsonJobStoreService } from '../../src/core/services/jobs/json-job-store.service'
import { ProcessMessageJobService } from '../../src/core/services/jobs/process-message-job.service'

const directories: string[] = []
const input = {
  host: 'localhost:3000',
  protocol: 'http',
  messages: [{ conversationId: 'restart-test', body: { files: [] } }],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

async function directory() {
  const dir = await mkdtemp(path.join(tmpdir(), 'adscombine-restart-'))
  directories.push(dir)
  return dir
}

function record(store: JsonJobStoreService, status: ProcessMessageJobRecord['status']) {
  const now = new Date().toISOString()
  return {
    id: store.createJobId(),
    type: 'process-message',
    status,
    request: input.messages,
    host: input.host,
    protocol: input.protocol,
    createdAt: now,
    updatedAt: now,
    ...(status === 'processing' ? { startedAt: now } : {}),
  } satisfies ProcessMessageJobRecord
}

function processor() {
  const calls: string[] = []
  return {
    calls,
    async execute(request: { messages: ProcessMessageJobRecord['request'] }) {
      calls.push(request.messages[0].conversationId)
      return {
        conversationId: 'restart-test',
        processedFiles: [],
        failedFiles: [],
        filename: 'restart-test.txt',
        downloadUrl: 'http://localhost:3000/restart-test.txt',
        downloadExpiresAt: '2026-10-11T00:00:00.000Z',
      }
    },
  }
}

class GatedStore extends JsonJobStoreService {
  readonly listing = deferred<void>()
  readonly release = deferred<void>()
  readonly completed = deferred<ProcessMessageJobRecord>()
  reads = 0
  saves = 0
  private firstList = true

  override async list(strict = false) {
    if (this.firstList) {
      this.firstList = false
      this.listing.resolve()
      await this.release.promise
    }
    return super.list(strict)
  }

  override async get(id: string) {
    this.reads++
    return super.get(id)
  }

  override async save(job: ProcessMessageJobRecord) {
    this.saves++
    await super.save(job)
    if (job.status === 'completed') this.completed.resolve(job)
  }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('Job restart recovery', () => {
  test('expires fresh inherited active jobs without replay and preserves terminal records', async () => {
    const dir = await directory()
    const previousStore = new JsonJobStoreService(dir)
    const active = (['queued', 'processing'] as const).map(status => record(previousStore, status))
    const terminal = (['completed', 'failed', 'expired'] as const).map(status => ({
      ...record(previousStore, status),
      finishedAt: '2020-01-01T00:00:00.000Z',
      error: status === 'completed' ? undefined : 'existing error',
      result:
        status === 'completed'
          ? { conversationId: 'old', processedFiles: [], failedFiles: [], filename: 'old.txt' }
          : undefined,
    }))
    for (const job of [...active, ...terminal]) await previousStore.save(job)
    const worker = processor()

    const service = new ProcessMessageJobService(new JsonJobStoreService(dir), worker)
    for (const job of active) {
      const recovered = await service.get(job.id)
      expect(recovered.status).toBe('expired')
      expect(recovered.finishedAt).toEqual(expect.any(String))
      expect(Number.isFinite(Date.parse(recovered.finishedAt ?? ''))).toBe(true)
      expect(recovered.error).toEqual(expect.any(String))
      expect(recovered.request).toEqual(job.request)
      expect(await previousStore.get(job.id)).toEqual(recovered)
    }
    for (const job of terminal) {
      expect(await service.get(job.id)).toEqual(JSON.parse(JSON.stringify(job)))
    }
    expect(worker.calls).toEqual([])
  })

  test('blocks create and get until reconciliation and only executes the new job', async () => {
    const dir = await directory()
    const previousStore = new JsonJobStoreService(dir)
    const inherited = record(previousStore, 'queued')
    await previousStore.save(inherited)
    const store = new GatedStore(dir)
    const worker = processor()
    const service = new ProcessMessageJobService(store, worker)

    const created = service.create(input)
    const retrieved = service.get(inherited.id)
    await store.listing.promise
    try {
      expect(store.saves).toBe(0)
      expect(store.reads).toBe(0)
      expect(worker.calls).toEqual([])
    } finally {
      store.release.resolve()
    }
    expect((await retrieved).status).toBe('expired')
    const newJob = await created
    expect(newJob.status).toBe('queued')
    const completed = await store.completed.promise
    expect(completed.id).toBe(newJob.id)
    expect((await service.get(newJob.id)).status).toBe('completed')
    expect(worker.calls).toEqual(['restart-test'])
    expect((await previousStore.get(inherited.id)).status).toBe('expired')
  })

  test('rejects create and get when startup cannot read a persisted job', async () => {
    const dir = await directory()
    const store = new JsonJobStoreService(dir)
    const id = store.createJobId()
    await writeFile(path.join(dir, `${id}.json`), '{invalid json')
    const worker = processor()

    const service = new ProcessMessageJobService(store, worker)
    await expect(service.get(id)).rejects.toBeInstanceOf(SyntaxError)
    await expect(service.create(input)).rejects.toBeInstanceOf(SyntaxError)
    expect(worker.calls).toEqual([])
    expect(await store.list()).toEqual([])
  })

  test('rejects create and get when startup cannot persist expiration', async () => {
    const dir = await directory()
    const store = new JsonJobStoreService(dir)
    const inherited = record(store, 'processing')
    await store.save(inherited)
    const failure = new Error('storage unavailable')
    class FailingStore extends JsonJobStoreService {
      override async update(): Promise<ProcessMessageJobRecord> {
        throw failure
      }
    }
    const worker = processor()

    const service = new ProcessMessageJobService(new FailingStore(dir), worker)
    await expect(service.get(inherited.id)).rejects.toBe(failure)
    await expect(service.create(input)).rejects.toBe(failure)
    expect(await store.get(inherited.id)).toEqual(inherited)
    expect(worker.calls).toEqual([])
  })
})
