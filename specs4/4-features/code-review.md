# Code Review

A review mode that leverages git's staging mechanism to present branch changes for AI-assisted code review. By performing a soft reset, all review changes appear as staged modifications — allowing the existing file picker, diff viewer, and context engine to work unchanged. The LLM reviews code with full symbol map context, structural change analysis, and interactive conversation.
## Architecture
- User selects branch and base commit via an interactive git graph
- Server verifies clean working tree, computes merge-base, performs a controlled sequence of checkouts and a soft reset
- Result — files on disk match branch tip, git HEAD at merge-base, all review changes appear as staged modifications
- Existing file picker, diff viewer, and context engine work unchanged
- System prompt swapped to a dedicated review prompt; snippets swapped to review-specific set
- Exit reverses the state — soft reset to branch tip, checkout original branch
## Prerequisites
### Clean Working Tree
- Review mode requires a clean working tree — no staged or unstaged changes to tracked files
- Uses git status porcelain with untracked-ignore flag — untracked files are tolerated
- If dirty, user is shown an error with remediation commands
- See [repository.md](../1-foundation/repository.md) for the cleanliness check
### Dedicated Review Clone
- Recommended workflow is to use a separate clone for reviews
- Avoids disrupting active development — the soft reset changes the git state in ways that would be confusing alongside uncommitted work
## Git State Machine — Entry Sequence
Ordered operations to transform the repository into review state:
1. Verify clean working tree
2. Compute merge-base between branch tip and original branch (the branch HEAD was on before review — typically master/main)
3. Checkout the original branch (ensures a known starting point)
4. Checkout the merge-base commit (detached HEAD, disk at pre-review state)
5. **Build pre-change symbol map** — symbol index runs on disk
6. Checkout the branch tip by SHA (detached HEAD, disk at reviewed state)
7. Soft reset to merge-base — HEAD moves, all feature branch changes become staged modifications
8. Clear file selection (frontend and server both perform this; defense in depth)
After step 7, the repository state:
| Aspect | State | Effect |
|---|---|---|
| Files on disk | Branch tip content | User sees reviewed code; symbol map reflects it |
| Git HEAD | Merge-base (detached) | `git diff --cached` shows only feature branch changes |
| Staged changes | Feature branch changes only | File picker shows M/A/D badges naturally |
| Working tree | Clean (matches disk) | No unstaged changes |
### Merge-Base Computation
- Use git merge-base rather than the parent of the user-selected base commit
- Matches GitLab/GitHub merge request semantics — excludes changes that arrived via merge commits from the target branch
- Cascades through candidates — original branch, then main, then master
- Falls back to parent of user-selected commit if all candidates fail
### Branch Tip Checkout by SHA
- Step 6 checks out by SHA, not by branch name
- Handles local and remote refs uniformly — remote refs like `origin/foo` would leave HEAD at the ref pointer rather than the actual commit
### File Selection Clearing
- Server-side (authoritative) — LLM service clears selected files as part of start-review, via direct property assignment (not the public setter — avoids a redundant broadcast during review entry)
- Frontend-side (responsive) — files tab clears its own selection state on the review-started event
- Both are required — the server clear is authoritative if events race; the frontend clear prevents a visual stale-selection window
## Git State Machine — Exit Sequence
1. Soft reset to branch tip — HEAD moves, staging clears
2. Checkout original branch — HEAD reattaches to the branch the user was on before review
3. Rebuild symbol index — reflects restored state
If the original branch no longer exists, HEAD remains detached at branch tip SHA and the user is informed.
## Error Recovery
- If any entry step fails, the repo module attempts to return to the original branch
- If that fails, the error is reported as-is
- If the server crashes during review, manual recovery via checkout of the original branch, or (if needed) a soft reset to branch tip followed by checkout
- Disk files already match branch tip — soft reset just moves HEAD
## Commit Selection via Git Graph
Replaces the two-step (branch dropdown → commit search) flow with a single visual interaction.
### Git Graph Display
- SVG rendered within a scrollable container
- Each branch occupies a stable vertical lane — branches do not shift lanes as the user scrolls
- Commit nodes are clickable — clicking selects that commit as the review base
- Lazy loading — initial batch of commits, more fetched on scroll-to-bottom
### Lane Assignment
- Each branch tip assigned a lane (column index), ordered by most recent commit date
- Commits follow first-parent links downward within the same lane
- Merge commits show a connecting line from the second parent's lane to the merge point
- When a branch's history joins another branch (the fork point), the lane ends
### Commit Node Display
- Colored circle matching its branch color
- Short SHA (7 characters)
- Commit message (first line, truncated)
- Author and relative date
- Branch tip commits show the branch name as a label badge
### Branch Legend
- Fixed header above the scrollable graph — does not scroll
- Branch chips colored to match their lanes
- Ordered by most recent commit
- Chips toggleable to filter branches in the graph
- Remote branches toggle button (default: local only)
### Disambiguation
- A commit can be reachable from multiple branches
- On click, perform full parent-walk from each branch tip to determine reachability
- Candidate branches are those whose walk reached the selected commit
- Disambiguation popover at the click position lists candidate branches
- The branch whose lane matches the selected commit's lane is pre-selected
- Scrolling the graph dismisses the popover
### Clean-Tree Check
- When the review selector opens, check cleanliness before rendering the graph
- If dirty, show an inline message with remediation commands instead of the graph
- Prevents selections that will fail at start-review time
### Review Summary and Action
- After selection, the area below the graph shows the review summary — branch name, commit range, commit count
- A single Start Review button initiates the review
## Commit Graph Data
- Paginated fetch with limit and offset
- Each commit carries SHA, short SHA, message, author, date, relative date, parent SHAs
- Branch data — name, SHA, is-current flag, is-remote flag
- Has-more flag for pagination
- Branch filtering — remove symbolic refs, arrow entries, bare remote aliases (e.g. `origin` when `origin/master` exists)
## System Prompt Swap
- On review entry, system prompt swapped from the standard coding prompt to a dedicated review prompt
- Extra prompt still appended (user customizations apply in both modes)
- Original prompt saved so it can be restored on exit
- If server crashes during review, next restart loads the standard prompt (review state is not persisted)
## Review Context in LLM Messages
Review context is inserted as a dedicated section in the message array, between URL context and active files. See [prompt-assembly.md](../3-llm/prompt-assembly.md) for placement.
### Review Context Content
- Review summary — branch, merge-base and tip short SHAs, commit count, files changed, additions, deletions
- Commit list — short SHA, message, author, relative date per commit
- Pre-change symbol map — symbol map from the merge-base commit, captured during entry
- Reverse diffs for selected files — patches showing what would revert each file to pre-review state
### Re-Injection
- Review context is re-injected on each message (like URL context)
- Always current with the user's file selection
- Stability tracker handles normal content tiering for file contents; the review block itself is rebuilt each message
### Pre-Change Symbol Map
- Captured during entry (step 5) while disk is at merge-base
- Held in memory on the LLM service during the review session
- Not persisted to disk — rebuilt if needed by re-running entry
- Having both pre-change and current symbol maps lets the LLM compare topology before and after the reviewed changes
### Reverse Diffs for Selected Files
- When a file is selected (checked in the file picker), its full current content is included in working files (as usual)
- Additionally, a reverse diff is included in the review context section
- Selected files contribute both content and diff
- Unselected files contribute neither
- Deleted files excluded from reverse diffs even if selected (no current content)
### Token Budget
- Large reviews cannot fit all file diffs
- User controls token budget through file selection
- Review status bar shows "N of M diffs in context" so the user knows how many changed files are currently included
- Typical workflow — review files in batches via the file picker
## UI Components
### Review Mode Banner
- Displayed at the top of the file picker when review active
- Shows branch name, commit range, file/line stats, exit button
- Synchronized with review state from the review-state RPC
### Git Graph Selector
- Floating resizable dialog, not modal-blocking
- File picker and chat panel remain usable underneath
- Draggable by header, resizable from edges
- Close button dismisses without starting a review
- Three zones — frozen branch legend, scrollable graph, review info / action bar
### File Picker in Review Mode
- Operates unchanged
- Staged files appear with their normal status badges
- Filter, selection, context menu, keyboard navigation work as normal
### Review Status Bar
- Slim bar above chat input
- Shows review summary — branch, commit count, files changed, additions/deletions
- Diff count — "N of M diffs in context"
- Empty-selection prompt — "Select files to include diffs"
- Exit Review button
### File Selection for Review Diffs
- No separate chip-per-file UI for toggling diffs
- Uses standard file selection — file picker checkboxes and file mentions in chat
- Any selected file that is also in the review's changed file list automatically has its reverse diff included
- Avoids duplicating the file picker's functionality, scales naturally to large reviews
### Diff Viewer in Review Mode
- Operates unchanged
- Left side (original) — file content from HEAD (pre-review state)
- Right side (modified) — file content from disk (reviewed code)
- Standard staged-diff view
### Review Snippets
- Review-mode snippets stored alongside code and doc snippets in the unified snippets file
- Snippet RPC checks review state first and returns review snippets when in review mode
- Frontend does not need to distinguish — always calls the single RPC and renders whatever is returned
- Examples — full review, security review, commit walkthrough
## Review State
Held in memory on the LLM service:
- Active flag
- Branch being reviewed
- Branch tip SHA (for restoration)
- Base commit SHA
- Parent SHA (merge-base, current git HEAD during review)
- Original branch (HEAD before entry, for restoration)
- Commit list
- Changed file list with status
- Aggregate stats — commit count, files, additions, deletions
- Pre-change symbol map
State is not persisted across server restarts.
## Integration with Existing Systems
### File Picker
- No changes — staged files appear naturally with their normal badges and diff stats
### Diff Viewer
- No changes — pre-review HEAD vs reviewed disk is a standard staged-changes diff
### Symbol Map
- Current symbol map reflects the reviewed codebase (disk files)
- Pre-change symbol map injected in review context

