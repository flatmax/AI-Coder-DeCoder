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

Six operations transform the repository into review state. The branch may be a local branch (e.g. `feature-auth`) or a remote tracking ref (e.g. `origin/feature-auth`). Both work — remote refs already have commits locally from fetch.

| Step | Command | Git HEAD | Index (Staged) | Disk Files |
|------|---------|----------|----------------|------------|
| 0. Start | — | branch tip (Z) | clean | branch tip |
| 1. Verify | `git status --porcelain -uno` | Z | must be clean | branch tip |
| 2. Checkout branch | `git checkout {branch}` | Z | clean | branch tip |
| 3. Checkout parent | `git checkout {base}^` | base^ (detached) | clean | pre-review |
| 4. **Build symbol_map_before** | *(symbol index runs on disk)* | base^ | clean | pre-review |
| 5. Checkout branch tip | `git checkout {branch_tip_sha}` | Z (detached) | clean | branch tip |
| 6. Soft reset | `git reset --soft {base}^` | base^ (detached) | **all review changes staged** | branch tip |
| 7. Clear file selection | *(internal)* | — | — | — |

Step 5 checks out the branch tip by SHA (not by name). This handles both local and remote refs uniformly — remote refs like `origin/foo` would leave HEAD detached at the ref pointer rather than at the actual tip commit.

Step 7 clears the selected files list so review starts with a clean slate — this prevents stale file selections from before the review from inadvertently including all diffs in the first message.

After step 6, the repository is in the perfect review state:

| Aspect | State | Effect |
|--------|-------|--------|
| **Files on disk** | Branch tip content | User sees final reviewed code; symbol map reflects it |
| **Git HEAD** | Parent of base commit (detached) | `git diff --cached` shows ALL review changes |
| **Staged changes** | Everything being reviewed | File picker shows M/A/D badges naturally |
| **Working tree** | Clean (matches disk) | No unstaged changes to confuse the UI |

### Exit Sequence

Three operations restore the repository, followed by an internal rebuild:

| Step | Command | Result |
|------|---------|--------|
| 1. Reset to tip | `git reset --soft {branch_tip_sha}` | HEAD moves to original tip SHA, staging clears |
| 2. Checkout original branch | `git checkout {original_branch}` | HEAD reattaches to the branch the user was on before review |
| 3. Rebuild symbol index | *(internal)* | Symbol map reflects restored state |

The original branch (the branch HEAD was on when review started) is recorded on entry. On exit, the system checks out that branch to restore the user's pre-review state. If the checkout fails (e.g., the branch was deleted), HEAD remains detached at the branch tip SHA and the user is informed.

### Error Recovery

If any step in the entry sequence fails (e.g., checkout conflict, invalid commit):

- **During initial checkout (steps 1-3):** The repo module attempts `git checkout {original_branch}` to return to the branch the user was on before review. If that fails, the error is reported as-is.
- **During setup completion (steps 5-6):** The LLM service calls the exit sequence (`exit_review_mode`) which performs `git reset --soft {branch_tip_sha}` and `git checkout {original_branch}`, restoring the repository state.
- The error is reported to the user and review mode is not entered.

If the process crashes during review mode, the user can manually restore with:
```
git checkout {original_branch}
```
Or if that fails:
```
git reset --soft {branch_tip_sha}
git checkout {original_branch}
```
Since disk files already match the branch tip, `reset --soft` just moves HEAD and clears staging, then checkout reattaches HEAD to the original branch.

## Prerequisites

### Clean Working Tree

Review mode requires a clean working tree — no staged or unstaged changes to tracked files. The check uses `git status --porcelain -uno` (the `-uno` flag ignores untracked files). Untracked files are ignored since they won't conflict with checkout/reset operations and are common in any repo (`.ac-dc/`, editor configs, etc.). If the tree is dirty, the user is shown an error:

```
Cannot enter review mode: working tree has uncommitted changes.
Please commit, stash, or discard changes first
(git stash, git commit, or git checkout -- <file>).
```

### Dedicated Review Clone

The recommended workflow is to use a separate clone for reviews. This avoids disrupting active development work. The soft reset changes the git state in ways that would be confusing if the user also has uncommitted work.

## Commit Selection via Git Graph

### Overview

