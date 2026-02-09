# Edit Protocol

## Overview

The LLM proposes file changes using a structured edit block format. Each block contains an **anchor** (context lines that uniquely locate the edit site) and **old/new** sections defining the replacement. Edit blocks are parsed from the LLM's streaming response, validated against actual file content, and applied sequentially.

## Edit Block Format

### Structure

```
path/to/file.ext
<<<< EDIT
[context lines]
[old lines to replace]
==== REPLACE
[context lines — identical to above]
[new lines]
>>>> EDIT END
```

### How It Works

The block has two sections separated by `==== REPLACE`:

1. **EDIT section** (between `<<<< EDIT` and `==== REPLACE`): Contains the old text as it currently exists in the file
2. **REPLACE section** (between `==== REPLACE` and `>>>> EDIT END`): Contains the new text to substitute

### The Common Prefix (Anchor)

The parser computes the **common prefix** — the leading lines that are identical in both sections. This prefix acts as an **anchor** to locate the edit position in the file. The remaining (non-common) lines are the actual old→new substitution.

Example:

```
src/math.py
<<<< EDIT
def multiply(a, b):
    return a + b  # BUG
==== REPLACE
def multiply(a, b):
    return a * b
>>>> EDIT END
```

Here:
- Common prefix (anchor): `def multiply(a, b):` — used to find the location
- Old (to remove): `    return a + b  # BUG`
- New (to insert): `    return a * b`

### Why Anchors Matter

The anchor must match **exactly one** location in the file. If the file has duplicate sections, more context lines are needed to disambiguate. If the anchor matches zero locations, the edit fails. If it matches multiple, it fails as ambiguous.

## Operations

### Modify Existing Code

```
src/utils.py
<<<< EDIT
def process(data):
    result = data.strip()
    return result
==== REPLACE
def process(data):
    result = data.strip().lower()
    return result
>>>> EDIT END
```

### Insert After a Line

Use a single anchor line with the new content added below it:

```
src/utils.py
<<<< EDIT
import os
==== REPLACE
import os
import sys
>>>> EDIT END
```

### Create a New File

Empty EDIT section, content only in REPLACE:

```
src/new_module.py
<<<< EDIT
==== REPLACE
def hello():
    print("Hello, world!")
>>>> EDIT END
```

### Delete Lines

Include the lines to remove in EDIT, omit them from REPLACE:

```
src/utils.py
<<<< EDIT
import os
import deprecated_module
import sys
==== REPLACE
import os
import sys
>>>> EDIT END
```

### Delete a File

Not done via edit blocks. Suggest: `git rm path/to/file`

### Rename a File

Not done via edit blocks. Suggest: `git mv old_path new_path`

## Multiple Edits to the Same File

Multiple edit blocks can target the same file. They are applied **sequentially**, top to bottom. After edit A is applied, the file content changes. Edit B's anchor must match the file **after** edit A, not the original.

If two edits are close together or overlapping, they should be **merged into a single block** to avoid anchor-not-found failures.

### Wrong — Second Edit Fails

```
src/app.py
<<<< EDIT
def process():
    step_one()
==== REPLACE
def process():
    step_one_updated()
>>>> EDIT END
```

```
src/app.py
<<<< EDIT
    step_one()
    step_two()
==== REPLACE
    step_one()
    step_two_updated()
>>>> EDIT END
```

The second edit looks for `step_one()` but that line was already changed to `step_one_updated()`.

### Correct — Merged Into One Block

```
src/app.py
<<<< EDIT
def process():
    step_one()
    step_two()
==== REPLACE
def process():
    step_one_updated()
    step_two_updated()
>>>> EDIT END
```

### Merge Rules

Merge edits into a single block when they are:
- **Overlapping**: Share any lines
- **Adjacent**: Within 3 lines of each other
- **Sequential dependencies**: Edit B's anchor region is affected by edit A

## Parsing

### State Machine

The parser extracts edit blocks from free-form LLM text (which includes explanations, markdown, etc.):

