# Git Operations Spec

Git operations are exposed through the dialog's header buttons and the file picker's context menu. All operations call into the `Repo` class on the server via JRPC, and the UI refreshes the file tree after each mutation to reflect the new state.

## Architecture

```
Dialog Header Buttons ──► ChatActionsMixin ──► Repo.* (JRPC) ──► GitPython
File Picker Context Menu ──► git-operation event ──► FileHandlerMixin ──► Repo.* (JRPC) ──► GitPython
```

The server-side `Repo` class (`ac/repo/repo.py`) composes four operation mixins:

| Mixin | Responsibility |
|-------|---------------|
| `FileOperationsMixin` | Read/write/rename/delete files, stage/unstage |
| `TreeOperationsMixin` | File tree construction with line counts and status |
| `CommitOperationsMixin` | Commits, diffs, branches, reset |
| `SearchOperationsMixin` | Grep-based file search |

All server methods return either a result value or a standardized error dict `{'error': message}`.

## Header Git Buttons

Three buttons appear in the `header-git` section when the Files tab is active and the dialog is not minimized:

| Button | Icon | Action | Method |
|--------|------|--------|--------|
| Copy diff | 📋 | Copy combined diff to clipboard | `copyGitDiff()` |
| Commit | 💾 | Auto-generate message and commit | `handleCommit()` |
| Reset | ⚠️ | Hard reset to HEAD | `handleResetHard()` |

### Copy Diff (`copyGitDiff`)

1. Fetches both `Repo.get_staged_diff()` and `Repo.get_unstaged_diff()`.
2. Concatenates staged diff first, then unstaged, separated by a newline.
3. Copies the combined text to the system clipboard via `navigator.clipboard.writeText()`.
4. Shows a confirmation message with line count, or "No changes to copy" if both diffs are empty.

### Commit (`handleCommit`)

A multi-step automated flow:

1. **Stage all** — Calls `Repo.stage_all()` which runs `git add -A`. Aborts on error.
2. **Get diff** — Calls `Repo.get_staged_diff()` to capture what will be committed. Aborts if empty.
3. **Generate message** — Calls `LiteLLM.get_commit_message(diff)` which sends the diff to the LLM with a commit-message prompt. The response is a `{message: string}` object.
4. **Commit** — Calls `Repo.commit(message)`. The server checks for staged changes (handling new repos without HEAD) and creates the commit via `repo.index.commit()`.
5. **Report** — Shows the short hash and first line of the commit message.
6. **Refresh** — Calls `loadFileTree()` to update status indicators.

Each step posts a progress message to the chat (`📦 Staging...`, `🤖 Generating...`, `✅ Committed!`).

### Reset Hard (`handleResetHard`)

1. Shows a browser `confirm()` dialog warning that all uncommitted changes will be lost.
2. If confirmed, calls `Repo.reset_hard()` which runs `git reset --hard HEAD`.
3. Refreshes the file tree.
4. Dispatches an `edits-applied` event with an empty file list to clear the diff viewer.

## Context Menu Operations

Right-clicking a file or directory in the file picker opens a context menu managed by `FileContextMenuMixin`. Menu items vary based on git status.

### File Context Menu

| Condition | Menu Item | Operation |
|-----------|-----------|-----------|
| Modified or untracked | Stage file | `stage` |
| Staged | Unstage file | `unstage` |
| Modified | Discard changes | `discard` (with confirm) |
| Always | Rename / Move... | `rename` (with prompt) |
| Always | Delete file | `delete` (with confirm) |

### Directory Context Menu

| Condition | Menu Item | Operation |
|-----------|-----------|-----------|
| Has unstaged changes | Stage all in directory | `stage-dir` |
| Has staged files | Unstage all in directory | `unstage` (filtered to staged) |
| Always | Rename / Move... | `rename-dir` (with prompt) |
| Always | New file... | `create-file` (with prompt) |
| Always | New directory... | `create-dir` (with prompt) |

The root directory node cannot be renamed.

### Event Flow

All context menu actions follow the same pattern:

1. The mixin closes the context menu.
2. Dangerous operations (`discard`, `delete`) show a `confirm()` dialog first.
3. Operations requiring user input (`rename`, `create-*`) show a `prompt()` dialog.
4. A `git-operation` custom event is dispatched with `{operation, paths}` in the detail.
5. `FileHandlerMixin.handleGitOperation()` catches the event and dispatches the appropriate `Repo.*` JRPC call.
6. On success, `loadFileTree()` is called to refresh the tree.
7. On failure, an error message is posted to the chat.

### Operation-to-RPC Mapping