The review selector presents an interactive git graph showing all branches and their commits. The user clicks a commit node to select it as the base commit for review. The system infers which branch the commit belongs to and presents the review summary. A single **Start Review** button initiates the review.

This replaces the previous two-step flow (branch dropdown → commit search) with a single visual interaction.

### Git Graph Display

The graph renders as an SVG within a scrollable container. Each branch occupies a stable vertical lane (column) throughout the graph — branches do not shift lanes as the user scrolls. This keeps the visual layout cognitively simple: a branch is always in the same column.

```
┌─────────────────────────────────────────────────────┐
│ ● main  ● feature-auth  ● fix-parsing  [⊙ remotes] │  ← frozen branch legend
├─────────────────────────────────────────────────────┤
│  ●─────── abc123  Fix validation (matt, 2h ago)     │
│  │  ●──── def456  Add rate limiting (matt, 1d ago)  │
│  │  │                                               │
│  │  ●──── ghi789  Auth middleware (matt, 2d ago)    │
│  │ /                                                │
│  ●─────── jkl012  Merge main (alex, 3d ago)         │  ← scrollable graph area
│  │  ●──── mno345  Refactor pool (alex, 4d ago)      │
│  │  │                                               │
│  ●─────── pqr678  Release 2.1 (alex, 5d ago)        │
│  │                                                  │
│  ...                                    [loading]   │
└─────────────────────────────────────────────────────┘
```

#### Lane Assignment

Each branch tip is assigned a lane (column index). Commits follow their first parent downward in the same lane. Second parents (merge commits) are drawn as connecting arcs/lines to the source lane. This keeps the common case — linear feature branches with occasional merges — clean and readable.

Lane assignment rules:
1. Each branch tip starts a lane, ordered by most recent commit date (leftmost = most recently active)
2. A commit stays in the lane of the branch tip it is reachable from via first-parent traversal
3. Merge commits show a connecting line from the second parent's lane to the merge point
4. When a branch's history joins another branch (the fork point), the lane ends

#### Commit Nodes

Each commit node shows:
- **Colored circle** matching its branch color
- **Short SHA** (7 characters)
- **Commit message** (first line, truncated to fit)
- **Author and relative date** (e.g., "matt · 2 days ago")

Branch tip commits additionally show the branch name as a label badge next to the node.

#### Lazy Loading

The graph loads an initial batch of commits (default: 100) and fetches more as the user scrolls toward the bottom. A loading indicator appears during fetch. The backend supports offset-based pagination via `get_commit_graph(limit, offset)`.

### Branch Legend (Frozen Header)

A fixed header above the scrollable graph area shows all branches as colored chips. The legend does not scroll — it remains visible regardless of graph scroll position.

```
● main  ● feature-auth  ● fix-parsing  [⊙ remotes]
```

Legend features:
- **Branch chips** are colored to match their lane in the graph
- **Ordered by most recent commit** — actively worked branches appear first
- **Toggleable for filtering** — clicking a branch chip toggles its visibility in the graph. Dimmed chips are hidden branches. This helps with noisy repos that have many branches.
- **Remote toggle** — a button to include/exclude remote tracking branches (default: local only). When enabled, remote branches appear in the legend and graph with a distinct visual style (e.g., dashed lane lines).

### Disambiguation

A commit can be reachable from multiple branches (e.g., a commit on `main` before a feature branch forked). When the user clicks such a commit:

1. The system identifies all branches whose tips are descendants of the selected commit
2. If only one branch → no ambiguity, proceed directly
3. If multiple branches:
   - A small dropdown/popover appears at the selected commit node listing the candidate branches
   - The branch whose tip is closest to the selected commit (fewest commits between selection and tip) is pre-selected
   - The user selects a branch from the dropdown to confirm
   - Clicking outside the dropdown cancels the selection

This is usually resolved instantly — the closest-tip heuristic is correct in the vast majority of cases, and the user just confirms with a click.

### Clean Working Tree Check

When the review selector opens, it immediately checks `is_clean()` before rendering the graph. If the working tree has uncommitted changes, the graph is not shown. Instead, an inline message is displayed:

```
┌─────────────────────────────────────────────────────┐
│ ⚠ Working tree has uncommitted changes              │
│                                                     │
│ Cannot start a review with pending changes.         │
│ Please commit, stash, or discard changes first:     │
│                                                     │
│   git stash                                         │
│   git commit -am "wip"                              │
│   git checkout -- <file>                            │
│                                                     │
│                                           [Close]   │
└─────────────────────────────────────────────────────┘
```

This prevents the user from making selections that will fail at `start_review` time.

### Selection and Review Summary

When a commit is selected (and branch disambiguated if needed), the area below the graph shows the review summary:

```
┌─────────────────────────────────────────────────────┐
│ 📋 Review: feature-auth                             │
│ abc1234 → def5678 (HEAD) · 12 commits               │
│                                                     │
│                                    [Start Review]   │
└─────────────────────────────────────────────────────┘
```

The **Start Review** button calls `start_review(branch, base_commit)` — the same API as before.

### Backend: Commit Graph Data

```pseudo
get_commit_graph(limit?, offset?) -> {
    commits: [
        {
            sha: string,
            short_sha: string,
            message: string,
            author: string,
            date: string,          # ISO timestamp
            relative_date: string, # "2 days ago"
            parents: [string],     # parent SHA(s)
        }
    ],
    branches: [
        {
            name: string,
            sha: string,           # tip commit SHA
            is_current: boolean,
            is_remote: boolean,
        }
    ],
    has_more: boolean              # whether more commits exist beyond this batch
}
```

Implementation: runs `git log --all --topo-order --parents --format=...` with pagination via `--skip` and `--max-count`. Branch data comes from `git branch [-a] --sort=-committerdate --format=...` (with `-a` when remote branches are included). Both are fast operations — milliseconds even on large repositories.

The backend post-filters branch results to remove:
- Symbolic refs: `HEAD`, `origin/HEAD`, entries containing ` -> `
- Bare remote aliases: a name like `origin` that is a prefix of other branch names (e.g. `origin/master`) is a remote alias, not a real branch. Filtered by checking if any other branch name starts with `name + "/"`, excluding the current branch.

The frontend computes lane assignment entirely client-side from the parent relationships and branch tip positions. No layout computation happens on the backend.

#### Lane Assignment Algorithm

Lane assignment follows these rules:

1. **Branch sorting**: Current branch first, then local branches, then remote branches. Within each group, committer-date order from the backend (most recent first) is preserved.
2. **Lane dedup**: Branches sharing the same tip SHA share a lane. Remote branches whose local counterpart exists (e.g. `origin/master` when `master` exists) share the local branch's lane.
3. **First-parent walk**: Starting from each branch tip in sorted order, follow first-parent links. Each commit is assigned to the branch's lane until a commit already claimed by another branch is reached — this is the fork point.
4. **Fork edges**: At each fork point, a diagonal/curved SVG path connects the child branch's lane to the parent branch's lane.
5. **Merge lines**: Merge commits (with multiple parents) draw dashed lines from the merge node to the second parent's lane.
6. **Lane ranges**: Each lane draws a continuous vertical line from its tip row to its fork row. Merge parents extend the target lane's range upward so the merge line connects visually.

This ensures the current/main branch claims the deepest history before feature branches, producing correct fork points.

## System Prompt Swap

When review mode is entered, the system prompt is swapped from the standard coding agent prompt (`system.md`) to a dedicated review system prompt (`review.md`). This gives the LLM review-specific instructions: how to read reverse diffs, severity categories, review methodology, and appropriate tone.

| Mode | System Prompt |
|------|--------------|
| Normal | `system.md` + `system_extra.md` (coding agent) |
| Review | `review.md` + `system_extra.md` (code reviewer) |

The swap happens at `start_review` time via `ContextManager.set_system_prompt()`. On `end_review`, the original system prompt is restored. The `system_extra.md` file is always appended — it contains user customizations that apply to both modes.

The original system prompt is saved on the LLM service so it can be restored on exit. If the server crashes during review, the next restart loads the standard prompt (review state is not persisted).

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

Files that are not selected contribute neither content nor diffs — the user controls context size through file selection. Deleted files (which no longer exist on disk) are excluded from reverse diffs even if selected, since there is no current content to review against.

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

### Git Graph Selector

