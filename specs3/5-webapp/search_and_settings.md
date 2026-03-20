# Search and Settings

Two simple tab components. Both are lazily loaded on first visit with DOM preserved across tab switches.

---

## Search Tab

Two-panel layout: file picker (left) and match context (right). Full-text search across the repository.

### Two-Panel Architecture

```
┌───────────────────────────────────────────────────────┐
│ [search input]                      3 in 2 files      │
│ [Aa] [.*] [ab]                                        │
├────────────────────────┬──────────────────────────────┤
│ <ac-file-picker>       │  ── src/repo.py ──── (12)   │
│                        │   15 │ import subprocess     │
│ ▾ src/                 │   16 │ from pathlib…         │
│   ▾ ac_dc/             │   …                         │
│     repo.py      [12]  │   42 │ def get_file_tree    │
│     config.py     [3]  │  ── src/config.py ── (3)   │
│   main.py         [5]  │   10 │ import argparse      │
│                        │                              │
│ (checkboxes, context   │  (click match → open file   │
│  menus, git status     │   at that line in editor)    │
│  all work normally)    │                              │
└────────────────────────┴──────────────────────────────┘
```

The left panel reuses `<ac-file-picker>` with a pruned tree of matching files. The right panel shows match context with highlighted results.

### Pruned Search Tree

After search results arrive, the search tab builds a tree in the same shape as `Repo.get_file_tree` returns:

1. Split each matching file path on `/`, insert into a nested directory structure
2. Set each file node's `lines` field to the **match count** (not line count) — the picker renders this badge identically
3. Call `picker.setTree(prunedTree)` to inject the tree, bypassing the RPC call
4. All directories are auto-expanded via `picker._expandAll()`

The picker's `setTree(treeData)` method (added for this feature) accepts a pre-built tree object, collects file paths, expands all directories, and triggers re-render.

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

### Right Panel — Match Context

Per file:
- **Sticky file header** — filename + match count badge, clickable → dispatches `search-navigate` with `{ path }`
- **Match rows** — line number + highlighted text, clickable → dispatches `search-navigate` with `{ path, line }`
- **Context rows** (1 before/after) — dimmed, not clickable

### Bidirectional Scroll Sync

- **Picker → match panel**: Intercept `file-clicked` from picker (`stopPropagation`). Smooth-scroll the match panel to the `[data-file-section]` element. Pause scroll sync for 400ms to prevent feedback loops.
- **Match panel → picker**: On scroll, find which `.match-file-section` is at the top of the visible area. Update the picker's `_activeInViewer` and `_focusedPath` properties. Expand ancestor directories via `_expandToPath()` so the file row is visible even if the tree was collapsed. Scroll the picker to the highlighted row.

### Resizable Divider

4px vertical divider between panels, `cursor: col-resize`. Drag to resize; picker width clamped to `[80px, 70% of body]`. Width persisted to local storage. Default: 45% of body.

### Keyboard

| Key | Action |
|-----|--------|
| ↓/↑ | Move through flat match list in right panel |
| Enter | Select match (or first if none focused) |
| Escape | Clear query and results, reset picker tree |

### Navigation

Click match row or file header in right panel → dispatch `search-navigate` with file path + line number → dialog re-dispatches as `navigate-file` → diff viewer opens file at line.

Picker's `file-clicked` event is intercepted — it scrolls the match panel instead of opening the file. Picker's `selection-changed` and `exclusion-changed` events bubble normally for context management.

### Edge Cases

- **Empty search / no results**: Two-panel layout hidden; shows placeholder or "No results found" message. Picker is not rendered.
- **Picker selections**: Checkboxes persist across searches via the picker's internal `_selected` set. Context menus, git status, expand/collapse all work as normal.

---

## Settings Tab

Access to configuration editing and hot-reload.

### Layout

An info banner at top showing current model names and config directory, followed by a card grid of config types, and an inline editor area below.

### Config Cards

| Card | Icon | Format | Reloadable |
|------|------|--------|------------|
| LLM Config | 🤖 | JSON | Yes |
| App Config | ⚙️ | JSON | Yes |
| System Prompt | 📝 | Markdown | No |
| System Extra | 📎 | Markdown | No |
| Compaction Skill | 🗜️ | Markdown | No |
| Snippets | ✂️ | JSON | No |

Clicking a card opens its content in an inline monospace textarea editor below the card grid. The active card is highlighted.

### Editing Flow

1. Click config card → content loaded via `Settings.get_config_content`
2. Content shown in inline monospace textarea within the settings tab
3. User edits directly in the textarea
4. Click 💾 Save (or Ctrl+S) → `Settings.save_config_content`
5. For reloadable configs (LLM, App), save automatically triggers reload
6. Separate ↻ Reload button available for reloadable configs
7. Click ✕ to close editor and return to card grid

### Editor Toolbar

Config type icon and label, file path, ↻ Reload (reloadable only), 💾 Save, ✕ Close.

### Feedback

Toast messages for success/error, auto-dismiss after 3 seconds.