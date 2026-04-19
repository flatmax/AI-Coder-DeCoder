# Edit Protocol

## Overview

The LLM proposes file changes using a structured edit block format. Each block contains **old text** (exact copy from the file, searched as a contiguous block) and **new text** (its complete replacement). Blocks are parsed from the streaming response, validated against file content, and applied sequentially.

## Edit Block Format

### Structure

```
path/to/file.ext
««« EDIT
[old text — exact copy from the file]
═══════ REPL
[new text — the replacement]
»»» EDIT END
```

### How It Works

The block has two sections separated by `═══════ REPL`:

1. **EDIT section** (between `««« EDIT` and `═══════ REPL`): Contains the old text as it currently exists in the file — searched as a contiguous block to locate the edit site
2. **REPL section** (between `═══════ REPL` and `»»» EDIT END`): Contains the new text that replaces the entire matched block

### How Matching Works

The entire EDIT section is searched for in the file as a contiguous block of lines. When exactly one match is found, the REPL section replaces it completely.

Example:

```
src/math.py
««« EDIT
def multiply(a, b):
    return a + b  # BUG
═══════ REPL
def multiply(a, b):
    return a * b
»»» EDIT END
```

Here:
- Old text (to find): `def multiply(a, b):` + `    return a + b  # BUG`
- New text (replacement): `def multiply(a, b):` + `    return a * b`
- The unchanged line `def multiply(a, b):` appears in both sections — it helps uniquely locate the edit and remains in the file after replacement

### Why Uniqueness Matters

The old text block must match **exactly one** location in the file. If the file has duplicate sections, more surrounding context lines should be included in both EDIT and REPL sections to disambiguate. Zero matches → fail. Multiple matches → fail (ambiguous).

## Operations

| Operation | Technique |
|-----------|-----------|
| Modify code | Old text with context in EDIT, modified version in REPL |
| Insert after | Context line(s) in EDIT, context + new lines in REPL |
| Create file | Empty EDIT section, content only in REPL |
| Delete lines | Lines to delete with context in EDIT, just context in REPL |
| Delete file | Not via edit blocks — suggest `git rm` |
| Rename file | Not via edit blocks — suggest `git mv` |

### Insert Example

```
src/utils.py
««« EDIT
import os
═══════ REPL
import os
import sys
»»» EDIT END
```

### Create File Example

```
src/new_module.py
««« EDIT
═══════ REPL
def hello():
    print("Hello, world!")
»»» EDIT END
```

### Delete Lines Example

```
src/utils.py
««« EDIT
import os
import deprecated_module
import sys
═══════ REPL
import os
import sys
»»» EDIT END
```

## Multiple Edits to the Same File

Applied **sequentially**, top to bottom. After edit A, edit B's old text must match the file **after** A. Adjacent/overlapping edits should be **merged into one block**.

### Why Merging Matters

```
# WRONG — second edit fails because first changed the old text

src/app.py
««« EDIT
def process():
    step_one()
═══════ REPL
def process():
    step_one_updated()
»»» EDIT END
```

```
src/app.py
««« EDIT
    step_one()
    step_two()
═══════ REPL
    step_one()
    step_two_updated()
»»» EDIT END
```

The second edit looks for `step_one()` but it was already changed to `step_one_updated()`.

```
# CORRECT — merged into one block

src/app.py
««« EDIT
def process():
    step_one()
    step_two()
═══════ REPL
def process():
    step_one_updated()
    step_two_updated()
»»» EDIT END
```

### Merge Rules

Merge when edits are: overlapping, adjacent (within 3 lines), or have sequential dependencies.

## Parsing

### State Machine

| State | Trigger | Action |
|-------|---------|--------|
| SCANNING | File path pattern | Record path → EXPECT_EDIT |
| EXPECT_EDIT | `««« EDIT` | → READING_OLD |
| EXPECT_EDIT | Anything else | → SCANNING |
| READING_OLD | `═══════ REPL` | → READING_NEW |
| READING_OLD | Other line | Accumulate old |
| READING_NEW | `»»» EDIT END` | Emit block → SCANNING |
| READING_NEW | Other line | Accumulate new |

