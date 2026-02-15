# Edit Protocol

## Overview

The LLM proposes file changes using a structured edit block format. Each block contains an **anchor** (context lines that uniquely locate the edit site) and **old/new** sections defining the replacement. Blocks are parsed from the streaming response, validated against file content, and applied sequentially.

## Edit Block Format

### Structure

```
path/to/file.ext
««« EDIT
[context lines]
[old lines to replace]
═══════ REPL
[context lines — identical to above]
[new lines]
»»» EDIT END
```

### How It Works

The block has two sections separated by `═══════ REPL`:

1. **EDIT section** (between `««« EDIT` and `═══════ REPL`): Contains the old text as it currently exists in the file
2. **REPL section** (between `═══════ REPL` and `»»» EDIT END`): Contains the new text to substitute

### The Common Prefix (Anchor)

The parser computes the **common prefix** — the leading lines that are identical in both sections. This prefix acts as an **anchor** to locate the edit position in the file. The remaining (non-common) lines are the actual old→new substitution.

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
- Common prefix (anchor): `def multiply(a, b):` — used to find the location
- Old (to remove): `    return a + b  # BUG`
- New (to insert): `    return a * b`

### Why Anchors Matter

The anchor must match **exactly one** location in the file. If the file has duplicate sections, more context lines are needed to disambiguate. Zero matches → fail. Multiple matches → fail (ambiguous).

## Operations

| Operation | Technique |
|-----------|-----------|
| Modify code | Anchor + old lines → new lines |
| Insert after | Single anchor line + new content in REPL |
| Create file | Empty EDIT section, content only in REPL |
| Delete lines | Include lines in EDIT, omit from REPL |
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

Applied **sequentially**, top to bottom. After edit A, edit B's anchor must match the file **after** A. Adjacent/overlapping edits should be **merged into one block**.

### Why Merging Matters

```
# WRONG — second edit fails because first changed the anchor

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

Recognized by: contains `/` or `\`, doesn't start with `#`/`//`/`*`/`-`/`>`, < 200 chars, immediately before `««« EDIT`.

### Streaming Considerations

During streaming, partially received blocks are tracked. The parser maintains state across chunks. Only completed blocks (with `»»» EDIT END`) are applied.

## Validation

1. **File exists?** — for modifications, not creates
2. **Not binary?** — null byte check in first 8KB
3. **Anchor found?** — common prefix must match exactly one location
4. **Old text matches?** — non-common lines match at anchored position

### Ambiguity Detection

- **Zero matches** → FAILED
- **Multiple matches** → FAILED (ambiguous)
- **Exactly one** → proceed to old-text verification

### Failure Diagnostics

- **Whitespace mismatch** — tabs vs spaces, trailing whitespace
- **Near match** — content with slight differences (reports closest line)
- **Not found** — anchor doesn't exist in file

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
| Failed | Anchor not found, ambiguous, or old text mismatch |
| Skipped | Binary file or pre-condition failed |
| Not In Context | File was not in the active context; edit deferred (see below) |

### Not-In-Context Edit Handling

When the LLM produces edit blocks for files that are not in the active file context (not selected in the file picker), the edits are **not attempted**. The LLM wrote these edits based on the symbol map alone, without seeing the full file content — anchors are likely wrong and edit quality is unreliable even if anchors happen to match.

Instead, the system:

1. **Separates edit blocks** into two groups: files currently in context vs files not in context
2. **Applies in-context edits normally** — these proceed through the standard validate/apply pipeline
3. **Marks not-in-context edits** with status `NOT_IN_CONTEXT` — distinct from `FAILED` to indicate a workflow issue rather than a matching error
4. **Auto-adds the files** to the selected files list so their full content will be in context for the next request
5. **Broadcasts the file change** via the `filesChanged` callback so the browser file picker updates
6. **Includes a system note** in the `streamComplete` result listing which files were auto-added and advising the user to send a follow-up message to retry the edits

