import { expect, test } from 'bun:test'
import { buildClauseIndex } from '../../src/core/services/messages/pdf-utils/gemini-critical-ranges'
import { tokenize } from '../../src/core/services/messages/pdf-utils/gemini-critical-tokenization'

test('builds dense whitespace boundaries within a deterministic linear operation budget', () => {
  const text = `🧾 R.22 início;${'\n'.repeat(4_096)}fim.`
  let operations = 0
  const index = buildClauseIndex(text, tokenize(text), {
    onCharacterRead() {
      operations++
    },
  })

  expect(operations).toBeLessThanOrEqual(text.length * 2)
  const fim = text.indexOf('fim')
  expect(index.locate(fim)).toEqual({ start: fim, end: text.length })
  expect(index.locate(text.indexOf('R.22') + 2).start).toBe(0)
})
