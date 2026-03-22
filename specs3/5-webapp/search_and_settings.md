# Search and Settings

Search is integrated into the Files tab's chat panel action bar. Settings remains an independent dialog tab.

---

## Integrated File Search

File search shares the action bar with chat message search in the Files tab. A mode toggle switches between the two search targets. When file search is active, the right panel shows match results overlaying the chat area, and the file picker shows a pruned tree of matching files.

### Action Bar Search Controls

The search area is visually separated from adjacent button groups by thin dividers. The search input contains inline toggle buttons on the right side (inside the input border), following the VS Code pattern:

| Element | Behavior |
|---------|----------|
| 💬/📁 mode toggle | Switch between message search and file search (left of input) |
| Search input | Placeholder changes with mode; debounced (300ms) for file search |
| `Aa` inline toggle | Ignore case (default: on) — inside input, right side |
| `.*` inline toggle | Regex mode (default: off) — inside input, right side |
| `ab` inline toggle | Whole word (default: off) — inside input, right side |
| Result counter | `N in M` (matches in files) for file search; `X/Y` (current/total) for message search |
| ▲/▼ navigation | Cycle through matches in either mode |

The input and its inline toggles share a single border (`.chat-search-box` wrapper). Focus-within highlights the border. Toggle states are persisted in `localStorage` with keys `ac-dc-search-ignore-case`, `ac-dc-search-regex`, `ac-dc-search-whole-word`.

### File Search Mode

When the 📁 mode is active:

- The search input calls `Repo.search_files` via RPC (debounced 300ms)
- The right panel shows a file search overlay covering the chat messages area
- The file picker swaps to a pruned tree of matching files
- Sending a chat message auto-exits file search mode
- The chat input remains visible below the overlay

### RPC Call

```
Repo.search_files(query, whole_word, use_regex, ignore_case, context_lines)
```

`context_lines` is fixed at 1 (one line before and after each match). A generation counter discards stale responses when new searches are issued before previous ones complete.

### Result Display

Results are grouped by file in the overlay:

- **File header**: sticky, shows path and match count badge. Clicking opens file in diff viewer.
- **Match rows**: line number + highlighted text. Clicking opens file at that line in the diff viewer.
- **Context rows** (1 before/after): dimmed, not clickable.

Match text is highlighted using a regex built from the query, respecting the current toggle states (`Aa`, `.*`, `ab`).

### Keyboard Navigation (File Search Mode)

| Key | Action |
|-----|--------|
| Enter | Navigate to focused match (open in diff viewer) |
| Shift+Enter | Previous match |
| ↑/↓ | Move focus through matches |
| Escape | Clear query first, then exit file search mode on second press |

The focused match has a left border accent and background highlight.

### Bidirectional Scroll Sync

**Match overlay → Picker**: As the user scrolls through results, the chat panel detects which `[data-file-section]` element is at the top of the visible area and dispatches a `file-search-scroll` event. The files tab receives this and updates `picker._focusedPath`, auto-expands ancestor directories, and scrolls the picker row into view.

**Picker → Match overlay**: Clicking a file in the pruned picker tree during file search mode is intercepted by the files tab (`stopPropagation` on `file-clicked`). Instead of navigating to the diff viewer, it calls `chatPanel.scrollFileSearchToFile(path)` which smooth-scrolls the overlay to the target file section. A 400ms pause (`_fileSearchScrollPaused` flag) prevents feedback loops between the two directions.

### Pruned Tree

After each search, the files tab builds a pruned tree from the results:

1. Split each matching file path on `/`, insert into a nested directory structure
2. Set each file node's `lines` field to the **match count** (not line count) — the picker renders this badge identically
3. Call `picker.setTree(prunedTree)` to inject the tree, bypassing the RPC call
4. The picker auto-expands all directories via `_expandAll()`

When file search exits, the full tree is restored via `picker.loadTree()` and `picker._focusedPath` is cleared.

### Activation

File search mode can be activated by:

- Clicking the 💬/📁 toggle button in the action bar
- Pressing **Ctrl+Shift+F** (routed through the dialog → files tab → `chatPanel.activateFileSearch(prefill)`)
- Calling `activateFileSearch(prefill)` programmatically, which optionally prefills the query from a text selection

**Ctrl+Shift+F** captures `window.getSelection()` synchronously before focus changes clear it. Multi-line selections are ignored. The dialog switches to the Files tab and activates file search mode.

### Empty State

When file search is active but the query is empty, the overlay shows "Type to search across files". When no results are found, it shows "No results found".

### Message Search Mode

When the 💬 mode is active (default), the search input and toggles operate on chat messages:

- Case-insensitive substring match on raw message `content` strings (not rendered HTML)
- `Aa` toggle affects case sensitivity
- Results highlight matching message cards with an accent border and glow
- ▲/▼ cycle through matching messages, scrolling each into view (`scrollIntoView({ block: 'center' })`)
- Enter for next match (wraps around), Shift+Enter for previous (wraps around), Escape clears query and blurs input
- All messages remain visible — only the current match is highlighted

### Component Architecture

The file search functionality is split across three components:

| Component | Responsibility |
|-----------|---------------|
| `ac-chat-panel` | Search UI (toggle buttons, input, overlay), file search RPC, match rendering, scroll sync events |
| `ac-files-tab` | Listens for `file-search-changed` and `file-search-scroll` events, builds pruned tree, intercepts picker clicks during search |
| `ac-file-picker` | Renders the pruned tree via `setTree()`, normal tree via `loadTree()` |

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