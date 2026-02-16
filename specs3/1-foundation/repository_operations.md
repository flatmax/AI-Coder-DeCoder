# Repository Operations

## Overview

The repository layer wraps version control operations and file I/O. It is exposed to the browser via RPC and used internally by the LLM context engine. All operations target a single git repository specified at startup.

## File Operations

| Method | Description |
|--------|-------------|
| `Repo.get_file_content(path, version?)` | Read file content. Optional `version` (e.g., "HEAD") for committed content |
| `Repo.write_file(path, content)` | Write content to file. Creates parent directories |
| `Repo.create_file(path, content)` | Create new file. Errors if file exists |
| `Repo.file_exists(path)` | Check if file exists |
| `Repo.is_binary_file(path)` | Binary detection: check first 8KB for null bytes |

### Git Staging

| Method | Description |
|--------|-------------|
| `Repo.stage_files(paths)` | Stage files for commit (git add) |
| `Repo.unstage_files(paths)` | Remove from staging area |
| `Repo.discard_changes(paths)` | Tracked: restore from HEAD. Untracked: delete |
| `Repo.delete_file(path)` | Remove from filesystem |

### Rename/Move

| Method | Description |
|--------|-------------|
| `Repo.rename_file(old, new)` | git mv for tracked, filesystem rename for untracked |
| `Repo.rename_directory(old, new)` | Same strategy at directory level |

## File Tree

`Repo.get_file_tree()` returns a nested tree combining tracked and untracked files.

### Tree Node Schema

```pseudo
FileNode:
    name: string
    path: string           // Full relative path
    type: "file" | "dir"
    lines: integer          // Line count (0 for binary/dirs)
    children: FileNode[]

TreeResult:
    tree: FileNode
    modified: string[]
    staged: string[]
    untracked: string[]
    diff_stats: map         // path → {additions, deletions}
```

### Ignored Files

Built from `git ls-files` (tracked) + `git ls-files --others --exclude-standard` (untracked, non-ignored). Ignored files never appear.

### Line Counting

Binary files (null bytes in first 8KB) report 0 lines. Text files count newlines.

### Diff Stats

Per-file addition/deletion counts from `git diff --numstat` (both staged and unstaged). Used for `+N -N` indicators in the file picker UI.

## Commit Operations

| Method | Description |
|--------|-------------|
| `Repo.get_staged_diff()` | `git diff --cached` as text |
| `Repo.get_unstaged_diff()` | `git diff` as text |
| `Repo.stage_all()` | `git add -A` |
| `Repo.commit(message)` | Create commit. Handles repos without HEAD |
| `Repo.reset_hard()` | `git reset --hard HEAD` |
| `Repo.search_commits(query, branch?, limit?)` | Search commits by message/SHA/author via `git log --grep` |

### Commit Flow (UI-Driven)

1. Stage all changes (`stage_all`)
2. Get staged diff (`get_staged_diff`)
3. Send diff to LLM to generate commit message
4. Commit with generated message (`commit`)
5. Display commit message as assistant message in chat
6. Refresh file tree

## Search

```pseudo
Repo.search_files(query, whole_word, use_regex, ignore_case, context_lines)
```

Delegates to `git grep` with appropriate flags.

### Response Format

```pseudo
SearchResult:
    file: string
    matches: [{
        line_num: integer,
        line: string,
        context_before: [{line_num, line}],
        context_after: [{line_num, line}]
    }]
```

## Path Handling

All paths are relative to the repository root. The tree includes the repository name as the root node. UI operations strip this root prefix before making RPC calls.

Paths containing `..` traversal are rejected. The resolved absolute path is verified to remain under the repo root before any read or write.

## Testing

- File read/write, read at HEAD version, create-exists error
- Path traversal blocked (../../../etc/passwd)
- Binary file detection (null bytes in first 8KB)
- Stage, unstage, staged diff verification
- Commit, reset hard restores content
- Rename tracked file
- Tree includes modified, untracked, staged arrays
- Flat file list contains expected paths
- Search finds content, case-insensitive, no-results returns empty

## Flat File List

`Repo.get_flat_file_list()` returns a sorted, one-file-per-line list of all tracked and untracked (non-ignored) files. Used in the prompt as the file tree section.

```
.gitignore
README.md
src/main.py
src/utils/helpers.py
```