### File Path Detection

A line is considered a file path if it meets these criteria (< 200 chars, not empty):

1. **Not a comment** — doesn't start with `#`, `//`, `*`, `-`, `>`, or triple backticks
2. **Path with separators** — contains `/` or `\` (most common case)
3. **Simple filename with extension** — matches `\.?[\w\-\.]+\.\w+` (e.g., `foo.js`, `.env.local`)
4. **Dotfile without extension** — matches `\.\w[\w\-\.]*` (e.g., `.gitignore`, `.dockerignore`, `.env`)
5. **Known extensionless filenames** — `Makefile`, `Dockerfile`, `Vagrantfile`, `Gemfile`, `Rakefile`, `Procfile`, `Brewfile`, `Justfile`

The path must appear on the line **immediately before** `««« EDIT` (with nothing else between except blank lines that cause a state reset).

### Streaming Considerations

During streaming, partially received blocks are tracked. The parser maintains state across chunks. Only completed blocks (with `»»» EDIT END`) are applied.

## Validation

1. **File exists?** — for modifications, not creates
2. **Not binary?** — null byte check in first 8KB
3. **Old text found?** — entire EDIT section must match exactly one contiguous block in the file

### Ambiguity Detection

- **Zero matches** → FAILED (old text not found)
- **Multiple matches** → FAILED (ambiguous — include more context)
- **Exactly one** → proceed

### Failure Diagnostics

- **Whitespace mismatch** — tabs vs spaces, trailing whitespace
- **Partial match** — first line found but subsequent lines differ
- **Not found** — old text not found in file

## Application

| Mode | Behavior |
|------|----------|
| Dry run | Validate all blocks, report what would change |
| Apply | Write to disk, stage modified files in git |

### Per-Block Results

| Status | Meaning |
|--------|---------|
| Applied | Written to disk |
| Validated | Dry-run passed |
| Failed | Old text not found or ambiguous match |
| Skipped | Binary file or pre-condition failed |
| Not In Context | File was not in the active context; edit deferred (see below) |
| Already Applied | New content already present in file (idempotent). Detected by searching the file for the full `new_lines` as a contiguous block — if found, the edit was already applied in a prior request |

Each result includes:

| Field | Description |
|-------|-------------|
| `file_path` | Target file for the edit |
| `status` | One of the statuses above |
| `message` | Human-readable error detail (e.g., "Old text not found in file") |
| `error_type` | Machine-readable failure category (empty string on success) |

#### Error Type Classification

Non-success results carry an `error_type` string classifying the failure:

| Error Type | Trigger |
|------------|---------|
| `anchor_not_found` | Old text block not found in file |
| `ambiguous_anchor` | Old text block matches multiple locations |
| `file_not_found` | File does not exist on disk (or cannot be read) |
| `write_error` | File validated but write to disk failed (OS error) |
| `validation_error` | Pre-condition failure: path traversal blocked, binary file |

The `error_type` is serialized alongside `status` and `message` in the `edit_results` array of the `streamComplete` result object.

### Not-In-Context Edit Handling

When the LLM produces edit blocks for files that are not in the active file context (not selected in the file picker), the edits are **not attempted**. The LLM wrote these edits based on the symbol map alone, without seeing the full file content — old text is likely wrong and edit quality is unreliable even if matches happen to succeed.

Instead, the system:

1. **Separates edit blocks** into two groups: files currently in context vs files not in context
2. **Applies in-context edits normally** — these proceed through the standard validate/apply pipeline
3. **Marks not-in-context edits** with status `NOT_IN_CONTEXT` — distinct from `FAILED` to indicate a workflow issue rather than a matching error
4. **Auto-adds the files** to the selected files list so their full content will be in context for the next request
5. **Broadcasts the file change** via the `filesChanged` callback so the browser file picker updates
6. **Includes a system note** in the `streamComplete` result listing which files were auto-added and advising the user to send a follow-up message to retry the edits

The user then sends a follow-up and the LLM regenerates the edit blocks with full file content in context.

**Auto-populated retry prompt:** When not-in-context edits are detected, the system auto-populates the chat textarea with a retry prompt naming the added files (e.g., "The file helpers.js has been added to context. Please retry the edit for: ..."). The prompt is not auto-sent — the user reviews and sends when ready. This parallels the ambiguous match retry prompt behavior.

#### Why Not Auto-Retry

Automatically sending a follow-up LLM request was considered but rejected:
- Adds complexity (continuation streams, loop prevention, cost control)
- Removes user control — the user may want to review which files were added
- The user's natural follow-up provides context the LLM can use to improve the edit

#### Detecting Context Membership

A file is "in context" if it is in the current selected files list (`_selected_files`) at the time edits are applied. Files that exist on disk but are not selected are not in context — the LLM has only seen their symbol map entry, not their full content.

### Post-Application

1. Modified files staged in git (`git add`)
2. Symbol cache entries invalidated for modified files
3. File tree refreshed on client
4. Results included in `streamComplete`

## Key Principles

1. **Copy-paste from file** — never type from memory
2. **Include enough unchanged context lines** in both sections for a unique match
3. **Exact match** — whitespace, blanks, comments matter
4. **No placeholders** (`...`, `// rest of code`)
5. **Ensure old text block matches exactly one location**
6. **No file moves/renames/deletes** — ask user to run `git mv` or `git rm`

