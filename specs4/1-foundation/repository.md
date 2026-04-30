# Repository

The repository layer wraps version control and file I/O. It is exposed to the browser via RPC and used internally by the LLM context engine. All operations target a single git repository specified at startup.

## File Operations

- Read file content at working copy or at a named version
- Read file as base64 data URI with auto-detected MIME type
- Write content (creates parent directories)
- Create new file (error if exists)
- Check existence
- Binary detection (null bytes in first 8KB)
- Delete

### Per-Path Write Serialization

The repository layer maintains an internal per-path mutex for write operations. Concurrent writes to different paths proceed in parallel; concurrent writes to the same path are serialized. The physical read → modify → write cycle (used by the edit-apply pipeline) acquires the lock for its target path and releases it after the write completes.

In single-agent operation, the lock is effectively never contended — only one agent writes at a time. The mutex exists so the repository layer's contract is safe for a future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) where N agents may generate edits concurrently. Implementing the lock now has zero cost in single-agent operation and unblocks the parallel case without refactoring the apply pipeline later.

## Git Staging

- Stage files (git add)
- Unstage files (git reset)
- Discard changes — restore tracked files from HEAD, delete untracked files

## File Manipulation

- Rename file — `git mv` for tracked, filesystem rename for untracked
- Rename directory — same strategy at directory level

## File Tree

- Nested tree combining tracked and untracked files
- Each node carries: name, path, type (file/dir), line count, modification time, children
- Result includes: tree, modified list, staged list, untracked list, deleted list, per-file diff stats
- Line count is 0 for binary files and directories
- Ignored files never appear
- Path quoting in git porcelain output is handled (strip quotes, handle renames)
- Per-segment quote stripping for rename entries

## Flat File List

- Sorted one-file-per-line list of all tracked and untracked (non-ignored) files
- Used as the file tree section in LLM prompts

## Commit Operations

- Staged diff (text)
- Unstaged diff (text)
- Diff to branch (two-dot diff comparing branch tip to working tree)
- Stage all
- Commit with message (handles initial commit case)
- Hard reset to HEAD
- Search commits via `git log --grep`

## Branch Operations

- Current branch info (branch name, SHA, detached flag)
- Resolve ref (branch, tag, SHA prefix) to full SHA
- List local branches
- List all branches (local + remote) sorted by recency, deduplicated
- Check working tree cleanliness (ignores untracked by default)
- Checkout branch — switch to a local branch, or create a local tracking branch when given a remote ref like `origin/feature`. DWIM semantics: remote ref with existing local counterpart switches to the local branch without re-creating; remote ref without counterpart creates a tracking branch and switches to it; plain local names switch directly. Refuses dirty working trees. Returns `{status, branch, sha}` on success, `{error}` on failure
- Commit graph (paginated, with parent relationships) — used by review selector
- Commit log for a range
- Parent of a commit
- Merge-base between two refs (cascades through candidates)

## Review Support

- Checkout a review's merge-base parent (entry sequence)
- Setup soft reset after branch-tip checkout
- Exit review mode (reset to branch tip, checkout original branch)
- Get changed files in review with status and diff stats
- Get single file diff

## Search

- Delegates to `git grep` with flags: regex, whole-word, ignore-case, context lines
- Response format — file with array of matches, each match has line number, line text, context-before array, context-after array

## TeX Preview

- Check if `make4ht` is on PATH
- Compile TeX source to HTML — writes content to temp dir, runs make4ht with mathjax config, extracts body + head styles, inlines assets as data URIs, strips alt-text artifacts
- Working directory set to temp dir so intermediate files stay contained
- TEXINPUTS set to the file's parent directory for `\input`/`\includegraphics`
- 30-second compilation timeout
- Temp directories cleaned up on next compilation and on server startup

## Path Handling

- All paths are relative to the repository root
- Tree includes the repository name as the root node; UI strips this prefix before RPC calls
- Paths containing `..` are rejected
- Resolved absolute path must remain under the repo root before any read or write

## Invariants

- Every file operation is confined to the repository root
- Binary files are never returned as text
- File tree operations reflect the current git state without caching stale data
- Rename operations preserve git history for tracked files
- Writes to the same path are serialized via a per-path mutex; writes to different paths proceed in parallel