The user then sends a follow-up (e.g., "please retry the edits for those files") and the LLM regenerates the edit blocks with full file content in context.

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
2. **Context in BOTH sections** identically
3. **Enough context** for unique match
4. **Exact match** — whitespace, blanks, comments matter
5. **No placeholders** (`...`, `// rest of code`)
6. **Verify anchor exists** by searching file first
7. **No file moves/renames/deletes** — ask user to run `git mv` or `git rm`

## Partial Failure

Edits applied sequentially — earlier successes remain on disk and staged in git. No rollback. Failed edit details (file path, error, diagnostics) visible to AI in subsequent exchanges for retry with corrected anchors.

## Ambiguous Anchor Retry Prompt

When one or more edits fail due to **ambiguous anchors** (the anchor text matched multiple locations in the file), the system auto-populates the chat input with a retry prompt — but does **not** auto-send it. The user reviews and sends when ready.

### Behavior

1. **Detection**: On `streamComplete`, the frontend inspects `edit_results` for entries with status `failed` and message containing `"Ambiguous anchor"`
2. **Prompt construction**: A retry prompt is composed listing each ambiguous failure with file path and error detail, instructing the LLM to use more unique context lines
3. **Auto-populate input**: The prompt text is placed into the chat textarea and auto-resized, but not sent
4. **User control**: The user can review, edit, or discard the prompt before sending. They may also add additional instructions or context

### Retry Prompt Template

```
Some edits failed due to ambiguous anchors (the context lines matched multiple locations in the file). Please retry these edits with more unique anchor context — include a distinctive preceding line (like a function name, class definition, or unique comment) to disambiguate:

- {file_path}: {error_message}
- {file_path}: {error_message}
```

### Why Not Auto-Send

Consistent with the not-in-context edit philosophy: the user maintains control over what is sent to the LLM. The user may want to provide additional guidance, select different files, or skip the retry entirely.

### Edit Summary Banner

When ambiguous anchor failures are present, the edit summary banner includes a note: *"A retry prompt has been prepared in the input below."* This draws attention to the auto-populated input without being intrusive.

## Testing

### Parsing
- Basic edit block extraction from prose text (file path, anchor, old/new lines)
- Create file (empty EDIT section)
- Insert after (anchor-only EDIT, new lines in REPL)
- Delete lines (lines in EDIT absent from REPL)
- Multiple blocks from one response
- Single filename without path separator recognized
- Comment-prefixed lines not treated as file paths

### Validation
- Valid edit passes (anchor found, old text matches)
- Anchor not found returns error
- Ambiguous match (multiple locations) returns error
- Create blocks always valid
- Whitespace mismatch diagnosed

### Application
- Basic replacement preserves surrounding content
- Create writes new file
- Insert adds line after anchor
- Failed apply returns original content unchanged
- Repo application writes to disk, status = APPLIED
- Create makes parent directories
- Dry run validates without writing (status = VALIDATED)
- Path escape (../) blocked (status = SKIPPED)
- Binary file skipped
- Missing file fails
- Multiple sequential edits to same file

### Not-In-Context Handling
- Edit blocks for files not in selected files get status NOT_IN_CONTEXT (not attempted)
- Edit blocks for files in selected files are applied normally in the same response
- Create blocks (empty EDIT section) are always attempted regardless of context membership
- Auto-added files appear in the selected files list after application
- Mixed response: in-context edits applied, not-in-context edits deferred, both reported in results
- The files_auto_added field in streamComplete lists the auto-added file paths

### Ambiguous Anchor Retry
- Ambiguous anchor failures (multiple matches) auto-populate retry prompt in chat input
- Prompt lists each affected file path and match count
- Prompt instructs LLM to include more distinctive context lines (function names, unique comments)
- Prompt is not auto-sent — user reviews and sends manually
- Edit summary banner notes the prepared retry prompt
- Only ambiguous failures trigger this; anchor-not-found and old-text-mismatch do not