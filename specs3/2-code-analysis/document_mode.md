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
        __init__.py       # EXTRACTORS registry: {'.md': MarkdownExtractor, '.svg': SvgExtractor}
        base.py           # BaseDocExtractor — extract(path) → DocOutline
        markdown_extractor.py
        svg_extractor.py  # stdlib xml.etree.ElementTree — text labels, groups, links
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
    outgoing_refs: DocSectionRef[]  # links FROM this section to other doc sections
    incoming_ref_count: int # number of sections in other docs that link TO this section (0 = leaf)
    content_types: string[] # detected content patterns, e.g. ["table", "code", "formula"]
    section_lines: int      # line count from this heading to the next (0 = unknown)

DocLink:
    target: string          # relative path or URL
    target_heading: string  # heading anchor in target doc, if present (e.g. "History-Compaction-Interaction")
    source_heading: string  # text of the heading under which this link appears (for reference index context)
    is_image: boolean       # true for ![alt](path) image references, false for [text](path) links

DocSectionRef:
    target_path: string     # e.g. "cache_tiering.md"
    target_heading: string  # e.g. "History Compaction Interaction" (null if link is doc-level)

DocOutline:
    path: string
    doc_type: string        # "spec" | "guide" | "reference" | "decision" | "readme" | "notes" | "unknown"
    headings: DocHeading[]
    links: DocLink[]

```

## Compact Output Format

The formatter produces text blocks structurally similar to code symbol map output. These blocks flow into the same cache tier system. The format is enriched with several annotations designed to make the outlines maximally useful for LLM navigation and reasoning:

- **KeyBERT keywords** in parentheses disambiguate sections with identical subheading structures
- **Section-level cross-references** (`→target.md#Section`) show where each section links, enabling concept tracing without loading full files
- **Incoming reference counts** (`←N`) on sections show conceptual weight — which sections are most depended-on across the documentation
- **Document type tags** (`[spec]`, `[guide]`, etc.) help the LLM calibrate tone and format for responses

### Markdown Example

```
specs3/3-llm-engine/context_and_history.md [spec]:
  # Context & History ~280ln ←5
  ## ContextManager (FileContext, token budget, shed) [code] ~85ln ←3 →src/ac_dc/context.py
  ## History Compaction (trigger threshold, verbatim window) [code] ~120ln ←2
    ### Topic Detection (LLM boundary, confidence score) ~45ln
      →cache_tiering.md#History-Compaction-Interaction
    ### Verbatim Window (recent exchanges, min preserved) ~30ln
  ## Token Budget (remaining, cache target, prompt estimate) [table] ~40ln
    →prompt_assembly.md#History-Placement
  links: prompt_assembly.md, cache_tiering.md
```

Key features visible here:
- `[spec]` — document type annotation after the path
- `←5` on `# Context & History` — 5 other sections across the docs link to this document
- `←3` on `## ContextManager` — 3 sections specifically reference this section
- `→cache_tiering.md#History-Compaction-Interaction` — section-level outgoing link (not just document-level)
- `→src/ac_dc/context.py` — doc→code cross-reference

### Repeated-Structure Example

When documents share identical subheading patterns (API references, specs), keywords are essential for disambiguation:

```
docs/api-reference.md [reference]:
  ## Authentication (OAuth2, bearer token, expiry) ~95ln ←4
    ### Overview (token flow, grant types) ~20ln
    ### Parameters (client_id, scope, redirect_uri) [table] ~35ln ←2
    ### Examples (curl, Python requests) [code] ~25ln
    ### Error Codes (401, 403, token_expired) [table] ~15ln
  ## Users (profile, CRUD, role assignment) ~80ln ←1
    ### Overview (account lifecycle, signup) ~18ln
    ### Parameters (email, display_name, role) [table] ~30ln
    ### Examples (create user, update role) [code] ~22ln
    ### Error Codes (404, duplicate_email, validation) [table] ~10ln
```

Without keywords, every `### Overview` / `### Parameters` / `### Error Codes` looks identical to the LLM. Without section-level `←N` counts, there's no way to know that `Authentication.Parameters` is referenced twice by other docs while `Users.Parameters` is not referenced at all.

### Converted DOCX Example

A `.docx` file converted via `pandoc -f docx -t markdown` and indexed as markdown:

```
docs/architecture.md [spec]:
  # System Architecture ~180ln ←3
  ## Component Overview (services, databases, message queues) [table] ~60ln ←2
  ## Data Flow (ingestion, transformation, storage) ~75ln ←1
    ### Input Pipeline (REST API, file upload, webhooks) [code] ~30ln
      →api-spec.md#REST-Endpoints
    ### Processing (validation, enrichment, dedup) ~25ln
  ## Deployment (Docker, Kubernetes, CI/CD) [code] ~45ln
    →diagrams/flow.md
  links: api-spec.md, diagrams/flow.md
```

### Converted Data File Example

A CSV converted to a markdown table (or summarised in a README):

```
data/README.md [reference]:
  # Data Files
  ## users.csv (id, name, email, role, created_at — 12,400 rows)
  ## budget.xlsx (3 sheets: Q1 Revenue, Q2 Forecast, Lookups)
```

### Format Annotations Reference

| Annotation | Syntax | Meaning |
|---|---|---|
| Document type | `[spec]` after path | Classification of the document's role |
| Keywords | `(keyword1, keyword2)` after heading text | KeyBERT-extracted terms for disambiguation |
| Content type | `[table]` `[code]` `[formula]` after keywords | Detected content patterns in section |
| Section size | `~Nln` after content types | Line count of section (omitted if < 5 lines) |
| Incoming refs | `←N` after size | Number of sections in other docs that link to this section |
| Outgoing section ref | `→target.md#Section` indented under heading | Section-level link to another document's heading |
| Outgoing doc ref | `→target.md` indented under heading | Document-level link (no specific section target) |
| Outgoing code ref | `→src/file.py` indented under heading | Doc→code cross-reference |

### Document Type Detection

Document type is inferred heuristically from the file path, heading structure, and content signals:

| Type | Detection heuristics |
|---|---|
| `spec` | Path contains `spec`, `specs`, `rfc`, `design`; or has numbered section headings |
| `guide` | Path contains `guide`, `tutorial`, `howto`, `getting-started`; or has step-by-step headings |
| `reference` | Path contains `reference`, `api`, `endpoints`; or has highly repetitive subheading structure |
| `decision` | Path contains `adr`, `decision`; or has "Status", "Context", "Decision" headings (ADR format) |
| `readme` | Filename is `README.md` (case-insensitive) |
| `notes` | Path contains `notes`, `meeting`, `minutes`, `journal` |
| `unknown` | No heuristic matches — the default |

Detection runs during extraction (no additional pass needed) and is stored in `DocOutline.doc_type`. The heuristic is conservative — `unknown` is fine; the type annotation is a hint, not a gate.

## Line Numbers

