import { describe, expect, test } from 'bun:test'
import { createVisualFallbackService, visualFallbackPage } from './visual-fallback.test-support'

describe('VisualFallbackService V2 per-PDF limits', () => {
  test('attempts six risky pages and marks a seventh as per-PDF budget-exhausted', async () => {
    const attemptedPages: number[] = []
    const { service, renderedPages } = createVisualFallbackService(
      {
        async transcribe({ pageNumber }) {
          attemptedPages.push(pageNumber)
          return { status: 'transcribed', transcription: `Matrícula nº 12.34${pageNumber}` }
        },
      },
      {
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
        maxPagesPerPdf: 6,
      }
    )
    const pages = [1, 2, 3, 4, 5, 6, 7].map(pageNumber =>
      visualFallbackPage({
        pageNumber,
        text: `Matrícula nº 12.34${pageNumber}`,
        legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
      })
    )

    const result = await service.execute({ buffer: Buffer.from('pdf'), fileName: 'x.pdf', pages })

    expect(renderedPages).toEqual([[1, 2, 3, 4, 5, 6]])
    expect(attemptedPages).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.selectedPageCount).toBe(6)
    expect(result.byPage.get(7)).toMatchObject({
      outcome: 'unavailable',
      decisionReason: 'budget_exhausted',
    })
  })

  test('attempts six risky pages and marks a seventh as shared-job budget-exhausted', async () => {
    const attemptedPages: number[] = []
    let remainingPages = 6
    const { service, renderedPages } = createVisualFallbackService(
      {
        async transcribe({ pageNumber }) {
          attemptedPages.push(pageNumber)
          return { status: 'transcribed', transcription: `Matrícula nº 12.34${pageNumber}` }
        },
      },
      {
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
        maxPagesPerPdf: 7,
      }
    )
    const pages = [1, 2, 3, 4, 5, 6, 7].map(pageNumber =>
      visualFallbackPage({
        pageNumber,
        text: `Matrícula nº 12.34${pageNumber}`,
        legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
      })
    )

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'x.pdf',
      pages,
      pageBudget: {
        remaining: () => remainingPages,
        reserve: pageCount => {
          if (pageCount > remainingPages) return false
          remainingPages -= pageCount
          return true
        },
      },
    })

    expect(renderedPages).toEqual([[1, 2, 3, 4, 5, 6]])
    expect(attemptedPages).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.selectedPageCount).toBe(6)
    expect(result.byPage.get(7)).toMatchObject({
      outcome: 'unavailable',
      decisionReason: 'budget_exhausted',
    })
  })

  test('retains overflow metadata without counting overflow pages as attempted', async () => {
    const { service, renderedPages } = createVisualFallbackService(
      {
        async transcribe() {
          return { status: 'transcribed', transcription: 'Matrícula nº 12.345' }
        },
      },
      {
        reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
        maxPagesPerPdf: 1,
      }
    )
    const pages = [1, 2, 3].map(pageNumber =>
      visualFallbackPage({
        pageNumber,
        text: `Matrícula nº 12.34${pageNumber}`,
        legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
      })
    )

    const result = await service.execute({ buffer: Buffer.from('pdf'), fileName: 'x.pdf', pages })

    expect(renderedPages).toEqual([[1]])
    expect(result.selectedPageCount).toBe(1)
    expect([result.byPage.get(2), result.byPage.get(3)]).toEqual([
      expect.objectContaining({ outcome: 'unavailable', decisionReason: 'budget_exhausted' }),
      expect.objectContaining({ outcome: 'unavailable', decisionReason: 'budget_exhausted' }),
    ])
  })

  test('marks attempted pages aborted and overflow pages budget-exhausted before work', async () => {
    const controller = new AbortController()
    controller.abort()
    const { service, renderedPages } = createVisualFallbackService(
      {
        async transcribe() {
          return { status: 'abstain' }
        },
      },
      { reconciliationPolicyVersion: 'gemini-whole-page-critical-v2', maxPagesPerPdf: 1 }
    )
    const pages = [1, 2, 3].map(pageNumber =>
      visualFallbackPage({
        pageNumber,
        legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
      })
    )

    const result = await service.execute({
      buffer: Buffer.from('pdf'),
      fileName: 'x.pdf',
      pages,
      signal: controller.signal,
    })

    expect(renderedPages).toEqual([])
    expect(result.selectedPageCount).toBe(1)
    expect(result.byPage.get(1)).toMatchObject({ decisionReason: 'aborted' })
    expect(result.byPage.get(2)).toMatchObject({ decisionReason: 'budget_exhausted' })
    expect(result.byPage.get(3)).toMatchObject({ decisionReason: 'budget_exhausted' })
  })
})
