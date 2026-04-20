# Prompt Assembly

## Overview

This is the **single source of truth** for how LLM messages are assembled. All prompt content — system prompts, symbol map, files, history, URLs — is organized into a structured message array with stability-based cache tier placement.

The assembly system supports two modes:
- **Tiered assembly** (`assemble_tiered_messages`) — organizes content into L0–L3 cached blocks with `cache_control` markers. This is the primary mode.
- **Flat assembly** (`assemble_messages`) — produces a flat message array without cache breakpoints. Used as a fallback or during development. Accepts an optional `graduated_files` set — files in this set are excluded from the active "Working Files" section (their content is assumed to be in a cached tier).

The streaming handler uses tiered assembly, passing a `tiered_content` dict built from the stability tracker's tier assignments (see [Tiered Assembly Data Flow](#tiered-assembly-data-flow) below).

### Fallback to Flat Assembly

`_build_tiered_content()` returns `None` when the stability tracker has not yet been initialized (`_stability_initialized` is `False`). The streaming handler uses this return value as the signal to fall back to flat assembly:

```python
tiered_content = self._build_tiered_content(
    symbol_map=symbol_map,
    symbol_legend=symbol_legend,
)

if tiered_content:
    # ... tier exclusion recomputation ...
    assembled = self._context.assemble_tiered_messages(
        user_prompt=augmented_message,
        images=images if images else None,
        symbol_map=symbol_map,
        symbol_legend=symbol_legend,
        doc_legend=doc_legend,
        file_tree=file_tree,
        tiered_content=tiered_content,
    )
else:
    assembled = self._context.assemble_messages(
        user_prompt=augmented_message,
        images=images if images else None,
        symbol_map=symbol_map,
        symbol_legend=symbol_legend,
        file_tree=file_tree,
    )
```

**None is the contract, not an empty dict.** An empty `tiered_content = {}` must not be used to signal "use flat assembly" — `assemble_tiered_messages` with an empty dict produces a message array with `cache_control` on the system message and no content, which would waste a cache breakpoint on every request before tier initialization completes. The explicit `None` check makes the two code paths cleanly disjoint.

**When does this fall-through actually fire?** In practice, only during a narrow window at startup: after `deferred_init=True` construction but before `_try_initialize_stability()` completes. In the fast-path startup this window closes during Phase 2 before the first user interaction is possible. If stability initialization fails entirely (e.g., no symbol index, no repo), the fallback persists for the lifetime of the session — which is acceptable because the model still gets correct content, just without cache breakpoints. A reimplementation that always calls `assemble_tiered_messages` with an empty `tiered_content` would produce wrong `cache_control` placement on these early requests (marking content as cacheable when the prompt is too short to actually hit a cache breakpoint), silently eating cache-write token costs without ever earning a cache-read benefit.

## System Prompt

### Assembly

Two files concatenated with `\n\n`:
1. **Main prompt** (`system.md`) — LLM role, symbol map navigation, edit protocol, workflow
2. **Extra prompt** (`system_extra.md`, optional) — project-specific instructions

### Content Structure

The main prompt covers:
1. **Role** — Expert coding agent with symbol map navigation
2. **Symbol Map** — How to read compact notation
3. **Edit Protocol** — EDIT/REPLACE block format with rules
4. **Workflow** — Query → Search Map → Trace deps → Request files → Read → Edit
5. **Failure Recovery** — Steps for retrying failed edits
6. **Context Trust** — Only trust file content shown in context

### Prompt Concatenation

System prompt assembly concatenates `system.md` + `system_extra.md` at assembly time (each request). This means edits to either file take effect on the next LLM request without restart. The `system_extra.md` file is optional — if missing, only `system.md` is used.

### Other Prompts

| Prompt | Used For |
|--------|----------|
| **Commit message prompt** (`commit.md`) | Loaded from config for generating git commit messages. Role: expert software engineer. Rules: conventional commit style with type prefix, imperative mood, 50-char subject line limit, 72-char body wrap, no commentary — output the commit message only |
| **Compaction skill prompt** | Loaded by topic detector for history compaction LLM calls |
| **System reminder** (`system_reminder.md`) | Loaded from config and appended to each user prompt. Edit-format reinforcement rules (close blocks properly, copy text exactly, use unique anchors, keep blocks small, no placeholders). Sits at the end of context, closest to where the model generates |

