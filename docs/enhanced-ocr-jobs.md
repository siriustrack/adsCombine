# Enhanced OCR & Selective Visual Fallback Jobs

The enhanced OCR flow in `adsCombine` is an opt-in, asynchronous pipeline designed for high-precision transcription of legal documents. Existing standard endpoints and response contracts remain fully backward compatible.

---

## 1. API Endpoints

### Create an Enhanced Job
`POST /api/jobs/process-message/enhanced`

- **Headers**: Authorization bearer token (`JOBS_TOKEN`).
- **Body**: Standard process-message JSON payload.
- **Response**: HTTP `202 Accepted` with `jobId`, `statusUrl`, and `resultUrl` (ending in `/result/enhanced`).

### Read Enhanced Result
`GET /api/jobs/:jobId/result/enhanced`

- **HTTP 202**: Job is queued or currently processing.
- **HTTP 404**: Job ID does not exist.
- **HTTP 409**: Job completed under standard profile (no enhanced metadata exists).
- **HTTP 200**: Job completed. Returns legacy result payload plus `profile`, `summary`, and `files` containing page-level OCR quality and visual fallback metadata.

---

## 2. Environment Configuration

Selective Gemini visual fallback, job queue parameters, OCR hard limits, and source file downloading are controlled via environment variables defined in `src/config/env.ts`.

### Core Service & Authentication

| Environment Variable | Type | Default | Validation / Constraint | Description |
| :--- | :--- | :--- | :--- | :--- |
| `BASE_URL` | string | `undefined` | required non-empty string | Service public base URL used for absolute endpoint links. |
| `PORT` | integer | `3000` | positive integer | HTTP server listening port. |
| `TOKEN` | string (secret) | `undefined` | required non-empty string | Standard bearer token for legacy route protection. |
| `JOBS_TOKEN` | string (secret) | `undefined` | required non-empty string | Bearer token required for enhanced jobs API authentication. |
| `REQUEST_LOGS_ENABLED` | boolean | `false` | boolean | Toggle for verbose HTTP request/route logging. |
| `OPENAI_API_KEY` | string (secret) | `undefined` | required non-empty string | OpenAI API key used for standard transcription processing. |
| `OPENAI_MODEL_TEXT` | string | `undefined` | required non-empty string | Default OpenAI model for text processing operations. |

### Safe File Download & Storage Origins

| Environment Variable | Type | Default | Validation / Constraint | Description |
| :--- | :--- | :--- | :--- | :--- |
| `FILE_DOWNLOAD_ALLOWED_URL_PREFIXES` | string | `undefined` | comma-separated URLs | Explicit allowlist origin prefixes for downloading source files. Exact-origin format recommended. |
| `SUPABASE_URL` | URL | `undefined` | valid URL | Supabase project URL (auto-derives `/storage/v1/object/` download prefix). |
| `SUPABASE_STORAGE_URL` | URL | `undefined` | valid URL | Dedicated storage endpoint URL (auto-derives `/storage/v1/object/` prefix). |
| `STORAGE_URL` | URL | `undefined` | valid URL | Generic storage URL (auto-derives `/storage/v1/object/` prefix). |

### Job Queue & Processing Limits

| Environment Variable | Type | Default | Max Limit / Constraint | Description |
| :--- | :--- | :--- | :--- | :--- |
| `PROCESSING_CONCURRENCY` | integer | `5` | positive integer, max `10` | Concurrency limit for general background request processing. |
| `JOBS_MAX_CONCURRENCY` | integer | `1` | positive integer, max `4` | Maximum worker concurrency for processing async job queue entries. |
| `JOBS_MAX_QUEUE_SIZE` | integer | `100` | positive integer, max `1000` | Maximum queue capacity for pending asynchronous jobs. |
| `JOBS_RETENTION_HOURS` | integer | `24` | positive integer, max `168` (7 days) | Retention window in hours before completed or failed job entries expire. |
| `JOB_STALE_AFTER_MS` | integer | `3600000` | positive integer, max `3600000` (1h) | Duration in milliseconds after which an active job is flagged as stale. |

### OCR & Document Hard Limits

