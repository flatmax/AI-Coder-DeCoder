# Code Review Mode

## Overview

A review mode that leverages git's staging mechanism to present branch changes for AI-assisted code review. By performing a soft reset, all review changes appear as staged modifications — allowing the existing file picker, diff viewer, and context engine to work unchanged. The AI reviews code with full symbol map context, structural change analysis, and interactive conversation.

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
    ├─ Symbol map (current) = branch tip structure
    ├─ Symbol map (before) = pre-review structure
    │
    ├─ File picker shows staged files with S badges
    ├─ Diff viewer shows base vs reviewed (unchanged behavior)
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

Six git operations transform the repository into review state:

| Step | Command | Git HEAD | Index (Staged) | Disk Files |
|------|---------|----------|----------------|------------|
| 0. Start | — | branch tip (Z) | clean | branch tip |
| 1. Verify | `git status --porcelain` | Z | must be clean | branch tip |
| 2. Checkout branch | `git checkout {branch}` | Z | clean | branch tip |
| 3. Checkout parent | `git checkout {base}^` | base^ (detached) | clean | pre-review |
| 4. **Build symbol_map_before** | *(symbol index runs on disk)* | base^ | clean | pre-review |
| 5. Checkout branch | `git checkout {branch}` | Z | clean | branch tip |
| 6. Soft reset | `git reset --soft {base}^` | base^ | **all review changes staged** | branch tip |

After step 6, the repository is in the perfect review state:

| Aspect | State | Effect |
|--------|-------|--------|
| **Files on disk** | Branch tip content | User sees final reviewed code; symbol map reflects it |
| **Git HEAD** | Parent of base commit | `git diff --cached` shows ALL review changes |
| **Staged changes** | Everything being reviewed | File picker shows M/A/D badges naturally |
| **Working tree** | Clean (matches disk) | No unstaged changes to confuse the UI |

### Exit Sequence

Three operations restore the branch to its original state:

| Step | Command | Result |
|------|---------|--------|
| 1. Reset to tip | `git reset --soft {branch_tip}` | HEAD moves to original tip, staging clears |
| 2. Checkout branch | `git checkout {branch}` | Reattach HEAD to branch ref |
| 3. Rebuild symbol index | *(internal)* | Symbol map reflects restored state |

The repository is exactly as it was before review mode — all commits intact, clean working tree, HEAD at branch tip.

### Error Recovery

If any step in the entry sequence fails (e.g., checkout conflict, invalid commit):
1. Attempt to return to the original branch: `git checkout {branch}`
2. If that fails, attempt: `git checkout {original_head_sha}`
3. Report the error to the user with the current git state
4. Do not enter review mode

If the process crashes during review mode, the user can manually restore with:
```
git checkout {branch}
```
Since disk files already match the branch tip, this just reattaches HEAD.

## Prerequisites

### Clean Working Tree

Review mode requires a clean working tree — no staged, unstaged, or untracked changes. If the tree is dirty, the user is shown an error:

```
Cannot enter review mode: working tree has uncommitted changes.
Please commit, stash, or discard changes before starting a review.
```

### Dedicated Review Clone

The recommended workflow is to use a separate clone for reviews. This avoids disrupting active development work. The soft reset changes the git state in ways that would be confusing if the user also has uncommitted work.

## Commit Selection

### Branch Selection

A dropdown or searchable list of local branches. Remote branches that aren't checked out locally are shown but require a fetch + checkout first.

```pseudo
list_branches() -> {
    branches: [{name, sha, message, is_current, is_remote}],
    current: string
}
```

### Commit Selection

After selecting a branch, the user chooses the base commit — the **first commit to review**. Everything from this commit through the branch tip is included in the review.

Two input methods:

**Fuzzy search overlay** — Similar to the input history search pattern. Shows commits from the selected branch in reverse chronological order (newest first). Typing filters by message, SHA prefix, or author.

```
┌──────────────────────────────────────┐
│ 🔍 Select first commit to review... │
├──────────────────────────────────────┤
│ abc1234  Fix auth validation         │
│          matt · 3 days ago           │
│ def5678  Add rate limiting           │
│          matt · 4 days ago           │
│ ghi9012  Refactor db pool            │
│          alex · 1 week ago           │
│ jkl3456  Initial auth scaffold       │
│          matt · 2 weeks ago          │
└──────────────────────────────────────┘
```

