import { describe, expect, test } from 'bun:test'
import {
  buildDocumentFurnitureProfile,
  createFurnitureAlignmentPlan,
} from '../../src/core/services/messages/pdf-utils/gemini-page-furniture'
import { reconcileGeminiWholePage } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'

const MAX_CELLS = 10_000_000

function pageText(page: number, body: string, footer = 'ENCERRAMENTO PADRÃO') {
  return [
    'CABEÇALHO PADRÃO',
    `Página ${page} de 3`,
    body,
    'Linha corporal final',
    'AVISO DE CONTINUIDADE',
    footer,
  ].join('\n')
}

function furnitureFor(pages: string[], pageNumber: number) {
  return buildDocumentFurnitureProfile(
    pages.map((text, index) => ({ pageNumber: index + 1, text }))
  ).get(pageNumber)
}

describe('deterministic repeated page furniture', () => {
  test('isolates identical repeated edges so a body value remains token-local', () => {
    const ocrPages = [
      pageText(1, 'R.1 ato alfa valor 10.'),
      pageText(2, 'R.2 ato beta valor 20.'),
      pageText(3, 'R.3 ato gama valor 30.'),
    ]
    const visualText = pageText(2, 'R.2 ato beta valor 21.')
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: furnitureFor(ocrPages, 2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toEqual(['21'])
  })

  test('keeps body localization independent when repeated header lines reorder or disappear', () => {
    const ocrPages = [
      pageText(1, 'R.1 ato alfa valor 10.'),
      pageText(2, 'R.2 ato beta valor 20.'),
      pageText(3, 'R.3 ato gama valor 30.'),
    ]
    const visualText = [
      'Página 2 de 3',
      'R.2 ato beta valor 22.',
      'Linha corporal final',
      'AVISO DE CONTINUIDADE',
      'ENCERRAMENTO PADRÃO',
    ].join('\n')
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: furnitureFor(ocrPages, 2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties.every(range => range.scope !== 'page')).toBe(true)
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toContain('22')
  })

  test('uses positional extrema when two confirmed top lines swap order', () => {
    const makePage = (body: string) =>
      [
        'CABEÇALHO ALFA',
        'CABEÇALHO BETA',
        body,
        'Linha corporal final',
        'BASE SINTÉTICA',
        'RODAPÉ SINTÉTICO',
      ].join('\n')
    const ocrPages = [
      makePage('R.1 ato alfa valor 10.'),
      makePage('R.2 ato beta valor 20.'),
      makePage('R.3 ato gama valor 30.'),
    ]
    const visualText = makePage('R.2 ato beta valor 22.').replace(
      'CABEÇALHO ALFA\nCABEÇALHO BETA',
      'CABEÇALHO BETA\nCABEÇALHO ALFA'
    )
    const profile = furnitureFor(ocrPages, 2)
    const plan = createFurnitureAlignmentPlan(ocrPages[1], visualText, profile)

    expect(plan?.sections.find(section => section.kind === 'body')?.geminiStart).toBe(
      visualText.indexOf('CABEÇALHO ALFA') + 'CABEÇALHO ALFA'.length
    )
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: profile,
    })
    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties.every(range => range.scope !== 'page')).toBe(true)
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toContain('22')
  })

  test('ignores safe page-counter variation but preserves another changed header number', () => {
    const ocrPages = [
      pageText(1, 'Corpo alfa 10.').replace('CABEÇALHO PADRÃO', 'CÓDIGO 40'),
      pageText(2, 'Corpo beta 20.').replace('CABEÇALHO PADRÃO', 'CÓDIGO 40'),
      pageText(3, 'Corpo gama 30.').replace('CABEÇALHO PADRÃO', 'CÓDIGO 40'),
    ]
    const visualText = pageText(9, 'Corpo beta 20.')
      .replace('de 3', 'de 3')
      .replace('CABEÇALHO PADRÃO', 'CÓDIGO 41')
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: furnitureFor(ocrPages, 2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      result.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toEqual(['41', '9'])
  })

  test('never ignores a repeated unlabeled fraction as pagination', () => {
    const ocrPages = [1, 2, 3].map(page =>
      ['FRAÇÃO IDEAL', '1 / 2', `corpo ${page}`, 'linha final', 'base', 'rodapé'].join('\n')
    )
    const visualText = ocrPages[1].replace('1 / 2', '1 / 3')
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: furnitureFor(ocrPages, 2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ categories: ['fraction'], divergences: ['different_value'] }),
    ])
  })

  test('ignores only explicitly labeled counters consistent with actual page numbers', () => {
    const valid = [1, 2, 3].map(page =>
      [`Pág. ${page} / 3`, 'cabeçalho', `corpo ${page}`, 'fim', 'base', 'rodapé'].join('\n')
    )
    expect(furnitureFor(valid, 2)?.top[0]?.pageCounter).toBe(true)

    const invalid = [...valid]
    invalid[1] = invalid[1].replace('Pág. 2', 'Pág. 9')
    expect(furnitureFor(invalid, 2)?.top.some(line => line.pageCounter)).toBe(false)
  })

  test('preserves a confirmed OCR page counter when Gemini omits its counterpart', () => {
    const ocrPages = [1, 2, 3].map(page =>
      [`CABEÇALHO 🧾`, `Página ${page}`, `corpo sintético ${page}`, 'fim', 'base', 'rodapé'].join(
        '\n'
      )
    )
    const ocrText = ocrPages[1]
    const visualText = ocrText.replace('Página 2\n', '')
    const result = reconcileGeminiWholePage({
      ocrText,
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: furnitureFor(ocrPages, 2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ categories: ['number'], divergences: ['ocr_only'] }),
    ])
    expect(result.ocrCriticalUncertainties).toEqual([
      {
        start: ocrText.indexOf('2'),
        end: ocrText.indexOf('2') + 1,
        scope: 'token',
        categories: ['number'],
        divergences: ['gemini_only'],
      },
    ])
  })

  test.each([
    ['omitted', (text: string) => text.replace('Página 2\n', '')],
    ['label mismatch', (text: string) => text.replace('Página 2', 'Folha 2')],
    ['ambiguous duplicate', (text: string) => text.replace('CABEÇALHO 🧾', 'Página 2')],
  ])('does not ignore either counter without a unique %s counterpart', (_label, candidateFor) => {
    const ocrPages = [1, 2, 3].map(page =>
      [`CABEÇALHO 🧾`, `Página ${page}`, `corpo ${page}`, 'fim', 'base', 'rodapé'].join('\n')
    )
    const ocrText = ocrPages[1]
    const plan = createFurnitureAlignmentPlan(
      ocrText,
      candidateFor(ocrText),
      furnitureFor(ocrPages, 2)
    )

    expect(plan?.ignoredOcrSpans).toEqual([])
    expect(plan?.ignoredGeminiSpans).toEqual([])
  })

  test('retains negation and amount evidence inside a uniquely repeated footer', () => {
    const footer = 'saldo não liberado por R$ 10,00'
    const ocrPages = [
      pageText(1, 'Corpo alfa 10.', footer),
      pageText(2, 'Corpo beta 20.', footer),
      pageText(3, 'Corpo gama 30.', footer),
    ]
    const visualText = pageText(2, 'Corpo beta 20.', 'saldo liberado por R$ 20,00')
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: furnitureFor(ocrPages, 2),
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ scope: 'clause', categories: ['currency', 'negation'] }),
    ])
    expect(
      visualText.slice(
        result.metadata.criticalUncertainties[0].start,
        result.metadata.criticalUncertainties[0].end
      )
    ).toContain('saldo liberado por R$ 20,00')
  })

  test('does not classify repeated legal acts or an edge phrase duplicated in body', () => {
    const legalPages = [1, 2, 3].map(page =>
      ['R.9 ato repetido valor 10.', `Página ${page} de 3`, 'corpo', 'fim', 'base', 'rodapé'].join(
        '\n'
      )
    )
    expect(furnitureFor(legalPages, 2)?.top.some(line => line.text.includes('R.9'))).toBe(false)

    const ambiguousPages = [1, 2, 3].map(page =>
      ['FRASE DUPLA', `Página ${page} de 3`, 'FRASE DUPLA', 'corpo', 'base', 'rodapé'].join('\n')
    )
    expect(furnitureFor(ambiguousPages, 2)?.top.some(line => line.text === 'FRASE DUPLA')).toBe(
      false
    )
  })

  test('preserves a fraction divergence in a wrapped repeated legal act', () => {
    const ocrPages = [1, 2, 3].map(page =>
      [
        'R.9 FRAÇÃO IDEAL',
        '1 / 2',
        `corpo sintético ${page}`,
        'linha final',
        'base sintética',
        'rodapé sintético',
      ].join('\n')
    )
    const visualText = ocrPages[1].replace('1 / 2', '1 / 3')
    const profile = furnitureFor(ocrPages, 2)

    expect(profile?.top.some(line => line.text === '1 / 2')).toBe(false)
    const result = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: profile,
    })

    expect(result.status).toBe('selected')
    if (result.status !== 'selected') throw new Error('expected selected candidate')
    expect(result.text).toBe(visualText)
    expect(result.metadata.criticalUncertainties).toEqual([
      expect.objectContaining({ categories: ['fraction'], divergences: ['different_value'] }),
    ])
  })

  test('treats one-page and cross-band repetition as body', () => {
    const single = buildDocumentFurnitureProfile([{ pageNumber: 1, text: pageText(1, 'corpo') }])
    expect(single.get(1)).toEqual({ top: [], bottom: [] })

    const crossBand = [
      ['CRUZADA', 'topo', 'a', 'b', 'base', 'fim'].join('\n'),
      ['CRUZADA', 'topo', 'a', 'b', 'base', 'fim'].join('\n'),
      ['topo', 'aux', 'a', 'b', 'base', 'CRUZADA'].join('\n'),
    ]
    expect(furnitureFor(crossBand, 1)?.top.some(line => line.text === 'CRUZADA')).toBe(false)
    expect(furnitureFor(crossBand, 3)?.bottom.some(line => line.text === 'CRUZADA')).toBe(false)
  })

  test('preserves emoji UTF-16 offsets and shares one budget across top, body and bottom', () => {
    const ocrPages = [
      pageText(1, '🧾 corpo alfa valor 10.'),
      pageText(2, '🧾 corpo beta valor 20.'),
      pageText(3, '🧾 corpo gama valor 30.'),
    ]
    const visualText = pageText(2, '🧾 corpo beta valor 21.')
    const profile = furnitureFor(ocrPages, 2)
    const selected = reconcileGeminiWholePage({
      ocrText: ocrPages[1],
      visualText,
      maxAlignmentCells: MAX_CELLS,
      furnitureProfile: profile,
    })
    expect(selected.status).toBe('selected')
    if (selected.status !== 'selected') throw new Error('expected selected candidate')
    expect(
      selected.metadata.criticalUncertainties.map(range => visualText.slice(range.start, range.end))
    ).toContain('21')

    expect(
      reconcileGeminiWholePage({
        ocrText: ocrPages[1],
        visualText,
        maxAlignmentCells: 80,
        furnitureProfile: profile,
      })
    ).toMatchObject({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })

  test('rejects oversized edge preprocessing before profile allocation', () => {
    const pages = [1, 2, 3].map(pageNumber => ({
      pageNumber,
      text: `${'X'.repeat(10_000)}\nheader\nbody\nend\nbase\nfooter`,
    }))
    const profile = buildDocumentFurnitureProfile(pages, 1_000).get(1)
    expect(profile?.preprocessingExceeded).toBe(true)
    expect(
      reconcileGeminiWholePage({
        ocrText: pages[0].text,
        visualText: pages[0].text,
        maxAlignmentCells: 1_000,
        furnitureProfile: profile,
      })
    ).toEqual({ status: 'rejected', reason: 'alignment_budget_exceeded' })
  })
})
