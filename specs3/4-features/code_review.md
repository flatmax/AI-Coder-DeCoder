# Code Review Mode

## Overview

A review mode that leverages git's staging mechanism to present branch changes for AI-assisted code review. By performing a soft reset, all review changes appear as staged modifications — allowing the existing file picker, diff viewer, and context engine to work unchanged.

## Architecture

```
User selects branch + base commit
    │
    ├─ Verify clean working tree
    ├─ Checkout parent of base commit
    ├─ Build symbol_map_before (pre-review structure)
    ├─ Checkout branch HEAD
    ├─ Soft reset to parent commit
    │
    ▼
Review Mode Active
    │
    ├─ Files on disk = branch tip (reviewed code)
    ├─ Git HEAD = parent commit (pre-review)
    ├─ Staged changes = all review modifications
    ├─ File picker shows staged files with S badges (unchanged)
    ├─ Diff viewer shows base vs reviewed (unchanged)
    ├─ AI gets review context + symbol structural diff
    │
    ▼
User clicks Exit Review
    │
    ├─ Soft reset to original branch tip
    ├─ Checkout branch (reattach HEAD)
    └─ Rebuild symbol index
```

## Git State Machine

### Entry Sequence

| Step | Command | Git HEAD | Index | Disk |
|------|---------|----------|-------|------|
| 0 | — | Z (branch tip) | clean | branch tip |
| 1 | `git status --porcelain` | Z | must be clean | branch tip |
| 2 | `git checkout {branch}` | Z | clean | branch tip |
| 3 | `git checkout {base}^` | base^ (detached) | clean | pre-review |
| 4 | *Build symbol_map_before* | base^ | clean | pre-review |
| 5 | `git checkout {branch}` | Z | clean | branch tip |
| 6 | `git reset --soft {base}^` | base^ | **all changes staged** | branch tip |

### Exit Sequence

| Step | Command | Result |
|------|---------|--------|
| 1 | `git reset --soft {branch_tip}` | HEAD to original tip |
| 2 | `git checkout {branch}` | Reattach HEAD |
| 3 | Rebuild symbol index | Restore symbol map |

### Error Recovery

If entry fails: attempt `git checkout {branch}`, then `git checkout {original_sha}`. If process crashes during review: `git checkout {branch}` restores everything (disk already matches tip).

## Prerequisites

Clean working tree required. Recommended: use a dedicated clone for reviews.

## Commit Selection

### Branch Selection

Searchable list of local branches. Remote branches shown but require fetch + checkout.

### Base Commit Selection

Two methods:
- **Fuzzy search** — commits in reverse chronological order, filterable by message/SHA/author
- **Direct SHA input** — text field with validation

**Merge base shortcut** — auto-detect divergence point: `git merge-base main {branch}`

## Review Context in LLM Messages

Inserted between URL context and active files in the message array (see [Prompt Assembly](../3-llm-engine/prompt_assembly.md)):

```
## Review: {branch} ({base_short} → {head_short})
{N} commits, {M} files changed, +{add} -{del}

## Commits
1. {sha} {message} ({author}, {date})
...

## Structural Changes (Symbol Diff)
+ path/new.py (new file)
    + class NewClass
~ path/changed.py (modified)
    + f added_function()
    ~ f changed_function()       ← signature changed
    - f removed_function()       ← removed (was ←5 refs!)
- path/deleted.py               ← deleted (was ←3 refs)

## Selected File Diffs
### path/file.py (+120 -30)
<diff content>
```

### Context Tiering

| Content | Tier |
|---------|------|
| Review summary, structural diff | Graduates to cached tiers |
| Individual file diffs | Active tier (user toggles inclusion) |
| Full file contents | Normal tiering |

## Symbol Map Structural Diff

Compares `symbol_map_before` against current symbol map:
1. Classify files as added/removed/modified
2. For modified files: diff symbol lists (added/removed/changed)
3. Annotate removed symbols with reference count from `symbol_map_before`

## Backend Methods

### Repo