**Direct SHA input** — A text field accepting a commit SHA (full or short). Validated before proceeding.

**Merge base shortcut** — A button or option to auto-detect the merge base with a target branch (typically `main`):
```
Review all commits since divergence from: [main ▾]
```
This calls `git merge-base main {branch}` and uses the result as the parent commit, reviewing everything unique to the branch.

### Commit Search

```pseudo
search_commits(query, branch?, limit?) -> [
    {sha, short_sha, message, author, date, files_changed?}
]
```

Searches by:
- Commit message substring (case-insensitive)
- SHA prefix match
- Author name

Limited to the selected branch's history by default.

## Review Context in LLM Messages

### Prompt Assembly

Review context is inserted as a dedicated section in the message array, between URL context and active files:

```
[L0: system prompt + legend + L0 symbols/files]
[L1, L2, L3 cached tiers]
[file tree]
[URL context]
[Review context]          ← NEW
[active files (Working Files)]
[active history]
[user prompt]
```

### Review Context Format

```
# Code Review Context

## Review: {branch} ({base_commit_short} → {head_short})
{commit_count} commits, {files_changed} files changed, +{additions} -{deletions}

## Commits
1. {sha_short} {message} ({author}, {relative_date})
2. {sha_short} {message} ({author}, {relative_date})
...

## Structural Changes (Symbol Diff)
+ path/to/new_file.py (new file)
    + class NewClass
    + f new_function() →calls_to
~ path/to/changed_file.py (modified)
    + f added_function()         ← new
    ~ f changed_function()       ← signature changed
    - f removed_function()       ← removed (was ←5 refs — check callers!)
- path/to/deleted_file.py       ← deleted (was ←3 refs)

## Selected File Diffs
### path/to/file.py (+120 -30)
```diff
@@ -10,6 +10,15 @@
 def existing_function():
-    old_code()
+    new_code()
```​

### path/to/other.py (+85 -0)
```diff
...
```​
```

### Context Tiering

| Content | Tier | Rationale |
|---------|------|-----------|
| Review summary (commits, stats) | Graduates to cached tiers | Doesn't change during review |
| Structural symbol diff | Graduates to cached tiers | Doesn't change during review |
| Individual file diffs | Active tier | User toggles which files are included |
| Full file contents | Normal tiering | Selected files follow standard stability rules |

### Token Budget

For large reviews, not all file diffs can fit in context. The system prioritizes:

1. **Files selected (checked) in the picker** — their diffs are always included
2. **High blast-radius files** — sorted by reference count from the symbol map
3. **Largest diffs last** — small changes are cheap to include; large rewrites may need to be reviewed individually

The review diff chips (see UI section) show which files have their diffs included, allowing the user to manage the token budget.

## Symbol Map Structural Diff

### Generation

The structural diff compares `symbol_map_before` (captured at step 4) against the current symbol map (built from disk at step 7):

1. Parse both symbol maps into per-file symbol sets
2. Classify files as added, removed, or modified
3. For modified files, diff the symbol lists:
   - Added symbols (present in current, absent in before)
   - Removed symbols (absent in current, present in before)  
   - Changed symbols (same name, different signature/parameters/return type)
4. Annotate removed symbols with their reference count from `symbol_map_before` — high ref counts indicate potential breakage

### Output Format

```
+ path/to/new_file.py (new file)
    + class NewValidator
    + f validate_email(email) ->bool
    + f validate_password(password) ->bool

~ path/to/handler.py (modified)
    + f validate_input(user, password) ->bool    ← new function
    ~ f authenticate(user, password, rate_limit?) ← added param
    - f _legacy_check(user) ->bool               ← removed (was ←3 refs)

~ path/to/connection.py (modified)
    - f retry_with_backoff(fn, max_retries) ->T  ← removed (was ←7 refs!)

- path/to/deprecated.py                          ← file deleted (was ←5 refs)
    - class OldHandler                            ← removed (was ←12 refs!)
    - f legacy_process(data) ->dict               ← removed (was ←3 refs)
```

Reference counts on removed symbols alert the reviewer to potentially breaking changes.

### Storage