Raw line numbers (e.g., `:42` per heading) are **not included** in the document index output. This mirrors the code symbol map's context format — `get_symbol_map()` also omits line numbers (only the LSP variant `get_lsp_symbol_map()` includes them for editor features). Line numbers serve two purposes in code:

1. **LLM spatial hint** — rough sense of where things are and how large sections are
2. **LSP features** — hover, go-to-definition, completions in the editor

For documents, neither purpose is compelling:
- The LLM edits files using text anchor matching (`_find_anchor` in `edit_parser.py`), not line numbers
- LSP hover/definition features are not applicable to documents
- Heading nesting already conveys structure without positional metadata

Omitting raw line numbers saves tokens — meaningful across a documentation-heavy repo with dozens of files. Note that `start_line` is still tracked internally on each `DocHeading` — it is used by the keyword enricher to slice section text and by `_annotate_sections()` to compute the `~Nln` section size annotations. Only the raw per-heading line numbers are omitted from the output; section sizes are included as they provide actionable budget information without the token cost of per-heading positions.

## Extractors — Markdown and SVG

The document index supports **markdown** (`.md`) and **SVG** (`.svg`) files. Both produce structural outlines that flow through the same cache, formatter, reference index, and tier system. No external parsing libraries are required — markdown uses line-by-line regex scanning, SVG uses stdlib `xml.etree.ElementTree`.

**SVG extraction is doc-mode only.** The document index is only consulted when `self._mode == Mode.DOC`. In code mode, SVG files are visible in the file tree and can be opened in the SVG viewer/editor, but they produce no structural outline in the symbol map context. This is deliberate:

- **In code mode, SVGs are implementation artifacts** — the LLM cares about the code that generates or uses the SVG, not the SVG's visual content. The symbol index already captures usage via imports and references.
- **In doc mode, SVGs are documentation** — architecture diagrams, flowcharts, and annotated illustrations are core documentation content. Knowing that `architecture.svg` contains boxes labeled "LLM Service", "Context Manager", "Symbol Index" with their relationships provides the same structural awareness the doc index gives for markdown files.
- **No token budget pressure in code mode** — code mode's budget is already tight with symbol maps and tiered code content. SVG outlines would consume tokens for content that isn't actionable (the LLM edits SVGs via the SVG editor, not via text edit blocks against raw XML).

**What the SVG extractor produces:**
- `<title>` → top-level heading (level 1)
- `<desc>` → description heading (level 2)
- `<text>`/`<tspan>` content → leaf headings (visible labels, annotations)
- `<g>` groups with `id`/`aria-label`/`inkscape:label` → structural headings containing their text children
- `<a>` links (excluding internal `#fragment` links) → `DocLink` entries for cross-reference tracking
- Duplicate text labels are deduplicated
- `<defs>`, `<style>`, `<script>`, `<metadata>` are skipped

**No keyword enrichment for SVG.** SVG text labels are already terse identifiers ("LLM Service", "streaming · edits · review"). Running KeyBERT on them would be redundant — the labels *are* the keywords. SVG files are explicitly skipped before the enrichment phase in `index_repo()` and `index_file()` — they are cached immediately after extraction without being added to the `needs_enrichment` queue. This avoids the ~6-8s per-file overhead of calling into KeyBERT even when `min_section_chars` would skip all sections.

| Format | Library | Extracts |
|---|---|---|
| Markdown (`.md`) | None (regex) | Headings, links, image references |
| SVG (`.svg`) | `xml.etree.ElementTree` (stdlib) | Title, desc, text labels, group structure, links |
| Markdown (post-processing) | `keybert` | Per-section keyword extraction |

### Image References

Image references are extracted as `DocLink` entries with `is_image: true`, ensuring that doc→SVG and doc→image cross-references appear in the reference index. This enables:

- **`←N` counts on SVG files** — an architecture diagram embedded by 5 documents gets `←5`, signalling its centrality
- **`→` outgoing refs in the outline** — a section embedding `![diagram](assets/flow.svg)` shows `→assets/flow.svg` under that heading
- **Connected components** — documents and the SVGs they embed cluster together for tier initialization

Rather than pattern-matching every possible markdown and HTML image syntax, the extractor uses a **path-extension scan**: each line is matched against `[\w./-]+\.svg` (and optionally other image extensions). This catches all embedding syntaxes — `![alt](path.svg)`, `<img src="path.svg">`, `<source srcset="path.svg">`, reference-style definitions, and even plain-text mentions — without needing per-syntax regexes.

Matched paths are validated against the repository file tree (via `Repo.get_flat_file_list()`) to filter out false positives (e.g., a prose mention of "the old layout.svg was removed"). Only paths that resolve to an existing repo file become `DocLink` entries. This validation is cheap — the flat file list is already cached by the repo layer.

All matched references are stored as `DocLink` with `is_image: true`. The `is_image` flag allows the formatter to optionally annotate image refs differently in future (e.g., `→[img] assets/flow.svg`), though the current formatter treats them identically to regular links.

External URLs containing `.svg` (e.g., `https://img.shields.io/badge/coverage.svg`) are excluded by the repo file tree validation — they don't match any local path.

**What this approach deliberately does not capture:** image alt text (`![alt text](path)`) and HTML attributes (`width`, `height`, `class`). Neither is needed — alt text is redundant with the SVG's own extracted labels (via `SvgExtractor`), and display attributes are irrelevant to the document reference graph. The path-extension scan trades syntactic precision for robustness: it catches every embedding syntax (including future ones) with a single regex and zero false positives.

### SVG Indexing Lifecycle

SVG files follow the same indexing lifecycle as markdown files — they are discovered, extracted, cached, and invalidated through identical code paths. The `EXTRACTORS` registry maps `.svg` → `SvgExtractor`, so any code that iterates over supported extensions automatically includes SVGs.

**When SVGs are indexed:**

| Trigger | SVGs indexed? | Mechanism |
|---|---|---|
| Server startup (background) | ✅ | `_build_doc_index()` → `index_repo()` discovers `.svg` via `EXTRACTORS` |
| Switch to doc mode | ✅ | `_switch_to_doc_mode()` → `index_repo()` re-indexes changed files |
| Every chat in doc mode | ✅ | `_stream_chat()` → `index_repo()` (mtime-based cache — only changed files re-parsed) |
| LLM edits an SVG | ✅ | Explicit `invalidate_file()` in `_stream_chat` + next `index_repo()` |
| User edits SVG in viewer | ✅ (lazy) | Mtime change on disk detected on next `index_repo()` call |
| Chat in code mode | ❌ | Doc index not consulted — SVG outlines not in context |

**Mtime-based cache** — `DocCache.get(path, mtime)` returns the cached outline if the mtime matches. When `index_repo()` runs, each `.svg` file is checked against the cache; only files with changed mtimes are re-parsed by `SvgExtractor`. This makes re-indexing after saves effectively free for unchanged files.

**Explicit invalidation on LLM edits** — After edit blocks are applied in `_stream_chat()`, modified files are invalidated in both the symbol index and doc index:

```python
if self._doc_index:
    for path in modified:
        self._doc_index.invalidate_file(path)
```

