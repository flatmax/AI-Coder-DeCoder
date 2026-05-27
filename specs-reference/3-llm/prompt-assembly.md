# Reference: Prompt Assembly

**Supplements:** `specs4/3-llm/prompt-assembly.md`

> **D36 update:** The aggregate `meta:repo_map`, `meta:doc_map`, and `meta:file_tree` rows are removed. Their content is distributed across **per-directory dir-blocks** (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) which are first-class tracker entries that can sit in any of L0–L3. Sections of this reference that previously described the aggregate-map model have been rewritten; the byte-level header strings, acknowledgements, and cache-control placement rules are unchanged.

This is the canonical owner for header constant byte-strings, cache-control marker placement, and acknowledgement text. Every LLM request the system makes depends on these strings being byte-identical across runs — cache-hit stability requires it.

## Byte-level formats

### Header constants

Module-level string constants used to introduce each section of the assembled message array. A trailing double-newline (`\n\n`) is included in every header so the following content starts cleanly.

| Constant | Value |
|---|---|
| `REPO_MAP_HEADER` | `"# Repository Structure\n\nBelow is a map of the repository showing classes, functions, and their relationships. Use this to navigate the codebase — request full file content when you need to read or edit.\n\n"` |
| `DOC_MAP_HEADER` | `"# Document Structure\n\nBelow is an outline map of documentation files showing headings, keywords, and cross-references. Use this to navigate the documentation — request full file content when you need to read or edit.\n\n"` |
| `PLAIN_FILES_HEADER` | `"# Repository Files\n\nFiles in this directory without symbol tables or doc indexes:\n\n"` (used as the per-directory `plain_files:<dir>` block header; replaces the former `FILE_TREE_HEADER`) |
| `URL_CONTEXT_HEADER` | `"# URL Context\n\nThe following content was fetched from URLs mentioned in the conversation:\n\n"` |
| `REVIEW_CONTEXT_HEADER` | `"# Code Review Context\n\n"` |
| `FILES_ACTIVE_HEADER` | `"# Working Files\n\nHere are the files:\n\n"` |
| `FILES_L0_HEADER` | `"# Reference Files (Stable)\n\nThese files are included for reference:\n\n"` |
| `FILES_L1_HEADER` | `"# Reference Files\n\nThese files are included for reference:\n\n"` |
| `FILES_L2_HEADER` | `"# Reference Files (L2)\n\nThese files are included for reference:\n\n"` |
| `FILES_L3_HEADER` | `"# Reference Files (L3)\n\nThese files are included for reference:\n\n"` |
| `TIER_SYMBOLS_HEADER` | `"# Repository Structure (continued)\n\n"` |

Header text is deliberately verbose and descriptive — it tells the LLM what the following block is and how to use it. Terseness would save a few tokens but produces measurably worse model behavior. The verbose text is cached in L0 so the token cost is paid once per session, not per request.

### Per-tier file header dispatch

The tier-to-file-header map is keyed by the `Tier` enum value:

| Tier | Header used |
|---|---|
| `L0` | `FILES_L0_HEADER` |
| `L1` | `FILES_L1_HEADER` |
| `L2` | `FILES_L2_HEADER` |
| `L3` | `FILES_L3_HEADER` |
| `ACTIVE` | `FILES_ACTIVE_HEADER` (used when rendering the uncached working-files section) |

### Acknowledgement text

After every uncached user-message section (file tree, URL context, review context, active files) AND after each L1/L2/L3 tier's content block, a fixed assistant acknowledgement is appended:

```
Ok.
```

Exactly three characters: `O`, `k`, `.` — no trailing newline, no variations. The URL context pair uses a different string:

```
Ok, I've reviewed the URL content.
```

The review context pair uses:

```
Ok, I've reviewed the code changes.
```

These three exact strings are the only acknowledgement forms. Variations would produce different token counts in cached blocks, defeating cache stability.

### L0 system message structure

The L0 message is a single `role: "system"` entry. Its content is the concatenation of:

1. System prompt (from `config.get_system_prompt()` or `config.get_doc_system_prompt()`)
2. One blank line (`\n\n`)
3. Mode-appropriate map header (`REPO_MAP_HEADER` in code mode, `DOC_MAP_HEADER` in doc mode)
4. Legend text (primary index's legend)
5. If cross-reference mode is active: blank line + opposite-mode header + opposite index's legend
6. L0 dir-blocks for the active mode's content type, in stable order (`symbols:<dir>` blocks in code mode, `docs:<dir>` blocks in doc mode), with cross-reference adding the opposite content type's L0 dir-blocks
7. L0 `plain_files:<dir>` blocks (filenames for non-source-non-doc files), in stable order
8. If tier has L0 file entries: `FILES_L0_HEADER` + fenced file contents

Under D36 the legends remain in L0 (they are static format descriptions and benefit from the head-anchor cache), but the **content** referenced by the legends — the symbol-map and doc-map bodies — is no longer concentrated in L0. Each directory's `symbols:<dir>` / `docs:<dir>` / `plain_files:<dir>` block is independently routed by the membrane controller and may live in any tier L0–L3. Empty L0 (no dir-blocks routed there) is legitimate: only the system prompt + legends remain.

Concatenation is done with single blank-line separation between sections unless a section's trailing `\n\n` already provides it.

### Cross-reference legend placement

When cross-reference mode is active in code mode, the L0 message contains:

```
{system_prompt}

# Repository Structure

Below is a map of the repository...

{symbol_legend}

# Document Structure

Below is an outline map of documentation files...

{doc_legend}

{L0 dir-blocks: any symbols:<dir> / docs:<dir> / plain_files:<dir> the membrane routed to L0}
```

The **opposite mode's header** introduces the secondary legend. Rationale: each legend is introduced with a contextually appropriate description. A reimplementer might be tempted to use the current mode's header for both — don't. The mismatch is deliberate.

Symmetric in doc mode: `DOC_MAP_HEADER` first (introducing `doc_legend`), then `REPO_MAP_HEADER` (introducing `symbol_legend`).

### Cache-control marker

The marker is a dict with a single `type` key:

```json
{"type": "ephemeral"}
```

Attached to a message by wrapping the content in a structured list:

```json
{
  "role": "system",
  "content": [
    {"type": "text", "text": "{full content}", "cache_control": {"type": "ephemeral"}}
  ]
}
```

When the content is already a list (multimodal messages with images), the marker is attached to the **last text block** in the list, not wrapped around the whole list. Multimodal image blocks never receive the marker directly.

### Cache-control placement rules

Exactly one marker per non-empty cached tier. Placement:

| Tier state | Marker location |
|---|---|
| L0 with no L0-tier history | On the system message's content |
| L0 with L0-tier history | On the last L0-tier history message's content (not the system message) |
| L1/L2/L3 with content but no history | On the tier's assistant acknowledgement message |
| L1/L2/L3 with content and history | On the last history message in the tier's sequence |

The marker migrates from the system message to the last L0 history message when L0 history exists — this is the only tier where marker placement depends on history presence. L1–L3 always place the marker on the last message in the tier's emitted sequence regardless of history presence (because L1–L3 always have at minimum the user/assistant content pair).

Maximum 4 markers per request. Providers typically enforce this limit; exceeding it causes the request to fail. Empty tiers emit no marker, which is how the system stays under the limit when fewer than 4 tiers have content.

### No provider-specific headers required

litellm automatically forwards `cache_control` markers to Anthropic and Bedrock Claude models. No `anthropic-beta` header, no `extra_headers` parameter, no provider-adapter configuration. The marker on the content block is sufficient.

Implementers migrating from direct Anthropic SDK usage may search for the right beta header — skip it. Pass the `cache_control` markers through litellm and the provider-specific dispatch handles forwarding.

## Schemas

### Message array structure (tiered assembly)

The message list returned from `assemble_tiered_messages` follows this exact shape when all tiers have content:

```
[
  {role: "system",    content: [...] with cache_control}   # L0 (if no L0 history)
  {role: "user",      content: "..."}                       # L0 history[0]
  {role: "assistant", content: "..."}                       # L0 history[1]
  ...
  {role: "...",       content: [...] with cache_control}   # last L0 history (if present, marker moves here)
  # — cache breakpoint 1 —
  {role: "user",      content: "{TIER_SYMBOLS_HEADER}{symbols}\n\n{FILES_L1_HEADER}{files}"}
  {role: "assistant", content: "Ok."}
  ...L1 native history...
  {role: "...",       content: [...] with cache_control}   # last L1 message
  # — cache breakpoint 2 —
  ...L2 block (same shape with FILES_L2_HEADER)...
  # — cache breakpoint 3 —
  ...L3 block (same shape with FILES_L3_HEADER)...
  # — cache breakpoint 4 —
  {role: "user",      content: "{URL_CONTEXT_HEADER}{urls}"}  # uncached, conditional
  {role: "assistant", content: "Ok, I've reviewed the URL content."}
  {role: "user",      content: "{REVIEW_CONTEXT_HEADER}{review}"}  # uncached, conditional
  {role: "assistant", content: "Ok, I've reviewed the code changes."}
  {role: "user",      content: "{FILES_ACTIVE_HEADER}{files}"}  # uncached, conditional
  {role: "assistant", content: "Ok."}
  ...active history (native pairs, filtered)...
  {role: "user",      content: "..." OR [text, image, image, ...]}  # current prompt
]
```

### Current user message shape

**Text-only:**
```json
{"role": "user", "content": "{user_prompt}{system_reminder}"}
```

**With images:**
```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "{user_prompt}{system_reminder}"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}},
    {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}
  ]
}
```

Non-data-URI images (HTTPS URLs, malformed entries) are silently dropped. Providers reject non-inline URLs anyway; filtering at assembly time avoids surfacing provider-specific errors.

### System reminder appending

`config.get_system_reminder()` returns the reminder text prefixed with two blank lines (`\n\n{content}`). The streaming handler appends this to the user prompt string before passing it to `assemble_tiered_messages`:

```python
augmented_message = message + config.get_system_reminder()
```

The reminder lives at the end of the user message text — closest position to the model's generation. Never cached. Never placed on its own message. Absence is legitimate (empty reminder file → empty string appended, no observable effect).

### File content formatting

Files in any tier's content section are rendered as fenced code blocks with NO language tag:

```
path/to/file.py
```
{file content verbatim}
```

path/to/other.py
```
{file content verbatim}
```
```

Format details:

- Path on its own line, immediately before the opening fence
- Opening fence is three backticks with nothing after (no language tag)
- File content verbatim, no prefix/suffix transformations
- Closing fence is three backticks with nothing after
- Two blank lines between files

The absence of a language tag is deliberate. Language tags are useful for syntax highlighting in UIs, but for LLM context they add tokens without improving model behavior — the model infers language from path and content equally well without the hint.

## Dir-block exclusions

Under D36, each directory is rendered as up to three independent dir-blocks: `symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`. Every indexed file is represented in **exactly one place** per turn:

- If the file is selected for editing, it appears as `file:<path>` full text in the Active working-files section, and is **excluded from its dir-block** at the tracker level (D36 edit-invariant).
- Otherwise, it appears as one entry inside its directory's appropriate dir-block (`symbols:` for source files with a symbol table, `docs:` for documents with a doc index, `plain_files:` for everything else indexed but neither).

There are exactly two filters on dir-block contents:

1. **Active full-text exclusion** — files currently in Active are removed from their dir-block. The tracker enforces this invariant; assembly does not re-coordinate it.
2. **User exclusion** — files removed via the file picker's three-state checkbox are dropped from the index entirely and therefore from every dir-block.

The three call sites that read dir-block bytes all use the same filtered view:

| Call site | Behaviour |
|---|---|
| `_assemble_tiered` | Renders each routed dir-block at its tier from the live index |
| `_get_block_content` (cache-viewer modal) | Renders the same dir-block bytes when the user clicks a `symbols:<dir>` / `docs:<dir>` / `plain_files:<dir>` row |
| `get_context_breakdown` | Reports the token count of each dir-block as its own row |

A file appears in **exactly one** location per turn — never duplicated across L0 + a lower tier the way D27/D28 required. The system-prompt authority rule from D27 ("Working Files supersedes structural outlines") is therefore unnecessary under D36 and has been removed from the system prompt.

## Synthetic meta rows

Under D36 the dir-blocks (`symbols:<dir>`, `docs:<dir>`, `plain_files:<dir>`) are first-class tracker entries with their own rows in the cache viewer; they are **not** surfaced via synthetic `meta:` keys. The remaining `meta:` rows cover sections that genuinely don't have tracker representation.

### Meta row catalog

| Key | Tier | Content |
|---|---|---|
| `meta:url:{url}` | uncached tail | One row per fetched URL; content is the URL service's formatted block |
| `meta:review_context` | uncached tail | Review mode's injected block (review summary + commits + pre-change map + reverse diffs) |
| `meta:active_file:{path}` | uncached tail | One row per selected file that hasn't graduated to a cached tier; content is the file's raw bytes |

The `meta:repo_map`, `meta:doc_map`, and `meta:file_tree` rows from D27/earlier are **removed**. Their content is now distributed across the dir-block set:

- The former `meta:repo_map` row was the union of `symbols:<dir>` blocks
- The former `meta:doc_map` row was the union of `docs:<dir>` blocks
- The former `meta:file_tree` row was the union of `plain_files:<dir>` blocks

The cache viewer renders one row per non-empty dir-block, with the directory path encoded into the key. This gives the user finer-grained visibility into which directories' indexes are sitting in which cache tier.

### Uncached tail composition

The cache viewer's synthetic "uncached" tier aggregates every row whose content appears in the prompt *after* the last cache breakpoint. These sections are rebuilt on every request (no caching benefit would accrue even if markers were placed). Per `specs4/3-llm/prompt-assembly.md § Message Array Structure`, the uncached tail contains:

- URL context — one `meta:url:{url}` per fetched URL
- Review context — `meta:review_context` (conditional, review mode only)
- Active files section — one `meta:active_file:{path}` per non-graduated selected file
- Active history — already rendered as `history:N` entries in the active tier (not duplicated as meta rows)
- Current user message — transient, not surfaced as a row

The standalone file-tree section that previously sat in the uncached tail under D27/D28 is **gone** — its filenames live in `plain_files:<dir>` dir-blocks distributed across L0–L3.

### Click-to-view dispatch

When the user clicks a row, the modal dispatches to a content-fetcher that re-computes or re-fetches the section's bytes. For `symbols:<dir>` / `docs:<dir>` / `plain_files:<dir>` rows the dispatcher renders the directory's block from the live index (with the two filters above applied). For `meta:url:` / `meta:review_context` / `meta:active_file:` rows the dispatcher fetches from the relevant subsystem (URL service / review mode / file context). The dispatcher and the row-building path read from the same source, so divergence-style bugs ("row shows N tokens but modal shows empty") are not possible.

## Numeric constants

### Maximum cache breakpoints per request

```
4
```

Provider-enforced. The system's tier structure (L0, L1, L2, L3) is designed around this: each cached tier consumes one breakpoint. Additional cached content would require combining tiers. The 4-tier limit is aligned with Anthropic's current cache-control budget; other providers with different limits would require tier-count adjustment.

### Minimum cacheable tokens (provider minimums)

See `specs-reference/3-llm/cache-tiering.md` § Per-model `min_cacheable_tokens` for the full table. Briefly:

- Claude Sonnet 4.x, Opus 4.0/4.1: 1024 tokens
- Claude Opus 4.5/4.6, Haiku 4.5: 4096 tokens
- Fallback: 1024 tokens

Content blocks smaller than the provider's minimum receive the `cache_control` marker but are not actually cached. The marker is still placed (harmless — provider silently ignores it) so the 4-marker budget is still consumed.

## Dependency quirks

### litellm forwarding

Under the hood, when litellm receives a message with structured content blocks containing `cache_control`, it:

1. Detects Anthropic/Bedrock Claude provider from model name prefix
2. Converts the structured content to the provider's expected format
3. Forwards `cache_control` on each block to the provider API

For non-caching providers (OpenAI, generic HTTP), litellm silently strips the `cache_control` marker and concatenates text blocks into a plain string. The system's message array stays provider-agnostic.

### Tokenizer-dependent content sizing

Token counts for cache threshold comparisons come from the token counter (see `specs-reference/1-foundation/configuration.md` § Token counter defaults — all models use `cl100k_base` via tiktoken). Provider tokenization may differ slightly, so a block that measures at exactly `min_cacheable_tokens` locally may fall just below on the provider side. The `cache_buffer_multiplier` (default 1.1) provides headroom against this drift.

## Cross-references

- Cache tier constants and promotion thresholds: `specs-reference/3-llm/cache-tiering.md`
- Header behavioral placement rules: `specs4/3-llm/prompt-assembly.md`
- Streaming integration (when assembly is called): `specs-reference/3-llm/streaming.md`
- Token counter and model family detection: `specs-reference/1-foundation/configuration.md` § Token counter defaults
- System reminder as a user-facing config file: `src/ac_dc/config/system_reminder.md`