| Method | Description |
|--------|-------------|
| `Repo.list_branches()` | Local branches with SHA, message, current flag |
| `Repo.is_clean()` | Clean working tree check |
| `Repo.search_commits(query, branch?, limit?)` | Search by message, SHA, author |
| `Repo.get_commit_log(base, head?)` | Commit range |
| `Repo.get_merge_base(ref1, ref2?)` | Merge base SHA |
| `Repo.enter_review_mode(branch, base)` | Steps 1-4 of entry |
| `Repo.complete_review_setup(branch, parent)` | Steps 5-6 |
| `Repo.exit_review_mode(branch, tip)` | Exit sequence |

### LLM

| Method | Description |
|--------|-------------|
| `LLM.start_review(branch, base)` | Full entry + context setup |
| `LLM.end_review()` | Exit + cleanup |
| `LLM.get_review_state()` | Current review state |

## UI Components

### Review Diff Chips

A chip bar displayed above the chat input (similar to URL chips), showing the active review and which file diffs are included in context:

```
📋 Review: abc1234→HEAD · 12 commits · 34 files
[📄 handler.py ✓] [📄 models.py ✓] [📄 connection.py ○]  +31 more
                                                    [Clear Review]
```

| Element | Behavior |
|---------|----------|
| Summary line | Branch, commit range, totals |
| File chip (✓) | Diff included in context; click to open in diff viewer |
| File chip (○) | Diff excluded; click to toggle inclusion |
| "+N more" | Expand to show all files |
| "Clear Review" | Exit review mode (with confirmation) |

Chips are synchronized with the file picker selection — checking a file in the picker also includes its diff.

### Review Banner

Displayed at the top of the file picker when review mode is active:

```
📋 Reviewing: feature-auth
abc1234 → HEAD · 12 commits
34 files · +1847 -423           [Exit ✕]
```

### Token Budget for Large Reviews

Not all file diffs can fit in context. The system prioritizes:

1. **Files selected (checked) in the picker** — diffs always included
2. **High blast-radius files** — sorted by reference count from symbol map
3. **Largest diffs last** — small changes are cheap; large rewrites may need individual review

## Review Snippets

When review mode is active, additional snippet buttons appear:

| Icon | Purpose |
|------|---------|
| 🔍 | Full review — structured summary with severity categories |
| 🔒 | Security review — input validation, auth, injection, secrets |
| 🚶 | Commit walkthrough — per-commit intent and issues |
| 🏗️ | Architecture review — modularity, coupling, design patterns |
| ✅ | Test coverage — coverage gaps, edge cases, assertion quality |
| 📝 | PR description — summary, motivation, testing notes |
| 🧹 | Code quality — naming, duplication, complexity, patterns |

These supplement (not replace) standard snippets. Loaded when `get_review_state().active` is true.

## Integration with Existing Systems

| System | Impact |
|--------|--------|
| **File Picker** | No changes — staged files from soft reset appear naturally with S badges |
| **Diff Viewer** | No changes — HEAD (pre-review) vs disk (reviewed code) is standard cached diff |
| **Symbol Map** | Current map reflects reviewed codebase; AI navigates normally |
| **Cache Tiering** | Review context graduates to cached tiers; file diffs stay active |
| **History / Compaction** | Standard system; review context re-injected each message |
| **Streaming Chat** | No changes; review context is additional prompt content |

## Notes

- Edit blocks proposed during review are **not applied** by default — review mode is for reading
- On restart, detect soft-reset state and prompt user to re-enter or exit review mode

## Future Enhancements

- **Review Annotations** — structured annotations exportable as GitHub PR comments or markdown reports
- **Suggested Fixes** — AI proposes edit blocks during review, optionally applied
- **Review Checklists** — configurable checklists (security, performance, style) with pass/fail per criterion
- **Incremental Review** — track reviewed vs pending files, focus AI on remaining files
- **Cross-Branch Comparison** — compare two branches side by side

## Limitations

- Single review session at a time
- No concurrent editing during review
- Root commits: empty pre-review state
- Large reviews: chip system controls included diffs
- No branch switching during review