| State | Trigger | Action |
|-------|---------|--------|
| SCANNING | Line matches a file path pattern | Record candidate path, move to EXPECT_EDIT |
| EXPECT_EDIT | `<<<< EDIT` on next non-blank line | Move to READING_OLD |
| EXPECT_EDIT | Anything else | Back to SCANNING |
| READING_OLD | `==== REPLACE` | Move to READING_NEW |
| READING_OLD | Any other line | Accumulate into old section |
| READING_NEW | `>>>> EDIT END` | Emit completed block, back to SCANNING |
| READING_NEW | Any other line | Accumulate into new section |

### File Path Detection

A candidate file path line is recognized by:
- Contains `/` or `\` (path separator)
- Does not start with common non-path prefixes (`#`, `//`, `*`, `-`, `>`)
- Is not excessively long (< 200 chars)
- Appears immediately before a `<<<< EDIT` marker

### Streaming Considerations

During streaming, partially received blocks are tracked:
- The parser maintains state across chunks
- Incomplete blocks render with an in-progress indicator in the UI
- Only completed blocks (with `>>>> EDIT END`) are applied

## Validation

Before applying, each block is validated:

1. **File exists?** — For modifications (not creates), the file must exist
2. **Not binary?** — Binary files are rejected (checked via null byte detection in first 8KB)
3. **Anchor found?** — The common prefix must match exactly one location in the file
4. **Old text matches?** — The old (non-common) lines must match at the anchored position

### Ambiguity Detection

- **Zero matches**: anchor text not found in file → FAILED
- **Multiple matches**: anchor text appears at more than one location → FAILED (ambiguous)
- **Exactly one match**: proceed to old-text verification

### Failure Diagnostics

When validation fails, the parser attempts to diagnose why:
- **Whitespace mismatch** — tabs vs spaces, trailing whitespace differences
- **Near match** — content exists with slight differences (reports line number of closest match)
- **Not found** — anchor text doesn't exist in the file at all

## Application

### Modes

| Mode | Behavior |
|------|----------|
| Dry run | Validate all blocks, report what would change, modify nothing |
| Apply | Write changes to disk, stage modified files in git |

### Per-Block Results

| Status | Meaning |
|--------|---------|
| Applied | Successfully written to disk |
| Validated | Dry-run passed, not written |
| Failed | Anchor not found, ambiguous match, or old text mismatch |
| Skipped | File is binary or other pre-condition failed |

### Post-Application

After successful edits:
1. Modified files are staged in git (`git add`)
2. Symbol cache entries for modified files are invalidated
3. File tree is refreshed on the client
4. Results are included in `streamComplete` for UI display

### Result Reporting

Each edit result includes:
- File path
- Status (applied/failed/skipped)
- Error message (if failed, with diagnostic details)
- Diff preview (old vs new lines, for UI display)

## Key Principles

1. **Raw output only** — Edit blocks are machine-parsed instructions, never wrapped in markdown code fences
2. **Copy-paste accuracy** — Old text must exactly match the file: whitespace, blank lines, comments all matter
3. **Sufficient context** — Include enough anchor lines to uniquely identify the location
4. **No placeholders** — Never use `...` or `// rest of code` to abbreviate
5. **Verify before editing** — Always read the file's current content before emitting an edit block
6. **One concept per block** — Keep edits focused; use multiple blocks for unrelated changes (but merge adjacent ones)

## Partial Failure Handling

When multiple edits are applied to a file and one fails:
- **Edits are applied sequentially** — earlier successful edits remain on disk and staged in git
- **No rollback** — partially applied state is preserved
- **Failure reporting** — `streamComplete` includes per-edit status with diagnostics (which edits succeeded, which failed with reasons)
- **Retry via AI** — the failed edit details (file path, error reason, diagnostic info) are visible to the AI in subsequent exchanges, allowing it to retry with corrected anchors against the now-modified file content
[context lines — identical anchor]
[new lines]
═══════ REPL
- **No merge editor** — the retry-via-AI approach is sufficient; the AI typically succeeds on the second attempt given the updated file state and failure diagnostics
═══════ REPL
[context lines — identical anchor]
[new lines]