- `symbol_map_before` is held in memory on the LLM service during the review session
- Not persisted to disk — rebuilt if needed by re-running the entry sequence
- The structural diff is computed once on review entry and cached

## UI Components

### Review Mode Banner

Displayed at the top of the file picker when review mode is active:

```
┌──────────────────────────────────┐
│ 📋 Reviewing: feature-auth      │
│ abc1234 → HEAD · 12 commits     │
│ 34 files · +1847 -423           │
│                      [Exit ✕]   │
└──────────────────────────────────┘
```

### Commit Selector

Appears when entering review mode. Located in the file picker panel area or as a modal overlay.

**Branch selector** — Dropdown with local branches, current branch pre-selected.

**Commit list** — Fuzzy-searchable list of commits on the selected branch. Each entry:
```
{short_sha}  {message}
             {author} · {relative_date}
```

**Merge base button** — "Since divergence from: [main ▾]" auto-fills the base commit.

**SHA input** — Text field for direct SHA entry.

**Start Review button** — Initiates the entry sequence. Shows progress:
```
Entering review mode...
  ✓ Verified clean working tree
  ✓ Checked out pre-review state
  ⟳ Building symbol map...
  ○ Setting up review state
```

### File Picker in Review Mode

The file picker operates unchanged — staged files appear with **S** badges, diff stats show additions/deletions. The filter, selection, context menu, and keyboard navigation all work as normal.

**Optional toggle**: "Show: Changed / All" to filter the tree to only files that changed in the review. Default: Changed only.

### Review Diff Chips

A chip bar displayed above the chat input (similar to URL chips), showing the active review and which file diffs are included in context:

```
┌───────────────────────────────────────────────────┐
│ 📋 Review: abc1234→HEAD · 12 commits · 34 files  │
│ [📄 handler.py ✓] [📄 models.py ✓]               │
│ [📄 connection.py ○]  +31 more                    │
│                                    [Clear Review] │
└───────────────────────────────────────────────────┘
```

| Element | Behavior |
|---------|----------|
| Summary line | Shows branch, commit range, totals |
| File chip (✓) | Diff included in LLM context; click to open in diff viewer |
| File chip (○) | Diff excluded; click to toggle inclusion |
| "+N more" | Expand to show all files |
| "Clear Review" | Exit review mode (with confirmation) |

Chips are synchronized with the file picker selection — checking a file in the picker also includes its diff in the review chips, and vice versa.

### Diff Viewer in Review Mode

The diff viewer operates unchanged. Since git HEAD is at the pre-review commit and disk files are at the branch tip:
- **Left side (original)**: file content from HEAD (pre-review state)
- **Right side (modified)**: file content from disk (reviewed code)
- This is the standard `git diff --cached` view

File tabs show review status badges: **NEW** for added files, **MOD** for modified, **DEL** for deleted.

### Review Snippets

When review mode is active, additional snippet buttons appear in the snippet drawer:

| Icon | Tooltip | Message |
|------|---------|---------|
| 🔍 | Full review | Review all changes in the review diff. Provide a structured summary with issues categorized by severity (critical, warning, suggestion, question). |
| 🔒 | Security review | Review the changes for security issues: input validation, authentication, authorization, injection attacks, error handling, secrets exposure, rate limiting. |
| 🚶 | Commit walkthrough | Walk through each commit in order, explaining the author's intent for each change and flagging any issues. |
| 🏗️ | Architecture review | Assess the structural changes: modularity, coupling, separation of concerns, design patterns, and how the changes fit the existing architecture. |
| ✅ | Test coverage | Evaluate test coverage of the changes. What functionality is tested? What edge cases are missing? Are the test assertions meaningful? |
| 📝 | PR description | Write a pull request description summarizing these changes, including: what changed, why, how to test, and any migration notes. |
| 🧹 | Code quality | Review for code quality: naming, duplication, complexity, error handling, documentation, and adherence to the codebase's existing patterns. |

These snippets supplement (not replace) the standard snippets. They are loaded when `get_review_state().active` is true.

## Backend

### Repo Methods

