import { expect, test } from 'bun:test'
import {
  acquisitionClauseFromBaseImage,
  unreadAcquisitionClauses,
} from '../../src/core/services/messages/pdf-utils/registry-acquisition-clause'

const damaged =
  'Av. 1 - Cidade.\nPESSOA A e PESSOA B, supra qualifi See E mével por compra feita-a PESSOA C, pelo preço de R$ 10,00.\n'
const clear =
  'Av. 1 - Cidade.\nPESSOA A e PESSOA B, supra qualificados, adquiriram o imóvel por compra feita a PESSOA C e PESSOA D, pelo preço de R$ 10,00.\n'
const terminal = 'R. 3 - Cidade.\nPESSOA A vendeu a PESSOA E.'

test('identifies an unread acquisition verb without assigning parties', () => {
  // Given / When
  const gaps = unreadAcquisitionClauses(damaged + terminal)
  // Then
  expect(gaps.map(gap => gap.key)).toEqual(['AV.1'])
  expect(gaps[0]?.end).toBe(damaged.length)
  expect(unreadAcquisitionClauses(clear + terminal)).toEqual([])
})

test('recovers only the matching observed introductory clause, not a later sale', () => {
  // Given / When
  const clause = acquisitionClauseFromBaseImage(clear + terminal, 'AV.1')
  // Then
  expect(clause).toBe(
    'PESSOA A e PESSOA B, supra qualificados, adquiriram o imóvel por compra feita a PESSOA C e PESSOA D,'
  )
  expect(acquisitionClauseFromBaseImage(clear + terminal, 'R.3')).toBeUndefined()
})

test('refuses ambiguous, incomplete and still unreadable base clauses', () => {
  // Given / When / Then
  expect(acquisitionClauseFromBaseImage(clear + clear, 'AV.1')).toBeUndefined()
  expect(acquisitionClauseFromBaseImage(damaged, 'AV.1')).toBeUndefined()
  expect(
    acquisitionClauseFromBaseImage(clear.replace('pelo preço', 'fragmento'), 'AV.1')
  ).toBeUndefined()
})