| Environment Variable | Type | Default | Max Limit / Constraint | Description |
| :--- | :--- | :--- | :--- | :--- |
| `EXTRACTION_MAX_FILE_BYTES` | integer | `104857600` | positive integer, max `104857600` (100MB) | Maximum file size in bytes accepted for text extraction. |
| `MAX_FILES_PER_JOB` | integer | `10` | positive integer, max `10` | Maximum number of files accepted within a single job execution. |
| `MAX_PDF_PAGES` | integer | `300` | positive integer, max `300` | Maximum page count permitted per individual PDF file. |
| `MAX_OCR_PAGES_PER_PDF` | integer | `150` | positive integer, max `150` | Maximum pages selected for OCR processing per individual PDF file. |
| `MAX_TOTAL_OCR_PAGES_PER_JOB` | integer | `200` | positive integer, max `1000` | Budget limit for total OCR pages processed across an entire job. |
| `OCR_MAX_PAGES_PER_CHUNK` | integer | `2` | positive integer, max `10` | Maximum pages processed per parallel OCR chunk execution. |
| `PDF_OCR_ALWAYS_THRESHOLD` | integer | `5` | positive integer, max `50` | PDF page count threshold below which OCR is always enforced. |
| `PDF_BYTES_PER_PAGE_THRESHOLD` | number | `50000` | positive number | File size per page threshold used to detect scanned or low-native text PDFs. |
| `MIXED_PAGE_OCR_DIRECT_MAX_PAGES` | integer | `10` | positive integer, max `50` | Maximum pages directly processed under mixed native and image mode. |
| `MIXED_PAGE_MIN_NATIVE_CHARS_PER_PAGE` | integer | `80` | positive integer | Minimum native characters per page required to consider native text valid. |

### Gemini Visual Fallback Configuration

| Environment Variable | Type | Default | Max Limit / Validation | Description |
| :--- | :--- | :--- | :--- | :--- |
| `VISUAL_FALLBACK_ENABLED` | boolean | `false` | boolean (`1`/`true`/`yes`/`on` or `0`/`false`/`no`/`off`) | Master toggle for selective visual fallback. Requires `GEMINI_API_KEY` to be set. |
| `VISUAL_FALLBACK_SHADOW_MODE` | boolean | `true` | boolean | When `true`, records visual state as `ocr_plus_visual_candidate` with SHA-256 hashes without active reconciliation (candidate text is never persisted). |
| `VISUAL_FALLBACK_MODEL` | string | `"gemini-2.5-flash"` | min 1 char | Gemini model ID used for visual page transcription. |
| `VISUAL_FALLBACK_TIMEOUT_MS` | integer | `15000` | positive integer, max `120000` (120s) | Per-page timeout in milliseconds for Gemini API requests. |
| `VISUAL_FALLBACK_MAX_RETRIES` | integer | `1` | min `0`, max `3` | Maximum retry attempts for failed Gemini API requests. |
| `VISUAL_FALLBACK_CONCURRENCY` | integer | `1` | positive integer, max `4` | Maximum concurrent visual fallback page requests per job. |
| `VISUAL_FALLBACK_MAX_PAGES_PER_PDF` | integer | `2` | positive integer, max `10` | Maximum risky pages selected for visual fallback per single PDF file. |
| `MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB` | integer | `4` | positive integer, max `20` | Maximum budget of total visual fallback pages across all files in a single job. |
| `GEMINI_API_KEY` | string (secret) | `undefined` | min 1 char | Google Gemini API key. Must use a paid tier account for sensitive legal documents. |

---

## 3. Selective Gemini Visual Fallback Architecture

Visual fallback operates as a secondary, highly targeted enhancement step for scanned legal documents (matrículas imobiliárias).

### Selective Execution Strategy
1. **Matrícula-Only Filter (`isMatriculaPdf`)**: Processing occurs strictly for PDF files where the filename matches `/matr[ií]cula/iu`. Non-matrícula documents bypass visual fallback completely (`ocr_only`).
2. **Page Degradation Detection (`selectRiskReasons`)**: Only pages with quality risk signals are selected:
   - `corrupted-symbols`: Unreadable or corrupted character spans.
   - `fragmented-number-or-measure`: Disrupted numeric values or measure units.
   - `garbled-spans`: Low-confidence or distorted text blocks.
   - `missing-measure`: Area/superfície mentioned in page text but zero square-meter markers found.
   - `missing-legal-marker`: Fragmented numbers present with registry markers but zero legal markers.
3. **Strict Page Budget Enforcement**:
   - Per-PDF cap: `VISUAL_FALLBACK_MAX_PAGES_PER_PDF` (default `2`, max `10`).
   - Global job cap: `MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB` (default `4`, max `20`).

### Immutable OCR Policy
Standard OCR transcription output is **immutable**. Visual fallback never modifies, overwrites, or truncates the primary OCR text directly. Candidate visual text is never saved or persisted. Only SHA-256 hashes (`imageSha256` and `candidateSha256`), provider (`gemini`), model, states, and ranges are stored alongside standard page metrics inside `visualFallback`.

