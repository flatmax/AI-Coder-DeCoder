# Search Interface

## Overview

Full-text search across the repository. Lazily loaded on first visit; DOM preserved across tab switches.

## Search Options

Three toggles (persisted to local storage):

| Option | Default | Effect |
|--------|---------|--------|
| Ignore case | true | Case-insensitive |
| Regex | false | Extended regex |
| Whole word | false | Word boundary matching |

Toggling re-runs the current search immediately.

## Search Execution

1. User types → debounced at 300ms
2. Clearing input cancels pending and clears results
3. RPC call: `Repo.search_files(query, whole_word, regex, ignore_case, context_lines=4)`
4. Generation counter ensures stale responses are discarded
5. Results stored as `[{file, matches}]`

## Results Display

Results grouped by file, each collapsible:
- **File header** — path with match count, clickable
- **Match rows** — line number, content with query highlighted, surrounding context lines

## Keyboard Navigation

| Key | Action |
|-----|--------|
| ↓/↑ | Move focus through flat match list |
| Enter | Select focused match (or first if none) |
| Escape | Clear query, or close if empty |

Focus tracks into a flat array of all matches. Selected item scrolls into view.

## Result Interaction

- **Click match** → dispatch event with file path and line number; parent loads file in diff viewer at that line
- **Click file header** → dispatch event to open file in diff viewer
- **Hover** → visual highlight
