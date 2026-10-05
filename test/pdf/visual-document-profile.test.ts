import { describe, expect, test } from 'bun:test'
import {
  inferVisualDocumentProfile,
  resolveVisualDocumentProfile,
  resolveVisualPageProfile,
  VISUAL_DOCUMENT_PROFILES,
  type VisualDocumentKind,
  type VisualDocumentProfile,
} from '../../src/core/services/messages/pdf-utils/visual-document-profile'

describe('visual document profile', () => {
  test.each(['matrícula.pdf', 'matricula.pdf', 'MaTrÍcUlA-123.PDF'])(
    'infers the matrícula profile from %s',
    fileName => {
      const profile = inferVisualDocumentProfile(fileName)

      expect(profile).toBe(VISUAL_DOCUMENT_PROFILES.matricula)
    }
  )

  test.each(['documento-generico.pdf', 'contrato-social.pdf', 'certidão-de-registro.pdf'])(
    'does not infer a profile from %s',
    fileName => {
      const profile = inferVisualDocumentProfile(fileName)

      expect(profile).toBeUndefined()
    }
  )

  test('represents every internal document kind with a neutral default when unverified', () => {
    const kinds: readonly VisualDocumentKind[] = [
      VISUAL_DOCUMENT_PROFILES.matricula.kind,
      VISUAL_DOCUMENT_PROFILES.contrato.kind,
      VISUAL_DOCUMENT_PROFILES['certidao-registro'].kind,
      VISUAL_DOCUMENT_PROFILES['legal-generico'].kind,
      VISUAL_DOCUMENT_PROFILES.tabela.kind,
    ]

    expect(kinds).toEqual([
      'matricula',
      'contrato',
      'certidao-registro',
      'legal-generico',
      'tabela',
    ])
    expect(VISUAL_DOCUMENT_PROFILES.contrato.transcriptionHints).toEqual([])
    expect(VISUAL_DOCUMENT_PROFILES['certidao-registro'].transcriptionHints).toEqual([])
    expect(VISUAL_DOCUMENT_PROFILES['legal-generico'].transcriptionHints).toEqual([])
  })

  test('prefers an explicit internal profile over matrícula filename inference', () => {
    const explicitProfile = {
      kind: 'contrato',
      transcriptionHints: ['Dica interna verificada.'],
    } satisfies VisualDocumentProfile

    const resolved = resolveVisualDocumentProfile('matrícula.pdf', explicitProfile)

    expect(resolved).toEqual(explicitProfile)
    expect(resolved).not.toBe(explicitProfile)
  })

  test('returns frozen profiles without mutating an explicit internal profile', () => {
    const explicitProfile = {
      kind: 'certidao-registro',
      transcriptionHints: ['Preserve o texto literal.'],
    } satisfies VisualDocumentProfile
    const originalHints = [...explicitProfile.transcriptionHints]

    const resolved = resolveVisualDocumentProfile('documento.pdf', explicitProfile)

    expect(explicitProfile.transcriptionHints).toEqual(originalHints)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved?.transcriptionHints)).toBe(true)
    for (const profile of Object.values(VISUAL_DOCUMENT_PROFILES)) {
      expect(Object.isFrozen(profile)).toBe(true)
      expect(Object.isFrozen(profile.transcriptionHints)).toBe(true)
    }
  })

  test('keeps the verified matrícula transcription hint unchanged', () => {
    expect(VISUAL_DOCUMENT_PROFILES.matricula.transcriptionHints).toEqual([
      'Preserve marcadores R. e AV. exatamente como visíveis.',
    ])
  })

  test('routes pages with repeated numeric columns through the table profile', () => {
    const resolved = resolveVisualPageProfile(undefined, {
      text: '19 20 21 22 23\nAp.36 86,70 10,85 97,55\nAp.41 102,70 12,90 115,60',
      tableCount: 0,
    })

    expect(resolved?.kind).toBe('tabela')
  })

  test('routes extractor-detected tables through the table profile', () => {
    const resolved = resolveVisualPageProfile(VISUAL_DOCUMENT_PROFILES.matricula, {
      text: 'texto curto',
      tableCount: 1,
    })

    expect(resolved?.kind).toBe('tabela')
  })
})