## Partial Failure

Edits applied sequentially — earlier successes remain on disk and staged in git. No rollback. Failed edit details (file path, error, diagnostics) visible to AI in subsequent exchanges for retry with corrected old text.

## Ambiguous Match Retry Prompt

When one or more edits fail due to **ambiguous matches** (the old text block matched multiple locations in the file), the system auto-populates the chat input with a retry prompt — but does **not** auto-send it. The user reviews and sends when ready.

### Behavior

1. **Detection**: On `streamComplete`, the frontend inspects `edit_results` for entries with status `failed` and message containing `"Ambiguous match"`
2. **Prompt construction**: A retry prompt is composed listing each ambiguous failure with file path and error detail, instructing the LLM to include more surrounding context lines
3. **Auto-populate input**: The prompt text is placed into the chat textarea and auto-resized, but not sent
4. **User control**: The user can review, edit, or discard the prompt before sending. They may also add additional instructions or context

### Retry Prompt Template

```
Some edits failed because the old text matched multiple locations in the file. Please retry with more surrounding context lines to make the match unique:

- {file_path}: {error_message}
- {file_path}: {error_message}
```

### Why Not Auto-Send

Consistent with the not-in-context edit philosophy: the user maintains control over what is sent to the LLM. The user may want to provide additional guidance, select different files, or skip the retry entirely.

### Edit Summary Banner

The edit summary banner (rendered by `_renderEditSummary` in `chat-panel.js`) shows aggregate counts with color-coded badges:

- ✅ **N applied** (green) — successfully written to disk
- ✅ **N already applied** (green) — new content already present
- ❌ **N failed** (red) — validation or application failure
- ⚠️ **N skipped** (amber) — pre-condition failure
- ⚠️ **N not in context** (amber) — file not in active selection

#### Individual Failure Listing

When one or more edit blocks have non-success status (`failed`, `skipped`, or `not_in_context`), the banner expands to list each failure individually:

| Field | Description |
|-------|-------------|
| **File path** | Clickable — navigates to the file in the diff viewer via `navigate-file` event |
| **Error type** | The `error_type` badge (e.g., `anchor_not_found`, `ambiguous_anchor`) |
| **Error message** | The human-readable `message` from the backend |

