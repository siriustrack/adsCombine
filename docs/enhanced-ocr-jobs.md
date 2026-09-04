# Enhanced OCR Jobs

The enhanced OCR flow is opt-in and asynchronous. Existing endpoints and their response contracts remain unchanged.

## Create an enhanced job

`POST /api/jobs/process-message/enhanced`

The request body uses the same message schema as `POST /api/jobs/process-message`. The route requires the existing jobs bearer token and returns HTTP `202` with `jobId`, `statusUrl`, and a `resultUrl` ending in `/result/enhanced`.

Enhanced jobs use the existing all-page OCR pipeline. They do not enable `mixed-page` and do not execute the standard and enhanced OCR paths for the same PDF.

## Read the enhanced result

`GET /api/jobs/:jobId/result/enhanced`

- Queued or processing jobs return HTTP `202`.
- Failed or expired jobs keep the existing terminal-job semantics.
- A completed standard job returns HTTP `409` because it has no enhanced result.
- A missing job returns HTTP `404`.
- A completed enhanced job returns the legacy result fields plus `profile`, `summary`, and `files` with page-level OCR quality metadata.

Page metadata may include confidence, word count, the selected OCR attempt and PSM, rotation information, registry/legal signals, and quality warnings. These values are heuristic processing signals. They do not certify that the transcription matches the original document and must not be treated as legal conclusions.

## Quality strategy

Enhanced OCR keeps the current rasterization and bounded attempt budget. It changes how attempts are evaluated:

- rewards preserved registry markers, dates, CPF/CNPJ, currency, fractions, and square-meter measurements;
- penalizes corrupted symbols, fragmented numbers or measurements, repeated identical labels, and garbled spans;
- runs the alternate PSM only when the first result contains degradation signals;
- applies conservative whitespace cleanup without reconstructing names, dates, measurements, or other factual values.

The original jobs and synchronous routes continue using their existing behavior.
