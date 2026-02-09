# Edit Blocks & AI File Editing

## Overview

The system uses a structured edit block format for the LLM to propose file changes. Edit blocks are parsed from the LLM's streaming response, validated against actual file content, and applied sequentially. The format is designed to be unambiguous, machine-parsable, and resistant to common LLM mistakes.

## Edit Block Format (v3)

### Structure

```
path/to/file.ext
[EDIT_START]
[context lines — anchor]
[old lines to replace]
[REPL_SEPARATOR]
[context lines — identical anchor]
[new lines]
[EDIT_END]
```

### Markers

| Marker | Unicode | Purpose |
|--------|---------|---------|
| Edit start | `\u00ab\u00ab\u00ab EDIT` | Start of edit block (preceded by file path on previous line) |
| Repl separator | `\u2550\u2550\u2550\u2550\u2550\u2550\u2550 REPL` | Separator between edit and replacement sections |
| Edit end | `\u00bb\u00bb\u00bb EDIT END` | End of edit block |

The start marker uses left guillemets, the separator uses box-drawing equals characters, and the end marker uses right guillemets.

### Anchor Computation

The **anchor** is the common prefix of identical lines between the EDIT and REPL sections. It serves as a unique locator in the file.

Given an edit block where both sections start with:
```
def process():
    step_one()
```

And the EDIT section continues with `    step_two()` while the REPL section has `    step_two_updated()`, the parser computes:
- **Anchor**: `def process():\n    step_one()` (matching prefix)
- **Old lines**: `    step_two()` (remainder of EDIT section)
- **New lines**: `    step_two_updated()` (remainder of REPL section)

### Special Cases

| Case | EDIT Section | REPL Section | Behaviour |
|------|-------------|--------------|-----------|
| **New file** | Empty | Content | Creates file with REPL content |
| **Insert after** | Context only | Context + new lines | Anchor matches, new lines appended |
| **Delete lines** | Context + old lines | Context only | Old lines removed |
| **Replace** | Context + old lines | Context + new lines | Standard replacement |

## Data Models

### EditBlock

Parsed from LLM response text.

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | `str` | Target file path |
| `anchor` | `str` | Common prefix lines (locator) |
| `old_lines` | `str` | Lines to remove (empty string if none) |
| `new_lines` | `str` | Lines to insert (empty string if none) |
| `raw_block` | `str` | Original text for error reporting |
| `line_number` | `int` | Line number in LLM response where block started |

### EditResult

Result of applying a single edit block.

| Field | Type | Description |
|-------|------|-------------|
| `file_path` | `str` | Target file path |
| `status` | `EditStatus` | `APPLIED`, `FAILED`, or `SKIPPED` |
| `reason` | `str?` | Error message if failed/skipped |
| `anchor_preview` | `str` | First 50 chars of anchor for UI |
| `old_preview` | `str` | First 50 chars of old lines for UI |
| `new_preview` | `str` | First 50 chars of new lines for UI |
| `block` | `EditBlock` | Original block reference |
| `estimated_line` | `int?` | Approximate line number in file |

### EditStatus

| Value | Meaning |
|-------|---------|
| `APPLIED` | Successfully applied |
| `FAILED` | Validation or application error |
| `SKIPPED` | Previous edit to same file failed, so this was skipped |

### ApplyResult

Result of applying all edit blocks from a response.

| Field | Type | Description |
|-------|------|-------------|
| `results` | `list[EditResult]` | Per-block results |
| `files_modified` | `list[str]` | Paths of files that were changed |
| `shell_suggestions` | `list[str]` | Detected shell commands (git rm, git mv, etc.) |

## Parsing Pipeline

### 1. Response Parsing (`parse_response`)

State machine walks response line-by-line:

```
IDLE -> EXPECT_START -> EDIT_SECTION -> REPL_SECTION -> IDLE
         ^                                              |
         +----------------------------------------------+
```

| State | Transition On | Action |
|-------|--------------|--------|
| `IDLE` | Non-empty line | Store as potential file path, move to `EXPECT_START` |
| `EXPECT_START` | Edit start marker | Begin edit block, move to `EDIT_SECTION` |
| `EXPECT_START` | Non-empty line | Update potential path (previous was explanation text) |
| `EDIT_SECTION` | Repl separator | Switch to replacement, move to `REPL_SECTION` |
| `EDIT_SECTION` | Other | Accumulate edit lines |
| `REPL_SECTION` | Edit end marker | Compute anchor, emit block, move to `IDLE` |
| `REPL_SECTION` | Other | Accumulate replacement lines |

Malformed blocks (missing markers, unclosed) are silently discarded. Parsing continues past errors.

