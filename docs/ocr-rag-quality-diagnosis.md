# OCR/RAG quality diagnosis for registry PDFs

## Context

This note documents the current failure mode observed with a Brazilian real-estate registry PDF (`Matrícula nº 62.132`) processed by `adsCombine` and later consumed by `agents-api` through document RAG.

The downstream AI answer was functionally complete at runtime, but the legal analysis was only partially faithful to the source document: it correctly identified the final title chain around `AV.20`, `AV.21`, and `R.22`, but confused/omitted intermediate acts and mischaracterized `R.18`.

## What is bad today

### 1. OCR text is present, but noisy

The database content inspected from `agents-api` showed that the document was not missing:

- `conversation_documents`: 45 chunks for the target PDF.
- Chunked text: about 43k characters.
- Original transcription: about 30k characters.
- Relevant acts exist in the stored text:
  - `R.18/62.132` with `TÍTULO: Compra e venda`.
  - `AV.20` with `131,22m²` and Rua Laguna.
  - `AV.21` with Leci qualification correction.
  - `R.22` with `ATO: DOAÇÃO`.
  - Several `CONDIÇÕES: Não constam` occurrences.

The issue is quality: the OCR output contains broken names, mixed line order, page/header noise, malformed dates, and fragmented text. This makes legal act reconstruction fragile even when the facts are technically present.

### 2. Sequential legal context is not guaranteed

For a query like “análise completa da matrícula”, vector top-k retrieval is not enough. The runtime retrieved useful chunks, but not the whole ordered act sequence.

This causes the model to reason from a partial set of acts instead of reading the matrícula as a sequential register.

### 3. Page and location metadata is weak downstream

Chunks observed in `agents-api` had poor line metadata, e.g. repeated `loc.lines.from/to` values. That makes it harder to:

- cite page/act origins;
- expand around the retrieved page;
- reconstruct the register order reliably;
- debug which OCR page produced a wrong assertion.

### 4. The model can still misinterpret available facts

The stored text contained enough evidence to identify `R.18` as compra e venda, but the AI still confused it with partilha in the final analysis. This means the fix is not only OCR. The downstream prompt/retrieval strategy also needs a “registry timeline” mode.

## Current `adsCombine` pipeline

### Entry points

- `src/api/controllers/messages.controllers.ts`
  - `POST /process-message` normalizes the request and calls `processMessagesService.execute(messageContext)`.
- `src/core/services/jobs/process-message-job.service.ts`
  - Async job path also calls `processMessagesService.execute(...)` with size/page limits.

### File processing orchestration

- `src/core/services/messages/process-messages.service.ts`
  - Dispatches by MIME subtype.
  - For PDFs, calls `ProcessPdfService.execute(...)`.
  - Builds a text file with a header:
    - `## Transcricao do arquivo: <filename>:`
  - Saves the combined extracted text to `TEXTS_DIR/<conversationId>/<conversationId>-<timestamp>.txt`.

Important: this service does **not** persist embeddings or chunks into `conversation_documents` directly. It returns a downloadable text file. Chunking/embedding appears to happen in a downstream/upstream integration outside this repo or in another service.

### Native PDF text extraction

- `src/core/services/messages/pdf-utils/pdf-text-extractor.service.ts`
  - Uses `pdf-parse` / `PDFParse`.
  - Extracts:
    - full text;
    - page count;
    - per-page text;
    - optional image/table metadata via `getImage()` / `getTable()`.

### PDF OCR decision and orchestration

- `src/core/services/messages/pdf-utils/process-pdf.service.ts`
  - Extracts native text first.
  - Analyzes quality via `TextQualityAnalyzer`.
  - Supports two modes:
    - `legacy`;
    - `mixed-page`.
  - Runs OCR through `OcrOrchestrator` when quality/page heuristics require it.

Important: `messages.controllers.ts` currently calls `processMessagesService.execute(messageContext)` without setting `pdfMode`, so the regular endpoint defaults to legacy behavior unless another caller passes `pdfMode: 'mixed-page'`.