When all edits succeed, no failure section is rendered — only aggregate counts appear.

When ambiguous match failures are present, the edit summary banner includes a note: *"A retry prompt has been prepared in the input below."* This draws attention to the auto-populated input without being intrusive.

## Edit Failure Retry Prompt

When edits fail on in-context files (whether old text not found or ambiguous), the system may auto-populate a retry prompt. For `anchor_not_found` failures on in-context files, the prompt reminds the LLM to re-read the file content from context and copy-paste the exact text. For `ambiguous_anchor` failures, the dedicated ambiguous retry prompt (above) takes priority.

Note: The `old_text_mismatch` error type is no longer produced — all failures are either `anchor_not_found` (old text not found, including whitespace issues) or `ambiguous_anchor`. The `OLD_TEXT_MISMATCH` enum value remains in the code for backward compatibility but will never be returned.

## Shell Command Detection

The `detect_shell_commands(text)` function (in `edit_parser.py`) extracts shell commands from assistant responses for display in the UI. It detects commands in:

- Fenced code blocks with `bash`, `shell`, or `sh` language tags (lines starting with `#` are treated as comments and skipped)
- Lines prefixed with `$ ` (dollar-space)
- Lines prefixed with `> ` (greater-than-space), unless the line starts with common prose words (`Note`, `Warning`, `This`, `The`, `Make`)

Returns a list of command strings. Empty lines inside code blocks are skipped.

## Testing

### Parsing
- Basic edit block extraction from prose text (file path, old/new lines)
- Create file (empty EDIT section)
- Insert after (context lines in EDIT, context + new lines in REPL)
- Delete lines (lines in EDIT absent from REPL)
- Multiple blocks from one response
- Single filename without path separator recognized
- Comment-prefixed lines not treated as file paths

### Validation
- Valid edit passes (old text found, unique match) — `error_type` is empty
- Old text not found returns error with `error_type: anchor_not_found`
- Ambiguous match (multiple locations) returns error with `error_type: ambiguous_anchor`
- Create blocks always valid — `error_type` is empty
- Whitespace mismatch in old text diagnosed with `error_type: anchor_not_found`

### Application
- Basic replacement preserves surrounding content
- Create writes new file
- Insert adds line after context
- Failed apply returns original content unchanged
- Repo application writes to disk, status = APPLIED
- Create makes parent directories
- Dry run validates without writing (status = VALIDATED)
- Path escape (../) blocked (status = SKIPPED, error_type = validation_error)
- Binary file skipped (status = SKIPPED, error_type = validation_error)
- Missing file fails (status = FAILED, error_type = file_not_found)
- Multiple sequential edits to same file

### Not-In-Context Handling
- Edit blocks for files not in selected files get status NOT_IN_CONTEXT (not attempted)
- Edit blocks for files in selected files are applied normally in the same response
- Create blocks (empty EDIT section) are always attempted regardless of context membership
- Auto-added files appear in the selected files list after application
- Mixed response: in-context edits applied, not-in-context edits deferred, both reported in results
- The files_auto_added field in streamComplete lists the auto-added file paths

### Ambiguous Match Retry
- Ambiguous match failures (multiple matches) auto-populate retry prompt in chat input
- Prompt lists each affected file path and match count
- Prompt instructs LLM to include more surrounding context lines for a unique match
- Prompt is not auto-sent — user reviews and sends manually
- Edit summary banner notes the prepared retry prompt
- Only ambiguous failures trigger this; anchor-not-found does not

### Edit Failure Retry
- Edit failures on in-context files (old text not found) may auto-populate retry prompt in chat input
- Prompt instructs LLM to re-read file content from context before retrying
- Prompt is not auto-sent — user reviews and sends manually
- The `old_text_mismatch` error type is no longer produced — all failures are `anchor_not_found` or `ambiguous_anchor`