### 2. Anchor Computation (`_compute_common_prefix`)

Compares EDIT and REPL sections line-by-line from the start. Matching lines become the anchor; remaining lines are old/new respectively.

### 3. Validation (`validate_block`)

Checks that `anchor + old_lines` appears contiguously in the file:

| Check | Error |
|-------|-------|
| Sequence not found | Detailed diagnosis (anchor missing? old lines don't match after anchor?) |
| Multiple matches | `"Edit location is ambiguous (matches at lines N and M)"` |
| New file (both empty) | Always valid |

Diagnosis tries to locate the first anchor line to give a hint about where the mismatch occurs.

### 4. Application (`apply_block`)

1. Validate block against file content
2. Build old sequence: `anchor + old_lines`
3. Build new sequence: `anchor + new_lines`
4. Replace first occurrence of old sequence with new sequence
5. Ensure trailing newline

### 5. Batch Application (`apply_edits`)

Applies multiple blocks sequentially:

1. For each block, get file content (from cache or disk)
2. Skip binary files
3. If a previous edit to the same file failed, skip subsequent edits to that file
4. Apply the edit, update in-memory content for next edit
5. After all edits: write files to disk, optionally `git add` modified files

Content is cached per-file so sequential edits to the same file work correctly — each edit sees the result of the previous one.

## Shell Command Detection

`detect_shell_suggestions` extracts shell commands from response text using regex patterns:

| Pattern | Example |
|---------|---------|
| `` `git rm <path>` `` | File deletion |
| `` `git mv <old> <new>` `` | File rename/move |
| `` `mkdir -p <path>` `` | Directory creation |
| `` `rm -rf <path>` `` | Directory deletion |

These are surfaced in the UI as actionable suggestions.

## Streaming Integration

During a streaming response (`StreamingMixin._stream_chat`):

1. LLM streams chunks which are accumulated
2. On stream completion, `parse_edits` is called on the full response
3. If edit blocks are found, `apply_edits` is called with the repo
4. Results are sent back to the webapp via `streamComplete`
5. Webapp displays edit results in the assistant card and loads diffs into the diff viewer

## Webapp Edit Block Rendering

### Parsing (`EditBlockParser.js`)

`parseEditBlocks(content)` extracts edit blocks from assistant message content for rendering. Identifies file paths, EDIT/REPL sections, and block boundaries.

`getEditResultForFile(editResults, filePath)` matches a rendered edit block to its server-side apply result.

### Rendering (`EditBlockRenderer.js`)

| Function | Description |
|----------|-------------|
| `renderEditBlock(block, editResults)` | Renders a complete edit block with syntax highlighting and status |
| `renderEditsSummary(editResults)` | Summary banner showing applied/failed counts |
| `renderInProgressEditBlock(filePath, partialLines)` | Renders an edit block still being streamed |
| `formatUnifiedDiff(editContent, replContent)` | Computes and renders inline diff with character-level highlights |

### Status Display

Each rendered edit block shows:
- File path (clickable — navigates to diff viewer)
- Status badge: applied, failed (with reason), or skipped
- Unified diff view with red/green highlighting
- Character-level diff highlighting within changed lines

### Edit Summary Banner

After all edits, a summary shows:
- Count of applied/failed/skipped edits
- List of modified files (clickable)
- Failed edit details with error messages

### Click Handling (`CardClickHandler.js`)

| Target | Action |
|--------|--------|
| File path in edit block header | Navigate to file in diff viewer at the edit location |
| Applied edit tag | Navigate to the applied edit location |
| Failed edit tag | Show the error context |
| File mention in text | View the file in diff viewer |

## LLM Instructions

The system prompt (`config/prompts/system.md`) instructs the LLM on correct edit block usage:

### Rules

1. Never wrap edit blocks in markdown code fences
2. Copy-paste exact content from files, never type from memory
3. Include identical context lines in both EDIT and REPL sections
4. Use enough context for a unique anchor match
5. Exact whitespace, blank lines, and comments matter
6. No placeholders (`...`, `// rest of code`)
7. Verify the anchor exists in the file before emitting

### Edit Sizing Guidelines

- Default to small, targeted edits
- Merge into one block when edits overlap, are adjacent (within 3 lines), or have sequential dependencies
- Be aware that sequential edits can invalidate anchors or create duplicate matches

### File Operations via Edit Blocks

| Operation | Technique |
|-----------|-----------|
| Create file | Empty EDIT section, content in REPL only |
| Delete file | Suggest `git rm path/to/file` |
| Rename file | Suggest `git mv old_path new_path` |
