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
    extractor.py          # base class + registry
    formatter.py          # produce compact map output
    keyword_enricher.py   # KeyBERT-based topic extraction per section
    reference_index.py    # cross-references: doc↔doc and doc→code
    extractors/
        markdown_extractor.py
        docx_extractor.py
        xlsx_extractor.py
        pdf_extractor.py
        csv_extractor.py
```

**Why separate from `symbol_index/`:**
- No tree-sitter dependency — document parsing uses regex or lightweight libraries
- Different data model — headings have depth/nesting that code symbols don't, and cross-references work differently than imports
- Cleaner separation — `symbol_index/` is already complex with parser, cache, extractors, reference_index, compact_format

## Data Model

```pseudo
DocHeading:
    text: string
    level: integer          # 1–6 for markdown, style-based for docx
    children: DocHeading[]  # nested sub-headings

DocLink:
    target: string          # relative path or URL
    context: string         # surrounding heading text

DocOutline:
    path: string
    headings: DocHeading[]
    links: DocLink[]
    meta: dict              # format-specific: sheet count, page count, row count, etc.

DocKeywords:
    heading_path: string[]  # e.g. ["Authentication", "Parameters"]
    keywords: string[]      # e.g. ["client_id", "scope", "redirect_uri"]
    score: float[]          # KeyBERT relevance scores, 0.0–1.0
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

### XLSX Example

```
data/budget.xlsx:
  Sheet: Q1 Revenue (rows: 150, cols: A-M)
  Sheet: Q2 Forecast (rows: 80, cols: A-H)
  Sheet: Lookups (rows: 20, cols: A-C)
```

### DOCX Example

```
docs/architecture.docx:
  # System Architecture
  ## Component Overview (services, databases, message queues)
  ## Data Flow (ingestion, transformation, storage)
    ### Input Pipeline (REST API, file upload, webhooks)
    ### Processing (validation, enrichment, dedup)
  ## Deployment (Docker, Kubernetes, CI/CD)
  links: api-spec.docx, diagrams/flow.xlsx
```

### CSV Example

```
data/users.csv:
  Columns: id, name, email, role, created_at (rows: 12,400)
```

## Line Numbers

Line numbers are **not included** in the document index output. In the code symbol map, line numbers serve two purposes:

1. **LLM spatial hint** — rough sense of where things are and how large sections are
2. **LSP features** — hover, go-to-definition, completions in the editor

For documents, neither purpose is compelling:
- The LLM edits files using text anchor matching (`_find_anchor` in `edit_parser.py`), not line numbers
- LSP hover/definition features are not applicable to documents
- Heading nesting already conveys structure without positional metadata

Omitting line numbers saves tokens — meaningful across a documentation-heavy repo with dozens of files.

## Extractors by File Type

Each extractor scans a file type and produces a `DocOutline`. Dependencies beyond markdown are optional — imported lazily and skipped if unavailable (same pattern as tree-sitter language loading in `parser.py`).

| Format | Library | Extracts |
|---|---|---|
| Markdown (`.md`) | None (regex) | Headings, links, code fence labels |
| Word (`.docx`) | `python-docx` | Headings by style, hyperlinks |
| Excel (`.xlsx`) | `openpyxl` | Sheet names, dimensions, header rows |
| PDF (`.pdf`) | `pymupdf` or `pdfplumber` | TOC / heading extraction, page count |
| CSV (`.csv`) | stdlib `csv` | Column headers, row count |
| **All above** | `keybert` | Per-section keyword extraction (post-processing step) |

The markdown extractor requires no external dependencies — heading extraction is a simple line-by-line scan for `#` prefixes, and link extraction uses a basic regex for `[text](target)` patterns.

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
        for each heading:
            section_text = slice between this heading and next sibling/parent
            if len(section_text) < _min_section_chars:
                skip
            keywords = _model.extract_keywords(section_text, top_n, ngram_range)
            heading.keywords = [kw for kw, score in keywords if score > 0.3]
        return outline
