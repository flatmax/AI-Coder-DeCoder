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

- **During initial checkout (steps 1-3):** The repo module attempts `git checkout {branch}` to return to the original branch. If that fails, the error is reported as-is.
- **During setup completion (steps 5-6):** The LLM service calls the full exit sequence (`exit_review_mode`) which performs `git reset --soft {branch_tip}` followed by `git checkout {branch}`, restoring the branch to its original state.
- The error is reported to the user and review mode is not entered.

If the process crashes during review mode, the user can manually restore with:
```
git checkout {branch}
```
Since disk files already match the branch tip, this just reattaches HEAD.

## Prerequisites

### Clean Working Tree

Review mode requires a clean working tree — no staged or unstaged changes to tracked files. Untracked files are ignored since they won't conflict with checkout/reset operations and are common in any repo (`.ac-dc/`, editor configs, etc.). If the tree is dirty, the user is shown an error:

```
Cannot enter review mode: working tree has uncommitted changes.
Please commit, stash, or discard changes first
(git stash, git commit, or git checkout -- <file>).
```

### Dedicated Review Clone

The recommended workflow is to use a separate clone for reviews. This avoids disrupting active development work. The soft reset changes the git state in ways that would be confusing if the user also has uncommitted work.

## Commit Selection

### Branch Selection

A dropdown or searchable list of local branches.