This ensures the next `index_repo()` re-parses any SVG the LLM just edited, regardless of mtime granularity.

**Manual edits in the SVG editor** — When a user edits and saves an SVG via the SVG viewer/editor (`SvgViewer._save()`), the file's mtime changes on disk. No explicit invalidation fires — the mtime change is detected lazily by the next `index_repo()` call (triggered by the next chat message). This is the same lazy-detection pattern used for markdown files edited in Monaco, as described in the Caching section above. The SVG outline may be stale only until the next chat message.

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
    svg_extractor.py        # v1 — stdlib xml.etree.ElementTree
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
keywords = kw_model.extract_keywords(
    section_text, top_n=3, keyphrase_ngram_range=(1, 2),
    use_mmr=True, diversity=0.5
)
# [("OAuth2 flow", 0.72), ("client_id", 0.65), ("scope parameter", 0.58)]
```

**Maximal Marginal Relevance (MMR):** By default, KeyBERT selects keywords purely by semantic similarity to the full section text. This produces near-duplicate keywords — e.g., "tier promote", "promotes tiers", "promotion tier" — because they all embed close to the same meaning. Enabling `use_mmr=True` applies Maximal Marginal Relevance: after selecting the most relevant keyword, each subsequent keyword is penalized for similarity to already-selected keywords. The `diversity` parameter (0.0–1.0) controls the penalty strength. At `diversity=0.5` (the default), keywords remain relevant to the section but are pushed apart in embedding space, producing more informative triples like "tier promotion", "cascade downward", "broken threshold" instead of three permutations of the same bigram.

### Known Limitations & Future Improvements

MMR significantly reduces keyword permutations. Two further improvements — content-type hints and section size signals — address additional limitations identified during LLM-side evaluation of the outline format:

1. **Content-type hints** (implemented). The markdown extractor scans each section for structural content patterns and emits `[table]`, `[code]`, and `[formula]` annotations after the keywords. Detection uses lightweight regex matching during extraction — no additional dependencies:
   - `[table]` — section contains a markdown table separator row (`|---|`)
   - `[code]` — section contains a fenced code block (triple backticks or tildes)
   - `[formula]` — section contains display math (`$$`) or inline math (`$...$`)

   These hints let the LLM know that a section contains structured reference content (tables, code examples) without loading the file. For example, seeing `## Tier Structure [table] ~35ln` immediately signals a reference table worth loading.

2. **Section size signal** (implemented). Each heading is annotated with `~Nln` showing the line count from that heading to the next. This is computed during extraction at zero cost from the `start_line` delta between consecutive headings. Sections under 5 lines are omitted to reduce noise (the absence of `~Nln` itself signals a trivially short section). This helps the LLM budget file-loading decisions — a `~200ln` section is a significant context investment, while a `~12ln` section is cheap.

3. **Generic keywords for short sections** (implemented). Sections with little text produce generic keywords because the embedding model has less signal to differentiate. MMR helps by forcing diversity, but very short sections (near the `min_section_chars` threshold) may still produce uninformative keywords. The enricher applies a **TF-IDF fallback** for sections below `keywords_tfidf_fallback_chars` (default: 150 characters): instead of calling KeyBERT's embedding-based extraction, it uses `TfidfVectorizer` from scikit-learn (already a transitive dependency of keybert) fitted on **all section texts in the document as a corpus**, extracting the highest-scoring terms for the target section. This surfaces terms that are distinctive to the short section relative to its siblings — TF-IDF penalises corpus-wide frequency directly, whereas embedding similarity tends to select generic terms that are semantically close to a short passage's overall meaning. The corpus is built from all cleaned section texts (both short and long) collected during the enrichment pass, so even short sections benefit from contrastive scoring against the full document. The threshold and fallback are configured via `app.json` (`keywords_tfidf_fallback_chars`). Sections below `min_section_chars` are still skipped entirely.

4. **Incidental terms from examples** (implemented). When a section contains worked examples with specific values (model names, token counts, configuration snippets), KeyBERT may select those concrete terms over the conceptual terms that actually describe the section's purpose. For instance, a section explaining a clustering algorithm with an Opus token-budget example may surface "opus" as a keyword instead of "orphan files" or "connected components". The enricher applies two layers of filtering:

   **Layer 1 — Code stripping:** Fenced code blocks (`` ``` `` … `` ``` ``) and inline code spans (`` `…` ``) are stripped from section text before passing it to KeyBERT, so the transformer focuses on explanatory prose rather than example data. Stripping is applied to a copy of the section text used only for embedding — the original content is not modified. The regex is lightweight: fenced blocks are removed with a multiline match on triple-backtick/tilde boundaries, and inline spans with a single-pass substitution. Sections that become empty after stripping (i.e., sections that are *entirely* code) fall back to the unstripped text so they still produce keywords rather than being silently skipped.

   **Layer 2 — Corpus-aware stopwords:** After KeyBERT extracts candidate keywords, the enricher filters out terms that appear in more than `keywords_max_doc_freq` fraction of sections across the entire document (default: 0.6). Terms like "diff viewer", "file picker", or "selection" that pervade a UI spec are corpus-frequent — they describe the document's domain, not any specific section's distinctive content. The document frequency is computed once per `enrich_all()` call from the batch of section texts and applied as a post-filter on each section's keyword list. This is cheap — it reuses the already-extracted candidate lists and requires only a term→count dictionary built during the batch phase. The filter runs *after* KeyBERT scoring so that MMR diversity still operates on the full candidate set; only the final output is pruned. If pruning would remove all keywords for a section, the top keyword is retained regardless of document frequency (a section should never be left entirely without keywords due to filtering).

5. **Adaptive `top_n` for large sections** (implemented). Sections describing multi-pathway decision logic (e.g., "graduate via path A, B, or C depending on X") compress poorly into 3 keywords because the distinctive terms are spread across branches. The enricher uses an adaptive `top_n`: sections with `section_lines >= 15` use `top_n + 2` (default: 5 keywords), while shorter sections use the base `top_n` (default: 3). This captures vocabulary from multiple branches at a modest token cost of ~2–4 extra tokens per large section. The threshold and bonus are not separately configurable — they are hardcoded in the enricher as a simple heuristic. The base `top_n` remains configurable via `app.json`.

6. **Future: Sibling-contrastive re-ranking** (not yet addressed). The TF-IDF fallback (item 3) already provides contrastive keyword extraction for short sections by fitting the vectorizer on all section texts as a corpus. A natural extension would apply the same principle to *all* sections as a **re-ranking step** after KeyBERT extraction: for each KeyBERT candidate keyword, compute its TF-IDF score across sibling sections and boost candidates that are distinctive (high TF-IDF in the target section, low in siblings). This would address cases where KeyBERT selects semantically relevant but non-distinctive terms for medium-to-large sections — e.g., selecting "value tracked" for a section about stability counters when "hash mismatch" would be more distinctive. The mechanism is cheap (reuses the already-fitted `TfidfVectorizer` from the short-section fallback) and requires no new dependencies. It is deferred because the corpus-frequency post-filter (item 4, Layer 2) already removes the worst offenders, and the remaining quality gap is acceptable for an initial release.

