# Document Mode & Document Index

## Motivation

The symbol index (tree-sitter parsing, compact format, reference graph) only covers programming languages — Python, JavaScript/TypeScript, C/C++. Markdown and other document files appear in the file tree by path but produce no structural representation. The LLM knows `.md` files exist but has zero insight into their content unless the full file is loaded into context.

Many repositories are documentation-heavy (specs, READMEs, wikis, design docs). Giving the LLM structural awareness of document content — without loading full text — would significantly improve its ability to navigate and reference documentation.

A further challenge: many technical documents share identical subheading structures (e.g., every API endpoint has `Overview`, `Parameters`, `Examples`, `Error Codes`). Headings alone don't disambiguate sections — the system needs semantic keyword extraction to surface what each section is actually *about*.

## Core Idea

Build a **document index** analogous to the symbol index, extracting structural outlines from documents and feeding them through the same cache tiering system used for code.

| Code Concept | Document Equivalent |
|---|---|
| Class / Module | Document (file) |
| Method / Function | Heading (H1–H6) |
| Imports | Links to other docs (`[text](path.md)`) |
| Call sites | Cross-references between documents |
| Call sites (cross-type) | Doc → code references (`[context](../src/context.py)`) |

## Module Structure

A separate `doc_index/` module, independent of tree-sitter:

```
src/ac_dc/doc_index/
    __init__.py
    cache.py              # DocCache(BaseCache) — mtime-based outline caching
    formatter.py          # DocFormatter(BaseFormatter) — compact map output
    keyword_enricher.py   # KeyBERT-based topic extraction per section
    reference_index.py    # DocReferenceIndex — doc↔doc and doc→code links
    index.py              # DocIndex — orchestrator (parallels symbol_index/index.py)
    extractors/
        __init__.py       # EXTRACTORS registry: {'.md': MarkdownExtractor} (v1 has one entry; mirrors symbol_index pattern for future extension)
        base.py           # BaseDocExtractor — extract(path) → DocOutline
        markdown_extractor.py
```

**Why separate from `symbol_index/`:**
- No tree-sitter dependency — document parsing uses regex only (no external libraries for extraction)
- Different data model — headings have depth/nesting that code symbols don't, and cross-references work differently than imports
- Cleaner separation — `symbol_index/` is already complex with parser, cache, extractors, reference_index, compact_format

## Data Model

```pseudo
DocHeading:
    text: string
    level: integer          # 1–6 for markdown headings
    keywords: string[]      # KeyBERT-extracted terms, e.g. ["OAuth2", "bearer token", "expiry"]
    start_line: integer     # line number where this heading appears (for keyword enricher slicing)
    children: DocHeading[]  # nested sub-headings

DocLink:
    target: string          # relative path or URL
    source_heading: string  # text of the heading under which this link appears (for reference index context)

DocOutline:
    path: string
    headings: DocHeading[]
    links: DocLink[]

```

## Compact Output Format

The formatter produces text blocks structurally similar to code symbol map output. These blocks flow into the same cache tier system. Headings are enriched with KeyBERT keywords in parentheses to disambiguate sections with identical subheading structures.

### Markdown Example

```
specs3/3-llm-engine/context_and_history.md:
  # Context & History
  ## ContextManager (FileContext, token budget, shed) →src/ac_dc/context.py
  ## History Compaction (trigger threshold, verbatim window)
    ### Topic Detection (LLM boundary, confidence score)
    ### Verbatim Window (recent exchanges, min preserved)
  ## Token Budget (remaining, cache target, prompt estimate)
  links: prompt_assembly.md, cache_tiering.md
```

### Repeated-Structure Example

When documents share identical subheading patterns (API references, specs), keywords are essential for disambiguation:

```
docs/api-reference.md:
  ## Authentication (OAuth2, bearer token, expiry)
    ### Overview (token flow, grant types)
    ### Parameters (client_id, scope, redirect_uri)
    ### Examples (curl, Python requests)
    ### Error Codes (401, 403, token_expired)
  ## Users (profile, CRUD, role assignment)
    ### Overview (account lifecycle, signup)
    ### Parameters (email, display_name, role)
    ### Examples (create user, update role)
    ### Error Codes (404, duplicate_email, validation)
```

