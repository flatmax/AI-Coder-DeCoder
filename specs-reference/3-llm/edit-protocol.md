# Reference: Edit Protocol

**Supplements:** `specs4/3-llm/edit-protocol.md`

This is the **canonical owner** for edit block marker bytes, parser rules, and diagnostic message text. Webapp twins (chat rendering, diff viewer navigation) link here rather than duplicate.

## Byte-level formats

### Marker sequences

Three marker lines bracket every edit block. Each marker is its own line with no trailing characters:

| Marker | Literal bytes | Unicode codepoints |
|---|---|---|
| Start | `🟧🟧🟧 EDIT` | U+1F7E7 U+1F7E7 U+1F7E7 U+0020 U+0045 U+0044 U+0049 U+0054 |
| Separator | `🟨🟨🟨 REPL` | U+1F7E8 U+1F7E8 U+1F7E8 U+0020 U+0052 U+0045 U+0050 U+004C |
| End | `🟩🟩🟩 END` | U+1F7E9 U+1F7E9 U+1F7E9 U+0020 U+0045 U+004E U+0044 |

- U+1F7E7 — LARGE ORANGE SQUARE
- U+1F7E8 — LARGE YELLOW SQUARE
- U+1F7E9 — LARGE GREEN SQUARE

The orange → yellow → green color progression is deliberate — malformed blocks (missing separator, missing end) are visually distinguishable from prose without reading the ASCII keywords.

No ASCII substitution is permitted. Parsers match on exact byte sequences including the emoji codepoints. Text processors that strip emoji will silently break the protocol.

### Agent-spawn marker sequences (reserved)

A second block type — agent-spawn blocks — is defined in `specs4/7-future/parallel-agents.md` § Agent-spawn block format. The current single-agent implementation does NOT parse these blocks; the marker bytes are documented here for forward-compatibility so a future parallel-agent implementation inherits the same byte-level discipline.

| Marker | Literal bytes | Unicode codepoints |
|---|---|---|
| Start | `🟧🟧🟧 AGENT` | U+1F7E7 U+1F7E7 U+1F7E7 U+0020 U+0041 U+0047 U+0045 U+004E U+0054 |
| End | `🟩🟩🟩 AGEND` | U+1F7E9 U+1F7E9 U+1F7E9 U+0020 U+0041 U+0047 U+0045 U+004E U+0044 |

Agent blocks have no middle separator — the body is a YAML-ish `key: value` payload directly between the start and end markers. The distinct end marker (`AGEND` rather than `END`) deliberately differs from edit blocks so a parser scanning line-by-line can dispatch on the literal line without tracking which start marker opened the current block. See the behavioural spec for field semantics.

The current `EditParser` treats both `🟧🟧🟧 AGENT` and `🟩🟩🟩 AGEND` as prose (unrecognised lines in the `SCANNING` state do not transition). This is the parser-tolerance invariant documented in `specs4/7-future/parallel-agents.md` § Foundation Requirements.

### Block structure

Complete block byte layout:

```
{file-path}\n
🟧🟧🟧 EDIT\n
{old-text lines}\n
🟨🟨🟨 REPL\n
{new-text lines}\n
🟩🟩🟩 END\n
```

- File path appears on the line immediately before the start marker
- Blank lines between file path and start marker cause a state reset (file path is forgotten)
- Old text is zero or more lines between start and separator
- New text is zero or more lines between separator and end
- Empty old text section signals a **create** operation; all other operations are modifies

### File path detection

A line is treated as a file path when it meets ALL:

1. Length < 200 characters
2. Non-empty after trim
3. Does NOT start with a comment prefix: `#`, `//`, `*`, `-`, `>`, triple-backtick
4. Matches ONE of:
   - Contains path separator `/` or `\`
   - Matches `\.?[\w\-\.]+\.\w+` (filename with extension, including dotfiles like `.env.local`)
   - Matches `\.\w[\w\-\.]*` (dotfile without extension, like `.gitignore`)
   - Is in the known extensionless-filename allowlist

### Known extensionless filenames (backend parser)

| Name | Reason |
|---|---|
| `Makefile` | Build scripts |
| `Dockerfile` | Container definitions |
| `Vagrantfile` | VM definitions |
| `Gemfile` | Ruby bundler |
| `Rakefile` | Ruby build tasks |
| `Procfile` | Process definitions |
| `Brewfile` | Homebrew bundles |
| `Justfile` | `just` command runner |

Case-sensitive matching. Files named `makefile` (lowercase) would fail — matches real-world convention.

### Frontend vs backend detection divergence

The webapp's edit-block segmenter (`edit-blocks.js`) and the backend parser (`edit_parser.py`) each implement `_is_file_path()` independently. The implementations differ deliberately:

| Rule | Backend | Frontend |
|---|---|---|
| Comment prefix rejection | ✓ | ✓ |
| Paths with `/` or `\` | ✓ | ✓ |
| Filename with extension | ✓ | ✓ |
| Dotfile without extension | ✓ | ✓ |
| Extensionless allowlist (`Makefile`, `Dockerfile`, ...) | ✓ | ✗ (not recognized) |

The frontend is simpler because its job is display-only — a `Makefile` edit block that fails to render as a visual block still applies correctly on the backend. The divergence is intentional; do not treat it as a bug to resolve.

## Parser state machine

Five states. Transitions driven by per-line classification.

| State | Trigger | Action | Next state |
|---|---|---|---|
| `SCANNING` | File path pattern | Record path | `EXPECT_EDIT` |
| `SCANNING` | Other line | — | `SCANNING` |
| `EXPECT_EDIT` | `🟧🟧🟧 EDIT` | — | `READING_OLD` |
| `EXPECT_EDIT` | File path pattern | Update recorded path (treat prior line as prose) | `EXPECT_EDIT` |
| `EXPECT_EDIT` | Blank line | Reset (discard path) | `SCANNING` |
| `EXPECT_EDIT` | Other line | Treat prior path as prose, append this line to buffer | `SCANNING` |
| `READING_OLD` | `🟨🟨🟨 REPL` | — | `READING_NEW` |
| `READING_OLD` | Other line | Accumulate as old-text | `READING_OLD` |
| `READING_NEW` | `🟩🟩🟩 END` | Emit block | `SCANNING` |
| `READING_NEW` | Other line | Accumulate as new-text | `READING_NEW` |

### Streaming considerations

- Parser maintains state across chunks so a block split mid-line parses correctly
- Partial blocks (stream ends in `READING_OLD` or `READING_NEW`) are NOT emitted
- A `READING_NEW` state with no closing END marker means the LLM was cut off mid-block; the block is discarded silently at parser flush

### Blank-line reset in `EXPECT_EDIT`

A blank line between a file path and a start marker discards the path. This handles the common case where prose mentions a file path (e.g., "Now we'll edit `src/foo.py`:") followed by a blank line and then an unrelated code block — without the reset, the code block would be interpreted as an edit block with a spurious target path.

## Numeric constants

### Merge-distance heuristic

Adjacent edits on the same file should be merged when:

- Overlapping: old-text regions intersect
- Adjacent: separated by 3 lines or fewer in the target file
- Sequential dependency: edit B's old-text was produced by edit A's new-text

The 3-line adjacency threshold is a soft heuristic applied by LLM system prompts, not enforced at parse time — the parser applies all blocks sequentially regardless.

## Schemas

### Per-block result

Each applied edit produces a result record with these fields:

| Field | Type | Notes |
|---|---|---|
| `file_path` | string | Relative to repo root |
| `status` | enum | See status table below |
| `message` | string | Human-readable detail, may be empty |
| `error_type` | string | See error-type table below; empty on success |

### Status enum values

| Value | Meaning |
|---|---|
| `applied` | Written to disk |
| `already_applied` | New content already matches on disk (detected by searching for `new_lines` as contiguous block in file) |
| `validated` | Dry-run passed, not written |
| `failed` | Anchor not found, ambiguous, or mismatch |
| `skipped` | Pre-condition failed (binary, path traversal, binary file) |
| `not_in_context` | File not in active selection, edit deferred |

### Error type enum values

`error_type` is populated on non-success results:

| Value | Trigger |
|---|---|
| `anchor_not_found` | Old text block not found in file (includes whitespace mismatch and partial match) |
| `ambiguous_anchor` | Old text block matches multiple locations |
| `file_not_found` | File does not exist or cannot be read |
| `write_error` | Post-validation write to disk failed (OS error) |
| `validation_error` | Path traversal, binary file, or other pre-condition |

`error_type` is empty (empty string) on success statuses (`applied`, `already_applied`, `validated`).

### Deprecated error types

`old_text_mismatch` — formerly used to distinguish whitespace-mismatch from not-found. Now consolidated into `anchor_not_found`. The enum value remains in code for backward compatibility but is never returned.

## Diagnostic messages

Diagnostic messages are emitted in the `message` field of edit results. Downstream tooling (including the webapp's retry-prompt generator) may pattern-match on these strings.

### Anchor not found — whitespace mismatch

```
Old text not found in file. Possible whitespace mismatch — check for tabs vs spaces or trailing whitespace.
```

### Anchor not found — partial match

```
Old text not found. The first line matched at line {N} but subsequent lines differ.
```

### Ambiguous anchor

```
Ambiguous match: old text appears {N} times in the file. Add more surrounding context lines to disambiguate.
```

The literal string `"Ambiguous match"` is matched by the webapp's retry-prompt detector (see [Ambiguous retry prompt template](#ambiguous-retry-prompt-template)).

### File not found

```
File does not exist: {path}
```

### Binary file

```
Binary file cannot be edited: {path}
```

### Path traversal

```
Path traversal blocked: {path}
```

## Retry prompt templates

The webapp auto-populates the chat input with retry prompts when specific failure conditions are detected on `streamComplete`. Prompt text is not sent automatically — the user reviews and sends.

### Ambiguous retry prompt template

Triggered when one or more edit results have `status = "failed"` and `message` contains `"Ambiguous match"`.

```
Some edits failed because the old text matched multiple locations in the file. Please retry with more surrounding context lines to make the match unique:

