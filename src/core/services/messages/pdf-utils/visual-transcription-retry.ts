import type { VisualDocumentProfile, VisualTranscriptionProvider } from './visual-fallback.types'
import { VisualTranscriptionTerminalError } from './visual-fallback.types'

type TranscriptionRetryInput = {
  image: Buffer
  pageNumber: number
  signal?: AbortSignal
  documentProfile?: VisualDocumentProfile
  model: string
  maxRetries: number
  timeoutMs: number
  provider: VisualTranscriptionProvider
}

export type TranscriptionAttemptResult =
  | { status: 'transcribed'; text: string }
  | { status: 'unavailable'; reason: 'provider_abstained' | 'provider_failed' | 'aborted' }

export async function transcribeWithRetries({
  image,
  pageNumber,
  signal,
  documentProfile,
  model,
  maxRetries,
  timeoutMs,
  provider,
}: TranscriptionRetryInput): Promise<TranscriptionAttemptResult> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await provider.transcribe({
        image,
        pageNumber,
        model,
        signal: controller.signal,
        ...(documentProfile !== undefined ? { documentProfile } : {}),
      })
      if (signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
      if (response.status === 'abstain') {
        return { status: 'unavailable', reason: 'provider_abstained' }
      }
      return { status: 'transcribed', text: response.transcription }
    } catch (error) {
      if (signal?.aborted) return { status: 'unavailable', reason: 'aborted' }
      if (error instanceof VisualTranscriptionTerminalError || attempt === maxRetries) {
        return { status: 'unavailable', reason: 'provider_failed' }
      }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }

  return { status: 'unavailable', reason: 'provider_failed' }
}