Without keywords, every `### Overview` / `### Parameters` / `### Error Codes` looks identical to the LLM.

### Converted DOCX Example

A `.docx` file converted via `pandoc -f docx -t markdown` and indexed as markdown:

```
docs/architecture.md:
  # System Architecture
  ## Component Overview (services, databases, message queues)
  ## Data Flow (ingestion, transformation, storage)
    ### Input Pipeline (REST API, file upload, webhooks)
    ### Processing (validation, enrichment, dedup)
  ## Deployment (Docker, Kubernetes, CI/CD)
  links: api-spec.md, diagrams/flow.md
```

### Converted Data File Example

A CSV converted to a markdown table (or summarised in a README):

```
data/README.md:
  # Data Files
  ## users.csv (id, name, email, role, created_at — 12,400 rows)
  ## budget.xlsx (3 sheets: Q1 Revenue, Q2 Forecast, Lookups)
```

## Line Numbers

Line numbers are **not included** in the document index output. This mirrors the code symbol map's context format — `get_symbol_map()` also omits line numbers (only the LSP variant `get_lsp_symbol_map()` includes them for editor features). Line numbers serve two purposes in code:

1. **LLM spatial hint** — rough sense of where things are and how large sections are
2. **LSP features** — hover, go-to-definition, completions in the editor

For documents, neither purpose is compelling:
- The LLM edits files using text anchor matching (`_find_anchor` in `edit_parser.py`), not line numbers
- LSP hover/definition features are not applicable to documents
- Heading nesting already conveys structure without positional metadata

Omitting line numbers saves tokens — meaningful across a documentation-heavy repo with dozens of files.

## Extractors — Markdown Only (v1)

The initial implementation supports **markdown files only** (`.md` extension). All other file formats — including plain text (`.txt`), reStructuredText (`.rst`), and binary document formats — are ignored by the document indexer. They remain visible in the file tree and can be loaded into context as selected files, but produce no structural outline. No external parsing libraries are required — heading extraction is a simple line-by-line scan for `#` prefixes, and link extraction uses a basic regex for `[text](target)` patterns.

| Format | Library | Extracts |
|---|---|---|
| Markdown (`.md`) | None (regex) | Headings, links |
| Markdown (post-processing) | `keybert` | Per-section keyword extraction |

### Non-Markdown Documents — Convert First

For `.docx`, `.pdf`, `.xlsx`, `.csv`, and other formats, the recommended workflow is to **convert to markdown before adding to the repository**. This is a deliberate design choice:

1. **Converted markdown is strictly superior in a git repo** — it's diffable, human-readable, greppable, and editable by the LLM via the standard edit block protocol
2. **Conversion tools are mature and widely available** — `pandoc` handles `.docx`/`.pdf`/`.epub`/`.rst`, `markitdown` and `marker` handle PDF with layout preservation, and simple scripts handle CSV→markdown tables
3. **Dedicated extractors would produce inferior results** — a `.docx` extractor can only extract headings and links (a lossy outline), while `pandoc` converts the full content to editable markdown. Why index a shadow when you can have the real thing?
4. **PDF heading extraction is inherently unreliable** — PDFs lack semantic structure; heading detection is heuristic-based and error-prone. Converting to markdown with a purpose-built tool (where the user can verify quality) produces far better results than attempting automated extraction at index time
5. **XLSX/CSV are data, not documents** — their "outline" (sheet names, column headers) is so minimal that a brief description in a README is more useful than a dedicated extractor
6. **Zero additional dependencies** — no `python-docx`, `openpyxl`, `pymupdf`, or `pdfplumber` to install, version-manage, or lazily import

Example conversion workflows:

