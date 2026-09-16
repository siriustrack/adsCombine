import { describe, expect, test } from 'bun:test'
import type { VisualFallbackMetadata } from '../../src/core/services/messages/pdf-utils/visual-fallback.types'
import logger from '../../src/lib/logger'
import { createVisualFallbackService, visualFallbackPage } from './visual-fallback.test-support'

const CONTEXTUAL_SHADOW_MESSAGE = 'Visual fallback contextual pairing shadow evaluated'
const INCUMBENT_MESSAGE = 'Visual fallback V2 reconciliation evaluated'

type ServiceRun = Readonly<{
  result: Readonly<{
    byPage: Map<number, VisualFallbackMetadata>
    acceptedVisualTextByPage: ReadonlyMap<number, string>
  }>
  providerCallCount: number
  renderedPages: number[][]
}>

const NON_CANDIDATE_PATHS: Array<
  Readonly<{
    label: string
    policy: 'safe-visual-v1' | 'gemini-whole-page-critical-v2'
    provider: 'gemini' | 'deepseek'
  }>
> = [
  { label: 'V1 Gemini', policy: 'safe-visual-v1', provider: 'gemini' },
  { label: 'V1 non-Gemini', policy: 'safe-visual-v1', provider: 'deepseek' },
  {
    label: 'V2 non-Gemini',
    policy: 'gemini-whole-page-critical-v2',
    provider: 'deepseek',
  },
]

function captureContextualShadowLogs(): Readonly<{
  events: unknown[]
  incumbentEvents: unknown[]
  stop: () => void
}> {
  const events: unknown[] = []
  const incumbentEvents: unknown[] = []
  const capture = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || !('message' in value)) return
    if (value.message === CONTEXTUAL_SHADOW_MESSAGE) events.push(value)
    if (value.message === INCUMBENT_MESSAGE) incumbentEvents.push(value)
  }
  logger.on('data', capture)
  return { events, incumbentEvents, stop: () => logger.off('data', capture) }
}

function eventPageNumber(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('pageNumber' in value)) return undefined
  return typeof value.pageNumber === 'number' ? value.pageNumber : undefined
}

function riskyPages() {
  return [1, 2].map(pageNumber =>
    visualFallbackPage({
      pageNumber,
      text: `R.1 base valor ${pageNumber * 10}; AV.2 fechamento valor 30.`,
      legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
    })
  )
}

async function runService(input: {
  readonly contextualPairingShadowEnabled: boolean
  readonly reconciliationPolicyVersion?: 'safe-visual-v1' | 'gemini-whole-page-critical-v2'
  readonly provider?: 'gemini' | 'deepseek'
  readonly shadowMode?: boolean
}): Promise<ServiceRun> {
  let providerCallCount = 0
  const { service, renderedPages } = createVisualFallbackService(
    {
      async transcribe({ pageNumber }) {
        providerCallCount++
        return {
          status: 'transcribed',
          transcription: `R.1 base valor ${pageNumber * 10 + 1}; AV.2 fechamento valor 30.`,
        }
      },
    },
    {
      contextualPairingShadowEnabled: input.contextualPairingShadowEnabled,
      reconciliationPolicyVersion: input.reconciliationPolicyVersion,
      provider: input.provider ?? 'gemini',
      shadowMode: input.shadowMode ?? false,
      maxPagesPerPdf: 2,
      maxRetries: 2,
    }
  )
  const result = await service.execute({
    buffer: Buffer.from('PRIVATE_IMAGE_SENTINEL'),
    fileName: 'PRIVATE_FILENAME_SENTINEL.pdf',
    pages: riskyPages(),
  })
  return { result, providerCallCount, renderedPages }
}

describe('contextual pairing shadow service integration', () => {
  test('performs no candidate evaluation when the flag is off', async () => {
    // Given
    const capture = captureContextualShadowLogs()

    // When
    try {
      await runService({
        contextualPairingShadowEnabled: false,
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      })
    } finally {
      capture.stop()
    }

    // Then
    expect(capture.events).toHaveLength(0)
    expect(capture.incumbentEvents).toHaveLength(2)
  })

  test('evaluates exactly once per Gemini V2 page without changing outputs or call counts', async () => {
    // Given
    const disabledCapture = captureContextualShadowLogs()
    const disabled = await runService({
      contextualPairingShadowEnabled: false,
      reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
    })
    disabledCapture.stop()
    const enabledCapture = captureContextualShadowLogs()

    // When
    let enabled: ServiceRun
    try {
      enabled = await runService({
        contextualPairingShadowEnabled: true,
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      })
    } finally {
      enabledCapture.stop()
    }

    // Then
    expect(disabledCapture.events).toHaveLength(0)
    expect(enabledCapture.events).toHaveLength(2)
    expect(disabledCapture.incumbentEvents).toHaveLength(2)
    expect(enabledCapture.incumbentEvents).toHaveLength(2)
    expect(enabledCapture.events.map(eventPageNumber).sort()).toEqual([1, 2])
    expect(enabled.result.byPage).toEqual(disabled.result.byPage)
    expect(enabled.result.acceptedVisualTextByPage).toEqual(
      disabled.result.acceptedVisualTextByPage
    )
    expect(enabled.providerCallCount).toBe(disabled.providerCallCount)
    expect(enabled.renderedPages).toEqual(disabled.renderedPages)
    expect(enabled.providerCallCount).toBe(2)
    expect(enabled.renderedPages).toEqual([[1, 2]])
    const serialized = JSON.stringify(enabledCapture.events).toLocaleLowerCase('en-US')
    for (const forbidden of [
      'private_',
      'filename',
      'url',
      'prompt',
      'range',
      'hash',
      'normalized',
      'message_and_stack',
      'sentinel',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  test.each(NON_CANDIDATE_PATHS)(
    'never evaluates the candidate on the $label path',
    async fixture => {
      // Given
      const capture = captureContextualShadowLogs()

      // When
      try {
        await runService({
          contextualPairingShadowEnabled: true,
          reconciliationPolicyVersion: fixture.policy,
          provider: fixture.provider,
        })
      } finally {
        capture.stop()
      }

      // Then
      expect(capture.events).toHaveLength(0)
    }
  )

  test('keeps active V2 accepted text authoritative and existing V2 shadow empty', async () => {
    // Given
    const capture = captureContextualShadowLogs()

    // When
    let active: ServiceRun
    let shadow: ServiceRun
    try {
      active = await runService({
        contextualPairingShadowEnabled: true,
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      })
      shadow = await runService({
        contextualPairingShadowEnabled: true,
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
        shadowMode: true,
      })
    } finally {
      capture.stop()
    }

    // Then
    expect(active.result.acceptedVisualTextByPage.size).toBe(2)
    expect(shadow.result.acceptedVisualTextByPage.size).toBe(0)
    expect(capture.events).toHaveLength(4)
  })
})