| Operation | RPC Method | Paths |
|-----------|-----------|-------|
| `stage` | `Repo.stage_files(paths)` | `[filePath]` |
| `stage-dir` | `Repo.stage_files(paths)` | `[dirPath]` — git stages recursively |
| `unstage` | `Repo.unstage_files(paths)` | `[filePath]` or filtered staged files |
| `discard` | `Repo.discard_changes(paths)` | `[filePath]` |
| `delete` | `Repo.delete_file(path)` | `[filePath]` |
| `create-file` | `Repo.create_file(path, '')` | `[relativePath/name]` |
| `create-dir` | `Repo.create_directory(path)` | `[relativePath/name]` |
| `rename` | `Repo.rename_file(old, new)` | `[oldPath, newPath]` |
| `rename-dir` | `Repo.rename_directory(old, new)` | `[oldPath, newPath]` |

### Path Handling

Context menu paths include the repository root node name as a prefix (e.g. `myrepo/src/file.js`). For `create-file`, `create-dir`, and `rename-dir`, the mixin strips the root prefix to produce a repo-relative path before dispatching.

## Server-Side Behavior

### File Operations (`FileOperationsMixin`)

- **`stage_files(paths)`** — Calls `git add` for each path individually.
- **`unstage_files(paths)`** — Calls `repo.index.reset(paths=paths)` to remove from the index.
- **`discard_changes(paths)`** — For tracked files, reads the blob from HEAD and overwrites the working copy. For untracked files, deletes them.
- **`delete_file(path)`** — Removes the file from the filesystem via `os.remove()`.
- **`create_file(path, content)`** — Creates parent directories if needed, writes the file. Errors if file already exists.
- **`create_directory(path)`** — Creates the directory tree. Errors if it already exists.
- **`write_file(path, content)`** — Creates parent directories if needed, writes content. Used by the edit parser after applying edits.
- **`rename_file(old, new)`** — Uses `git mv` for tracked files, `os.rename()` for untracked. Creates destination directories as needed. Errors if destination exists.
- **`rename_directory(old, new)`** — Uses `git mv` for the whole directory (handles tracked files), falls back to `os.rename()`. Errors if destination exists.

### Commit Operations (`CommitOperationsMixin`)

- **`get_staged_diff()`** — Returns `git diff --cached` as a string.
- **`get_unstaged_diff()`** — Returns `git diff` as a string.
- **`stage_all()`** — Runs `git add -A`.
- **`commit(message)`** — Checks for staged changes (with special handling for repos without HEAD), then calls `repo.index.commit(message)`. Returns the commit hash and message.
- **`reset_hard()`** — Runs `git reset --hard HEAD`.
- **`get_diff_stats()`** — Parses `git diff --numstat` and `git diff --cached --numstat` to produce per-file `{additions, deletions}` counts. Used by the file tree to show `+N -N` indicators.

### Tree Operations (`TreeOperationsMixin`)

- **`get_file_tree()`** — Combines `git ls-files` (tracked) and untracked files into a nested tree structure. Each file node includes `{name, path, lines}` where `lines` is counted by reading the file (0 for binary). Returns the tree along with `modified`, `staged`, `untracked` arrays and `diffStats`.
- **`_count_file_lines(path)`** — Binary-checks the first 8KB for null bytes, then counts newlines. Returns 0 for binary files or on error.

## UI Presentation

### Context Menu Styling

The context menu is rendered as a fixed-position overlay at the click coordinates:

- Dark background (`#1e1e2e`) with a subtle border and drop shadow.
- Items highlight on hover (`#0f3460` background).
- Dangerous items (`discard`, `delete`) are styled in red (`#e94560`), with a red-tinted hover (`#3d1a2a`).

The menu auto-closes on any click or right-click elsewhere in the document.

### File Status Indicators

Files in the tree show colored names and status badges based on git state:

| State | Name Color | Badge |
|-------|-----------|-------|
| Clean | `#888` (grey) | — |
| Modified | `#e2c08d` (amber) | M |
| Staged | `#73c991` (green) | S |
| Untracked | `#73c991` (green) | U |
| Staged + Modified | `#73c991` (green) | S |

Diff stats (`+N -N`) appear to the right of modified/staged files in green/red monospace text.

### File Tree Refresh

`loadFileTree()` compares the JSON-serialized tree against `_lastTreeJson` and only updates the `fileTree` property when the structure actually changes. This avoids unnecessary re-renders and cache invalidation in the file picker. Status arrays (`modifiedFiles`, `stagedFiles`, `untrackedFiles`) and `diffStats` are always updated since they are cheap to diff.
