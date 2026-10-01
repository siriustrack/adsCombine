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
4. within the same severity, the measured intensity of corruption, fragmentation, garbling,
   missing markers, and confidence deficit
5. page-number order only when severity and intensity are equal

Organizational expressions such as `área de atuação`, `área de competência`, `área de
conhecimento`, and `área de jurisdição` do not trigger the physical-measure risk.

Pages excluded by per-PDF or per-job limits are internal `fallback_skipped` /
`outcome: skipped` decisions with `decisionReason: budget_exhausted`. They are not provider
or rendering failures, are omitted from page-level public metadata, and are counted only in
the file/job aggregate summary by `pdf` or `job` scope.

## Latency trade-offs

The policy spends visual fallback calls first on pages most likely to have unusable OCR, which improves recovery under tight caps without increasing the configured cap. Broader routing would increase render/provider latency and should not be enabled until routing metrics show missed recovery on capped pages.

Mixed-page OCR remains inactive by default and is not activated by jobs. Rotation, Gemini fallback activation, and model defaults are unchanged.

## Rollout guidance

- Monitor selected page counts, `weak-ocr-evidence` reasons, provider latency, and `budget_exhausted` rates per PDF.
- Benchmark model changes only after the routing metrics stabilize; otherwise model latency/quality changes will be confounded with routing changes.
- If `budget_exhausted` rises on high-value documents, adjust caps or routing thresholds with an A/B benchmark rather than enabling mixed-page or changing providers globally.