## Message Array Structure

Content is organized into 5 stability tiers (see [Cache Tiering](cache_tiering.md)):

```
[0]  system    L0: system prompt + legend + L0 symbols + L0 files
[1+] L0 history (native user/assistant pairs)
     ── cache breakpoint ──
[N]  user      L1: symbols + files
[N+1] assistant "Ok."
[N+] L1 history pairs
     ── cache breakpoint ──
     L2 block (same structure)
     ── cache breakpoint ──
     L3 block (same structure)
     ── cache breakpoint ──
[M]  user      File tree
[M+1] assistant "Ok."
[M+2] user     URL context
[M+3] assistant "Ok, I've reviewed the URL content."
[M+4] user     Review context (if review mode active)
[M+5] assistant "Ok, I've reviewed the code changes."
[M+6] user     Active files ("Working Files")
[M+7] assistant "Ok."
[M+] Active history (native pairs)
[last] user    Current prompt (with optional images)
```

Empty tiers are skipped entirely.

### Cross-Reference Legend Headers

When cross-reference mode is active, the secondary index's legend is appended to L0 with its own header. The header used is the **opposite mode's header** — ensuring each legend is introduced with a contextually appropriate description:

| Primary Mode | Primary Header | Cross-Ref Legend Header |
|---|---|---|
| Code | `REPO_MAP_HEADER` | `DOC_MAP_HEADER` (for the doc legend) |
| Document | `DOC_MAP_HEADER` | `REPO_MAP_HEADER` (for the symbol legend) |

This means in code mode with cross-reference enabled, the L0 system message contains:
1. System prompt
2. `REPO_MAP_HEADER` + symbol legend + L0 symbol entries
3. `DOC_MAP_HEADER` + doc legend

And in document mode with cross-reference enabled:
1. System prompt
2. `DOC_MAP_HEADER` + doc legend + L0 doc entries
3. `REPO_MAP_HEADER` + symbol legend

### Review Context (Conditional)

When review mode is active (see [Code Review](../4-features/code_review.md)), a review context block is inserted between URL context and active files:

```pseudo
{"role": "user", "content": REVIEW_CONTEXT_HEADER + review_content}
{"role": "assistant", "content": "Ok, I've reviewed the code changes."}
```

Header:
```
# Code Review Context

```

