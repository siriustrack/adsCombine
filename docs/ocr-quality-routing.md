# OCR quality routing

## Findings

- Global native-text quality now measures word density from actual whitespace-delimited words. The previous approximation (`characters / 5`) made density nearly constant and could mark dense short-token text as high quality.
- Visual fallback routing now uses weak OCR evidence already produced by enhanced OCR pages: text, mean confidence, word count, and warnings.
- Confidence alone is intentionally insufficient for routing. A low-confidence page needs another weak signal before it spends visual fallback budget.

## Current policy

Enhanced OCR pages are eligible for visual fallback when they have existing legal-risk signals or conservative weak OCR evidence.

Weak OCR evidence is selected when either:

1. the page has no sanitized text, or enhanced OCR emitted `no-text-detected`; or
2. at least two routing thresholds are present:
   - `meanConfidence <= 50`
   - `wordCount <= 5`
   - sanitized and trimmed text length `<= 30`

Risky pages are sorted before `maxPagesPerPdf` is applied:

1. no-text / weak OCR evidence
2. corrupted symbols, garbled spans, or fragmented numbers/measures
3. missing legal marker or missing measure risks
4. page-number order for ties

Pages excluded by the per-PDF cap are recorded as `fallback_failed` with `decisionReason: budget_exhausted` in V1, matching the existing V2 budget semantics.

## Latency trade-offs

The policy spends visual fallback calls first on pages most likely to have unusable OCR, which improves recovery under tight caps without increasing the configured cap. Broader routing would increase render/provider latency and should not be enabled until routing metrics show missed recovery on capped pages.

Mixed-page OCR remains inactive by default and is not activated by jobs. Rotation, Gemini fallback activation, and model defaults are unchanged.

## Rollout guidance

- Monitor selected page counts, `weak-ocr-evidence` reasons, provider latency, and `budget_exhausted` rates per PDF.
- Benchmark model changes only after the routing metrics stabilize; otherwise model latency/quality changes will be confounded with routing changes.
- If `budget_exhausted` rises on high-value documents, adjust caps or routing thresholds with an A/B benchmark rather than enabling mixed-page or changing providers globally.
