# Repository Operations

## Overview

The repository layer wraps version control operations and file I/O. It is exposed to the browser via RPC and used internally by the LLM context engine. All operations target a single git repository specified at startup.

## Service Architecture

The Repo service is composed of four operation groups:

| Group | Responsibility |
|-------|---------------|
| **File Operations** | Read, write, create, rename, delete files; stage/unstage |
| **Tree Operations** | Build file tree with line counts and git status |
| **Commit Operations** | Diffs, staging, commits, reset |
| **Search Operations** | Full-text search via git grep |

All methods return either a result value or a standardized error dict `{error: message}`.

## File Operations

### Read/Write

| Method | Description |
|--------|-------------|
| `get_file_content(path, version?)` | Read file content. Optional `version` (e.g., "HEAD") for committed content |
| `write_file(path, content)` | Write content to file. Creates parent directories if needed |
| `create_file(path, content)` | Create new file. Errors if file exists |
| `file_exists(path)` | Check if file exists |
| `is_binary_file(path)` | Binary detection: check first 8KB for null bytes |

### Git Staging

| Method | Description |
|--------|-------------|
| `stage_files(paths)` | Stage files for commit (git add) |
| `unstage_files(paths)` | Remove files from staging area |
| `discard_changes(paths)` | For tracked files: restore from HEAD. For untracked: delete |
| `delete_file(path)` | Remove file from filesystem |

### Rename/Move

| Method | Description |
|--------|-------------|
| `rename_file(old, new)` | Uses git mv for tracked files, filesystem rename for untracked. Creates destination dirs. Errors if destination exists |
| `rename_directory(old, new)` | Same strategy at directory level |

## File Tree

`get_file_tree()` returns a nested tree structure combining tracked and untracked files.

### Tree Node Schema

```pseudo
FileNode:
    name: string           // Display name
    path: string           // Full relative path
    type: "file" | "dir"
    lines: integer         // Line count (0 for binary/dirs)
    children: FileNode[]   // For directories

TreeResult:
    tree: FileNode
    modified: string[]     // Modified file paths
    staged: string[]       // Staged file paths
    untracked: string[]    // Untracked file paths
    diff_stats: map        // path → {additions, deletions}
```

### Ignored Files

The tree only includes tracked files and untracked files not excluded by `.gitignore`. Ignored files do not appear. Built from `git ls-files` (tracked) combined with `git ls-files --others --exclude-standard` (untracked, non-ignored).

### Line Counting

Binary detection checks the first 8KB for null bytes. Binary files report 0 lines. Text files count newlines.

### Diff Stats

Per-file addition/deletion counts from `git diff --numstat` (both staged and unstaged). Used for `+N -N` indicators in the UI.

## Commit Operations

| Method | Description |
|--------|-------------|
| `get_staged_diff()` | Returns `git diff --cached` as text |
| `get_unstaged_diff()` | Returns `git diff` as text |
| `stage_all()` | Runs `git add -A` |
| `commit(message)` | Creates commit. Handles new repos without HEAD |
| `reset_hard()` | Runs `git reset --hard HEAD` |

### Commit Flow (UI-Driven)

1. Stage all changes
2. Get staged diff
3. Send diff to LLM to generate commit message
4. Commit with generated message
5. Display commit message as assistant message in chat
6. Refresh file tree

## Search

```pseudo
search_files(query, whole_word, use_regex, ignore_case, context_lines)
```

Delegates to `git grep` with appropriate flags.

### Response Format

```pseudo
SearchResult:
    file: string
    matches: Match[]

Match:
    line_num: integer
    line: string           // Matched content
    context_before: Line[] // Optional surrounding lines
    context_after: Line[]

Line:
    line_num: integer
    line: string
```

### Context Lines

When `context_lines > 0`, the grep output includes surrounding lines. A separator-based parser handles mixed match lines (`:` delimiter) and context lines (`-` delimiter), with `--` as group separator between non-adjacent matches.

## Path Handling

All paths are relative to the repository root. The tree includes the repository name as the root node. UI operations strip this root prefix before making RPC calls.