```pseudo
list_branches() -> {
    branches: [{name, sha, message, is_current}],
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

**Direct SHA input** — The commit search input also accepts SHA prefixes. The `search_commits` backend method first tries `--grep` matching, then falls back to SHA prefix matching against the commit log.

**Merge base shortcut** — A button to auto-detect the merge base with a target branch (defaults to `main` or `master` if available, otherwise the first other branch):
```
Review all commits since divergence from: [main ▾]
```
This calls `git merge-base main {branch}` and uses the result as the parent commit, reviewing everything unique to the branch.

### Commit Search

```pseudo
search_commits(query, branch?, limit?) -> [
    {sha, short_sha, message, author, date}
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

## Review: {branch} ({parent_short} → {tip_short})
{commit_count} commits, {files_changed} files changed, +{additions} -{deletions}

## Commits
1. {sha_short} {message} ({author}, {relative_date})
2. {sha_short} {message} ({author}, {relative_date})
...

## Pre-Change Symbol Map
Symbol map from the parent commit (before the reviewed changes).
Compare against the current symbol map in the repository structure above.

<full symbol map from parent commit>

## Reverse Diffs (selected files)
These diffs show what would revert each file to the pre-review state.
The full current content is in the working files above.

### path/to/file.py (+120 -30)
```diff
@@ -10,6 +10,15 @@
 def existing_function():
+    old_code()
-    new_code()
```​

### path/to/other.py (+85 -0)
```diff
...
```​
```

### Context Tiering

Review context is re-injected on each message (like URL context), so it is always current with the user's file selection. The stability tracker handles tiering naturally:

| Content | Tier | Rationale |
|---------|------|-----------|
| Review summary (commits, stats) | Re-injected each message | Part of the review context block |
| Pre-change symbol map | Re-injected each message | Part of the review context block |
| Reverse diffs for selected files | Re-injected each message | Changes as user toggles file selection |
| Full file contents | Normal tiering | Selected files follow standard stability rules |

Since the review context block is rebuilt each message, compaction of older history messages doesn't lose review information.

### Token Budget

For large reviews, not all file diffs can fit in context. The system includes reverse diffs only for files the user has explicitly selected in the file picker. This gives the user direct control over the token budget:

1. **Selected files** — their full content is in the working files context, and their reverse diff is in the review context section
2. **Unselected files** — contribute neither content nor diffs
3. **Incremental review** — the user can review files in batches: "Review the auth module files" → select those files → send → deselect → select the next batch

The review status bar shows "N/M diffs in context" so the user always knows how many changed files are currently included.

## Pre-Change Symbol Map

On review entry the service captures `symbol_map_before` (the full symbol map built from the parent commit). This is injected into the review context so the LLM can compare the pre-change codebase topology against the current (post-change) symbol map that is already part of every request.

Having both maps lets the LLM assess blast radius, trace removed dependencies, and understand the structural evolution — much richer than a flat symbol diff summary.

### Storage

- `symbol_map_before` is held in memory on the LLM service during the review session
- Not persisted to disk — rebuilt if needed by re-running the entry sequence

## Reverse Diffs for Selected Files

When a file is selected (checked in the file picker) during review mode, its full current content is included in the working files context as usual. Additionally, a **reverse diff** (`git diff --cached -R`) is included in the review context section. This gives the LLM complete information: the current code plus exactly what it replaced.

Files that are not selected contribute neither content nor diffs — the user controls context size through file selection.

### File Selection Flow

The typical review workflow uses file mentions as the primary interaction:

1. User sends a review prompt (e.g., "Review the auth changes")
2. LLM responds, mentioning relevant files by name
3. File mentions appear as clickable links in the chat message
4. User clicks a file mention → file is toggled in the picker → its full content and reverse diff are included in subsequent messages
5. The review status bar updates to show "N/M diffs in context"
6. User can also directly check/uncheck files in the file picker

This leverages the existing file mention detection and click-to-select infrastructure — no review-specific file UI is needed.

## UI Components

### Review Mode Banner

Displayed at the top of the file picker when review mode is active. Shows the branch name, commit range, and an exit button:

```
┌──────────────────────────────────┐
│ 📋 Reviewing: feature-auth      │
│ abc1234 → HEAD · 12 commits     │
│ 34 files · +1847 -423           │
│                      [Exit ✕]   │
└──────────────────────────────────┘
```

The banner is rendered by the file picker component and synchronized with the review state from `get_review_state()`.

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
  ⟳ Building symbol maps & setting up review
```

### File Picker in Review Mode

The file picker operates unchanged — staged files appear with **S** badges, diff stats show additions/deletions. The filter, selection, context menu, and keyboard navigation all work as normal.

### Review Status Bar

A slim status bar displayed above the chat input showing the active review summary and diff inclusion count:

```
┌────────────────────────────────────────────────────────────────┐
│ 📋  feature-auth  12 commits · 34 files · +1847 −423          │
│                              3/34 diffs in context [Exit Review]│
└────────────────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---------|----------|
| Branch name | Shows which branch is under review |
| Stats | Commit count, files changed, additions/deletions |
| Diff count | "N/M diffs in context" — how many selected files overlap with changed files |
| Prompt text | When no files selected: "Select files to include diffs" |
| "Exit Review" | Exit review mode and restore branch |

### File Selection for Review Diffs

Review mode does **not** use a separate chip-per-file UI for toggling diffs. Instead, it uses the standard file selection mechanisms:

1. **File picker** — User checks files in the tree as usual. Staged review files appear with **S** badges.
2. **File mentions** — The LLM mentions files in its responses; clicking a mention toggles the file's selection in the picker.
3. **Automatic diff inclusion** — Any selected file that is also in the review's changed file list automatically has its reverse diff included in the review context sent to the LLM.

This approach avoids duplicating the file picker's functionality and scales naturally to large reviews — the user selects only the files they want the LLM to focus on, and the review status bar shows the count of diffs currently in context.

### Diff Viewer in Review Mode

The diff viewer operates unchanged. Since git HEAD is at the pre-review commit and disk files are at the branch tip:
- **Left side (original)**: file content from HEAD (pre-review state)
- **Right side (modified)**: file content from disk (reviewed code)
- This is the standard `git diff --cached` view

File tabs show review status badges: **NEW** for added files, **MOD** for modified, **DEL** for deleted.

### Review Snippets

When review mode is active, additional snippet buttons can appear in the snippet drawer. These are loaded from the `review_snippets` array in the snippets configuration file (repo-local `.ac-dc/snippets.json` or the global `snippets.json`). No default review snippets are included — users configure them for their workflow.

Example `snippets.json` with review snippets:

```json
{
  "snippets": [ ... ],
  "review_snippets": [
    {"icon": "🔍", "tooltip": "Full review", "message": "Review all changes in the review diff. Provide a structured summary with issues categorized by severity (critical, warning, suggestion, question)."},
    {"icon": "🔒", "tooltip": "Security review", "message": "Review the changes for security issues: input validation, authentication, authorization, injection attacks, error handling, secrets exposure, rate limiting."},
    {"icon": "🚶", "tooltip": "Commit walkthrough", "message": "Walk through each commit in order, explaining the author's intent for each change and flagging any issues."},
    {"icon": "🏗️", "tooltip": "Architecture review", "message": "Assess the structural changes: modularity, coupling, separation of concerns, design patterns, and how the changes fit the existing architecture."},
    {"icon": "✅", "tooltip": "Test coverage", "message": "Evaluate test coverage of the changes. What functionality is tested? What edge cases are missing? Are the test assertions meaningful?"},
    {"icon": "📝", "tooltip": "PR description", "message": "Write a pull request description summarizing these changes, including: what changed, why, how to test, and any migration notes."},
    {"icon": "🧹", "tooltip": "Code quality", "message": "Review for code quality: naming, duplication, complexity, error handling, documentation, and adherence to the codebase's existing patterns."}
  ]
}
```

These snippets supplement (not replace) the standard snippets. They are merged into the snippet drawer when `get_review_state().active` is true.

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
    stats: {commit_count, files_changed, additions, deletions},
    symbol_diff: {added, removed, modified, text}
} | {error}

end_review() -> {status: "restored"} | {error}

get_review_state() -> {
    active: boolean,
    branch?, base_commit?, branch_tip?, commits?, changed_files?,
    stats?,
    stale_review?: {branch, branch_tip, detached_at}
}

recover_from_stale_review() -> {status: "restored"} | {error}

get_review_file_diff(path) -> {path, diff}

get_reverse_review_file_diff(path) -> string
    # Used internally by _format_review_context for reverse diffs
    # (git diff --cached -R -- path)
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
| `_review_stats` | dict | Aggregate stats (commit count, files, additions, deletions) |
| `_symbol_map_before` | str | Symbol map from pre-review state |
| `_stale_review` | dict or None | Detected stale review state from previous session (branch, branch_tip, detached_at) |

State is not persisted across server restarts. On restart, the server detects the soft-reset state (HEAD detached) and identifies the review branch by iterating local branches and finding one with commits ahead of the current HEAD via `get_commit_log(current_sha, branch_name)`. The frontend auto-recovers on load by calling `recover_from_stale_review()`, which restores the branch via the standard exit sequence and rebuilds the symbol index. If recovery fails, the user is shown an error toast. If HEAD is detached but no candidate branch is found (e.g. intentional detach), no stale review is reported.

```pseudo
_detect_stale_review() -> {branch, branch_tip, detached_at} | null

recover_from_stale_review() -> {status: "restored"} | {error}
```

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

Edit blocks proposed by the AI during review mode are **not applied** — review mode is read-only. The edit blocks still appear in the response for reference, but `apply_edits_to_repo` is skipped. Commit generation is also blocked during review mode.

A future enhancement could support suggested fixes that are applied on user confirmation.

### Symbol Diff

On review entry, `start_review` computes a structural symbol diff by comparing `symbol_map_before` against the current symbol index. The result is returned to the frontend as `symbol_diff`:

```pseudo
symbol_diff: {
    added: [{path, status: "added", symbols: [{name, kind, signature, action}]}],
    removed: [{path, status: "deleted", ref_count}],
    modified: [{path, status: "modified", changes: [{signature, action}]}],
    text: string  // human-readable summary for display
}
```

This gives the UI a structured overview of what changed architecturally, while the LLM gets both full symbol maps to reason about changes in context.

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