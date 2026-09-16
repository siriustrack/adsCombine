import { reconcileGeminiWholePage as reconcileGeminiWholePagePolicy } from '../../src/core/services/messages/pdf-utils/gemini-whole-page-critical.policy'

export type ReconciliationInput = Parameters<typeof reconcileGeminiWholePagePolicy>[0]

export function reconcileGeminiWholePage(input: ReconciliationInput) {
  return reconcileGeminiWholePagePolicy({ maxAlignmentCells: 10_000_000, ...input })
}