### Integration: `keyword_enricher.py`

The keyword enricher runs as a post-processing step after structural extraction:

1. **Extractor** produces a `DocOutline` with headings, links, and raw section text
2. **KeywordEnricher** receives the outline and the full document text
3. All eligible sections (above `min_section_chars`) are collected into a batch
4. KeyBERT extracts keywords for all sections in a single `extract_keywords()` call — the underlying sentence-transformer batches all embeddings in one forward pass
5. Keywords are attached to their respective headings and passed to the formatter

If the batched call fails (e.g., KeyBERT version incompatibility), the enricher falls back to per-heading extraction automatically.

```pseudo
KeywordEnricher:
    _model: KeyBERT          # lazily initialized, shared across files
    _top_n: int              # keywords per section (default: 3)
    _ngram_range: (int, int) # (1, 2) for single words and bigrams
    _min_section_chars: int  # skip keyword extraction for very short sections (default: 50)
    _diversity: float        # MMR diversity (0.0 = no diversity, 1.0 = max; default: 0.5)
    _tfidf_fallback_chars: int  # sections below this use TF-IDF instead of KeyBERT (default: 150)
    _max_doc_freq: float     # corpus-frequency ceiling for keyword filtering (default: 0.6)

    enrich(outline: DocOutline, full_text: string) -> DocOutline:
        full_text_lines = full_text.splitlines()
        all_headings = _flatten(outline.headings)  # recursive tree→list

        # Collect eligible sections for batched extraction
        batch_texts = []
        batch_top_ns = []
        batch_headings = []
        all_cleaned_texts = []      # all sections (both short and long) for TF-IDF corpus
        all_cleaned_headings = []
        all_cleaned_top_ns = []
        for i, heading in enumerate(all_headings):
            end_line = all_headings[i+1].start_line if i+1 < len(all_headings) else len(full_text_lines)
            section_text = "\n".join(full_text_lines[heading.start_line:end_line])
            if len(section_text) < _min_section_chars:
                skip

            # Strip code blocks/spans so KeyBERT focuses on prose
            cleaned = _strip_code(section_text)
            if not cleaned.strip():
                cleaned = section_text  # fallback: section is entirely code

            # Adaptive top_n: large sections get more keywords
            section_lines = end_line - heading.start_line
            effective_top_n = _top_n + 2 if section_lines >= 15 else _top_n

            all_cleaned_texts.append(cleaned)
            all_cleaned_headings.append(heading)
            all_cleaned_top_ns.append(effective_top_n)

            # Route: short sections use TF-IDF fallback, others go to KeyBERT batch
            if len(cleaned) >= _tfidf_fallback_chars:
                batch_texts.append(cleaned)
                batch_headings.append(heading)
                batch_top_ns.append(effective_top_n)

        # TF-IDF fallback for short sections — now that we have the full corpus
        tfidf_corpus = [t for t in all_cleaned_texts] if all_cleaned_texts else []
        for heading, cleaned, effective_top_n in zip(all_cleaned_headings, all_cleaned_texts, all_cleaned_top_ns):
            if len(cleaned) < _tfidf_fallback_chars:
                heading.keywords = [
                    kw for kw, score in _extract_tfidf_keywords(cleaned, effective_top_n, tfidf_corpus)
                ]

        if not batch_texts:
            return outline

        # Batched call uses max(top_ns) — we trim per-heading below
        max_top_n = max(batch_top_ns)
        all_keywords = _model.extract_keywords(
            batch_texts, max_top_n, ngram_range,
            use_mmr=True, diversity=_diversity
        )

        # Normalize: single doc returns flat list, not list-of-lists
        if batch_texts and all_keywords and not isinstance(all_keywords[0], list):
            all_keywords = [all_keywords]

        # Build document-frequency map for corpus-aware filtering
        term_doc_count = {}  # term → number of sections containing it
        for text in batch_texts:
            seen = set()
            for word in text.lower().split():
                if word not in seen:
                    term_doc_count[word] = term_doc_count.get(word, 0) + 1
                    seen.add(word)
        doc_freq_threshold = len(batch_texts) * _max_doc_freq

        for heading, keywords, effective_n in zip(batch_headings, all_keywords, batch_top_ns):
            filtered = [
                kw for kw, score in keywords[:effective_n]
                if score > 0.3 and not _is_corpus_frequent(kw, term_doc_count, doc_freq_threshold)
            ]
            # Never leave a section with zero keywords due to filtering
            if not filtered and keywords:
                filtered = [keywords[0][0]]
            heading.keywords = filtered

        return outline

    _is_corpus_frequent(kw: string, term_doc_count: dict, threshold: int) -> bool:
        # A keyword (possibly a bigram) is corpus-frequent if ALL its constituent
        # unigrams exceed threshold. This uses unigram document frequencies only —
        # matching KeyBERT's bigram tokenization would add complexity for marginal
        # benefit. The ALL-must-exceed rule means a bigram like "tier promotion" is
        # only filtered if both "tier" AND "promotion" are individually pervasive.
        # A bigram with one rare constituent (e.g., "cascade demotion") survives.
        return all(term_doc_count.get(w, 0) > threshold for w in kw.lower().split())

    _extract_tfidf_keywords(text: string, top_n: int, corpus: list[string]) -> list[(string, float)]:
        # Fallback for short sections where embeddings produce generic keywords.
        # Uses sklearn's TfidfVectorizer (transitive dep of keybert) fitted on all
        # section texts as the corpus, so IDF penalises terms common across sections.
        # The target section must be included in corpus (it is by construction).
        from sklearn.feature_extraction.text import TfidfVectorizer
        vec = TfidfVectorizer(ngram_range=_ngram_range, stop_words="english")
        try:
            tfidf = vec.fit_transform(corpus)
        except ValueError:
            return []  # empty vocabulary after stop words
        # Find the row corresponding to the target section
        target_idx = corpus.index(text)
        feature_names = vec.get_feature_names_out()
        scores = tfidf.toarray()[target_idx]
        ranked = sorted(zip(feature_names, scores), key=lambda x: -x[1])
        return ranked[:top_n]

    _strip_code(text: string) -> string:
        # Remove fenced code blocks (```…``` or ~~~…~~~)
        # Non-greedy .*? with DOTALL matches the shortest span between matching fences
        text = re.sub(r'(?m)^[ \t]*(`{3,}|~{3,})[^\n]*\n(.*?\n)?[ \t]*\1[ \t]*$', '', text, flags=re.DOTALL)
        # Remove inline code spans (`…`)
        text = re.sub(r'`[^`\n]+`', '', text)
        return text
