import { env } from '@config/env'
import { DeepSeekVisualTranscriptionProvider } from './deepseek-visual-transcription.provider'
import { GeminiVisualTranscriptionProvider } from './gemini-visual-transcription.provider'
import type { VisualFallbackProvider, VisualTranscriptionProvider } from './visual-fallback.types'

export function createDefaultVisualProvider(
  provider: VisualFallbackProvider
): VisualTranscriptionProvider {
  if (provider === 'deepseek') {
    return new DeepSeekVisualTranscriptionProvider(env.DEEPSEEK_API_KEY ?? '')
  }
  return new GeminiVisualTranscriptionProvider(env.GEMINI_API_KEY ?? '')
}