### OCR worker

- `src/core/services/messages/pdf-utils/ocr-orchestrator.service.ts`
  - Validates PDF structure with `pdfinfo`.
  - Splits pages into chunks using `OcrChunkManager`.
  - Sends chunks to a Piscina worker pool.
- `src/core/services/messages/pdf-utils/ocr-chunk-manager.service.ts`
  - Builds page ranges for OCR.
  - Selected-page mode respects `OCR_MAX_PAGES_PER_CHUNK`.
- `src/core/services/messages/pdfChunkWorker.js`
  - Rasterizes pages with Poppler `pdftoppm`.
  - Runs Tesseract TSV output.
  - Parses word confidence.
  - Tries original image, preprocessed image, fallback PSM, threshold preprocessing, optional rotation fallback.
  - Uses ImageMagick/GraphicsMagick style preprocessing if available.

## Current OCR strengths

The OCR stack is not naive. It already has useful controls:

- Poppler validation via `pdfinfo`.
- Rasterization through `pdftoppm`.
- Configurable DPI:
  - `PDF_RASTER_DPI`, default 300 in worker.
  - `PDF_OCR_DPI`, propagated from raster DPI if not set.
- Tesseract language preference:
  - `por+eng` when available.
- TSV confidence parsing.
- Multiple OCR attempts:
  - original;
  - ImageMagick preprocess;
  - fallback PSM;
  - thresholded preprocess.
- Optional rotation fallback.
- Mixed-page path exists in code.
- Page count, image count, table count, and quality diagnostics exist in mixed mode.

## Main gaps to improve

### Priority 1 — Preserve layout in the current PDF output

Today the final text is flattened into a string and heavily sanitized. The first safe improvement is to preserve line breaks and existing double line breaks from native extraction/OCR in the current default PDF path. For registry certificates, those breaks often encode act boundaries and table-like relationships.

This does not add page markers or change OCR selection. Page-aware structured output remains a later phase.

Recommended output shape before chunking:

```md
<page number="1" source="ocr" confidence="82.4">
...
</page>

<page number="2" source="ocr" confidence="79.1">
...
</page>
```

At minimum, emit page markers:

```md
<!-- page: 1 -->
...
<!-- page: 2 -->
...
```

Why: downstream chunking and legal analysis need the existing textual layout before page anchors can be added safely.

### Priority 2 — Stop collapsing all whitespace too early

`src/utils/sanitize.ts` currently does:

```ts
input.replace(/\s+/g, ' ').trim()
```

This destroys line/page structure. For registry certificates, line breaks often encode act boundaries and table-like relationships.

Recommendation:

- Keep a layout-preserving sanitizer for OCR/PDF.
- Only use whitespace-collapsing sanitizer for simple text fields.
- Avoid flattening all line breaks before downstream chunking.

### Priority 3 — Keep `mixed-page` inactive

`mixed-page` was tested and removed from the active flow because its performance cost did not compensate for the quality gain. The normal `/process-message` controller and job path intentionally do not pass `pdfMode`, so they remain on the current default path.

Do not reactivate `mixed-page`, make it the default, or add an environment switch for it as part of OCR/RAG quality work. A future dedicated cleanup phase can remove its remaining references and dead code after callers are confirmed absent.


### Priority 4 — Return OCR confidence and attempt metadata

The worker computes confidence and selected attempt internally, but the final string does not preserve that metadata.

Recommendation:

- Return structured page results with:
  - `pageNumber`;
  - `text`;
  - `meanConfidence`;
  - `wordCount`;
  - `selectedAttempt`;
  - `psm`;
  - `dpi`;
  - `rotation` if used.
- Persist this metadata alongside transcription or pass it to the chunking service.

### Priority 5 — Preserve page/chunk metadata into embeddings

`adsCombine` does not appear to write to `conversation_documents` directly, but the downstream chunker should receive page-aware text and store metadata like:

```json
{
  "source": "conversation-upload",
  "fileId": "...",
  "fileName": "...",
  "pageStart": 3,
  "pageEnd": 4,
  "chunkIndex": 12,
  "ocrConfidence": 81.2,
  "extractionMode": "ocr|native|mixed"
}
```

The observed downstream metadata is too weak for precise RAG expansion.

### Priority 6 — Add registry/legal-document cleanup

For matrícula/certidão PDFs, add deterministic cleanup before chunking:

- detect and mark repeated headers/footers;
- remove or isolate validation watermarks/QR/sidebar text;
- preserve act labels (`AV.20/62.132`, `R.22/62.132`) as hard boundaries;
- normalize common OCR variants:
  - `Av.20/62. 132` → `AV.20/62.132`;
  - `Matricula n°` → `Matrícula nº`;
  - `DOAÇAO` / `DOACAO` → `DOAÇÃO`.

Do not over-normalize names or legal values without source evidence.

### Priority 7 — Add sequential chunking mode for registry documents

Legal registry analysis should not rely only on semantic top-k.

Recommended chunking strategy:

- split by page first;
- within each page, split by act markers:
  - `AV.\d+/62\.132`;
  - `R\.\d+/62\.132`;
  - `MATRÍCULA Nº`;
  - `CERTIFICO`;
- keep overlap around act boundaries;
- store `actNumber`, `actType`, `pageStart`, `pageEnd` when detectable.

For “análise completa da matrícula”, downstream should retrieve:

- all chunks of that document in order; or
- an act-index summary + targeted chunks.

### Priority 8 — Consider a higher-quality OCR provider for this class of document

Tesseract is useful, but scanned registry PDFs with small fonts, stamps, sidebars, and dense act text are hard.

Recommended evaluation order:

1. **Azure AI Document Intelligence - Read/Layout**
   - Strong layout/line/page support.
   - Good fit for page/line metadata and tables.
2. **Google Document AI / Vision OCR**
   - Strong OCR and layout metadata.
   - Good for scanned forms/certificates.
3. **AWS Textract**
   - Good for forms/tables, but legal Portuguese text quality must be tested.
4. **Mistral OCR / multimodal OCR providers**
   - Worth testing for dense document understanding and markdown output.
5. **OCRmyPDF + Tesseract**
   - Good as open-source baseline improvement, especially for deskew/orientation/searchable PDF layer.
6. **LLM vision fallback**
   - Use selectively for low-confidence pages or act extraction verification, not as primary OCR for all pages due to cost/latency.

## Recommended next implementation phases

### Phase A — Instrument and preserve structure

- Stop collapsing line breaks for PDF/OCR outputs.
- Keep the default PDF path unchanged; do not pass `pdfMode` or reactivate `mixed-page`.
- Evaluate page markers and OCR metadata separately after measuring the layout-preserving output.

### Phase B — Improve registry document chunking

- Add act-aware splitting for registry PDFs.
- Carry page/act metadata into downstream chunk persistence.
- Add tests using snippets with `AV.`/`R.` markers.

### Phase C — Add OCR quality benchmark

- Build a small benchmark set with this matrícula PDF and 3-5 similar documents.
- For each provider/mode, measure:
  - act marker recall;
  - owner/name accuracy;
  - area/value/date accuracy;
  - page attribution;
  - latency/cost.

### Phase D — Provider fallback

- Keep current Poppler/Tesseract path as baseline.
- Add a configurable premium OCR path for low-confidence or legal-registry documents.

## Acceptance criteria

For the matrícula example, improved OCR/RAG should allow the downstream agent to correctly state:

- `R.18/62.132` is compra e venda, not formal de partilha.
- `AV.20/62.132` concerns the 131,22m² wooden building at Rua Laguna.
- `AV.21/62.132` corrects Leci’s qualification/regime.
- `R.22/62.132` is doação from Juarez to Leci.
- The answer must distinguish between:
  - “not found in retrieved context”; and
  - “not present in the matrícula”.