```

The enricher receives `full_text` as a separate parameter (not stored in the outline) to keep the cached `DocOutline` compact. Each `DocHeading` stores its `start_line`, and the enricher flattens the heading tree to compute section boundaries (each section runs from one heading's `start_line` to the next heading's `start_line`). The markdown extractor populates `start_line` during extraction at no additional cost.

### Document Type Detection

Document type (`DocOutline.doc_type`) is inferred during extraction as a lightweight heuristic — no KeyBERT or ML involved:

```pseudo
detect_doc_type(path: string, headings: DocHeading[]) -> string:
    basename = lowercase(filename(path))
    dir_parts = lowercase(directory_parts(path))

    # Path-based detection (highest confidence)
    if basename starts with "readme":     return "readme"
    if basename starts with "adr-":       return "decision"
    if "spec" or "rfc" in dir_parts:      return "spec"
    if "guide" or "tutorial" in dir_parts: return "guide"
    if "reference" or "api" in dir_parts: return "reference"
    if "notes" or "meeting" in dir_parts: return "notes"

    # Heading-based detection (fallback)
    heading_texts = lowercase([h.text for h in flatten(headings)])
    if "status" in heading_texts and "decision" in heading_texts:
        return "decision"                 # ADR format
    if any numbered headings (e.g. "1. ", "1.1 "):
        return "spec"

    return "unknown"
```

**Batched extraction** is the primary performance optimisation. When KeyBERT receives a list of documents, the underlying sentence-transformer encodes all section texts in a single forward pass rather than one pass per section. This typically yields 2–4× speedup over per-heading calls for documents with many sections. MMR adds negligible overhead — the diversity penalty is computed on the already-extracted embeddings, not via additional model forward passes.

### Lazy Loading

KeyBERT depends on `sentence-transformers` which downloads the configured model on first use (~420MB for the default `all-mpnet-base-v2`). The enricher follows the same lazy-loading pattern as tree-sitter languages in `parser.py`:

- `KeyBERT` is imported inside `__init__` or on first call
- If `keybert` is not installed, a warning is logged and headings are emitted without keywords
- The model is initialized once and reused across all files in an indexing run

### Graceful Degradation in Packaged Releases

The PyInstaller release binaries do not bundle `keybert` or `sentence-transformers` (and their transitive dependency PyTorch, which adds 200MB+ CPU-only or 2–4GB with CUDA). Document mode remains fully functional without keywords — heading outlines, cross-reference links, reference counting, cache tiering, and the document-specific system prompt all work without any keyword library.

When a user switches to document mode and keybert is not installed:

1. **Backend:** `DocIndex.keywords_available` property returns `False`. The `_switch_to_doc_mode()` response includes `keywords_available: false` and a human-readable `keywords_message` explaining the limitation and how to install
2. **Frontend:** The mode-switch handler in `ac-dialog.js` checks for `keywords_available === false` and shows a **warning toast** with the install instructions
3. **Terminal:** A `logger.warning` is emitted during `_build_doc_index()` for server-side visibility

The degradation is purely cosmetic — headings appear without `(keyword1, keyword2)` annotations. For most documents with descriptive heading text, the structural outline alone provides sufficient context for the LLM. Keyword enrichment is most valuable for documents with repetitive subheading patterns (API references, spec templates).

Users running from source can install keyword support with:

```bash
pip install ac-dc[docs]
# or
uv sync --extra docs
```

### Caching

Keyword extraction results are cached alongside the structural outline using the same mtime-based cache as the symbol index. Since KeyBERT is deterministic (same input + same model → same output), content hashing works correctly for tier stability detection. Keyword extraction only re-runs when the file's mtime changes.

**Disk persistence:** `DocCache` writes a JSON sidecar file per cached entry to `.ac-dc/doc_cache/` on every `put()`. On initialization, existing sidecar files are loaded back into the in-memory cache so that keyword-enriched outlines survive server restarts. This avoids the ~65s KeyBERT re-enrichment cost on every restart — only files whose mtime has changed since the last run need re-processing.

Each sidecar file (`<safe_path>.json`) stores:
- `path` — original relative file path
- `mtime` — file modification time at indexing
- `content_hash` — deterministic hash of the outline (for stability tracking)
- `keyword_model` — name of the sentence-transformer model used
- `outline` — serialized `DocOutline` (headings with keywords, links)

The sidecar format uses compact JSON (`separators=(",", ":")`) to minimize disk usage. Corrupt sidecar files are silently removed on load. The `.ac-dc/` directory is already gitignored, so `doc_cache/` inside it requires no additional gitignore entries.

**Cache lifecycle operations:**
- `invalidate(path)` removes both the in-memory entry and the disk sidecar
- `clear()` removes all sidecar files and clears the in-memory cache
- `DocCache(repo_root=None)` falls back to in-memory-only behavior (no disk persistence) — used in tests and when repo root is unavailable

**Model change invalidation:** The `DocCache` stores the `keyword_model` name used to generate each cached entry. On cache lookup, if the stored model name differs from the current `app.json` configuration, the entry is treated as stale and re-extracted. This ensures that changing `keyword_model` triggers a full re-enrichment without requiring a manual cache clear. This check applies to both in-memory and disk-loaded entries.

**File deselection and re-indexing:** When a file is unchecked (removed from selected files / full-content context) and the doc map is rebuilt, `index_repo()` is called which checks the cache for each file. If the file was edited while in full-content context, its mtime will have changed and the stale cache entry is bypassed — the file is re-extracted and re-enriched. If the file was not modified, the disk-cached entry is used instantly.

**Edit-driven invalidation:** When the LLM applies edit blocks that modify files, `_stream_chat` explicitly invalidates both the symbol index and the doc index caches for all modified files. This ensures the next `index_repo()` call re-parses modified documents regardless of mtime granularity:

```python
# Invalidate symbol cache for modified files
if self._symbol_index:
    for path in modified:
        self._symbol_index.invalidate_file(path)

# Invalidate doc index cache for modified doc files
if self._doc_index:
    for path in modified:
        self._doc_index.invalidate_file(path)