```bash
# Word documents
pandoc -f docx -t markdown -o docs/architecture.md docs/architecture.docx

# PDF (simple text)
pandoc -f pdf -t markdown -o docs/spec.md docs/spec.pdf

# PDF (complex layout — use a dedicated tool)
marker docs/report.pdf docs/report.md

# CSV to markdown table
# (simple script or pandoc)
pandoc -f csv -t markdown -o data/users.md data/users.csv
```

Once converted, the `.md` files are indexed automatically by the document index like any other markdown file. The original binary files can remain in the repo (or in `.gitignore`) — only the `.md` versions are indexed.

### Future: Additional Format Extractors

Dedicated extractors for other text formats and binary formats may be added in a future version if demand warrants it. The extractor registry pattern (base class + per-format subclasses) is designed to accommodate this:

```
extractors/
    markdown_extractor.py   # v1 — regex-based, no dependencies
    docx_extractor.py       # future — python-docx
    xlsx_extractor.py       # future — openpyxl
    pdf_extractor.py        # future — pymupdf or pdfplumber
    csv_extractor.py        # future — stdlib csv
```

Each future extractor would be optional — imported lazily and skipped if its library is unavailable (same pattern as tree-sitter language loading in `parser.py`).

## Keyword Enrichment with KeyBERT

### Why Keywords Are Needed

Structural extraction (headings, links) is sufficient when heading text is descriptive and unique. But many technical documents — API references, spec suites, compliance checklists, template-based reports — reuse the same subheading patterns across every section. The LLM cannot distinguish between them from structure alone.

### How KeyBERT Works