```pseudo
list_branches() -> {
    branches: [{name, sha, message, is_current}],
    current: string
}

get_current_branch() -> {
    branch: string,
    sha: string,
    detached: boolean
}

is_clean() -> boolean

search_commits(query, branch?, limit?) -> [
    {sha, short_sha, message, author, date}
]

get_commit_log(base, head?, limit?) -> [
    {sha, short_sha, message, author, date}
]

get_commit_parent(commit) -> {sha, short_sha} | {error}

get_merge_base(ref1, ref2?) -> {sha, short_sha} | {error}

enter_review_mode(branch, base_commit) -> {
    branch, branch_tip, base_commit, parent_commit,
    phase: "at_parent"
} | {error}

complete_review_setup(branch, parent_commit) -> {status: "review_ready"}

exit_review_mode(branch, branch_tip) -> {status: "restored"} | {error}
```

### LLM Service Methods

```pseudo
start_review(branch, base_commit) -> {
    status, branch, base_commit,
    commits: [{sha, message, author, date}],
    changed_files: [{path, status, additions, deletions}],
    symbol_diff: {added: [], removed: [], modified: []},
    stats: {commit_count, files_changed, additions, deletions}
} | {error}

end_review() -> {status: "restored"} | {error}

get_review_state() -> {
    active: boolean,
    branch?, base_commit?, commits?, changed_files?,
    symbol_diff?, stats?
}
```

### Review State

The LLM service holds review state in memory:

| Field | Type | Description |
|-------|------|-------------|
| `_review_active` | bool | Whether review mode is on |
| `_review_branch` | str | Branch being reviewed |
| `_review_branch_tip` | str | Original branch HEAD SHA (for restoration) |
| `_review_base_commit` | str | First commit in the review |
| `_review_parent` | str | Parent of base commit (current git HEAD) |
| `_review_commits` | list | Commit log |
| `_review_changed_files` | list | Changed file paths with status |
| `_review_symbol_diff` | dict | Structural symbol changes |
| `_symbol_map_before` | str | Symbol map from pre-review state |

State is not persisted across server restarts. On restart, the server detects the soft-reset state and prompts the user to either re-enter review mode or exit cleanly.

## Integration with Existing Systems

### File Picker

No changes needed. Staged files from the soft reset appear naturally with S badges and diff stats.

### Diff Viewer

No changes needed. HEAD (pre-review) vs disk (reviewed code) is the standard diff view for staged changes.

### Symbol Map

The current symbol map (built from disk files) reflects the reviewed codebase. The AI navigates it normally — tracing dependencies, assessing blast radius, finding related code.

### Cache Tiering

Review context (commit log, structural diff) can graduate to cached tiers since it doesn't change during the review. File diffs stay in the active tier as the user toggles them.

### History / Compaction

Review conversations use the standard history and compaction system. The review context is re-injected on each message (like URL context), so compaction of older messages doesn't lose it.

### Streaming Chat

The chat operates normally during review. The review context is additional content in the prompt assembly — no changes to the streaming, edit parsing, or completion flow.

Edit blocks proposed by the AI during review mode are **not applied** by default — review mode is for reading, not writing. A future enhancement could support suggested fixes that are applied on user confirmation.

## Limitations

### Single Review Session

Only one review can be active at a time. Starting a new review exits the current one first.

### No Concurrent Editing

Since git HEAD is at a different commit during review, committing new changes is not supported. The user should exit review mode before making commits.

### Root Commits

If the base commit is the first commit in the repository (has no parent), the pre-review state is an empty tree. The symbol_map_before will be empty, and all files appear as new additions.

### Large Reviews

Reviews with hundreds of changed files may exceed token budgets. The chip system allows the user to control which diffs are included. The AI can review files incrementally: "Review the next 5 files" or "Focus on the auth module changes."

### Branch Switching During Review

Not supported. The user must exit review mode before switching branches.

## Future Enhancements

### Review Annotations

The AI could produce structured annotations that map to specific files and line ranges, exportable as:
- GitHub PR review comments
- Markdown review report
- Inline code comments

### Suggested Fixes

Allow the AI to propose edit blocks during review that can be optionally applied — turning review feedback into actionable fixes.

### Review Checklists

Configurable review checklists (security, performance, style) that the AI evaluates systematically, producing a pass/fail report per criterion.

### Incremental Review

For ongoing reviews, track which files have been reviewed and which are pending. Allow the user to mark files as "reviewed" and focus the AI on remaining files.

### Cross-Branch Comparison

Compare two branches side by side — useful for evaluating alternative implementations.