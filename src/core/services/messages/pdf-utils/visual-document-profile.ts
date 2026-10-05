export const VISUAL_DOCUMENT_KINDS = [
  'matricula',
  'contrato',
  'certidao-registro',
  'legal-generico',
  'tabela',
] as const

export type VisualDocumentKind = (typeof VISUAL_DOCUMENT_KINDS)[number]

export type VisualDocumentProfile = {
  readonly kind: VisualDocumentKind
  readonly transcriptionHints: readonly string[]
}

function freezeProfile(profile: VisualDocumentProfile): VisualDocumentProfile {
  return Object.freeze({
    kind: profile.kind,
    transcriptionHints: Object.freeze([...profile.transcriptionHints]),
  })
}

export const VISUAL_DOCUMENT_PROFILES = Object.freeze({
  matricula: freezeProfile({
    kind: 'matricula',
    transcriptionHints: ['Preserve marcadores R. e AV. exatamente como visíveis.'],
  }),
  contrato: freezeProfile({ kind: 'contrato', transcriptionHints: [] }),
  'certidao-registro': freezeProfile({ kind: 'certidao-registro', transcriptionHints: [] }),
  'legal-generico': freezeProfile({ kind: 'legal-generico', transcriptionHints: [] }),
  tabela: freezeProfile({
    kind: 'tabela',
    transcriptionHints: [
      'Esta página contém uma tabela.',
      'Preserve linhas, colunas, cabeçalhos e células vazias.',
      'Não reordene, agrupe ou deduplique números.',
      'Se não conseguir associar cada valor à sua coluna, responda com status "abstain".',
    ],
  }),
}) satisfies Readonly<Record<VisualDocumentKind, VisualDocumentProfile>>

const NUMERIC_CELL_PATTERN = /^\d+(?:[.,]\d+)*$/u
const AREA_TABLE_HEADING_PATTERN =
  /(?:quadro|tabela|c[aá]lculo\s+das?\s+[aá]reas?|[aá]reas?\s+das?\s+unidades?\s+aut[oô]nomas?)/iu

export function isLikelyTabularText(text: string): boolean {
  const rows = text
    .split('\n')
    .map(line => line.trim().split(/\s+/u).filter(Boolean))
    .filter(tokens => tokens.length > 0)
  const hasNumericHeader = rows.some(
    tokens => tokens.length >= 5 && tokens.every(token => NUMERIC_CELL_PATTERN.test(token))
  )
  const hasLabeledDataRow = rows.some(
    tokens =>
      tokens.some(token => !NUMERIC_CELL_PATTERN.test(token)) &&
      tokens.filter(token => NUMERIC_CELL_PATTERN.test(token)).length >= 3
  )

  return hasNumericHeader && hasLabeledDataRow
}

export function hasTabularAreaReference(text: string, tableCount = 0): boolean {
  const hasAreaTableHeading = text.split('\n').some(line => AREA_TABLE_HEADING_PATTERN.test(line))
  return hasAreaTableHeading && (tableCount > 0 || isLikelyTabularText(text))
}

export function inferVisualDocumentProfile(fileName: string): VisualDocumentProfile | undefined {
  const normalizedFileName = fileName.normalize('NFD').replace(/\p{Diacritic}/gu, '')
  return /matricula/iu.test(normalizedFileName) ? VISUAL_DOCUMENT_PROFILES.matricula : undefined
}

export function resolveVisualDocumentProfile(
  fileName: string,
  explicitProfile?: VisualDocumentProfile
): VisualDocumentProfile | undefined {
  return explicitProfile === undefined
    ? inferVisualDocumentProfile(fileName)
    : freezeProfile(explicitProfile)
}

export function resolveVisualPageProfile(
  documentProfile: VisualDocumentProfile | undefined,
  page: { readonly text: string; readonly tableCount?: number }
): VisualDocumentProfile | undefined {
  const isTabular = (page.tableCount ?? 0) > 0 || isLikelyTabularText(page.text)
  if (!isTabular) return documentProfile

  return freezeProfile({
    kind: 'tabela',
    transcriptionHints: [
      ...(documentProfile?.transcriptionHints ?? []),
      ...VISUAL_DOCUMENT_PROFILES.tabela.transcriptionHints,
    ],
  })
}
