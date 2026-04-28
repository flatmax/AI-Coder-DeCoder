# Edit Protocol

**Status:** stub

The LLM proposes file changes using a structured edit block format. Each block contains old text (exact copy from the file, searched as a contiguous block) and new text (its complete replacement). Blocks are parsed from the streaming response, validated against file content, and applied sequentially.

## Block Structure

Each edit block has four literal marker lines bracketing two content sections:

1. A line containing the file path (relative to repo root)
2. Start marker: `🟧🟧🟧 EDIT`
3. Old text — exact copy from the file (the anchor)
4. Separator marker: `🟨🟨🟨 REPL`
5. New text — the replacement content
6. End marker: `🟩🟩🟩 END`

### Delimiter Lines — Exact Form

Each delimiter appears on its own line with nothing else on that line:

- Start: `🟧🟧🟧 EDIT` — three orange squares (U+1F7E7), space, literal `EDIT`
- Separator: `🟨🟨🟨 REPL` — three yellow squares (U+1F7E8), space, literal `REPL`
- End: `🟩🟩🟩 END` — three green squares (U+1F7E9), space, literal `END`

The emoji prefix varies by marker role (orange/yellow/green = start/middle/end) so a block is visually distinguishable from prose at any zoom and any theme. The color sequence also makes malformed blocks (missing separator, missing end) obvious during review.

### Example

```
src/math.py
🟧🟧🟧 EDIT
def multiply(a, b):
    return a + b  # BUG
🟨🟨🟨 REPL
def multiply(a, b):
    return a * b
🟩🟩🟩 END
```

The LLM must reproduce the marker characters exactly — no ASCII substitutions, no added punctuation, no translation. Parsers match on the literal byte sequences.

## How Matching Works

- The entire old-text section is searched in the file as a contiguous block of lines
- When exactly one match is found, the new-text section replaces it completely
- Zero matches — fail (anchor not found)
- Multiple matches — fail (ambiguous anchor)
- More surrounding context lines should be included when disambiguation is needed

## Operations

- Modify — old text with context in old section, modified version in new section
- Insert after — context line(s) in old section, context plus new lines in new section
- Create file — empty old section, content only in new section
- Delete lines — lines to delete with context in old section, just context in new section
- Delete file — not via edit blocks; suggest shell command
- Rename file — not via edit blocks; suggest shell command

## Multiple Edits to the Same File

- Applied sequentially top to bottom
- After edit A, edit B's old text must match the file *after* A
- Adjacent or overlapping edits should be merged into one block
- Merge rules — overlapping, adjacent within a few lines, or having sequential dependencies

## Parsing State Machine

- Scanning — looking for a file path pattern
- Expect edit — file path found, waiting for start marker
- Reading old — accumulating old-text lines until separator
- Reading new — accumulating new-text lines until end marker
- Emit block on end marker

## File Path Detection