Appears when entering review mode. Renders as a **floating resizable dialog** overlaying the main UI — the file picker and chat panel remain visible underneath. The dialog can be repositioned by dragging its header and resized from edges/corners (min 400×300px). A close button dismisses it without starting a review.

The component has three visual zones stacked vertically:

**1. Frozen branch legend** — A fixed header bar showing colored branch chips. Stays visible during graph scrolling. Chips are toggleable to filter branches. Includes a remote branches toggle button. Used for disambiguation when a selected commit belongs to multiple branches.

**2. Scrollable git graph** — An SVG-rendered commit graph with stable lane columns. Each branch keeps its lane throughout the visible history. Commit nodes are clickable — clicking selects that commit as the review base. The selected commit gets a highlight ring. Lazy-loads more commits on scroll-to-bottom.

**3. Review info / action bar** — A fixed footer area showing:
- Before selection: "Click a commit to select the review starting point"
- After selection: branch name, commit range, commit count, and a **Start Review** button
- During review entry: progress indicator ("Entering review mode... ⟳ Building symbol maps & setting up review")
- If working tree is dirty: warning message with remediation commands (graph is not rendered)

```
┌─────────────────────────────────────────────────────┐
│ ● main  ● feature-auth  ● fix-parsing  [⊙ remotes] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ●─── abc123  Fix validation (matt, 2h ago)         │
│  │ ●─ def456  Add rate limiting (matt, 1d ago)      │
│  │ │                                                │
│  │ ●─ [ghi789] Auth middleware (matt, 2d ago)  ← ●  │
│  │/                                                 │
│  ●─── jkl012  Merge main (alex, 3d ago)             │
│  ...                                                │
│                                                     │
├─────────────────────────────────────────────────────┤
│ 📋 Review: feature-auth                             │
│ ghi789 → def456 (HEAD) · 2 commits                  │
│                                    [Start Review]   │
└─────────────────────────────────────────────────────┘
```

#### Graph Rendering Details

The graph is rendered as an inline SVG within a LitElement component. Layout is computed client-side from the commit parent relationships:

- **Lanes**: Each branch tip is assigned a column index, ordered by most recent commit date. Commits follow first-parent links downward within the same lane.
- **Merge lines**: Second-parent edges are drawn as curved or angled SVG paths connecting to the source lane.
- **Colors**: Each lane gets a color from a predefined palette. The same color is used for the lane's line, commit nodes, and the corresponding legend chip.
- **Interaction**: Commit nodes have hover states (enlarged, tooltip with full message) and click handlers for selection.
- **Scroll loading**: An IntersectionObserver on a sentinel element near the bottom triggers fetching the next batch of commits.

No external graph rendering libraries are used — the layout and SVG generation are implemented directly in the component.

#### Dialog Behavior

The review selector renders as a floating dialog with:

- **Draggable header**: "📋 Code Review" title with close (✕) button. Drag to reposition.
- **Resizable**: All edges and corners. Minimum size 400×300px. No maximum — can fill the viewport.
- **Default position**: Centered in the viewport, 60% width, 70% height.
- **Z-index**: Above the dialog and diff viewer (z-index: 500) so it floats over the main UI.
- **Backdrop**: Semi-transparent overlay behind the dialog. Clicking the backdrop closes the dialog.
- **Close behavior**: Close button or backdrop click hides the dialog without starting a review. Escape key also closes.
- **Persistence**: Position and size are NOT persisted — dialog resets to default centered position each time it opens.

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

When review mode is active, the snippet drawer shows **review-specific snippets** instead of the standard coding snippets. This is a full replacement, not a merge — the review workflow needs different quick actions than the coding workflow.

Review snippets are loaded from a dedicated config file (`review-snippets.json`) using the same format as the standard `snippets.json`. The two-location fallback applies: repo-local `.ac-dc/review-snippets.json` first, then the app config directory.

```json
{
  "snippets": [
    {"icon": "🔍", "tooltip": "Full review", "message": "Review all changes..."},
    {"icon": "🔒", "tooltip": "Security review", "message": "Review for security issues..."},
    {"icon": "🚶", "tooltip": "Commit walkthrough", "message": "Walk through each commit..."}
  ]
}
```