[KeyBERT](https://github.com/MaartenGr/KeyBERT) uses sentence-transformer embeddings to find keywords/keyphrases most semantically similar to a text chunk. For each section (text between consecutive headings), KeyBERT produces ranked keywords with relevance scores.

```python
from keybert import KeyBERT

kw_model = KeyBERT()

section_text = "The OAuth2 flow requires a client_id and scope parameter..."
keywords = kw_model.extract_keywords(section_text, top_n=3, keyphrase_ngram_range=(1, 2))
# [("OAuth2 flow", 0.72), ("client_id", 0.68), ("scope parameter", 0.61)]
```

### Integration: `keyword_enricher.py`

The keyword enricher runs as a post-processing step after structural extraction:

1. **Extractor** produces a `DocOutline` with headings, links, and raw section text
2. **KeywordEnricher** receives the outline and the full document text
3. For each heading, it slices the text from that heading to the next heading at the same or higher level
4. KeyBERT extracts top-N keywords (default: 3) from each section slice
5. Keywords are attached to the heading and passed to the formatter

```pseudo
KeywordEnricher:
    _model: KeyBERT          # lazily initialized, shared across files
    _top_n: int              # keywords per section (default: 3)
    _ngram_range: (int, int) # (1, 2) for single words and bigrams
    _min_section_chars: int  # skip keyword extraction for very short sections (default: 50)

    enrich(outline: DocOutline, full_text: string) -> DocOutline:
        full_text_lines = full_text.splitlines()
        all_headings = _flatten(outline.headings)  # recursive tree→list
        for i, heading in enumerate(all_headings):
            end_line = all_headings[i+1].start_line if i+1 < len(all_headings) else len(full_text_lines)
            section_text = "\n".join(full_text_lines[heading.start_line:end_line])
            if len(section_text) < _min_section_chars:
                skip
            keywords = _model.extract_keywords(section_text, top_n, ngram_range)
            heading.keywords = [kw for kw, score in keywords if score > 0.3]
        return outline
```

The enricher receives `full_text` as a separate parameter (not stored in the outline) to keep the cached `DocOutline` compact. Each `DocHeading` stores its `start_line`, and the enricher flattens the heading tree to compute section boundaries (each section runs from one heading's `start_line` to the next heading's `start_line`). The markdown extractor populates `start_line` during extraction at no additional cost.

### Lazy Loading

KeyBERT depends on `sentence-transformers` which downloads the configured model on first use (~420MB for the default `all-mpnet-base-v2`). The enricher follows the same lazy-loading pattern as tree-sitter languages in `parser.py`:

- `KeyBERT` is imported inside `__init__` or on first call
- If `keybert` is not installed, a warning is logged and headings are emitted without keywords
- The model is initialized once and reused across all files in an indexing run

### Caching

Keyword extraction results are cached alongside the structural outline using the same mtime-based cache as the symbol index. Since KeyBERT is deterministic (same input + same model → same output), content hashing works correctly for tier stability detection. Keyword extraction only re-runs when the file's mtime changes.

**Model change invalidation:** The `DocCache` stores the `keyword_model` name used to generate each cached entry. On cache lookup, if the stored model name differs from the current `app.json` configuration, the entry is treated as stale and re-extracted. This ensures that changing `keyword_model` triggers a full re-enrichment without requiring a manual cache clear.

### Performance

| Operation | Time (mpnet-base default) | Notes |
|-----------|------|-------|
| Model load (first call) | ~5s | One-time per session (~420MB download on first-ever run) |
| Model load (cached) | ~400ms | sentence-transformers caches locally |
| Markdown structure extraction (one file) | <5ms | Regex-based, no dependencies |
| Extract keywords (one section) | ~40-60ms | Depends on section length |
| Full document (20 sections) | ~1s | Parallelizable if needed |
| Full repo (50 docs) | ~50-65s | First run; subsequent runs check mtime and skip unchanged files |

For comparison, tree-sitter indexing of a full repo takes 1-5s. Document indexing with KeyBERT is slower but runs infrequently — documents change much less often than code. The bottleneck is entirely keyword extraction, not structural parsing — markdown outline extraction for 50 files completes in <250ms. Smaller models (e.g., `all-MiniLM-L6-v2`) reduce keyword extraction times by ~60% at some quality cost — see the model comparison table in Design Decisions.

### Token Budget

Keywords add ~3-8 tokens per heading. For a document with 20 headings, that's 60-160 extra tokens — a modest cost for significant disambiguation value.

### Configuration

Keyword enrichment is controlled via `app.json`:

```json
{
  "doc_index": {
    "keyword_model": "all-mpnet-base-v2",
    "keywords_enabled": true,
    "keywords_top_n": 3,
    "keywords_ngram_range": [1, 2],
    "keywords_min_section_chars": 50,
    "keywords_min_score": 0.3
  }
}
```

## Integration with Cache Tiering

Document outline blocks integrate with the existing stability tracker and cache tier system with no special treatment:

1. **Stability tracker** tracks doc files by key (e.g., `file:specs3/README.md`), same as code files
2. **Tier graduation** works identically — a frequently referenced doc promotes from L3 → L2 → L1
3. **`_build_tiered_content()`** assembles blocks from whichever index is active for the current mode — doc outline blocks in document mode, code symbol blocks in code mode. The two are never intermingled; the mode toggle is a full context switch
4. **Content hashing** detects when a doc's structure changes (heading added/removed), triggering demotion back to active tier

Documents tend to change less frequently than code, so they would naturally stabilize at higher tiers quickly — a good fit for the caching model.

## Document Mode Toggle

Document mode is a **full context switch**, not an additive layer. It replaces the code-oriented context with a documentation-oriented context. The target audience is non-technical users — managers, product owners, technical writers — who work with documents and don't need code symbols.

| Mode | Symbol map | Document index | File tree | System prompt |
|---|---|---|---|---|
| Code (default) | Full symbol detail | Not included | All files | Code-oriented |
| Document | Not included | Full outlines: headings + KeyBERT keywords + links + first-paragraph summaries | All files (unchanged) | Document-oriented |

### What Changes in Document Mode

1. **Symbol map removed** — no code symbols in context. The entire token budget is available for document outlines, selected document content, and conversation history
2. **File tree unchanged** — all files remain visible. Users may need to reference code files while editing documentation (e.g., verifying what they're documenting). The tree is cheap in tokens and filtering it adds complexity for no benefit
3. **System prompt swapped** — a separate `system_doc.md` prompt tuned for document work: summarisation, restructuring, cross-referencing, writing assistance. No code editing instructions
4. **Edit protocol unchanged** — the LLM still uses the same edit block format to modify `.md` and other text files. The anchor-matching system in `edit_parser.py` works on any text content
5. **Cache tiering operates on doc blocks** — the stability tracker and tier system work identically, just with document outline blocks instead of code symbol blocks
6. **Snippets swapped** — a separate `doc-snippets.json` with document-relevant quick actions: "Summarise this section", "Check cross-references", "Suggest restructuring", "Write an executive summary"

### What Stays the Same

- Conversation history, compaction, and session management — unchanged
- URL fetching and context — unchanged (useful for referencing external docs)
- File editing via edit blocks — unchanged
- Search — unchanged (grep over file content works on any text)
- Review mode — unchanged (reviewing document edits before committing is equally useful)

### Switching Modes

Mode switching is a session-level action — it clears the current context and rebuilds with the appropriate index. Conversation history is preserved but the LLM is informed of the mode change via a system message.

**Index lifecycle in `LLMService`:** Both `SymbolIndex` and `DocIndex` are held simultaneously — the code index is built during startup (as today) and the doc index is built **lazily on first switch to document mode**. This avoids penalising users who never use document mode with a ~65s startup cost. On first switch, the progress bar (described in Progress Reporting below) keeps the user informed during keyword extraction. Once built, both indexes are held in memory so subsequent mode switches are instant. Memory overhead is modest: index data structures are dictionaries of small outline/symbol objects, not full file contents. The active mode determines which index feeds `_build_tiered_content()` and which formatter produces the map output.

**Dispatch mechanism in `_build_tiered_content()`:** The method checks `self._mode` (an enum: `Mode.CODE` or `Mode.DOC`) and calls the appropriate index. Both `SymbolIndex` and `DocIndex` expose the same two methods needed by tier assembly: `get_symbol_map()`/`get_doc_map()` for the full map and `get_file_symbol_block()`/`get_file_doc_block()` for per-file blocks. A shared interface is not needed — the dispatch is a simple if/else in one method. The formatter selection follows the same pattern: `CompactFormatter` for code, `DocFormatter` for documents.

**File discovery in `DocIndex`:** The orchestrator scans the repo for `.md` files using the same `os.walk` pattern as `SymbolIndex._get_source_files()`, filtered by extension rather than `language_for_file()`. Files matching `.gitignore` patterns and the `.ac-dc/` directory are excluded, consistent with the code index.

```
User clicks mode toggle
    │
    ├── If first switch to document mode:
    │     ├── Show progress bar via startupProgress events
    │     ├── Build DocIndex (structure extraction + keyword enrichment, ~65s first run)
    │     ├── Build DocReferenceIndex from extracted links
    │     └── Initialize document-mode StabilityTracker from DocReferenceIndex
    │
    ├── Clear file context (selected files)
    ├── Swap system prompt (system.md → system_doc.md)
    ├── Swap snippets (snippets.json → doc-snippets.json)
    ├── Switch stability tracker to doc-mode instance (separate state per mode)
    ├── Rebuild tier content from doc_index instead of symbol_index
    └── Insert system message: "Switched to document mode"
```

**History across mode switches:** Conversation history is preserved as-is — messages generated under the code system prompt remain in history when switching to document mode and vice versa. The mode-switch system message (e.g., "Switched to document mode") provides sufficient context for the LLM to reinterpret prior messages. If compaction runs after a mode switch, the compaction prompt uses the *current* mode's prompt, so any summary it generates reflects the active mode. In practice, users who switch modes frequently will naturally start new sessions, and the history compactor's topic boundary detection will identify mode switches as natural conversation boundaries.

**Mode persistence:** The current mode is stored in the webapp's `localStorage` (keyed per repo, like other dialog preferences) and sent to the backend on reconnect. The backend does not persist mode state — it defaults to code mode on startup and accepts the mode from the frontend during the initial `setupDone` handshake.

**Stability tracker lifecycle:** Two independent `StabilityTracker` instances are held — one for code mode, one for document mode. Each tracks its own tier state, graduation history, and content hashes. Mode switching activates the appropriate tracker instance; the inactive instance retains its state so switching back is instant with no re-initialization. Both trackers are initialized lazily — the document tracker is created on first switch to document mode, using `DocReferenceIndex.connected_components()` for initial tier assignment.

## System Prompt for Document Mode

A separate `system_doc.md` prompt (in `src/ac_dc/config/system_doc.md`, alongside the existing `system.md`) optimised for document work. Document-mode snippets live in `src/ac_dc/config/doc-snippets.json` (alongside `snippets.json`). Key differences from the code prompt:

- No references to programming languages, frameworks, or debugging
- Focus on: document structure, clarity, cross-referencing, consistency, writing style
- Edit block format explained in terms of document editing (sections, paragraphs, headings) rather than code editing (functions, classes, imports)
- Awareness of document types: specs, READMEs, design docs, reports, meeting notes, requirements

The prompt includes awareness of the document index format so the LLM understands the heading + keyword outlines it sees in context.

## Document-Specific Snippets

`doc-snippets.json` provides quick actions relevant to document workflows:

```json
[
  {"label": "Summarise", "text": "Summarise this document in 3-5 bullet points"},
  {"label": "Cross-refs", "text": "Check all cross-references in this document and flag any broken links"},
  {"label": "Restructure", "text": "Suggest a better structure for this document"},
  {"label": "Executive summary", "text": "Write an executive summary of this document"},
  {"label": "TOC", "text": "Generate a table of contents for this document"},
  {"label": "Consistency", "text": "Check this document for terminology inconsistencies"},
  {"label": "Simplify", "text": "Rewrite this section in simpler language"}
]
```

## Cross-Reference Index

The document reference index tracks three types of links:

- **Doc → Doc**: `[link](other.md)` — analogous to imports between code files
- **Doc → Code**: `[context](../src/context.py)` — documents referencing source files
- **Code → Doc**: Not extracted automatically, but could be inferred from comments containing doc paths

This is implemented as a separate `DocReferenceIndex` class in `doc_index/reference_index.py`, not a subclass of the code `ReferenceIndex`. The two indexes have different edge types (heading-level links vs symbol-level imports) and different build inputs. However, `DocReferenceIndex` exposes the same `connected_components()` and `file_ref_count()` protocol methods so the stability tracker's `initialize_from_reference_graph()` works with either index. The tracker calls only these two methods and never inspects the internal node types (`Symbol`/`CallSite` vs `DocHeading`/`DocLink`), so no modification to the tracker is needed — it operates on file-level connectivity, not symbol-level details.

This enables the connected components algorithm to cluster related documents together for tier initialization. Doc→Code links are included as edges in the graph — if `specs/api.md` links to `src/api.py`, both files appear as nodes in the `DocReferenceIndex`. However, code files in this graph are leaf nodes (they have no outgoing edges since they aren't parsed by the doc extractor), so they serve only as clustering bridges: two documents that both reference the same source file will land in the same connected component.

## Design Decisions

### Cache Infrastructure — Shared Base Class

The document index shares the `symbol_index/cache.py` infrastructure via a base class extraction. `SymbolCache` is refactored into an abstract `BaseCache` with concrete subclasses:

- `BaseCache` (in `src/ac_dc/base_cache.py`) — mtime-based get/put/invalidate, content hashing, `cached_files` property
- `SymbolCache(BaseCache)` — existing code symbol caching (unchanged external API)
- `DocCache(BaseCache)` — document outline caching with the same mtime semantics

This pattern extends to the formatter: a `BaseFormatter` (in `src/ac_dc/base_formatter.py`) provides common logic (path aliasing, reference counting integration), while `CompactFormatter` (in `symbol_index/compact_format.py`, unchanged external API) and `DocFormatter` (in `doc_index/formatter.py`) implement format-specific output. Mode-specific logic — such as test file collapsing for code — lives in the respective subclass. The legend is defined as an abstract method in the base class, implemented differently by each subclass to describe its own symbol vocabulary.

**Why `ac_dc/` level for base classes:** Both `symbol_index/` and `doc_index/` are sibling packages. Placing shared bases in either one would create a cross-dependency. The `ac_dc/` package root is the natural shared location, keeping both index packages independent.

### UI Mode Toggle

Document mode is exposed as a toggle in the `ac-dialog` component, next to the existing tab bar. A simple code/document mode indicator shows the current mode and switches on click. Mode switching clears file context and rebuilds tier content from the appropriate index.

### Search — Unchanged

The existing `search_files` in `repo.py` (grep over file content) is used as-is for both modes. Document headings are not added as a separate search target. This keeps the implementation simple and can be revisited later if heading-specific search proves valuable.

### Sentence-Transformer Model — User Configurable

The sentence-transformer model used by KeyBERT is configurable via `app.json`. The default is `all-mpnet-base-v2` — the highest quality English model. Load time (~5s first run, ~400ms cached) is acceptable given the fine-grained progress reporting described below. Comparative performance for a 50-document repo (1000 sections):

| Model | Size | Load (first) | Load (cached) | Per-section | Full repo (1000 sections) |
|---|---|---|---|---|---|
| `all-MiniLM-L6-v2` | 80MB | ~2s | ~200ms | ~20-30ms | ~25s |
| `all-MiniLM-L12-v2` | 120MB | ~2.5s | ~250ms | ~25-40ms | ~30s |
| `all-mpnet-base-v2` (default) | 420MB | ~5s | ~400ms | ~40-60ms | ~65s |
| `all-distilroberta-v1` | 290MB | ~4s | ~350ms | ~35-50ms | ~45s |

Configuration in `app.json`:

```json
{
  "doc_index": {
    "keyword_model": "all-mpnet-base-v2"
  }
}
```

### Progress Reporting

Document indexing with keyword extraction is slower than code indexing (~65s vs ~1-5s for a 50-doc repo on first run). A fine-grained progress bar in the UI keeps the user informed throughout.

**Backend progress events** — The document indexer emits progress via the existing `startupProgress(stage, message, percent)` server→client RPC push. This is the same mechanism already used by `app-shell.js` for initial load: the Python backend calls `self._event_callback('startupProgress', stage, message, percent)` on `LLMService`, which pushes to the frontend via jrpc-oo, and the `startupProgress` method on `AcApp` renders the progress bar. Phases:

1. **Model loading** (0–10%) — "Loading keyword model…" — emitted once when the sentence-transformer model initialises. On first-ever run this includes the ~420MB download, reported as a sub-progress if the model library exposes download callbacks.
2. **Structure extraction** (10–30%) — "Extracting outlines… (12/50 files)" — fast phase, increments per file.
3. **Keyword extraction** (30–95%) — "Extracting keywords… (8/50 files)" — the slow phase, increments per file. Each file completion updates the percentage proportionally (`30 + 65 * files_done / total_files`).
4. **Cache write** (95–100%) — "Caching results…" — writing enriched outlines to the doc cache.

**Frontend display** — The `app-shell.js` `startupProgress` handler already renders a progress bar with stage label and percentage. Document indexing reuses this exactly. The bar appears during initial index build and during re-indexing when many files have changed. For incremental updates (1-2 files changed), the operation is fast enough (<2s) that no progress bar is shown.

**Granularity** — Progress updates fire after each file completes keyword extraction, not after each section. Per-file granularity gives smooth visual updates (50 increments for 50 files) without excessive RPC overhead. For large files with many sections, the keyword extraction step for that single file may take ~500ms — acceptable without sub-file progress.

### Keywords — Always Included

Keywords are always included for all headings, including unique ones. Consistent formatting is simpler to implement and reason about, and the token cost is modest (~3-8 tokens per heading). Omitting keywords for unique headings would add conditional logic for marginal token savings.

### Language Support — English Only

Only English is supported initially. The default `all-mpnet-base-v2` model is English-optimised. Multilingual support (via `paraphrase-multilingual-MiniLM-L12-v2` or similar) can be added later as a configurable model option if needed.