# Embedded document notices

Enhanced OCR can miss short notices drawn as rotated or transparent image
overlays. After normal page OCR and page-budget validation, the extractor checks
small, wide embedded images for an explicit Portuguese no-certificate warning.
Only observed matching lines are appended to the same page, marked as embedded
image OCR. Existing page text and registry acts are retained.

The supplemental reader has a five-second total deadline and at most two local
Tesseract attempts across at most two pages per PDF. It exports only pages with
candidate strips, at most 16 images and 32 Mi pixels per page. Image dimensions
and the total export bound are checked before extraction. No AI provider or
additional page rendering is used; caller cancellation and temporary cleanup
follow the existing OCR lifecycle.

`embedded-document-notice` identifies recovered evidence. Budget exclusions and
read failures remain visible through `document-notice-budget-exhausted` and
`document-notice-read-unavailable`. Absence of a detected notice is not proof
that the source is a valid certificate or that every graphic element was read.
This is not general OCR of all embedded images.

The supplied one-page case preserves AV1, AV2, R3, cancellation and payment while
recovering the no-certificate line. Only synthetic fixtures are maintained in
the repository. Old stored transcriptions are not automatically replaced.
