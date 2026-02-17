# Prompt Assembly

## Overview

This is the **single source of truth** for how LLM messages are assembled. All prompt content — system prompts, symbol map, files, history, URLs — is organized into a structured message array with stability-based cache tier placement.

The assembly system supports two modes:
- **Tiered assembly** (`assemble_tiered_messages`) — organizes content into L0–L3 cached blocks with `cache_control` markers. This is the primary mode.
- **Flat assembly** (`assemble_messages`) — produces a flat message array without cache breakpoints. Used as a fallback or during development.

The streaming handler uses tiered assembly, passing a `tiered_content` dict built from the stability tracker's tier assignments (see [Tiered Assembly Data Flow](#tiered-assembly-data-flow) below).

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

## Block Details

### L0 Block (System Message)

L0 is the **system role message** (not a user/assistant pair). It concatenates:

1. **System prompt** — from files
2. **Symbol map legend** — preceded by:
   ```
   # Repository Structure

   Below is a map of the repository showing classes, functions, and their relationships.
   Use this to understand the codebase structure and find relevant code.

   ```
   Then the legend text (abbreviation key + path aliases)
3. **L0 symbol entries** — symbol blocks for L0-stability files
4. **L0 file contents** — preceded by:
   ```
   # Reference Files (Stable)

   These files are included for reference:

   ```

### L1, L2, L3 Blocks

Each non-empty tier produces a **user/assistant pair** (if it has symbols or files):
- User message: symbol entries + file contents concatenated
- Assistant message: `"Ok."`

Symbol entries use header: `# Repository Structure (continued)\n\n`

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

The file tree is a **flat sorted list** — one file per line, no indentation:
```
# File Tree (236 files)

.gitignore
README.md
src/main.py
```

### URL Context (Uncached)

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
    # tier_items = {key: TrackedItem} where key is "file:{path}", "symbol:{path}", or "history:{N}"
```

### Step 2: Build Content for Each Tier

For each tier, separate items by type and gather their content:

```pseudo
tiered_content = {}
for tier in [L0, L1, L2, L3]:
    tier_items = tracker.get_tier_items(tier)
    symbols_text = ""
    files_text = ""
    history_messages = []

    for key, item in tier_items:
        if key starts with "symbol:":
            path = key.removeprefix("symbol:")
            block = symbol_index.get_file_symbol_block(path)
            if block:
                symbols_text += block + "\n"

        elif key starts with "file:":
            path = key.removeprefix("file:")
            content = file_context.get_content(path)
            if content:
                files_text += format_as_fenced_block(path, content) + "\n\n"

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

Files in any cached tier must be excluded from the active "Working Files" section and from the symbol map output:

```pseudo
graduated_files = set()
symbol_map_exclude = set()

for tier in [L0, L1, L2, L3]:
    for key in tracker.get_tier_items(tier):
        if key starts with "file:":
            path = key.removeprefix("file:")
            graduated_files.add(path)
            symbol_map_exclude.add(path)  # full content present, no need for symbol block
        elif key starts with "symbol:":
            path = key.removeprefix("symbol:")
            symbol_map_exclude.add(path)  # symbol block in tier, exclude from main map

# Also exclude selected files whose symbol blocks are in active
for path in selected_files:
    symbol_map_exclude.add(path)  # full content in active, symbol block redundant
```

### Step 4: Assemble

```pseudo
symbol_map = symbol_index.get_symbol_map(exclude_files=symbol_map_exclude)
legend = symbol_index.get_legend()

messages = context_manager.assemble_tiered_messages(
    user_prompt=user_message,
    images=images,
    symbol_map=symbol_map,
    symbol_legend=legend,
    file_tree=file_tree,
    tiered_content=tiered_content
)
```

### Content Gathering Rules

| Item Type | Content Source | Exclusion Effect |
|-----------|--------------|------------------|
| `file:{path}` in tier | `FileContext.get_content(path)` | Excluded from active Working Files; symbol block excluded from main map |
| `symbol:{path}` in tier | `SymbolIndex.get_file_symbol_block(path)` | Excluded from main symbol map output |
| `history:{N}` in tier | `ContextManager.get_history()[N]` | Excluded from active history messages |
| `file:{path}` in active | `FileContext.get_content(path)` | Symbol block excluded from main map (full content present) |
| `symbol:{path}` in active | Not rendered separately | Listed in active items for N-tracking only |

### A File Never Appears Twice

A file's content is present in exactly one location:
- **Full content** in a cached tier block (graduated) — symbol block excluded from all maps
- **Full content** in the active Working Files section — symbol block excluded from main map
- **Symbol block only** in a cached tier — when full content is not selected
- **Symbol block only** in the main symbol map — default for unselected, non-graduated files