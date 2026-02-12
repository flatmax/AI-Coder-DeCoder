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