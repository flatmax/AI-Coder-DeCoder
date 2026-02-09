# Search Tab Spec

The Search tab (`TABS.SEARCH`) provides full-text search across the repository. The UI component is `<find-in-files>` and the backend is `Repo.search_files`.

## Lazy Loading

The tab's component is imported on first visit:
```
await import('./find-in-files/FindInFiles.js')
```
Once visited, the DOM is preserved across tab switches (hidden via `tab-hidden` class). Switching to the Search tab calls `focusInput()` to auto-focus the search input.

## Component: `<find-in-files>`

Uses `RpcMixin` for RPC access. No direct WebSocket connection — acquires the shared `call` object via the singleton.

### Search options

Three toggles persisted to `localStorage` under `findInFiles.options`:

| Option | Default | Effect |
|---|---|---|
| Ignore case | `true` | Case-insensitive matching |
| Regex | `false` | Treat query as extended regex |
| Whole word | `false` | Match whole words only |

Toggling an option re-runs the current search immediately.

### Search execution

1. User types in the input field → `handleSearchInput` sets `this.query` and schedules a debounced search (300ms)
2. Clearing the input cancels pending searches and clears results
3. `performSearch()` calls `Repo.search_files(query, wholeWord, useRegex, ignoreCase, 4)` via `_rpc`
4. A generation counter (`_searchGen`) ensures stale responses from superseded searches are discarded
5. Results are stored as an array of `{ file, matches }` objects

### Results display

Results are grouped by file, each collapsible:

- **File header** — File path with match count, clickable to open in diff viewer
- **Match rows** — Line number, matched content with query highlighted, up to 4 lines of context before/after

### Keyboard navigation

| Key | Action |
|---|---|
| `↓` / `↑` | Move focus through flat list of all matches |
| `Enter` | Select focused match (or first match if none focused) |
| `Escape` | Clear query, or close search if query is empty |

Focus state is tracked by `focusedIndex` into a flat array built by `_getFlatMatches()`. The focused item scrolls into view via `_scrollToFocused()`.

### Result interaction

- **Click a match** — `selectResult(filePath, lineNum)` dispatches a `result-selected` event. `AppShell` handles this by loading the file into the diff viewer and scrolling to the line.
- **Click a file header** — `openFile(filePath)` dispatches a `file-selected` event to open the file in the diff viewer.
- **Hover** — `hoveredIndex` tracks mouse position for visual highlight.

## Backend: `Repo.search_files`

Delegates to `git grep` via GitPython:

```pseudo
search_files(query, word=False, regex=False, ignore_case=True, context_lines=1)
```

### Grep flags

| Parameter | Flag |
|---|---|
| Always | `-n` (line numbers) |
| `ignore_case` | `-i` |
| `word` | `-w` |
| `regex` | `-E` (extended regex) |
| `context_lines > 0` | `-C{n}` (context lines, clamped 0–4) |

### Response format

Without context lines (simple):
```
[{ file: "path/to/file.py", matches: [{ line_num: 42, line: "matched content" }] }]
```

With context lines:
```
[{ file: "path/to/file.py", matches: [{
  line_num: 42,
  line: "matched content",
  context_before: [{ line_num: 40, line: "..." }, { line_num: 41, line: "..." }],
  context_after: [{ line_num: 43, line: "..." }, { line_num: 44, line: "..." }]
}] }]
```

### Parsing

Two parsers handle grep output:
- `_parse_simple_grep` — Splits on `:` to extract `file:linenum:content`
- `_parse_grep_with_context` — Handles mixed match lines (`:` separator) and context lines (`-` separator), with `--` as group separator between non-adjacent matches
