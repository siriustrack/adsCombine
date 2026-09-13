import { expect, test } from 'bun:test'
import { createVisualFallbackService, visualFallbackPage } from './visual-fallback.test-support'

test('keeps V2 page concurrency and ordering while applying ephemeral furniture profiles', async () => {
  let active = 0
  let maxActive = 0
  const calls: number[] = []
  const texts = [1, 2, 3].map(pageNumber =>
    [
      'CABEÇALHO SINTÉTICO',
      `Página ${pageNumber} de 3`,
      `R.${pageNumber} ato item${pageNumber} valor ${pageNumber * 10}.`,
      'Linha corporal final',
      'AVISO DE CONTINUIDADE',
      'RODAPÉ SINTÉTICO',
    ].join('\n')
  )
  const { service } = createVisualFallbackService(
    {
      async transcribe({ pageNumber }) {
        calls.push(pageNumber)
        active++
        maxActive = Math.max(maxActive, active)
        await Bun.sleep(pageNumber === 1 ? 10 : 2)
        active--
        return {
          status: 'transcribed',
          transcription:
            pageNumber === 2 ? texts[1].replace('valor 20', 'valor 21') : texts[pageNumber - 1],
        }
      },
    },
    {
      reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      concurrency: 2,
      maxPagesPerPdf: 3,
    }
  )
  const pages = texts.map((text, index) =>
    visualFallbackPage({
      pageNumber: index + 1,
      text,
      legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
    })
  )

  const result = await service.execute({
    buffer: Buffer.from('pdf'),
    fileName: 'registro-sintetico.pdf',
    pages,
  })

  expect(calls.sort()).toEqual([1, 2, 3])
  expect(maxActive).toBe(2)
  expect([...result.byPage.keys()]).toEqual([1, 2, 3])
  const second = result.byPage.get(2)
  expect(second).toMatchObject({ outcome: 'selected', selectedTextSource: 'visual' })
  if (second?.policyVersion !== 'gemini-whole-page-critical-v2') {
    throw new Error('expected V2 metadata')
  }
  if (second.outcome !== 'selected') throw new Error('expected selected page')
  expect(
    second.criticalUncertainties.map(range =>
      result.acceptedVisualTextByPage.get(2)?.slice(range.start, range.end)
    )
  ).toEqual(['21'])
})

test('preserves a repeated edge fraction and profiles only visual-attempt pages', async () => {
  const texts = [1, 2, 3, 4].map(pageNumber =>
    [
      'FRAÇÃO IDEAL',
      '1 / 2',
      `R.${pageNumber} corpo valor ${pageNumber * 10}.`,
      'linha final',
      'base',
      'rodapé',
    ].join('\n')
  )
  texts[3] = `${'X'.repeat(6_000)}\nheader\nbody\nend\nbase\nfooter`
  const { service } = createVisualFallbackService(
    {
      async transcribe({ pageNumber }) {
        return {
          status: 'transcribed',
          transcription:
            pageNumber === 2 ? texts[1].replace('1 / 2', '1 / 3') : texts[pageNumber - 1],
        }
      },
    },
    {
      reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      maxPagesPerPdf: 3,
      maxAlignmentCells: 5_000,
    }
  )
  const pages = texts.map((text, index) =>
    visualFallbackPage({
      pageNumber: index + 1,
      text,
      legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
    })
  )

  const result = await service.execute({
    buffer: Buffer.from('pdf'),
    fileName: 'fração.pdf',
    pages,
  })
  const second = result.byPage.get(2)
  if (second?.policyVersion !== 'gemini-whole-page-critical-v2' || second.outcome !== 'selected') {
    throw new Error('expected selected V2 page')
  }
  expect(result.acceptedVisualTextByPage.get(2)).toBe(texts[1].replace('1 / 2', '1 / 3'))
  expect(second.criticalUncertainties).toEqual([
    expect.objectContaining({ categories: ['fraction'], divergences: ['different_value'] }),
  ])
  expect(result.byPage.get(4)).toMatchObject({
    outcome: 'unavailable',
    decisionReason: 'budget_exhausted',
  })
})

test('publishes an omitted confirmed page counter in shadow OCR metadata', async () => {
  const texts = [1, 2, 3].map(pageNumber =>
    [
      'CABEÇALHO 🧾',
      `Página ${pageNumber}`,
      `R.${pageNumber} corpo valor ${pageNumber * 10}.`,
      'linha final',
      'base',
      'rodapé',
    ].join('\n')
  )
  const { service } = createVisualFallbackService(
    {
      async transcribe({ pageNumber }) {
        return {
          status: 'transcribed',
          transcription:
            pageNumber === 2 ? texts[1].replace('Página 2\n', '') : texts[pageNumber - 1],
        }
      },
    },
    {
      reconciliationPolicyVersion: 'gemini-whole-page-critical-v2',
      shadowMode: true,
      maxPagesPerPdf: 3,
    }
  )
  const pages = texts.map((text, index) =>
    visualFallbackPage({
      pageNumber: index + 1,
      text,
      legalSignals: { ...visualFallbackPage().legalSignals, corruptedSymbols: 1 },
    })
  )

  const result = await service.execute({
    buffer: Buffer.from('pdf'),
    fileName: 'registro-sintetico.pdf',
    pages,
  })
  const second = result.byPage.get(2)
  expect(second).toMatchObject({
    outcome: 'shadow',
    selectedTextSource: 'ocr',
    criticalUncertainties: [
      {
        start: texts[1].indexOf('2'),
        end: texts[1].indexOf('2') + 1,
        scope: 'token',
        categories: ['number'],
        divergences: ['gemini_only'],
      },
    ],
  })
})
