import { createRegions, pairRegions, type Region, type RegionPair } from './gemini-critical-regions'
import type { AlignmentLedger, Token } from './gemini-critical-tokenization'
import type { FurnitureAlignmentSection } from './gemini-page-furniture'
import type { V2DiagnosticRecorder } from './visual-fallback.diagnostics'

export type RegionPairingStrategy = (input: {
  readonly section: FurnitureAlignmentSection
  readonly ocrRegions: readonly Region[]
  readonly geminiRegions: readonly Region[]
  readonly ledger: AlignmentLedger
}) =>
  | Readonly<{ status: 'budget_exceeded' }>
  | Readonly<{
      status: 'paired'
      pairs: readonly RegionPair[]
      ambiguous: boolean
    }>

export type CriticalSectionPairing = Readonly<{
  section: FurnitureAlignmentSection
  pairing: Readonly<{
    pairs: RegionPair[]
    ambiguous: boolean
  }>
}>

export const pairIncumbentRegions: RegionPairingStrategy = input => ({
  status: 'paired',
  ...pairRegions([...input.ocrRegions], [...input.geminiRegions]),
})

export type CriticalSectionPairingResult =
  | Readonly<{ status: 'budget_exceeded' }>
  | Readonly<{ status: 'paired'; pairings: readonly CriticalSectionPairing[] }>

export function pairCriticalSections(input: {
  readonly ocrText: string
  readonly geminiText: string
  readonly ocrTokens: readonly Token[]
  readonly geminiTokens: readonly Token[]
  readonly sections: readonly FurnitureAlignmentSection[]
  readonly strategy: RegionPairingStrategy
  readonly ledger: AlignmentLedger
  readonly diagnostics?: V2DiagnosticRecorder
}): CriticalSectionPairingResult {
  const pairings: CriticalSectionPairing[] = []
  for (const section of input.sections) {
    const ocrRegions = createRegions(
      input.ocrText,
      input.ocrTokens.filter(
        token => token.start >= section.ocrStart && token.end <= section.ocrEnd
      )
    )
    const geminiRegions = createRegions(
      input.geminiText,
      input.geminiTokens.filter(
        token => token.start >= section.geminiStart && token.end <= section.geminiEnd
      )
    )
    const result = input.strategy({ section, ocrRegions, geminiRegions, ledger: input.ledger })
    if (result.status === 'budget_exceeded') {
      input.diagnostics?.record('alignment_budget_exceeded', section.kind)
      return result
    }
    const pairing = { pairs: [...result.pairs], ambiguous: result.ambiguous }
    input.diagnostics?.addRegionCounts({
      ocr: ocrRegions.length,
      gemini: geminiRegions.length,
      paired: pairing.pairs.length,
      unpairedOcr: ocrRegions.length - pairing.pairs.length,
      unpairedGemini: geminiRegions.length - pairing.pairs.length,
    })
    pairings.push({ section, pairing })
  }
  return { status: 'paired', pairings }
}