- {file_path}: {error_message}
- {file_path}: {error_message}
```

One bullet per ambiguous failure. File paths ordered by appearance in the original response.

### Not-in-context retry prompt template

Triggered when one or more edit results have `status = "not_in_context"`.

**Single file:**
```
The file {basename} has been added to context. Please retry the edit for: {path}
```

**Multiple files:**
```
The files {basename1}, {basename2}, {basename3} have been added to context. Please retry the edits for:

- {path1}
- {path2}
- {path3}
```

### Old-text-mismatch retry prompt template

Triggered when one or more edit results have `status = "failed"`, `error_type = "anchor_not_found"`, AND the target file is already in the active file context (not `not_in_context`). This indicates the LLM produced wrong text despite having seen the file.

```
The old text you specified does not exist in the file. The file is already in context — please re-read it before retrying:

- {file_path}
```

This prompt and the ambiguous retry prompt can both be triggered by the same response. Only one is auto-populated; the ambiguous prompt takes priority because it's more recoverable (just add context lines) than the re-read prompt.

## Shell command detection

The `detect_shell_commands(text)` function extracts suggested shell commands from assistant responses for UI display. It is called after edit-block parsing and operates on the full response text.

### Detection rules

A line is treated as a shell command if it matches ONE of:

1. Inside a fenced code block with language `bash`, `shell`, or `sh` — every non-comment, non-blank line is a command
2. Line starts with `$ ` (dollar-space prefix) — the rest of the line is the command
3. Line starts with `> ` (greater-than-space prefix) AND does NOT start with common prose words (`Note`, `Warning`, `This`, `The`, `Make`) — the rest of the line is the command

### Prose-filter wordlist

Lines starting with `> ` are rejected as prose (blockquotes) if they start with any of:

- `Note`
- `Warning`
- `This`
- `The`
- `Make`

Case-sensitive. `> Make` rejects (prose like "Make sure to..."), but `> make` accepts (the build command `make`).

### Output

Returns a list of command strings (no leading `$` or `>`). Empty input or no matches returns empty list. Comments (`#` prefix) inside fenced blocks are skipped.

## Dependency quirks

No external libraries. Edit block parsing and application are pure stdlib Python (no regex libraries, no parsers, no git-index libraries — git operations delegate to the repository layer).

## Cross-references

- Behavioral contract, operation taxonomy, application modes, invariants: `specs4/3-llm/edit-protocol.md` (the parent spec)
- Chat panel edit-block rendering (consumer): webapp twins link here for marker bytes
- Diff viewer edit-block navigation (consumer): webapp twins link here for marker bytes
- Streaming pipeline integration: `specs4/3-llm/streaming.md` (when implemented, `specs-reference/3-llm/streaming.md`)
- Apply pipeline concurrency invariants: `specs4/3-llm/edit-protocol.md` § "Concurrent Invocation"