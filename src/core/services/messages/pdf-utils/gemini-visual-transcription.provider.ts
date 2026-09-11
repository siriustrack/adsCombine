import type {
  VisualTranscriptionProvider,
  VisualTranscriptionResponse,
} from './visual-fallback.types'
import { VisualTranscriptionTerminalError } from './visual-fallback.types'

type GeminiResponse = {
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
}

const transcriptionSchema = {
  type: 'OBJECT',
  properties: {
    status: { type: 'STRING', enum: ['transcribed', 'abstain'] },
    transcription: { type: 'STRING' },
  },
  required: ['status'],
} as const

const MAX_OUTPUT_TOKENS = 8_192
const MAX_STRUCTURED_RESPONSE_BYTES = 65_536
const MAX_TRANSCRIPTION_BYTES = 32_768

function literalTranscriptionPrompt(transcriptionHints: readonly string[] = []): string {
  return [
    'Transcreva literalmente somente o texto visível desta página do documento.',
    'Não interprete, corrija, complete, normalize, resuma ou deduza informações.',
    'Preserve números, pontuação, quebras relevantes e unidades como aparecem na imagem.',
    ...transcriptionHints,
    'Se não puder transcrever com segurança, responda com status "abstain".',
  ].join(' ')
}

export class GeminiVisualTranscriptionProvider implements VisualTranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe({
    image,
    model,
    signal,
    documentProfile,
  }: Parameters<
    VisualTranscriptionProvider['transcribe']
  >[0]): Promise<VisualTranscriptionResponse> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: literalTranscriptionPrompt(documentProfile?.transcriptionHints) },
                { inlineData: { mimeType: 'image/png', data: image.toString('base64') } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: transcriptionSchema,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
          },
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Gemini visual transcription request failed (${response.status})`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_STRUCTURED_RESPONSE_BYTES) {
      throw new Error('Gemini visual transcription returned an invalid structured response')
    }

    const responseText = await response.text()
    if (Buffer.byteLength(responseText) > MAX_STRUCTURED_RESPONSE_BYTES) {
      throw new Error('Gemini visual transcription returned an invalid structured response')
    }

    let payload: GeminiResponse
    try {
      payload = JSON.parse(responseText) as GeminiResponse
    } catch {
      throw new Error('Gemini visual transcription returned an invalid structured response')
    }
    const candidate = payload.candidates?.[0]
    if (candidate?.finishReason !== 'STOP') {
      throw new VisualTranscriptionTerminalError(
        `Gemini visual transcription abnormal completion (${candidate?.finishReason ?? 'missing'})`
      )
    }
    const text = candidate.content?.parts?.find(part => part.text)?.text
    if (!text || Buffer.byteLength(text) > MAX_STRUCTURED_RESPONSE_BYTES) {
      throw new Error('Gemini visual transcription returned no structured content')
    }

    let parsed: { status?: unknown; transcription?: unknown }
    try {
      parsed = JSON.parse(text) as { status?: unknown; transcription?: unknown }
    } catch {
      throw new Error('Gemini visual transcription returned an invalid structured response')
    }
    if (parsed.status === 'abstain') return { status: 'abstain' }
    if (
      parsed.status === 'transcribed' &&
      typeof parsed.transcription === 'string' &&
      parsed.transcription.length > 0 &&
      Buffer.byteLength(parsed.transcription) <= MAX_TRANSCRIPTION_BYTES
    ) {
      return { status: 'transcribed', transcription: parsed.transcription }
    }

    throw new Error('Gemini visual transcription returned an invalid structured response')
  }
}