```

**Manual edits in the diff editor:** When a user manually edits and saves a `.md` file in the Monaco diff editor, no index invalidation occurs immediately — the save goes directly to `Repo.write_file`. The mtime change is detected lazily: the next `index_repo()` call (triggered by a chat request or mode switch) sees the new mtime, cache-misses, and re-parses the file. This is correct because mtime-based cache validation catches all disk writes. Explicit invalidation (as above) is only needed for LLM edits as a belt-and-suspenders measure alongside mtime checks.

### Performance

| Operation | Time (mpnet-base default) | Notes |
|-----------|------|-------|
| Model load (first call) | ~5s | One-time per session (~420MB download on first-ever run) |
| Model load (cached) | ~400ms | sentence-transformers caches locally |
| Markdown structure extraction (one file) | <5ms | Regex-based, no dependencies |
| Extract keywords (one section) | ~40-60ms | Depends on section length |
| Extract keywords (batched, 20 sections) | ~300-500ms | 2-4× faster than 20 individual calls |
| Full document (20 sections) | ~500ms | With batched extraction |
| Full repo (50 docs) | ~30-40s | First run with batched extraction; subsequent runs check mtime and skip unchanged files |

For comparison, tree-sitter indexing of a full repo takes 1-5s. Document indexing with KeyBERT is slower but runs infrequently — documents change much less often than code. The bottleneck is entirely keyword extraction, not structural parsing — markdown outline extraction for 50 files completes in <250ms. Batched extraction (see Integration section above) provides the primary speedup by letting the sentence-transformer encode all section texts in a single forward pass. Smaller models (e.g., `all-MiniLM-L6-v2`) reduce keyword extraction times by ~60% at some quality cost — see the model comparison table in Design Decisions.

**Threaded cache writes:** During the enrichment phase of `index_repo()`, a `ThreadPoolExecutor(max_workers=4)` overlaps disk sidecar writes with the CPU-bound keyword extraction for the next file. Since enrichment is CPU-bound (sentence-transformer embedding) and cache writes are I/O-bound, this keeps disk I/O off the critical path. The first file is enriched synchronously (to trigger model loading with progress reporting); remaining files use the thread pool for cache writes only. The sentence-transformer itself is **not** run in threads — Python's GIL prevents CPU-bound threading from providing speedup, and the model's ~420MB memory footprint makes process-based parallelism impractical. The real speed win comes from batched extraction: `KeywordEnricher.enrich()` sends all sections to KeyBERT in a single `extract_keywords()` call, which lets the underlying transformer batch-encode embeddings in one forward pass (2-4× faster than per-heading calls).

### Token Budget

The enriched format adds tokens from three sources:

| Annotation | Per heading | 20-heading document | Notes |
|---|---|---|---|
| Keywords | ~3-8 tokens | ~60-160 tokens | Most valuable for disambiguation |
| Content types (`[table]` etc.) | ~2-4 tokens | ~20-40 tokens | Only on headings with detected content |
| Section size (`~Nln`) | ~2 tokens | ~30-40 tokens | Omitted for sections under 5 lines |
| Section refs (`→`) | ~5-10 tokens each | ~50-100 tokens | Only on headings that contain links |
| Ref counts (`←N`) | ~2 tokens | ~10-20 tokens | Only on headings with incoming refs |
| Doc type tag | ~2 tokens | ~2 tokens (once per file) | Minimal cost |
| **Total overhead** | | **~170-360 tokens** | Per 20-heading document |

For a 50-document repo, the full enriched index adds ~6,000-14,000 tokens — well within the budget freed by removing code symbols in document mode. In code mode, where doc outlines are not included, these tokens are never spent. There is headroom to increase `top_n` from 3 to 4–5 for larger sections without exceeding budget — the additional ~2,000–4,000 tokens across 50 documents would improve keyword quality for sections with branching logic or worked examples.

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
    "keywords_min_score": 0.3,
    "keywords_diversity": 0.5,
    "keywords_tfidf_fallback_chars": 150,
    "keywords_max_doc_freq": 0.6
  }
}
```

| Key | Type | Default | Description |
|---|---|---|---|
| `keyword_model` | string | `"all-mpnet-base-v2"` | Sentence-transformer model name |
| `keywords_enabled` | bool | `true` | Enable/disable keyword extraction entirely |
| `keywords_top_n` | int | `3` | Keywords per section. Consider 4–5 for repos with complex spec documents |
| `keywords_ngram_range` | [int, int] | `[1, 2]` | Unigrams and bigrams |
| `keywords_min_section_chars` | int | `50` | Skip keyword extraction for very short sections |
| `keywords_min_score` | float | `0.3` | Minimum relevance score to include a keyword |
| `keywords_diversity` | float | `0.5` | MMR diversity penalty (0.0 = pure relevance, 1.0 = max diversity). Higher values push keywords apart in embedding space, reducing permutations |
| `keywords_tfidf_fallback_chars` | int | `150` | Sections below this character count use TF-IDF extraction instead of KeyBERT embeddings. TF-IDF surfaces rare-but-present terms more reliably than embeddings for short text |
| `keywords_max_doc_freq` | float | `0.6` | Corpus-frequency ceiling. Keywords where all constituent terms appear in more than this fraction of sections are filtered out. Removes pervasive domain terms ("diff viewer", "file picker") that don't disambiguate |

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
2. **File tree unchanged** — all files remain visible. Non-technical users may still need to see the full repository structure for orientation, and the tree is cheap in tokens. Filtering it adds complexity for no benefit
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

**Index lifecycle in `LLMService`:** Both `SymbolIndex` and `DocIndex` are held simultaneously — the code index is built during startup (as today) and the doc index is built **eagerly in the background after startup completes**. The build is deferred to after the "ready" signal so the startup overlay dismisses and the UI becomes interactive before heavy model loading (KeyBERT/PyTorch sentence-transformers) blocks the GIL and stalls WebSocket delivery. The `_start_background_doc_index()` call is made by `main.py` *after* `_send_progress("ready", ...)` — not inside `complete_deferred_init()` — so the startup overlay is guaranteed to dismiss before KeyBERT/PyTorch model loading blocks the GIL and stalls WebSocket message delivery. Once built, both indexes are held in memory so mode switches are instant. Memory overhead is modest: index data structures are dictionaries of small outline/symbol objects, not full file contents. The active mode determines which index feeds `_build_tiered_content()` and which formatter produces the map output.

**Dispatch mechanism in `_build_tiered_content()`:** The method checks `self._mode` (an enum: `Mode.CODE` or `Mode.DOC`) and calls the appropriate index. Both `SymbolIndex` and `DocIndex` expose the same two methods needed by tier assembly: `get_symbol_map()`/`get_doc_map()` for the full map and `get_file_symbol_block()`/`get_file_doc_block()` for per-file blocks. A shared interface is not needed — the dispatch is a simple if/else in one method. The formatter selection follows the same pattern: `CompactFormatter` for code, `DocFormatter` for documents.

**File discovery in `DocIndex`:** The orchestrator scans the repo for `.md` files using the same `os.walk` pattern as `SymbolIndex._get_source_files()`, filtered by extension rather than `language_for_file()`. Files matching `.gitignore` patterns and the `.ac-dc/` directory are excluded, consistent with the code index.

```
Server startup
    │
    ├── Code index built, stability initialized, "ready" sent → startup overlay dismissed
    └── _start_background_doc_index() called AFTER "ready"
          ├── Show header progress bar via startupProgress/compactionEvent events
          ├── Build DocIndex (structure extraction + keyword enrichment)
          ├── Build DocReferenceIndex from extracted links
          └── Send doc_index_ready compaction event → header progress bar dismissed, mode toggle enabled

User clicks mode toggle (doc index already built)
    │
    ├── Re-index doc files (mtime-based — only changed files re-parsed)
    ├── Clear file context (selected files)
    ├── Broadcast cleared file selection via filesChanged → frontend picker deselects
    ├── Swap system prompt (system.md → system_doc.md)
    ├── Swap snippets (snippets.json → doc-snippets.json)
    ├── Switch stability tracker to doc-mode instance (separate state per mode)
    ├── Update stability with current context (run _update_stability)
    ├── Rebuild tier content from doc_index instead of symbol_index
    ├── Frontend: mode-changed event triggers cache/context tab refresh
    └── Insert system message: "Switched to document mode"
```

