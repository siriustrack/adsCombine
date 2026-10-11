import { AsyncLocalStorage } from 'node:async_hooks'

export const processingContext = new AsyncLocalStorage<{ readonly jobId: string }>()
