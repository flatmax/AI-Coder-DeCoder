# Prompt Assembly

## Overview

This is the **single source of truth** for how LLM messages are assembled. All prompt content — system prompts, symbol map, files, history, URLs — is organized into a structured message array with cache breakpoints. Other specs reference this document rather than duplicating the format.

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

### Other Prompts

| Prompt | Used For |
|--------|----------|
| **Commit message prompt** | Inline constant for generating git commit messages |
| **Compaction skill prompt** | Loaded by topic detector for history compaction LLM calls |
| **System reminder** | Compact edit format reference (exists as infrastructure, not currently injected) |

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
[M+4] user     Active files ("Working Files")
[M+5] assistant "Ok."
[M+] Active history (native pairs)
[last] user    Current prompt (with optional images)
```

Empty tiers are skipped entirely.

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

### Current User Message

```pseudo
// Without images:
{"role": "user", "content": user_prompt}

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