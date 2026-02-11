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

## Global Shortcut

**Ctrl+Shift+F** (Cmd+Shift+F on macOS) opens the Search tab from anywhere and pre-fills the search input:

1. The browser's current text selection is captured **synchronously** in the keydown handler (before focus changes clear it)
2. If the dialog is minimized, it un-minimizes
3. The Search tab activates
4. The search input is populated with the captured selection text and auto-searches

**Priority chain** for pre-fill:
1. **Browser selection** (`window.getSelection()`) — text highlighted in the UI (chat, diff viewer, search results). On Linux this mirrors the X11 primary selection within the app
2. **Clipboard** (`navigator.clipboard.readText()`) — fallback to Ctrl+C clipboard
3. **Just focus** — if both are empty or unavailable

Multi-line selections are ignored (not useful as search queries). The populated text is auto-selected for easy replacement.

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