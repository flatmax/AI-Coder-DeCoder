# Reference: Document Index

**Supplements:** `specs4/2-indexing/document-index.md`

## Byte-level formats

### Annotation syntax reference

| Annotation | Syntax | Placement |
|---|---|---|
| Document type | `[spec]`, `[guide]`, `[reference]`, `[decision]`, `[readme]`, `[notes]`, or `[unknown]` after the file path | Path line, after the colon-space-path, preceding the newline |
| Keywords | `(keyword1, keyword2, keyword3)` with comma-space separator | After heading text, before content-type markers |
| Content type — table | `[table]` | After keywords, before section size |
| Content type — code | `[code]` | Same slot as `[table]` |
| Content type — formula | `[formula]` | Same slot as `[table]` |
| Section size | `~Nln` (literal `~`, integer, literal `ln`) | After content-type markers, before incoming-ref count |
| Incoming refs | `←N` (U+2190 LEFT ARROW, integer count) | After section size, before children on the next line |
| Outgoing section ref | `→target.md#Section-Heading` (U+2192 RIGHT ARROW) | Own line, indented one level deeper than the heading it refers from |
| Outgoing doc ref | `→target.md` (no fragment) | Same slot as outgoing section ref |
| Outgoing code ref | `→src/file.py` | Same slot as outgoing section / doc ref |
| Document-level links summary | `  links: target1.md, target2.md, target3.md` (two-space indent, literal `links:`, comma-space-joined) | Final line of a file's block |

### Heading syntax

```
## Cache Tiering (cache, promotion, stability) [table] [code] ~85ln ←4
```

- Heading-level prefix: `#` repeated level times, followed by space (`## ` for level 2, `#### ` for level 4)
- Nesting via two-space indent per level increase relative to document top
- Annotations appended in fixed order: keywords → content types → section size → incoming refs
- Missing annotations are omitted entirely (no empty `()` or `[]` placeholders)

### Annotation ordering

Fixed left-to-right sequence on a single heading line:

```
{indent}{#-prefix} {heading text}{ (keywords)}{ [content-types]}{ ~Nln}{ ←N}
```

Braces indicate optional segments. Each segment has a leading space only when present. A heading with no annotations at all is just `{indent}{#-prefix} {heading text}`.

### Full file block example

```
docs/guides/context-and-history.md [spec]:
  # Context & History ~280ln ←5
  ## ContextManager (FileContext, token budget, shed) [code] ~85ln ←3
    →src/ac_dc/context.py
  ## History Compaction (trigger threshold, verbatim window) [code] ~120ln ←2
    ### Topic Detection (LLM boundary, confidence score) ~45ln
      →cache_tiering.md#History-Compaction-Interaction
    ### Verbatim Window (recent exchanges, min preserved) ~30ln
  ## Token Budget (remaining, cache target, prompt estimate) [table] ~40ln
    →prompt_assembly.md#History-Placement
  links: prompt_assembly.md, cache_tiering.md
```

### Outgoing ref indentation

Outgoing section / doc / code refs appear on their own lines, indented **one level deeper** than the heading they refer from. Multiple refs from the same heading each get their own line in the order they appear in the source document.

### Document-level links line

Emitted as the last line of a file's block when the file has any document-level links (links without a fragment, i.e. without `#Section`). Prefix is two spaces (not four, regardless of heading depth), literal `links:`, one space, then comma-space-joined target paths in first-appearance order. Duplicate targets deduplicated.

Files with no document-level links omit the line entirely — no empty `links:` placeholder.

## Numeric constants

### Section size threshold

- `~Nln` annotation **omitted** when `N < 5`
- Rationale: sections under 5 lines carry negligible budget signal and the annotation adds more visual noise than it saves
- The threshold is a hardcoded constant — not user-tunable

### Incoming reference count threshold

- `←N` annotation **omitted** when `N == 0`
- Zero-ref headings are the common case; emitting `←0` everywhere would clutter the map

### Label-length threshold for SVG prose blocks

- SVG `<text>` elements longer than **80 characters** are captured as prose blocks rather than heading leaves
- Prose blocks participate in keyword enrichment via the same pipeline as markdown sections
- Elements at or below 80 chars are treated as short labels (not enriched, emitted as heading leaves)
- Threshold chosen to distinguish concise labels from body prose; not user-tunable

## Schemas

### Document type enumeration

Fixed set — detection falls back to `unknown` when no rule matches:

| Type tag | Path-based triggers | Heading-based triggers |
|---|---|---|
| `readme` | Filename is `README.md` (case-insensitive) | — |
| `spec` | Path contains `spec`, `specs`, `rfc`, `design`, `designs` | Numbered section headings (`1.`, `1.1.`, etc.) |
| `guide` | Path contains `guide`, `guides`, `tutorial`, `howto`, `getting-started` | Step-by-step imperative headings |
| `reference` | Path contains `reference`, `references`, `api`, `endpoints` | Highly repetitive subheading structure |
| `decision` | Path contains `adr`, `decision`, `decisions` | ADR-style headings: `Status`, `Context`, `Decision`, `Consequences` |
| `notes` | Path contains `notes`, `meeting`, `minutes`, `journal` | — |
| `unknown` | Default when no path or heading heuristic matches | — |

Detection is heuristic and conservative. Path triggers win over heading triggers when both match. Path matching is case-insensitive and checks directory segments individually (not the full path as a substring).

### Cache sidecar JSON

Each cached outline persists as `{repo_root}/.ac-dc4/doc_cache/{flattened-path}.json`. Flattening rule: replace `/` and `\` in the relative path with `__`, append `.json`.

Fields:

```json
{
  "path": "relative/path/to/file.md",
  "mtime": 1736956800.123,
  "content_hash": "a1b2c3...",
  "keyword_model": "BAAI/bge-small-en-v1.5",
  "outline": { ... serialized DocOutline ... }
}
```

- `mtime` is the file's modification time at indexing (float seconds since epoch)
- `content_hash` is a stable hash derived from the outline's structural fields (not the formatted output)
- `keyword_model` records which sentence-transformer model enriched the outline; mismatched model on read invalidates the entry
- `outline` is a recursive serialization of the DocOutline dataclass — headings with nested children, links, prose blocks

Cache operations:
- `get(path, mtime, keyword_model)` — returns the cached outline only if all three match
- `put(path, mtime, outline, keyword_model)` — writes the sidecar atomically
- `invalidate(path)` — removes the sidecar
- Corrupt JSON files are silently removed on load

## Dependency quirks

### KeyBERT optional dependency

The `keybert` pip package pulls in `sentence-transformers`, which pulls in `torch`. The bundle is large and is gated behind an optional extras group (`ac-dc[docs]` or equivalent). Missing keybert causes the enricher to silently no-op — outlines emit without keyword annotations. This is the designed degradation path.

### `huggingface_hub` cache probe

Before loading a sentence-transformer model for the first time in a session, the enricher probes the local hugging-face cache via `huggingface_hub.try_to_load_from_cache`. The probe is used to distinguish "downloading" (will take time) from "loading from cache" (near-instant) for the user-facing progress message. A probe failure is non-critical — the enricher falls back to a generic loading message.

## Cross-references

- Symbol map compact format: `specs-reference/2-indexing/symbol-index.md` — different output format, shared downstream consumers
- Keyword enrichment detail: `specs-reference/2-indexing/keyword-enrichment.md` (when created)