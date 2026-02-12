# Search and Settings

Two simple tab components. Both are lazily loaded on first visit with DOM preserved across tab switches.

---

## Search Tab

Full-text search across the repository.

### Search Options

Three toggles (persisted to local storage):

| Option | Default | Effect |
|--------|---------|--------|
| Ignore case | true | Case-insensitive |
| Regex | false | Extended regex |
| Whole word | false | Word boundary matching |

Toggling re-runs the current search.

### Global Shortcut

**Ctrl+Shift+F** opens Search tab and pre-fills:
1. Browser selection (`window.getSelection()`) — captured synchronously before focus change
2. Clipboard fallback
3. Just focus if both empty

Multi-line selections ignored.

### Execution

Debounced at 300ms. Generation counter discards stale responses. Results: `[{file, matches}]`.

### Results

Grouped by file, each collapsible:
- **File header** — path + match count (clickable)
- **Match rows** — line number, highlighted content, context lines

### Keyboard

| Key | Action |
|-----|--------|
| ↓/↑ | Move through flat match list |
| Enter | Select match (or first if none focused) |
| Escape | Clear query, or close if empty |

### Navigation

Click match → dispatch `search-navigate` with file path + line number → dialog re-dispatches as `navigate-file` → diff viewer opens file at line.

---

## Settings Tab

Access to configuration editing and hot-reload.

### Layout

Four sections:

| Section | Controls |
|---------|----------|
| LLM | Current model names, Edit button, Reload button |
| App | Edit button, Reload button |
| Prompts | Edit buttons for: system, extra, compaction |
| Snippets | Edit button |

### Editing Flow

1. Click Edit → config loaded into diff viewer
2. User edits and saves (Ctrl+S)
3. Content written via `Settings.save_config_content`
4. Click Reload to apply

### Feedback

Toast messages for success/error, auto-dismiss after 3 seconds.