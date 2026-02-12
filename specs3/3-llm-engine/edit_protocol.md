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