### Shadow Rollout Semantics (`VISUAL_FALLBACK_SHADOW_MODE`)
- **Shadow Mode (`true` - Default)**: Visual fallback renders the page, requests a transcription from Gemini, and records state `ocr_plus_visual_candidate` with `imageSha256` and `candidateSha256` in `visualFallback` (candidate visual text itself is never saved or persisted). No active text comparison or reconciliation is performed. This enables benchmarking Gemini accuracy safely in production.
- **Active Mode (`false`)**: Normalizes standard OCR text and Gemini candidate text in memory (`normalizeForComparison`):
  - **Identical**: State becomes `reconciled`.
  - **Different**: State becomes `conflict`.

### Visual Fallback State Reference

| State | Description |
| :--- | :--- |
| `ocr_only` | Page was not evaluated by visual fallback (non-matrícula PDF or no risk signals detected). |
| `fallback_pending` | Visual fallback rendering or Gemini request is currently in progress. |
| `fallback_failed` | Visual fallback failed due to rendering error, timeout (default 15s, max 120s), max retries exceeded (default 1, max 3), or API failure. |
| `ocr_plus_visual_candidate` | Visual candidate generated successfully in shadow mode (`VISUAL_FALLBACK_SHADOW_MODE=true`). Candidate text is not saved. |
| `reconciled` | Active mode (`VISUAL_FALLBACK_SHADOW_MODE=false`), Gemini candidate text matches standard OCR text. |
| `conflict` | Active mode (`VISUAL_FALLBACK_SHADOW_MODE=false`), Gemini candidate text differs from standard OCR text. |

---

## 4. Storage & Download URL Allowlist Configuration

To guard against SSRF (Server-Side Request Forgery) and unauthorized resource access, `FileDownloadService` enforces strict origin allowlists when downloading source files.

### Exact-Origin Guidance (`FILE_DOWNLOAD_ALLOWED_URL_PREFIXES`)
- **Explicit Prefixes**: When specifying `FILE_DOWNLOAD_ALLOWED_URL_PREFIXES`, specify exact origin prefixes.
  - *Example*: `FILE_DOWNLOAD_ALLOWED_URL_PREFIXES=https://xyz.supabase.co/storage/v1/object/public/`
- **Automatic Storage Origin Derivation**: If `SUPABASE_URL`, `SUPABASE_STORAGE_URL`, or `STORAGE_URL` are set, `adsCombine` automatically appends `/storage/v1/object/` to form allowed download prefixes.
- **Redirect Validation & DNS Pinning**: Downloads follow up to 3 redirects (`MAX_REDIRECTS = 3`). Redirect target URLs are validated against the allowlist policy and DNS-pinned prior to fetching.

---

## 5. Enterprise Data Privacy & Gemini Paid Tier Requirement

When handling matrículas imobiliárias and legal contracts containing sensitive personal and financial data:

- **Mandatory Paid Tier Account**: `GEMINI_API_KEY` MUST belong to a **paid tier Google Cloud / Gemini API account**.
- **Data Privacy Guarantee**: Google Cloud paid tier enterprise terms guarantee that submitted PDF images and candidate transcriptions are not retained or used for AI model training.
- **Free Tier Prohibition**: Public developer or free-tier API keys MUST NOT be used for processing customer documents.

---

## 6. Operational Kill Switch, Rollback, & Zero Migration

### Operational Kill Switch
If Gemini services experience degradation or rate limits, operators can disable visual fallback instantly:
1. Set `VISUAL_FALLBACK_ENABLED=false` in environment configuration.
2. Restart or reload the `adsCombine` service.
3. Jobs will immediately skip visual fallback processing (`ocr_only`) without interrupting standard OCR execution.

### Zero Database Migration Architecture
- Visual fallback results are stored inside the existing JSON payload structure returned by enhanced endpoints.
- Toggling `VISUAL_FALLBACK_ENABLED` or changing budget environment variables requires **zero database schema migrations**.
- Stored historical job results remain completely compatible and unaffected.

---

## 7. Security Protocols & Secret Rotation

- **Never Commit Secrets**: `GEMINI_API_KEY`, `JOBS_TOKEN`, `OPENAI_API_KEY`, and other secrets must remain strictly in environment variables and never committed to source control or public files.
- **Secret Rotation Protocol**: If any API key is exposed in logs, git commit history, or unencrypted storage, operators MUST immediately:
  1. Revoke the compromised API key in the provider console (e.g., Google Cloud Console).
  2. Generate a new API key.
  3. Update environment configuration and restart application services.

---

## 8. Metrics & Observability

Operators should track the following health indicators in service logs:
- **Visual Fallback Success Rate**: Percentage of processed pages reaching `reconciled` or `ocr_plus_visual_candidate` vs `fallback_failed`.
- **Budget Rejections**: Logged events when job page count hits `MAX_TOTAL_VISUAL_FALLBACK_PAGES_PER_JOB` (default 4).
- **Download Security Rejections**: Log entries generated when source URLs fail `SourceUrlPolicy` allowlist verification.
