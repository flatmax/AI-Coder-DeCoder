# Search

Search is integrated into the Files tab's chat panel action bar rather than occupying a separate tab. A mode toggle switches between chat message search and file content search. File search shows a match overlay covering the messages area and a pruned file tree in the picker, with bidirectional scroll sync between them.

## Action Bar Integration

The search area shares the chat panel's action bar with session buttons. It consists of:

- Mode toggle (message / file) on the left of the input
- Search input with inline toggle buttons on the right edge (ignore case, regex, whole word)
- Match counter showing current position or total count
- Navigation arrows (previous / next)
- Session buttons (new session, history browser) — hidden when file search is active

The input and its inline toggles share a single border. Focus-within highlights the border.

## Dual Mode

### Message Search (Default)

- Matches against raw message content strings (not rendered HTML)
- Ignore-case toggle affects case sensitivity
- Match counter shows current index and total count
- All messages remain visible — matches are highlighted and scrolled into view
- Current match scrolled to center with accent-bordered highlight and subtle glow
- Previous/next buttons or Enter/Shift+Enter cycle through matches, wrapping around
- Escape clears the query and blurs the input

### File Search

- Debounced content search via the repo's search RPC with the three toggle flags
- Results appear in an overlay covering the messages area
- File picker swaps to a pruned tree showing only matching files
- Bidirectional scroll sync between overlay and picker
- Sending a chat message auto-exits file search mode

## Inline Toggles

Three toggle buttons inside the input's right edge:

- Ignore case — default on
- Regex — default off; when on, the query is interpreted as a regular expression
- Whole word — default off; when on, only whole-word matches count

Toggle states persisted to localStorage under individual keys. Applied to both message and file search modes.

## File Search Overlay

When file search mode is active:

- The messages area is hidden (CSS display, not removed from DOM)
- The overlay is shown in the same space (absolutely positioned)
- The chat input remains visible below the overlay
- Chat panel DOM state (streaming, scroll position, input text) is preserved

### Result Display

Results grouped by file:

- File header — sticky, shows path and match count badge; clicking opens the file in the diff viewer
- Match rows — line number + highlighted text; clicking opens the file at that line
- Context rows — one line before and after each match, dimmed, not clickable

Match text highlighted using a regex built from the query respecting the current toggle states.

### Keyboard Navigation

| Key | Action |
|---|---|
| Enter | Navigate to focused match (open in diff viewer) |
| Shift+Enter | Previous match |
| Up / Down | Move focus through matches |
| Escape | Clear query first; on second press, exit file search mode |

The focused match has a distinct visual treatment (accent left border, background highlight).

### Empty States

- Query empty — "Type to search across files"
- No results — "No results found"

## Pruned Tree

After each search, the files tab builds a pruned tree from the results:

1. Split each matching file path on separator, insert into a nested directory structure
2. Set each file node's line-count field to the match count (not the real line count) — picker renders this as a badge identically
3. Call the picker's set-tree method to inject the tree, bypassing the normal tree load RPC
4. Picker auto-expands all directories

When file search exits, the full tree is restored. Expand state from before the search is preserved and restored (see [file-picker.md](file-picker.md#file-search-integration)).

## Bidirectional Scroll Sync

### Overlay → Picker

- As the user scrolls through results, the chat panel detects which file section is at the top of the visible area
- Dispatches a search-scroll event with the file path
- Files tab updates the picker's focused path, auto-expands ancestor directories, and scrolls the picker row into view

### Picker → Overlay

- Clicking a file in the pruned tree during file search mode is intercepted by the files tab (file-clicked event)
- Instead of navigating to the diff viewer, the files tab calls the chat panel's scroll-to-file method
- Chat panel smooth-scrolls the overlay to the target file section
- A brief pause flag prevents feedback loops between the two directions

## Activation

File search mode can be activated by:

- Clicking the mode toggle button in the action bar
- Pressing Ctrl+Shift+F — routed through the dialog → files tab → chat panel's activate method
- Calling the activate method programmatically, which optionally prefills the query from a text selection

Ctrl+Shift+F captures `window.getSelection()` synchronously before focus changes clear it. Multi-line selections are ignored. The dialog switches to the Files tab and activates file search mode. See [shell.md](shell.md#ctrlshiftf-selection-capture) for the timing rules.

## Component Architecture

Split across three components:

| Component | Responsibility |
|---|---|
| Chat panel | Search UI (toggle buttons, input, overlay), file search RPC, match rendering, scroll sync events |
| Files tab | Listens for search-changed and search-scroll events, builds pruned tree, intercepts picker clicks during search |
| File picker | Renders pruned tree via set-tree, normal tree via load-tree |

## Stale Response Discarding

- A generation counter on the search RPC call discards stale responses when new searches are issued before previous ones complete
- Prevents older results from overwriting newer ones when the user types rapidly

## Message Search Highlight Implementation

- Message cards have a transparent border by default with a CSS transition on border color and box shadow
- A highlight class (applied via message-index attribute matching) sets an accent border and subtle glow
- Chat panel manages highlight state internally — scroll-to-match method clears all previous highlights, then queries its own shadow DOM for the matching card and applies the class
- Uses scroll-into-view with block center alignment to bring the match into view
- All highlight state (matches array, current index) is managed within the chat panel

## Exit Behavior

- Explicit toggle back to message search — clear file search state, restore full tree
- Escape twice — same
- Send chat message — auto-exit, restore full tree, clear pruned state
- Switching dialog tabs — file search state is preserved (overlay stays hidden via tab switch, ready to show on return)

## Invariants

- Search mode state (message vs file) is always reflected by the mode toggle button
- Inline toggle states always persist across sessions via localStorage
- File search overlay never destroys chat panel DOM state — streaming, scroll, and input state survive toggling
- Pruned tree is always replaced by the full tree on file search exit
- Expand state from before file search is always restored on exit
- Message search highlights are always cleared before applying a new highlight
- Ctrl+Shift+F selection capture is synchronous in the keydown handler; never re-read inside async callbacks
- Bidirectional scroll sync never enters a feedback loop — a brief pause flag guards each direction
- Stale search responses (from rapid typing) are never applied — a generation counter discards them
- Sending a chat message always auto-exits file search mode and restores the full tree