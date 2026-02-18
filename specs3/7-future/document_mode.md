# Document Mode & Document Index

## Motivation

The symbol index (tree-sitter parsing, compact format, reference graph) only covers programming languages — Python, JavaScript/TypeScript, C/C++. Markdown and other document files appear in the file tree by path but produce no structural representation. The LLM knows `.md` files exist but has zero insight into their content unless the full file is loaded into context.

Many repositories are documentation-heavy (specs, READMEs, wikis, design docs). Giving the LLM structural awareness of document content — without loading full text — would significantly improve its ability to navigate and reference documentation.

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
```

## Compact Output Format

The formatter produces text blocks structurally similar to code symbol map output. These blocks flow into the same cache tier system.

### Markdown Example

```
specs3/3-llm-engine/context_and_history.md:
  # Context & History
  ## ContextManager →src/ac_dc/context.py
  ## History Compaction
    ### Topic Detection
    ### Verbatim Window
  ## Token Budget
  links: prompt_assembly.md, cache_tiering.md
```

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
  ## Component Overview
  ## Data Flow
    ### Input Pipeline
    ### Processing
  ## Deployment
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

The markdown extractor requires no external dependencies — heading extraction is a simple line-by-line scan for `#` prefixes, and link extraction uses a basic regex for `[text](target)` patterns.

## Integration with Cache Tiering

Document outline blocks integrate with the existing stability tracker and cache tier system with no special treatment:

1. **Stability tracker** tracks doc files by key (e.g., `file:specs3/README.md`), same as code files
2. **Tier graduation** works identically — a frequently referenced doc promotes from L3 → L2 → L1
3. **`_build_tiered_content()`** assembles doc blocks and code blocks together, intermingled based on tier assignment
4. **Content hashing** detects when a doc's structure changes (heading added/removed), triggering demotion back to active tier

Documents tend to change less frequently than code, so they would naturally stabilize at higher tiers quickly — a good fit for the caching model.

## Document Mode Toggle

Rather than a hard mode switch that replaces one index with another, document mode controls **verbosity per file type**:

| Mode | Code files | Document files |
|---|---|---|
| Default (code) | Full symbol detail | Heading-only outlines |
| Document mode | File names only | Expanded outlines (headings + link targets + optional first-paragraph summaries) |

This is a flag on `_build_tiered_content()` and the formatter, not a separate pipeline. Both indexes are always built; the mode just controls how much detail each contributes to the prompt.

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