The re-index step on every mode switch ensures that any files edited manually in the diff editor (or modified by LLM edits while in code mode) are detected and re-parsed before the doc map is assembled. Since the mtime-based cache skips unchanged files, this step is fast (~<50ms) unless files were actually modified. The re-index runs with progress reporting via `startupProgress` events so the header progress bar shows activity during the switch. A final `doc_index_ready` compaction event clears the progress bar after the switch completes.

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

The document reference index tracks links at **section granularity**, not just document level. This is the key enabler for section-level `←N` counts and `→target.md#Section` annotations in the compact output.

### Link Types

- **Doc section → Doc section**: `[link](other.md#Section-Heading)` — a heading in one document links to a specific heading in another. The most valuable link type for concept tracing
- **Doc section → Doc**: `[link](other.md)` — a heading links to another document without targeting a specific section. The link is associated with the source heading for context
- **Doc → Code**: `[context](../src/context.py)` — documents referencing source files. Tracked at heading level (which section contains the link)
- **Code → Doc**: Not extracted automatically, but could be inferred from comments containing doc paths

### Section Anchor Resolution

When a link target contains a fragment (`other.md#History-Compaction-Interaction`), the reference index resolves it to a specific `DocHeading` in the target document's outline. Resolution uses GitHub-style anchor slugging: lowercase, spaces→hyphens, strip punctuation. If the anchor doesn't match any heading in the target (typo, stale link), the link falls back to document-level and is flagged as `unresolved_anchor: true` for optional reporting.

### Incoming Reference Counting

Each `DocHeading` receives an `incoming_ref_count` — the number of sections in *other* documents that link to it (or to its parent document if the link has no fragment). Counting rules:

- A link to `cache_tiering.md#Tier-Structure` increments the `incoming_ref_count` on the "Tier Structure" heading
- A link to `cache_tiering.md` (no fragment) increments the count on the **top-level heading** (H1) of that document
- Self-references (links within the same document) are excluded from the count
- Multiple links from the same source section to the same target section count as one (deduplicated)

Counts of zero are omitted from the formatter output (no `←0` annotations).

### Implementation

This is implemented as a separate `DocReferenceIndex` class in `doc_index/reference_index.py`, not a subclass of the code `ReferenceIndex`. The two indexes have different edge types (heading-level links vs symbol-level imports) and different build inputs. However, `DocReferenceIndex` exposes the same `connected_components()` and `file_ref_count()` protocol methods so the stability tracker's `initialize_from_reference_graph()` works with either index. The tracker calls only these two methods and never inspects the internal node types (`Symbol`/`CallSite` vs `DocHeading`/`DocLink`), so no modification to the tracker is needed — it operates on file-level connectivity, not symbol-level details.