The review content includes: review summary (branch, commits, stats), commit log, pre-change symbol map, and reverse diffs for selected files. Re-injected on each message. See [Code Review — Review Context](../4-features/code_review.md#review-context-in-llm-messages) for full format.

## Header Constants

The following named constants are used when building the message array:

| Constant | Value |
|----------|-------|
| `REPO_MAP_HEADER` | `# Repository Structure\n\n...` |
| `FILE_TREE_HEADER` | `# Repository Files\n\n...` |
| `URL_CONTEXT_HEADER` | `# URL Context\n\n...` |
| `FILES_ACTIVE_HEADER` | `# Working Files\n\n...` |
| `FILES_L0_HEADER` | `# Reference Files (Stable)\n\n...` |
| `FILES_L1_HEADER` | `# Reference Files\n\n...` |
| `FILES_L2_HEADER` | `# Reference Files (L2)\n\n...` |
| `FILES_L3_HEADER` | `# Reference Files (L3)\n\n...` |
| `TIER_SYMBOLS_HEADER` | `# Repository Structure (continued)\n\n` |
| `REVIEW_CONTEXT_HEADER` | `# Code Review Context\n\n` |
| `DOC_MAP_HEADER` | `# Document Structure\n\nBelow is an outline map of documentation files...\n\n` |

## Block Details

### L0 Block (System Message)

L0 is the **system role message** (not a user/assistant pair). It concatenates:

1. **System prompt** — from files
2. **Index legend(s)** — preceded by a mode-specific header:
   - **Code mode**: `REPO_MAP_HEADER` — "# Repository Structure\n\nBelow is a map of the repository showing classes, functions, and their relationships..."
   - **Document mode**: `DOC_MAP_HEADER` — "# Document Structure\n\nBelow is an outline map of documentation files showing headings, keywords, and cross-references..."

   Then the legend text (abbreviation key + path aliases). The context legend does not include `:N=line(s)` since line numbers are not present in the context symbol map. When cross-reference mode is active, both the symbol-map legend and the doc-index legend are included in L0, each preceded by its own mode-appropriate header (see [Cross-Reference Legend Headers](#cross-reference-legend-headers) below).
3. **L0 index entries** — symbol/doc blocks for L0-stability files
4. **L0 file contents** — preceded by:
   ```
   # Reference Files (Stable)

   These files are included for reference:

   ```

### L1, L2, L3 Blocks

Each non-empty tier produces a **user/assistant pair** (if it has symbols or files):
- User message: symbol entries + file contents concatenated
- Assistant message: `"Ok."`

Index entries use header: `# Repository Structure (continued)\n\n`

File content headers by tier:
- L1: `# Reference Files\n\nThese files are included for reference:\n\n`
- L2: `# Reference Files (L2)\n\nThese files are included for reference:\n\n`
- L3: `# Reference Files (L3)\n\nThese files are included for reference:\n\n`

**Followed by** native history messages for that tier.

### File Tree (Uncached)

```pseudo
{"role": "user", "content": FILE_TREE_HEADER + file_tree}
{"role": "assistant", "content": "Ok."}
```

Header:
```
# Repository Files

Complete list of files in the repository:

```

The file tree content is built by the streaming handler as a **flat sorted list** with a count header — one file per line, no indentation. The `FILE_TREE_HEADER` is prepended during assembly:
```
# File Tree (236 files)

.gitignore
README.md
src/main.py
```

The streaming handler constructs this as `f"# File Tree ({len(flat_files)} files)\n\n" + "\n".join(flat_files)`, which is then wrapped by the assembly function with `FILE_TREE_HEADER`.

### URL Context (Currently Uncached)

> **Implementation status:** URL tier graduation is not yet implemented. All fetched URLs currently appear in the uncached URL context pair below. The partially-cached design described here is the target for a future implementation — see [Cache Tiering — URL Content](cache_tiering.md#url-content--direct-tier-entry-not-yet-implemented).

URL content that has graduated to a cached tier (L1–L0) would be included in that tier's content block (concatenated into the tier's files section with a `# URL Context (continued)` header). Currently, all URLs appear in the uncached URL context pair:

```pseudo
{"role": "user", "content": URL_CONTEXT_HEADER + joined_url_parts}
{"role": "assistant", "content": "Ok, I've reviewed the URL content."}
```

Header:
```
# URL Context

The following content was fetched from URLs mentioned in the conversation:

```

Multiple URLs joined with `\n---\n`. Each URL formatted as title + content + optional symbol map.

URL content is static once fetched. The target design has `url:{hash}` items entering the stability tracker directly at L1 (entry_n = 9) on first appearance, promoting through tiers normally from there. **This is not yet implemented** — currently all fetched URLs appear in the uncached URL context pair on every request regardless of stability.

### Active Files (Uncached)

```pseudo
{"role": "user", "content": FILES_ACTIVE_HEADER + formatted_files}
{"role": "assistant", "content": "Ok."}
```

Header:
```
# Working Files

Here are the files:

```

### Active History (Uncached)

Native `{role, content}` message dicts inserted directly — no wrapping.

### System Reminder

The system reminder (`system_reminder.md`) is appended to the user's message text before assembly, so it appears at the very end of context — closest to where the model generates its response. This is an edit-format reinforcement that reminds the LLM of critical edit block rules on every request. Loaded via `config.get_system_reminder()` which prepends `\n\n` to the file content.

### Current User Message

```pseudo
// Without images:
{"role": "user", "content": user_prompt + system_reminder}

// With images:
{"role": "user", "content": [
    {"type": "text", "text": user_prompt},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
]}
```

## File Content Formatting

Files formatted as fenced code blocks with **no language tags**:

```
path/to/file.py
```​
<full file content>
```​

path/to/other.py
```​
<full file content>
```​
```

Files joined with `\n\n`. Sections with no loadable content are omitted.

## Cache Control Placement

| Scenario | Placement |
|----------|-----------|
| L0 without history | `cache_control` on system message (structured content format) |
| L0 with history | `cache_control` on last L0 history message |
| L1/L2/L3 | `cache_control` on last message in tier's sequence |

The `cache_control` marker wraps content as:
```pseudo
[{type: "text", text: <content>, cache_control: {type: "ephemeral"}}]
```

Providers typically allow 4 breakpoints per request. Blocks under the provider minimum (e.g., 1024 tokens) won't actually be cached.

### No Extra Headers Needed

**litellm does not require any special `extra_headers` argument for Anthropic prompt caching.** When the model is an Anthropic or Bedrock Claude model, litellm automatically forwards the `cache_control: {"type": "ephemeral"}` markers on content blocks to the provider. The `anthropic-beta: prompt-caching-2024-07-31` header used to be required but is now enabled by default across litellm's Anthropic and Bedrock adapters.

Implementers migrating from raw Anthropic SDK code may waste time searching for the right header — just pass the `cache_control` markers and let litellm handle provider-specific dispatch. The only requirement is that the model name is correctly recognized (`anthropic/*`, `bedrock/*.claude-*`, etc.).

## History Placement

- **Cached tier history**: Native message dicts placed after the tier's user/assistant pair, before the cache_control boundary
- **Active history**: Raw message dicts from conversation history, filtered to active-tier indices only

## Cache Hit Reporting

Cache hit statistics are **read from the LLM provider's response**, not computed locally. The provider reports cache read tokens and cache write tokens. The application requests usage reporting via `stream_options: {"include_usage": true}`.

## Tiered Assembly Data Flow

This section specifies how the streaming handler builds the `tiered_content` dict from stability tracker state and passes it to `assemble_tiered_messages()`.

### Step 1: Gather Tier Assignments

```pseudo
for tier in [L0, L1, L2, L3]:
    tier_items = stability_tracker.get_tier_items(tier)
    # tier_items = {key: TrackedItem} where key is "file:{path}", "sym:{path}", "doc:{path}", or "history:{N}"
```

### Step 2: Build Content for Each Tier

For each tier, separate items by type and gather their content. Items whose path is in the user-excluded index files set (`excluded_index_files`) are **skipped** — they should not appear in any tier's content even if they have a tracker entry (the defensive removal in `_update_stability` should have removed them, but `_build_tiered_content` checks again as a belt-and-suspenders measure):

```pseudo
tiered_content = {}
for tier in [L0, L1, L2, L3]:
    tier_items = tracker.get_tier_items(tier)
    symbols_text = ""
    files_text = ""
    history_messages = []

    for key, item in tier_items:
        if key starts with "system:":
            continue  # system prompt handled separately by assemble_tiered_messages

        if key starts with "symbol:" or key starts with "doc:" or key starts with "file:":
            path = key.split(":", 1)[1]
            if path in excluded_index_files:
                continue

        if key starts with "symbol:":
            path = key.removeprefix("symbol:")
            block = symbol_index.get_file_symbol_block(path)
            if block:
                symbols_text += block + "\n"

        elif key starts with "doc:":
            path = key.removeprefix("doc:")
            block = doc_index.get_file_doc_block(path)
            if block:
                symbols_text += block + "\n"

        elif key starts with "file:":
            path = key.removeprefix("file:")
            content = file_context.get_content(path)
            if content:
                files_text += format_as_fenced_block(path, content) + "\n\n"

        # NOTE: url: items are not yet tracked in the stability tracker.
        # When implemented, dispatch would be:
        # elif key starts with "url:":
        #     url_hash = key.removeprefix("url:")
        #     url_content = url_service.get_url_content_by_hash(url_hash)
        #     if url_content:
        #         formatted = url_content.format_for_prompt()
        #         if formatted:
        #             files_text += "\n---\n" + formatted + "\n"

        elif key starts with "history:":
            index = int(key.removeprefix("history:"))
            # Collect history message pairs by index
            history_messages.append(history[index])

    tiered_content[tier] = {
        "symbols": symbols_text,
        "files": files_text,
        "history": history_messages
    }
```

### Step 3: Determine Exclusions

Files in any cached tier must be excluded from the active "Working Files" section and from the symbol map output. URLs in any cached tier must be excluded from the uncached URL context pair. User-excluded index files (via the file picker's three-state checkbox) must be excluded from all map output:

```pseudo
graduated_files = set()
symbol_map_exclude = set()
graduated_urls = set()  # URL hashes in cached tiers

# User-excluded files — completely removed from index
symbol_map_exclude |= excluded_index_files

for tier in [L0, L1, L2, L3]:
    for key in tracker.get_tier_items(tier):
        if key starts with "file:":
            path = key.removeprefix("file:")
            graduated_files.add(path)
            symbol_map_exclude.add(path)  # full content present, no need for index block
        elif key starts with "symbol:" or key starts with "doc:":
            path = key.split(":", 1)[1]
            symbol_map_exclude.add(path)  # index block in tier, exclude from main map
        elif key starts with "url:":
            graduated_urls.add(key.removeprefix("url:"))

# Also exclude selected files whose symbol blocks are in active
for path in selected_files:
    symbol_map_exclude.add(path)  # full content in active, symbol block redundant
```

### Tiered Content Dict Structure

Each tier key (`l0`, `l1`, `l2`, `l3`) in the `tiered_content` dict contains:

| Field | Type | Description |
|-------|------|-------------|
| `symbols` | `str` | Concatenated symbol/doc index blocks for files in this tier |
| `files` | `str` | Concatenated fenced code blocks for graduated file contents |
| `history` | `list[dict]` | History message dicts graduated to this tier |
| `graduated_files` | `list[str]` | File paths whose full content is in this tier (excluded from active Working Files) |
| `graduated_history_indices` | `list[int]` | History message indices in this tier (excluded from active history) |

The `graduated_files` and `graduated_history_indices` fields are used by `assemble_tiered_messages` to exclude graduated content from the uncached active sections, ensuring no content appears twice.

### Step 4: Assemble

```pseudo
symbol_map = symbol_index.get_symbol_map(exclude_files=symbol_map_exclude)
symbol_legend = symbol_index.get_legend()
doc_legend = doc_index.get_legend() if cross_ref_enabled else None

messages = context_manager.assemble_tiered_messages(
    user_prompt=user_message,
    images=images,
    symbol_map=symbol_map,
    symbol_legend=symbol_legend,
    doc_legend=doc_legend,
    file_tree=file_tree,
    tiered_content=tiered_content
)
```

### Content Gathering Rules

| Item Type | Content Source | Exclusion Effect |
|-----------|--------------|------------------|
| `file:{path}` in tier | `FileContext.get_content(path)` | Excluded from active Working Files; index block excluded from main map |
| `symbol:{path}` in tier | `SymbolIndex.get_file_symbol_block(path)` | Excluded from main symbol map output |
| `doc:{path}` in tier | `DocIndex.get_file_doc_block(path)` | Excluded from main doc index output |
| `url:{hash}` in tier | `URLService.get_url_content(url).format_for_prompt()` | Excluded from uncached URL context pair (**not yet implemented** — URLs currently always appear in uncached section) |
| `history:{N}` in tier | `ContextManager.get_history()[N]` | Excluded from active history messages |
| `file:{path}` in active | `FileContext.get_content(path)` | Index block excluded from main map (full content present) |
| `symbol:{path}` in active | Not rendered separately | Listed in active items for N-tracking only |
| `doc:{path}` in active | Not rendered separately | Listed in active items for N-tracking only |
| `url:{hash}` in active | Not rendered separately | Listed in active items for N-tracking only (first request only — enters L1 immediately) |

### A File Never Appears Twice

A file's content is present in exactly one location:
- **Full content** in a cached tier block (graduated) — index block (`symbol:` or `doc:` entry) excluded from all maps
- **Full content** in the active Working Files section — index block excluded from main map
- **Index block only** in a cached tier — when full content is not selected
- **Index block only** in the main map — default for unselected, non-graduated files

### A URL Never Appears Twice

A URL's content is present in exactly one location:
- **Formatted content** in a cached tier block (L1 or above) — excluded from uncached URL context pair
- **Formatted content** in the uncached URL context pair — only on the first request before tier entry