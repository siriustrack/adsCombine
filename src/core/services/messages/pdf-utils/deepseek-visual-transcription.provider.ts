import type {
  VisualTranscriptionProvider,
  VisualTranscriptionResponse,
} from './visual-fallback.types'

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
}

const MAX_OUTPUT_TOKENS = 8_192
const MAX_INLINE_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_REQUEST_BODY_BYTES = 48 * 1024 * 1024
const MAX_STRUCTURED_RESPONSE_BYTES = 65_536
const MAX_TRANSCRIPTION_BYTES = 32_768

const literalTranscriptionPrompt = [
  'Transcreva literalmente somente o texto visível desta página de matrícula imobiliária.',
  'Não interprete, corrija, complete, normalize, resuma ou deduza efeitos jurídicos.',
  'Preserve números, pontuação, quebras relevantes e unidades como aparecem na imagem.',
  'Se não puder transcrever com segurança, responda com status "abstain".',
].join(' ')

export class DeepSeekVisualTranscriptionProvider implements VisualTranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe({
    image,
    model,
    signal,
  }: Parameters<
    VisualTranscriptionProvider['transcribe']
  >[0]): Promise<VisualTranscriptionResponse> {
    if (image.byteLength > MAX_INLINE_IMAGE_BYTES) {
      throw new Error('DeepSeek visual transcription image exceeds the 32 MiB limit')
    }

    const body = JSON.stringify({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: literalTranscriptionPrompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${image.toString('base64')}`,
                detail: 'auto',
              },
            },
          ],
        },
      ],
    })
    if (Buffer.byteLength(body) > MAX_REQUEST_BODY_BYTES) {
      throw new Error('DeepSeek visual transcription request body exceeds the 48 MiB limit')
    }

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      signal,
      body,
    })
    if (!response.ok) {
      throw new Error(`DeepSeek visual transcription request failed (${response.status})`)
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_STRUCTURED_RESPONSE_BYTES) {
      throw new Error('DeepSeek visual transcription returned an invalid structured response')
    }
    const responseText = await response.text()
    if (Buffer.byteLength(responseText) > MAX_STRUCTURED_RESPONSE_BYTES) {
      throw new Error('DeepSeek visual transcription returned an invalid structured response')
    }

    let payload: DeepSeekResponse
    try {
      payload = JSON.parse(responseText) as DeepSeekResponse
    } catch {
      throw new Error('DeepSeek visual transcription returned an invalid structured response')
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content || Buffer.byteLength(content) > MAX_STRUCTURED_RESPONSE_BYTES) {
      throw new Error('DeepSeek visual transcription returned no structured content')
    }

    let parsed: { status?: unknown; transcription?: unknown }
    try {
      parsed = JSON.parse(content) as { status?: unknown; transcription?: unknown }
    } catch {
      throw new Error('DeepSeek visual transcription returned an invalid structured response')
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

    throw new Error('DeepSeek visual transcription returned an invalid structured response')
  }
}