The `get_snippets()` RPC method checks `get_review_state().active` and returns review snippets when in review mode, standard snippets otherwise. The frontend does not need to distinguish — it always calls `get_snippets()` and renders whatever is returned.

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
    # Uses git status --porcelain -uno (ignores untracked files)

resolve_ref(ref) -> string | null
    # Resolve a git ref (branch name, tag, SHA prefix) to a full SHA

get_commit_graph(limit?, offset?, include_remote?) -> {
    commits: [
        {sha, short_sha, message, author, date, relative_date, parents: [sha]}
    ],
    branches: [
        {name, sha, is_current, is_remote}
    ],
    has_more: boolean
}
    # Branches are post-filtered to remove symbolic refs (HEAD, origin/HEAD),
    # pointer entries (->), and bare remote aliases (e.g. "origin")

get_commit_log(base, head?, limit?) -> [
    {sha, short_sha, message, author, date}
]

get_commit_parent(commit) -> {sha, short_sha} | {error}

get_merge_base(ref1, ref2?) -> {sha, short_sha} | {error}

checkout_review_parent(branch, base_commit) -> {
    branch, branch_tip, base_commit, parent_commit,
    original_branch,
    phase: "at_parent"
} | {error}
    # branch can be local ("feature-auth") or remote ("origin/feature-auth")
    # original_branch is the branch HEAD was on before review (for restoration)

setup_review_soft_reset(branch_tip, parent_commit) -> {status: "review_ready"}
    # Checks out branch_tip by SHA (not name) for remote ref compatibility
    # Then soft resets to parent_commit

exit_review_mode(branch_tip, original_branch) -> {status: "restored"} | {error}
    # Resets to branch_tip SHA, then checks out original_branch
    # If checkout fails, HEAD remains detached and error is reported
```

### LLM Service Methods

```pseudo
get_commit_graph(limit?, offset?, include_remote?) -> {
    commits: [{sha, short_sha, message, author, date, relative_date, parents}],
    branches: [{name, sha, is_current, is_remote}],
    has_more: boolean
}
    # Delegates to repo.get_commit_graph(). Called by the review selector
    # to populate the git graph UI. Pagination via offset for lazy loading.

check_review_ready() -> {clean: true} | {clean: false, message: string}
    # Checks is_clean() and returns a user-friendly message if the working
    # tree has uncommitted changes. Called when the review selector opens,
    # before rendering the graph.

start_review(branch, base_commit) -> {
    status: "review_active", branch, base_commit,
    commits: [{sha, short_sha, message, author, date}],
    changed_files: [{path, status, additions, deletions}],
    stats: {commit_count, files_changed, additions, deletions}
} | {error}
    # Full entry sequence: checkout_review_parent → build symbol_map_before →
    # setup_review_soft_reset → rebuild symbol index

end_review() -> {status: "restored"} | {error}
    # Calls exit_review_mode(branch_tip, original_branch), clears review state,
    # rebuilds symbol index and stability tracker

get_review_state() -> {
    active: boolean,
    branch?, base_commit?, branch_tip?, commits?, changed_files?,
    stats?
}

get_review_file_diff(path) -> {path, diff}
    # Delegates to repo.get_review_file_diff (git diff --cached -- path)
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
| `_review_original_branch` | str | Branch HEAD was on before review (for restoration on exit) |
| `_review_commits` | list | Commit log |
| `_review_changed_files` | list | Changed file paths with status |
| `_review_stats` | dict | Aggregate stats (commit count, files, additions, deletions) |
| `_symbol_map_before` | str | Symbol map from pre-review state |

State is not persisted across server restarts. If the server crashes during a review, the user must manually restore with `git checkout {original_branch}`. This is documented in the error recovery section.

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

**Review mode is read-only.** The `_stream_chat` method explicitly checks `_review_active` and:
- Skips `apply_edits_to_repo` — edit blocks still appear in the response for reference but are not applied to disk
- Skips commit message generation — the commit button is disabled in the UI

A future enhancement could support suggested fixes that are applied on user confirmation.

### Symbol Maps

The LLM receives both the current symbol map (standard in every request) and the pre-change symbol map (in the review context block). Having both full maps lets the LLM directly compare the codebase topology before and after the reviewed changes — tracing removed dependencies, assessing blast radius, and understanding structural evolution. No computed symbol diff is needed; the LLM performs this analysis itself.

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