- Not a comment (doesn't start with common comment prefixes or triple backticks)
- Path with separators (slash or backslash)
- Filename with extension
- Dotfile without extension
- Known extensionless filenames (Makefile, Dockerfile, etc.)
- Path appears immediately before start marker, with blank lines causing state reset

## Frontend vs Backend Path Detection

- Each has its own file-path predicate — they are intentionally not identical
- Frontend is simpler (display-only); backend is authoritative
- Frontend may miss extensionless filenames like Makefile — block still applies correctly server-side

## Streaming Considerations

- Partially received blocks tracked across chunks
- Parser maintains state across chunks
- Only completed blocks are applied

## Validation

- File exists (for modifications, not creates)
- File is not binary (null byte check)
- Old text found exactly once in the file

## Failure Diagnostics

- Anchor not found — old text doesn't match any location
- Ambiguous anchor — old text matches multiple locations
- Whitespace mismatch — tabs vs spaces, trailing whitespace detected as a likely cause

## Application Modes

- Dry run — validate all blocks, report what would change, no writes
- Apply — write to disk, stage modified files in git

## Per-Block Results

Status values:

- Applied — written to disk
- Already applied — new content already present (idempotent)
- Validated — dry-run passed
- Failed — anchor not found or ambiguous
- Skipped — binary file or pre-condition failed
- Not in context — file not in active selection; edit deferred

Each result includes: file path, status, human-readable message, machine-readable error type.

## Error Type Classification

- Anchor not found
- Ambiguous anchor
- File not found
- Write error — validated but disk write failed
- Validation error — path traversal blocked, binary file

## Not-In-Context Edit Handling

- Separate edit blocks into in-context and not-in-context groups
- Apply in-context edits normally
- Mark not-in-context edits with special status, do not attempt application
- Auto-add not-in-context files to selected files list for next request
- Broadcast file change via the standard callback
- Include system note in completion result listing auto-added files

## Created File Handling

- Successful create blocks auto-add the new file to the selected files list
- Broadcast file change via the standard callback so the picker checkbox reflects the new selection
- The completion result lists created files separately from not-in-context auto-adds — the frontend distinguishes the two
- No retry prompt is generated for creates — the create already succeeded, there is nothing to retry
- Dry-run creates (validated but not written) do not auto-add — nothing was written to disk
- Failed creates (conflict with an existing file, write error) do not auto-add

## Auto-Populated Retry Prompts

- When not-in-context edits are detected, auto-populate chat textarea with retry prompt naming added files
- Prompt is not auto-sent — user reviews and sends when ready
- When ambiguous-anchor failures are detected, auto-populate prompt asking for more unique context
- When old-text-mismatch failures occur on in-context files, prompt asks the LLM to re-read the file content and retry
- Multiple retry prompts can collide — latter one overwrites earlier one in textarea (acceptable — user can edit)
- Created files do not generate a retry prompt — they auto-add to selection but the create already succeeded

## Why Not Auto-Retry

- Adds complexity (continuation streams, loop prevention, cost control)
- Removes user control over what is sent to the LLM
- User's natural follow-up provides context the LLM can use to improve the edit

## Detecting Context Membership

- A file is in context if it is in the current selected files list at the time edits are applied
- Files that exist on disk but are not selected are not in context — the LLM has only seen their index block

## Post-Application

- Modified files staged in git
- Symbol cache entries invalidated for modified files
- Doc index cache invalidated for modified doc files (and structure re-extracted immediately)
- File tree refreshed on client
- Results included in completion event

## Concurrent Invocation

The apply pipeline is safe to invoke concurrently for different edit-block batches. Per-file write serialization is provided by the repository layer's per-path mutex (see [repository.md](../1-foundation/repository.md#per-path-write-serialization)) — two concurrent batches targeting different files proceed in parallel; two targeting the same file serialize at the write step.

In single-agent operation, only one apply pipeline invocation runs at a time. The re-entrancy guarantee exists so a future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) can invoke the pipeline from N threads concurrently without refactoring. The anchor-based validation model already handles the failure case naturally — if two agents' edits target overlapping text, one succeeds and the other fails with an ambiguous-anchor or anchor-not-found diagnostic, which feeds into the assessment step.

## Review Mode Read-Only

- Review mode skips all edit application entirely
- Edit blocks still appear in the response for reference but are not applied to disk
- Applies to the whole streaming pipeline — the edit parser runs but the apply step is a no-op

## Partial Failure

- Edits applied sequentially — earlier successes remain on disk and staged
- No rollback
- Failed edit details visible in subsequent exchanges so the LLM can retry with corrected content

## Shell Command Detection

- Assistant responses scanned for shell commands for UI display
- Detected in fenced code blocks with `bash` / `shell` / `sh` language tags, lines prefixed with `$ `, or lines prefixed with `> ` (unless starting with common prose words)
- Returned as a list for display; not executed automatically

## Invariants

- An anchor that matches zero or multiple locations always fails; never silently applied
- Create blocks (empty old section) are always attempted regardless of context membership
- Successful create blocks always auto-add the new file to the selected files list
- Auto-added files from not-in-context modifies and from creates are tracked separately in the completion result; only not-in-context modifies drive retry prompts
- File modifications are confined to files within the repository root
- A failed edit never partially writes — the file is left unchanged
- Sequential edits on the same file preserve the order in which the LLM produced them
- The apply pipeline is safe to invoke concurrently for different edit-block batches; per-file writes serialize via the repository's per-path mutex