# Keyword Enrichment

Keyword extraction for document outlines. Disambiguates sections with similar heading structures by surfacing what each section is actually about.

## Motivation

- Structural extraction alone is insufficient when heading text is generic or repeated
- API references, spec suites, compliance checklists, template-based reports share subheading patterns across sections
- Semantic keywords per section let the LLM distinguish between structurally identical sections
- SVG prose blocks (text elements exceeding the label-length threshold — see [document-index.md § Long Text Elements](document-index.md#long-text-elements--prose-blocks-for-enrichment)) flow through the same pipeline as markdown sections

## Underlying Technique

- Sentence-transformer embeddings used to find keywords most semantically similar to a text chunk
- Ranked keywords with relevance scores returned per section
- Maximal Marginal Relevance (MMR) applied to reduce near-duplicate keywords
- Diversity parameter controls MMR penalty strength — pushes keywords apart in embedding space

## Pipeline

- Structural extraction produces an outline with headings, links, and raw section text (or prose blocks for SVG)
- Enricher receives the outline and the full document text
- Eligible sections (above minimum character threshold) are collected into a batch — markdown sections and SVG prose blocks are mixed into the same batch when both are present in a single document
- Batched extraction — all sections encoded in one forward pass for speed
- Keywords attached to their respective headings or prose blocks
- Per-document TF-IDF corpus includes all eligible text from the document regardless of source (markdown sections and SVG prose blocks share the corpus), so contrastive scoring works uniformly

## Configuration Surface

- Sentence-transformer model name
- Enabled flag
- Keywords per section (top-N)
- N-gram range (unigrams and bigrams by default)
- Minimum section character count
- Minimum relevance score
- Diversity parameter
- TF-IDF fallback threshold (character count)
- Maximum document frequency (corpus-aware filter)

## Quality Improvements

### Content-Type Hints

- Content patterns detected during extraction — table, code, formula
- Annotated inline after keywords
- Helps LLM know a section contains reference material without loading it

### Section Size Signal

- Line count from heading to next heading
- Sections under threshold have size annotation omitted
- Helps LLM budget file-loading decisions

### TF-IDF Fallback for Short Sections

- Sections below character threshold use TF-IDF instead of embedding-based extraction
- Vectorizer fit on all section texts in the document as the corpus
- Surfaces terms distinctive to the short section relative to its siblings
- Embeddings tend to select generic terms for short passages; TF-IDF penalizes corpus-wide frequency

### Code Stripping

- Fenced code blocks and inline code spans stripped before passing to the model
- Keeps keyword extraction focused on explanatory prose
- Sections that become empty after stripping fall back to unstripped text

### Corpus-Aware Stopwords

- After extraction, keywords that appear in more than a threshold fraction of sections are filtered
- Removes pervasive domain terms that don't disambiguate
- Document frequency computed once per batch
- A bigram is filtered only if all its constituent unigrams exceed the threshold
- If pruning would leave a section keyword-less, the top keyword is retained regardless

### Adaptive Top-N

- Large sections get extra keywords to capture vocabulary from multiple branches
- Modest token cost for multi-pathway logic sections

## Lazy Model Loading

- Model is loaded on first enrich call or first availability check
- Tristate flag (unchecked, available, unavailable) prevents re-initialization attempts
- Missing library — log warning, emit headings without keywords
- Model initialized once, reused across all files in an indexing run

## Model Cache Probing

- Before loading, probe the local model cache to determine if download is needed
- Distinct progress message for downloading vs loading from cache
- Probe failure is non-critical — fall back to generic loading message

## Packaged Release Degradation

- Release binaries may not bundle the keyword library or its dependencies (large footprint)
- Document mode remains fully functional without keywords
- Structural outlines, cross-references, reference counting, cache tiering, and doc system prompt all work
- Mode-switch response indicates availability; frontend shows a one-time warning toast
- Users running from source can install the optional extra

## Per-File Asynchronous Processing

- Background enrichment splits work into per-file executor calls
- Event loop yield between files allows WebSocket traffic to flow
- Threaded cache writes overlap disk I/O with the next file's extraction
- Model itself is not run in threads (GIL, memory footprint)

## Eager Pre-Initialization

- Model is eagerly loaded during the background startup phase before the doc-index-ready signal
- Ensures the first mode switch never blocks on a multi-second model load
- Loads unconditionally, even when all files are cached — a future file change may require enrichment

## Cache Entry Replacement

- When enrichment completes for a file, the enriched outline replaces the unenriched entry in both memory and on disk
- Replacement is atomic from the perspective of subsequent cache lookups
- The formatted output map is updated in-place so immediate queries reflect enriched content
- No stability tracker demotion on enrichment — the content hash will change, triggering a normal demote/re-graduate, which is acceptable

## Reference Index Rebuild After Enrichment

- After a batch of files completes, the reference index is rebuilt
- Defensive — keyword enrichment does not change heading or link structure in practice
- Rebuild is a no-op in terms of graph topology

## Invariants

- Keywords are always included on eligible headings (consistent formatting)
- Enrichment never blocks any user-facing operation
- Enriched outlines are cached on disk and survive server restart
- Model name mismatch invalidates cache entries