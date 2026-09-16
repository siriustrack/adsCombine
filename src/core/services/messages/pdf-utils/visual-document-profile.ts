export const VISUAL_DOCUMENT_KINDS = [
  'matricula',
  'contrato',
  'certidao-registro',
  'legal-generico',
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
}) satisfies Readonly<Record<VisualDocumentKind, VisualDocumentProfile>>

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