### Cache Tiering

- Review context (summary, commit log, pre-change symbol map) can graduate to cached tiers since it doesn't change during the review session
- File diffs stay in the active tier as the user toggles selection

### History and Compaction

- Review conversations use the standard history and compaction system
- Review context is re-injected on every message (like URL context) so compaction of older messages doesn't lose it

### Streaming Chat

- Chat operates normally during review
- Review context is additional content in prompt assembly — no changes to streaming, edit parsing, or completion flow

## Read-Only Mode

- Review mode is explicitly read-only — edits are never applied to disk
- The streaming handler checks the review-active flag and skips the edit-application step entirely
- Edit blocks still appear in the response for reference, but the apply step is a no-op
- Commit message generation is also skipped — the commit button is disabled in the UI
- A future enhancement could support suggested fixes that are applied on user confirmation

## Limitations

### Single Review Session

- Only one review can be active at a time
- Starting a new review exits the current one first

### No Concurrent Editing

- Since git HEAD is at a different commit during review, committing new changes is not supported
- The user should exit review mode before making commits

### Root Commits

- If the base commit is the first commit in the repository (no parent), the pre-review state is an empty tree
- Pre-change symbol map will be empty, and all files appear as new additions

### Large Reviews

- Reviews with hundreds of changed files may exceed token budgets
- User-driven file selection keeps the context manageable
- The LLM can review files incrementally across multiple messages

### Branch Switching During Review

- Not supported
- User must exit review mode before switching branches

## Invariants

- Edits are never applied to disk while review mode is active
- The pre-change symbol map reflects the merge-base state, not the branch tip
- Exit always restores the original branch, or leaves HEAD detached with an informative error
- Clean working tree is enforced before entry — a dirty tree can never enter review mode
- File selection is cleared on review entry by both server and frontend
- Review context is re-injected on every message during the review session
- Review state is never persisted across server restarts