This enables the connected components algorithm to cluster related documents together for tier initialization. Doc→Code links are included as edges in the graph — if `specs/api.md` links to `src/api.py`, both files appear as nodes in the `DocReferenceIndex`. However, code files in this graph are leaf nodes (they have no outgoing edges since they aren't parsed by the doc extractor), so they serve only as clustering bridges: two documents that both reference the same source file will land in the same connected component.

### Building the Section-Level Graph

The reference index is built in two passes:

1. **Collect**: iterate over all `DocOutline` objects, extracting every `DocLink` with its `source_heading` and `target_heading` fields. Build a mapping: `(source_path, source_heading) → [(target_path, target_heading)]`
2. **Resolve**: for each link, look up the target path's `DocOutline` and resolve the `target_heading` anchor to a `DocHeading` node. Increment that heading's `incoming_ref_count`. Record the resolved link as a `DocSectionRef` on the source heading's `outgoing_refs` list

This two-pass approach ensures all outlines are available before resolution begins (a link from doc A to doc B requires B's outline to resolve the heading anchor).

## Design Decisions

### Formatter Output Assembly

The `DocFormatter` assembles the compact output for each file in a defined order:

1. **Path line** — file path followed by `[doc_type]:` tag (omitted if `unknown`)
2. **Heading tree** — indented by level, each heading followed by:
   - Keywords in parentheses `(kw1, kw2, kw3)` — omitted if no keywords extracted
   - Incoming ref count `←N` — omitted if zero
   - Outgoing section refs on indented lines below: `→target.md#Section-Heading`
3. **Links line** — `links:` listing all document-level link targets (deduplicated), same as code format

Outgoing section refs are rendered as indented children of the heading they appear under, prefixed with `→`. This keeps them visually associated with their source section while remaining distinct from child headings (which use `#` prefixes).

```pseudo
DocFormatter.format_file(outline: DocOutline, ref_index: DocReferenceIndex) -> string:
    lines = []
    type_tag = f" [{outline.doc_type}]" if outline.doc_type != "unknown" else ""
    lines.append(f"{outline.path}{type_tag}:")

    for heading in walk_tree(outline.headings):
        indent = "  " * heading.level
        kw_str = f" ({', '.join(heading.keywords)})" if heading.keywords else ""
        ct_str = " " + " ".join(f"[{ct}]" for ct in heading.content_types) if heading.content_types else ""
        sz_str = f" ~{heading.section_lines}ln" if heading.section_lines >= 5 else ""
        ref_count = ref_index.incoming_count(outline.path, heading.text)
        ref_str = f" ←{ref_count}" if ref_count > 0 else ""
        lines.append(f"{indent}{'#' * heading.level} {heading.text}{kw_str}{ct_str}{sz_str}{ref_str}")

        # Outgoing section refs, indented one level deeper
        for ref in heading.outgoing_refs:
            ref_indent = "  " * (heading.level + 1)
            if ref.target_heading:
                lines.append(f"{ref_indent}→{ref.target_path}#{ref.target_heading}")
            else:
                lines.append(f"{ref_indent}→{ref.target_path}")

    # Document-level links summary
    all_targets = deduplicate([link.target for link in outline.links])
    if all_targets:
        lines.append(f"  links: {', '.join(all_targets)}")

    return "\n".join(lines)
```

### Cache Infrastructure — Shared Base Class

The document index shares the `symbol_index/cache.py` infrastructure via a base class extraction. `SymbolCache` is refactored into an abstract `BaseCache` with concrete subclasses:

- `BaseCache` (in `src/ac_dc/base_cache.py`) — mtime-based get/put/invalidate, content hashing, `cached_files` property (in-memory only)
- `SymbolCache(BaseCache)` — existing code symbol caching (unchanged external API, in-memory only — fast enough that disk persistence is unnecessary)
- `DocCache(BaseCache)` — document outline caching with the same mtime semantics, plus disk persistence via JSON sidecar files in `.ac-dc/doc_cache/` (necessary because KeyBERT enrichment is expensive — ~40-60ms per section vs <5ms for tree-sitter parsing)

This pattern extends to the formatter: a `BaseFormatter` (in `src/ac_dc/base_formatter.py`) provides common logic (path aliasing, reference counting integration), while `CompactFormatter` (in `symbol_index/compact_format.py`, unchanged external API) and `DocFormatter` (in `doc_index/formatter.py`) implement format-specific output. Mode-specific logic — such as test file collapsing for code — lives in the respective subclass. The legend is defined as an abstract method in the base class, implemented differently by each subclass to describe its own symbol vocabulary.

**Why `ac_dc/` level for base classes:** Both `symbol_index/` and `doc_index/` are sibling packages. Placing shared bases in either one would create a cross-dependency. The `ac_dc/` package root is the natural shared location, keeping both index packages independent.

### UI Mode Toggle

Document mode is exposed as a toggle in the `ac-dialog` component, next to the existing tab bar. A simple code/document mode indicator shows the current mode and switches on click. Mode switching clears file context and rebuilds tier content from the appropriate index.

### Search — Unchanged

The existing `search_files` in `repo.py` (grep over file content) is used as-is for both modes. Document headings are not added as a separate search target. This keeps the implementation simple and can be revisited later if heading-specific search proves valuable.

### Sentence-Transformer Model — User Configurable

The sentence-transformer model used by KeyBERT is configurable via `app.json`. The default is `all-mpnet-base-v2` — the highest quality English model. Load time (~5s first run, ~400ms cached) is acceptable given the fine-grained progress reporting described below. Comparative performance for a 50-document repo (1000 sections):

| Model | Size | Load (first) | Load (cached) | Per-section | Full repo (1000 sections, batched) |
|---|---|---|---|---|---|
| `all-MiniLM-L6-v2` | 80MB | ~2s | ~200ms | ~20-30ms | ~15s |
| `all-MiniLM-L12-v2` | 120MB | ~2.5s | ~250ms | ~25-40ms | ~18s |
| `all-mpnet-base-v2` (default) | 420MB | ~5s | ~400ms | ~40-60ms | ~35s |
| `all-distilroberta-v1` | 290MB | ~4s | ~350ms | ~35-50ms | ~25s |

Configuration in `app.json`:

```json
{
  "doc_index": {
    "keyword_model": "all-mpnet-base-v2"
  }
}
```

### Progress Reporting

Document indexing with keyword extraction is slower than code indexing (~65s vs ~1-5s for a 50-doc repo on first run). The UI keeps the user informed without blocking interaction.

**Design principle — non-blocking feedback only.** Document index progress must never overlay or block the dialog panel. The dialog is the user's primary workspace; covering it with a loading overlay during a background build would be disruptive. All progress is communicated via two non-blocking channels:

1. **Header progress bar** — a compact inline bar in the `ac-dialog` header, visible even when the dialog is minimized. Shows a short label and percentage fill.
2. **Toasts** — milestone notifications ("Document index ready — doc mode available") via the global toast system.

**Backend progress events** — The document indexer emits progress via the existing `startupProgress(stage, message, percent)` server→client RPC push, and also via `compactionEvent` for milestone notifications. The backend sends both channels so progress is reported regardless of whether the startup overlay is still visible:

- `startupProgress("doc_index", message, percent)` — continuous progress updates
- `compactionEvent("doc_index_progress", {stage, message, percent})` — same data via the compaction channel
- `compactionEvent("doc_index_ready", {...})` — build complete milestone
- `compactionEvent("doc_index_failed", {...})` — build failure notification

Phases reported via `startupProgress`:

1. **Model loading** (0–10%) — "Loading keyword model…" — emitted once when the sentence-transformer model initialises. On first-ever run this includes the ~420MB download, reported as a sub-progress if the model library exposes download callbacks.
2. **Structure extraction** (10–30%) — "Extracting outlines… (12/50 files)" — fast phase, increments per file.
3. **Keyword extraction** (30–95%) — "Extracting keywords… (8/50 files)" — the slow phase, increments per file. Each file completion updates the percentage proportionally (`30 + 65 * files_done / total_files`).
4. **Cache write** (95–100%) — "Caching results…" — writing enriched outlines to the doc cache.

**Frontend event flow:**

1. `app-shell.js` receives `startupProgress` RPC calls. For `stage === "doc_index"`, it **always** dispatches a `mode-switch-progress` DOM event (regardless of whether the startup overlay is visible). This ensures the dialog header bar receives updates both during initial startup and during later re-indexing.
2. `ac-dialog.js` listens for `mode-switch-progress` events and drives its header progress bar: sets `_docIndexBuilding = true`, `_modeSwitching = true`, and updates `_modeSwitchMessage` / `_modeSwitchPercent`.
3. When `compactionEvent` with `stage === "doc_index_ready"` fires, the dialog clears the progress bar (`_modeSwitching = false`, `_docIndexBuilding = false`) and shows a toast: "📝 Document index ready — doc mode available".
4. The mode toggle button in the dialog header shows a pulsing `⏳` icon while `_docIndexBuilding` is true, switching to `📝` when the index is ready.

**Resilient state recovery:** The `doc_index_ready` compaction event may be missed if the browser connects after the background build completes, or if a WebSocket reconnection drops the event. To handle this, `_refreshMode()` — which queries the server-side `get_mode()` RPC for the authoritative `doc_index_ready` flag — is called not only on initial RPC connection but also on `stream-complete` and `state-loaded` events. This ensures the mode toggle icon reflects reality after the next user interaction even if the one-shot completion event was lost.

**What is NOT used for doc index progress:**

- **No startup overlay** — the startup overlay (`startup-overlay` in `app-shell.js`) is only for initial server connection and code index setup. Document indexing runs in the background after the overlay has dismissed. The `_start_background_doc_index()` call is made by `main.py` *after* `_send_progress("ready", ...)` — not inside `complete_deferred_init()`. This ordering guarantees the startup overlay dismisses and the UI becomes fully interactive before KeyBERT/PyTorch model loading blocks the GIL and stalls WebSocket message delivery.
- **No blocking mode-switch overlay** — the `mode-switch-overlay` div in `ac-dialog.js` is not shown for background doc index builds. It exists for future use (e.g., blocking mode switches that require user action) but document indexing is fully non-blocking.

**Granularity** — Progress updates fire after each file completes keyword extraction, not after each section. Per-file granularity gives smooth visual updates (50 increments for 50 files) without excessive RPC overhead. For large files with many sections, the keyword extraction step for that single file may take ~500ms — acceptable without sub-file progress.

### Keywords — Always Included

Keywords are always included for all headings, including unique ones. Consistent formatting is simpler to implement and reason about, and the token cost is modest (~3-8 tokens per heading). Omitting keywords for unique headings would add conditional logic for marginal token savings.

### Language Support — English Only

Only English is supported initially. The default `all-mpnet-base-v2` model is English-optimised. Multilingual support (via `paraphrase-multilingual-MiniLM-L12-v2` or similar) can be added later as a configurable model option if needed.