```

### Lazy Loading

KeyBERT depends on `sentence-transformers` which downloads a model (~100MB) on first use. The enricher follows the same lazy-loading pattern as tree-sitter languages in `parser.py`:

- `KeyBERT` is imported inside `__init__` or on first call
- If `keybert` is not installed, a warning is logged and headings are emitted without keywords
- The model is initialized once and reused across all files in an indexing run

### Caching

Keyword extraction results are cached alongside the structural outline using the same mtime-based cache as the symbol index. Since KeyBERT is deterministic (same input → same output), content hashing works correctly for tier stability detection. Keyword extraction only re-runs when the file's mtime changes.

### Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Model load (first call) | ~2s | One-time per session |
| Model load (cached) | ~200ms | sentence-transformers caches locally |
| Extract keywords (one section) | ~20-50ms | Depends on section length |
| Full document (20 sections) | ~500ms | Parallelizable if needed |
| Full repo (50 docs) | ~10-25s | Runs once, then mtime-cached |

For comparison, tree-sitter indexing of a full repo takes 1-5s. Document indexing with KeyBERT is slower but runs infrequently — documents change much less often than code.

### Token Budget

Keywords add ~3-8 tokens per heading. For a document with 20 headings, that's 60-160 extra tokens — a modest cost for significant disambiguation value. The formatter can optionally omit keywords for headings that are already unique within their document (optimization for token-sensitive budgets).

### Configuration

Keyword enrichment is controlled via `app.json`:

```json
{
  "doc_index": {
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
3. **`_build_tiered_content()`** assembles doc blocks and code blocks together, intermingled based on tier assignment
4. **Content hashing** detects when a doc's structure changes (heading added/removed), triggering demotion back to active tier

Documents tend to change less frequently than code, so they would naturally stabilize at higher tiers quickly — a good fit for the caching model.

## Document Mode Toggle

Document mode is a **full context switch**, not an additive layer. It replaces the code-oriented context with a documentation-oriented context. The target audience is non-technical users — managers, product owners, technical writers — who work with documents and don't need code symbols.

| Mode | Symbol map | Document index | File tree | System prompt |
|---|---|---|---|---|
| Code (default) | Full symbol detail | Not included | Source files | Code-oriented |
| Document | Not included | Full outlines: headings + KeyBERT keywords + links + first-paragraph summaries | Document files only (`.md`, `.docx`, `.pdf`, `.xlsx`, `.csv`) | Document-oriented |

### What Changes in Document Mode

1. **Symbol map removed** — no code symbols in context. The entire token budget is available for document outlines, selected document content, and conversation history
2. **File tree filtered** — only document files appear. Source code files are hidden from the tree and file picker
3. **System prompt swapped** — a separate `system_doc.md` prompt tuned for document work: summarisation, restructuring, cross-referencing, writing assistance. No code editing instructions
4. **Edit protocol unchanged** — the LLM still uses the same edit block format to modify `.md` and other text files. The anchor-matching system in `edit_parser.py` works on any text content
5. **Cache tiering operates on doc blocks** — the stability tracker and tier system work identically, just with document outline blocks instead of code symbol blocks
6. **Snippets swapped** — a separate `doc-snippets.json` with document-relevant quick actions: "Summarise this section", "Check cross-references", "Suggest restructuring", "Write an executive summary"

### What Stays the Same

- Conversation history, compaction, and session management — unchanged
- URL fetching and context — unchanged (useful for referencing external docs)
- File editing via edit blocks — unchanged
- Search — works on document content instead of code
- Review mode — disabled in document mode (code review is not applicable)

### Switching Modes

Mode switching is a session-level action — it clears the current context and rebuilds with the appropriate index. Conversation history is preserved but the LLM is informed of the mode change via a system message.

```
User clicks mode toggle
    │
    ├── Clear file context (selected files)
    ├── Swap system prompt (system.md → system_doc.md)
    ├── Swap snippets (snippets.json → doc-snippets.json)
    ├── Rebuild tier content from doc_index instead of symbol_index
    ├── Filter file tree to document files only
    └── Insert system message: "Switched to document mode"
```

## System Prompt for Document Mode

A separate `system_doc.md` prompt optimised for document work. Key differences from the code prompt:

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

This enables the connected components algorithm (already used in `reference_index.py`) to cluster related documents and code files together for tier initialization.

## Open Questions

- **Should the document index share the `symbol_index/cache.py` infrastructure?** The mtime-based caching and content hashing would apply equally well. Could use the same `SymbolCache` with a different key prefix, or a parallel `DocCache`.
- **How should the UI expose document mode?** A toggle in the dialog, a per-session setting, or auto-detected from repo content (e.g., if >50% of files are documents)?
- **Should document outlines support search?** The existing `search_files` in `repo.py` searches file content via grep — document headings could be an additional search target.
- **Which sentence-transformer model for KeyBERT?** The default `all-MiniLM-L6-v2` (80MB) is a good balance of speed and quality. Larger models like `all-mpnet-base-v2` (420MB) produce better keywords but with slower first-load. Should this be configurable?
- **Should keywords be omitted for unique headings?** If a heading text appears only once in a document, keywords add less value. The formatter could skip them to save tokens — but consistent formatting may be simpler.
- **Keyword language support?** KeyBERT works best with English text. For multilingual repos, a multilingual model (`paraphrase-multilingual-MiniLM-L12-v2`) could be used at the cost of larger download and slightly lower English quality.