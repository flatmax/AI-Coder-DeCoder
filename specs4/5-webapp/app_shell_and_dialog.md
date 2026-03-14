# App Shell and Dialog

## Overview

The webapp is a single-page application built with **Lit** (LitElement web components). The main UI surface is a floating dialog that hosts all tabs — draggable, resizable, and collapsible. The diff viewer fills the background.

## Application Structure

```
AppShell (root, extends JRPCClient)
    ├── Viewer Background (fills viewport)
    │   ├── DiffViewer (text files)
    │   │   ├── Tab bar (open files)
    │   │   └── Monaco diff editor
    │   └── SvgViewer (.svg files)
    │       ├── Tab bar (open SVG files)
    │       └── Side-by-side SVG panels with synchronized pan/zoom
    ├── TokenHUD (floating overlay, fixed positioning)
    └── Dialog (foreground, left-docked)
        ├── Header Bar (tabs, actions, minimize)
        ├── Content Area
        │   ├── Files & Chat tab (default)
        │   ├── Search tab
        │   ├── Context Budget tab
        │   ├── Cache Tiers tab
        │   └── Settings tab
        └── History Bar (token usage indicator)
```

## App Shell

The root component extends `JRPCClient`, managing the WebSocket connection and routing events between dialog and diff viewer.

### Responsibilities

- Set browser tab title to the repo name (e.g., `my-project`). The repo name comes from the `repo_name` field of `get_current_state()`. Updated on initial state load. No prefix or branding in the title — just the bare repo name.
- Extract WebSocket port from `?port=N`
- Publish `SharedRpc` on connection
- Route `navigate-file` events to diff viewer
- Route `file-save` events to Repo or Settings RPC
- Trigger token HUD on `streamComplete`
- Handle reconnection with exponential backoff
- Re-layout viewers on window resize (RAF-throttled to avoid jank — see [Window Resize Handling](#window-resize-handling))

### Server Callbacks

Methods the server calls on the client (registered via `addClass`):

| Method | Action |
|--------|--------|
| `streamChunk(requestId, content)` | Dispatch `stream-chunk` window event |
| `streamComplete(requestId, result)` | Dispatch `stream-complete` window event |
| `compactionEvent(requestId, event)` | Dispatch `compaction-event` window event |
| `filesChanged(selectedFiles)` | Dispatch `files-changed` window event |

### Startup Sequence

**Server:** Validate git repo (if not a repo: open HTML instruction page in browser, print terminal banner, exit). Initialize services. Register classes with JRPCServer. Start WebSocket server. Open browser.

**App Shell:** On `setupDone`: publish call proxy → fetch `LLMService.get_current_state()` → dispatch `state-loaded` event (window-level CustomEvent with full state object as detail). The state already contains messages from the server's auto-restored last session, so the browser renders the previous conversation immediately. After state is loaded, the app shell re-opens the last viewed file and restores its viewport state (see [File and Viewport Persistence](#file-and-viewport-persistence)).

**Files Tab:** On RPC ready: load snippets, load file tree, load review state. On `state-loaded`: restore messages, selected files, streaming status, mode state, sync file picker, scroll chat to bottom.

**RPC Deferral:** Some components defer their first RPC call to the next microtask (`Promise.resolve().then(...)`) in `onRpcReady()`. This ensures the `SharedRpc` call proxy has fully propagated to all listeners before any component issues requests. Without this, a component's `onRpcReady` might fire before sibling components have received the proxy, causing race conditions when calls trigger events that siblings need to handle.

**Dialog:** On RPC ready: sync history bar via `LLMService.get_history_status()`. Restore last-used tab from localStorage.

### State Restoration Cascade

The `state-loaded` event triggers a specific cascade with ordering constraints:

1. **App shell** dispatches `state-loaded` on `window` with the full state object (`messages`, `selected_files`, `streaming_active`, `session_id`, `repo_name`). The `repo_name` field is used to set the browser tab title.
2. **Files tab** listens on `window`, sets `_messages`, `_selectedFiles`, `_streamingActive` from the state
3. **File picker sync is deferred** via `requestAnimationFrame` — the picker may not have its tree loaded yet (its own `onRpcReady` fires independently via microtask deferral)
4. **Chat panel** detects bulk message load (empty→non-empty transition in `updated()`) and triggers scroll-to-bottom with double-rAF

**Ordering dependency:** The file picker loads its tree via its own `onRpcReady` (deferred to next microtask), while the files tab restores selection from `state-loaded`. These can race. The `requestAnimationFrame` deferral of picker sync ensures the tree is loaded before selection is applied.

**The files tab does NOT call `loadTree()` on `state-loaded`** — the picker's own `onRpcReady` handles tree loading independently. This separation prevents duplicate tree fetches.

## Dialog

### Layout

Default: fixed left-docked, 50% viewport width (min 400px), full height. Right half available for diff viewer.

### Tabs

| Tab | Icon | Shortcut |
|-----|------|----------|
| FILES | 📁 | Alt+1 |
| SEARCH | 🔍 | Alt+2 |
| CONTEXT | 📊 | Alt+3 |
| CACHE | 🗄️ | Alt+4 |
| SETTINGS | ⚙️ | Alt+5 |

### Lazy Loading and DOM Preservation

Non-default tabs are loaded on first visit via dynamic `import()`. A `lazyImports` map associates tab IDs with import functions. A `_visitedTabs` set tracks which tabs have been rendered — Lit templates conditionally include tab panels only for visited tabs, so unvisited tabs have no DOM presence at all.

Once visited, tab panels remain in DOM (hidden via CSS, not destroyed). Switching tabs toggles the `.active` class. Each tab component may implement an `onTabVisible()` callback — the dialog calls this when switching to a tab, allowing the component to refresh stale data (e.g., context/cache tabs that missed `stream-complete` events while hidden).

### Tab Active Detection

Tab components determine their visibility by checking their parent `.tab-panel` element's class list for `active`. This is used by context and cache tabs to decide whether to refresh on `stream-complete` / `files-changed` events or mark themselves as stale:

```pseudo
_isTabActive():
    panel = this.parentElement
    if panel has class 'tab-panel':
        return panel has class 'active'
    return this.offsetParent !== null  // fallback
```

When a stale tab becomes visible (via `onTabVisible()`), it clears the stale flag and refreshes automatically. A `● stale` badge is shown in the toolbar while the tab is stale.

### Global Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Alt+1..5 | Switch to tab |
| Alt+M | Toggle minimize |
| Ctrl+Shift+F | Open Search tab with current selection or clipboard |

Ctrl+Shift+F captures `window.getSelection()` synchronously before focus change clears it.

### Dragging & Resizing

- Header drag with 5px threshold (under = click → toggle minimize)
- Three resize handles: right edge, bottom edge, and bottom-right corner (see [Resize Handles](#resize-handles))
- Undocking: on first drag beyond threshold (or first bottom/corner resize), dialog switches from docked layout (top/left/height: 100%) to explicit fixed positioning with pixel coordinates
- Min width: 300px, min height: 200px (enforced during resize)
- Once undocked, position is persisted to localStorage as JSON (`ac-dc-dialog-pos`: left, top, width, height)

### Tab Restoration

On RPC ready (not on construction), the dialog restores the last-used tab from localStorage (`ac-dc-active-tab`). This is deferred to `onRpcReady()` rather than `connectedCallback()` so that lazy-loaded tab components can fetch data immediately when activated. The default tab is `files` if no saved preference exists.

### Position Persistence

| State | Persisted | Storage Key |
|-------|-----------|-------------|
| Dialog width | Yes | `ac-dc-dialog-width` |
| Undocked position | Yes | `ac-dc-dialog-pos` (JSON: left, top, width, height) |
| Minimized state | Yes | `ac-dc-minimized` |
| Active tab | Yes | `ac-dc-active-tab` |

On startup, the dialog restores its last position and size. Undocked positions are bounds-checked against the current viewport (at least 100px must remain visible). If the dialog was never undocked, it starts in the default left-docked layout at 50% viewport width.

### Resize Handles

The dialog supports three resize interactions:

| Handle | Location | Behavior |
|--------|----------|----------|
| Right edge | 8px wide, absolute at right: -4px | Resize width only. Works in both docked and undocked modes |
| Bottom edge | 8px tall, absolute at bottom: -4px | Resize height only. Auto-undocks if still docked |
| Bottom-right corner | 14px × 14px at the bottom-right corner | Resize width and height simultaneously. Auto-undocks if still docked |

All handles show an accent-colored highlight on hover. All three are hidden when the dialog is minimized. The right edge handle enforces a minimum width of 300px. The bottom edge handle enforces a minimum height of 200px.

### Header Sections

| Section | Content |
|---------|---------|
| Left | Active tab label; click toggles minimize |
| Center | Tab icon buttons |
| Right | Cross-ref toggle, review toggle (👁️), minimize button |

**Cross-reference toggle:** A checkbox labeled **+doc index** (in code mode) or **+code symbols** (in document mode) appears in the header actions area, to the left of the review toggle. The checkbox is **always visible** once the initial startup completes — in code mode the doc index's structural extraction finishes within ~250ms of the "ready" signal (before any user interaction is possible), so the toggle is available immediately; in document mode the symbol index is always available. Checking the box calls `LLMService.set_cross_reference(true)` via RPC; unchecking calls `set_cross_reference(false)`. A toast notifies the user of the token impact on activation and confirms removal on deactivation. The checkbox resets to unchecked on mode switch.

The dialog tracks cross-ref state via `_crossRefEnabled` property, synced from:
- `onRpcReady` / `state-loaded`: reads `cross_ref_enabled` from `get_current_state()`
- `mode-changed` event: resets `_crossRefEnabled = false`

The review toggle button (👁️) appears in the header actions area on all tabs. When review mode is inactive, clicking it switches to the Files tab and opens the review selector. When review mode is active, the button is visually highlighted (`review-active` class) and clicking it calls `_exitReview()` on the files tab. This provides quick access to review without navigating to the Files tab first.

The dialog tracks review state via `_reviewActive` property, synced from:
- `onRpcReady`: fetches `LLMService.get_review_state()`
- `review-started` window event → sets `true`
- `review-ended` window event → sets `false`

**Note:** Git action buttons (clipboard, commit, reset) and session buttons (new session, history browser) are in the chat panel's action bar, not the dialog header. See [Chat Interface — Action Bar](chat_interface.md#action-bar).

### Minimizing

Toggle via header click or Alt+M. Minimized: 48px header only.

### History Bar

3px bar at bottom showing history token usage percentage:
- Green ≤ 75%, Orange 75–90%, Red > 90%
- Data from `LLMService.get_history_status()`, refreshed on: RPC ready, stream-complete, compaction, state-loaded

Event listeners for history bar refresh are registered once (guarded to prevent duplicate listeners on reconnect, since `onRpcReady` fires again on each reconnection).

## Viewer Background

The background layer (`position: fixed; inset: 0; z-index: 0`) hosts two viewer components as absolutely positioned siblings:

| Viewer | Files | Component |
|--------|-------|-----------|
| Diff Viewer | All text files | `<ac-diff-viewer>` |
| SVG Viewer | `.svg` files | `<ac-svg-viewer>` |

Only one viewer is visible at a time. CSS classes `viewer-visible` / `viewer-hidden` toggle `opacity` and `pointer-events` with a 150ms transition. The app shell routes `navigate-file` events by file extension and toggles visibility on `active-file-changed`.

Both viewers share the same empty state: AC⚡DC watermark (8rem, 18% opacity). Both maintain independent tab state — switching between an open `.svg` and an open `.js` file toggles the viewer layer without closing either tab.

Post-edit refresh (`stream-complete` with `files_modified`, or `files-modified` events) calls `refreshOpenFiles()` on both viewers. Neither viewer auto-opens new tabs on refresh.

See [Diff Viewer](diff_viewer.md) for the Monaco editor and [SVG Viewer](svg_viewer.md) for the SVG diff viewer.

## Window Resize Handling

Window resize events (display change, maximize, laptop lid reopen) trigger Monaco `layout()` to recalculate the editor dimensions. This is **throttled to one layout per animation frame** via `requestAnimationFrame` to prevent jank:

- A pending RAF handle (`_resizeRAF`) gates the handler — subsequent resize events within the same frame are dropped
- The RAF callback clears the handle before calling `layout()`, re-arming for the next frame
- The handle is cancelled in `disconnectedCallback` to prevent stale callbacks

Without this throttle, rapid resize events can cause a feedback loop: scroll → layout shift → resize event → `layout()` → forced reflow → scroll position recalculated → visible jank. This is especially problematic when horizontal scroll state is being persisted, as the viewport save queries (`getScrollTop`, `getScrollLeft`, `getPosition`) force synchronous layout.

## File and Viewport Persistence

The app shell persists the last-opened file and its viewport state to localStorage, restoring them on page refresh for seamless continuity.

### Storage Keys

| Key | Content | Lifecycle |
|-----|---------|-----------|
| `ac-last-open-file` | File path of the last opened/navigated file | Written on every `navigate-file` event |
| `ac-last-viewport` | JSON: `{path, type, diff: {scrollTop, scrollLeft, lineNumber, column}}` | Written on `beforeunload` and before navigating to a different file |

### Save Triggers

- **File path**: saved on every `navigate-file` event, immediately before routing to the viewer
- **Viewport state**: saved on `beforeunload` (page refresh/close) and before navigating away from the current file. SVG files are excluded (SVG zoom restore is not yet supported). The pre-navigation save is wrapped in a try/catch to prevent Monaco layout query failures from blocking file navigation
- The diff viewer's `getViewportState()` returns the modified editor's `scrollTop`, `scrollLeft`, cursor `lineNumber`, and `column`

### Restore Flow

On startup, after `state-loaded` completes, the file reopen is **deferred until the startup overlay dismisses** (i.e., after the server sends `startupProgress("ready")`). This prevents file-fetch RPC calls from blocking the server's event loop during heavy initialization — synchronous `git show` subprocess calls in the RPC handler can starve WebSocket pings and cause disconnections. On reconnect (when `init_complete` is already true in `get_current_state()`), the file reopens immediately.

1. Read `ac-last-open-file` from localStorage
2. If the startup overlay is still visible, set `_pendingReopen = true` and return
3. When the overlay dismisses (on `startupProgress("ready")` or when `init_complete` is true on reconnect), proceed with the reopen
4. Read `ac-last-viewport` and verify the viewport's `path` matches
5. Dispatch a `navigate-file` event to re-open the file
6. For diff files with saved viewport state:
   - Register a one-shot `active-file-changed` listener filtered to the target path
   - When the file opens, use double-rAF to wait for the editor to be ready
   - Call `restoreViewportState()` which sets cursor position, reveals the line, and restores scroll offsets
7. `restoreViewportState()` polls up to 20 animation frames for the Monaco editor to be ready (it's created asynchronously after the file content fetch completes)
8. A 10-second timeout removes the listener if the file never opens (e.g., file was deleted)

## Local Storage Persistence Pattern

Multiple components persist UI preferences to localStorage using a duplicated `_loadBool`/`_saveBool` pattern (load via `getItem(key) === 'true'`, save via `setItem(key, String(value))`). This is intentionally duplicated per-component rather than extracted to a shared utility — each component manages its own keys independently.

| Component | Keys |
|-----------|------|
| App shell | `ac-last-open-file`, `ac-last-viewport` |
| Dialog | `ac-dc-dialog-width`, `ac-dc-dialog-pos`, `ac-dc-minimized`, `ac-dc-active-tab` |
| File picker | `ac-dc-picker-width`, `ac-dc-picker-collapsed` |
| Search tab | `ac-dc-search-ignore-case`, `ac-dc-search-regex`, `ac-dc-search-whole-word` |
| Chat panel | `ac-dc-snippet-drawer` |
| Cache tab | `ac-dc-cache-expanded` |
| Context tab | `ac-dc-context-expanded` |
| Token HUD | `ac-dc-hud-collapsed` |

## Content-Visibility Detail

The `content-visibility` optimization described in the chat interface spec relies on `data-msg-index` attributes on each `.message-card` element. These indices are also used by the chat search highlight system. The last 15 messages use `content-visibility: visible` and `contain: none` (via a `.force-visible` class) to ensure accurate scroll heights near the bottom of the conversation, where the user is most likely scrolling.

## Graceful Degradation

| Failure | Behavior |
|---------|----------|
| Tree-sitter parse failure | Skip file in symbol index, log warning. File still in tree and selectable |
| LLM provider down/timeout | streamComplete with error in chat. User can retry |
| Git operation fails | Return `{error}` from RPC. Error toast. File tree doesn't update |
| Commit fails | Error shown in chat. Files remain staged |
| URL fetch fails | Chip shows error state. Error results not cached. Content not included. User can retry |
| WebSocket disconnect | Reconnecting banner with attempt count, auto-retry with exponential backoff (1s, 2s, 4s, 8s, max 15s). On disconnect: reset `SharedRpc`, show banner, dispatch error toast. On reconnect via `serverChanged()`: re-publish call proxy, fetch state, rebuild UI, dispatch success toast |
| Config file corrupt/missing | Use built-in defaults. Log warning. Settings panel displays the error |
| Symbol cache corrupt | Clear in-memory cache, rebuild from source |
| Compaction LLM failure | Safe defaults (no boundary, 0 confidence). History unchanged. Retry next trigger |
| Emergency token overflow | Oldest messages truncated without summarization if > 2× compaction trigger |
| Review mode crash | Manual recovery via `git checkout {original_branch}`. Detached HEAD state is safe — disk files match branch tip |

---

## Context Viewer Tab

### Layout

```
Context Budget                              [↻ Refresh]
──────────────────────────────────────────────────────
Token Budget          45.2K / 200.0K
[████████░░░░░░░░░░░░░░░░░░░░░░░░] 22.6% used

Model: provider/model-name    Cache: 23% hit
──────────────────────────────────────────────────────
  ▶ System Prompt        1.6K  ██
  ▶ Symbol Map (42)     34.4K  ████████████████████
  ▶ Files (3)           15.6K  ██████████
    URLs                   0
    History              4.1K  ███
──────────────────────────────────────────────────────
Session Totals
  Prompt In      182.8K    Completion Out    12.4K
  Total          195.2K    Cache Hit         48.1K
```

### Budget Bar Colors

≤ 75% Green, 75–90% Yellow, > 90% Red.

### Model Info

Below the budget bar: model name, cache hit rate percentage, and mode indicator. In document mode, ` · 📝 Doc Mode` is appended.

### Categories

Each category shows a name, proportional bar, and token count. Expandable categories (with ▶/▼ toggle) show per-item details when clicked:

| Category | Expandable | Detail Items |
|----------|------------|-------------|
| System Prompt | No | — |
| Symbol Map | Yes | Per-chunk name and tokens |
| Files | Yes | Per-file path and tokens |
| URLs | Yes | Per-URL with tokens |
| History | No | — |

Categories with zero tokens or no detail items show no toggle.

### Session Totals

Fixed footer below categories: grid showing cumulative session totals (total, prompt in, completion out, cache read, cache write). Cache read highlighted green when non-zero; cache write highlighted yellow when non-zero.

---

## Cache Viewer Tab

### Layout

```
Cache Performance                     23% hit rate
[████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░]
──────────────────────────────────────────────
Filter items...                    ● stale  [↻]
──────────────────────────────────────────────
RECENT CHANGES
📈 L3 → L2: symbol:src/ac_dc/context.py
──────────────────────────────────────────────
▼ L0 · Most Stable     1.6K  🔒
    ⚙️ System Prompt            1.4K
    📖 Legend                      0.2K
► L1 · Very Stable    11.1K  🔒
► L2 · Stable          5.9K  🔒
► L3 · Entry           0.4K  🔒
▼ active              19.7K
    📄 src/context.py   ▓▓░░  9.3K
    📄 src/repo.py      ▓░░░  6.2K
    💬 History (8)             4.1K
```

### Content Groups

| Type | Icon | Detail |
|------|------|--------|
| system | ⚙️ | Token count |
| legend | 📖 | Token count |
| symbols | 📦 (code) / 📝 (doc) | File path + stability bar (N/threshold) + tokens |
| files | 📄 | File path + stability bar (N/threshold) + tokens |
| urls | 🔗 | Title + tokens |
| history | 💬 | Message count + tokens |

**Mode-aware labels:** When `mode === "doc"`, the cache viewer shows "pre-indexed documents" instead of "pre-indexed symbols" for unmeasured tier items, and uses the 📝 icon for symbol-type entries. The context viewer shows "Doc Map" instead of "Symbol Map" for the symbol_map category, and the stacked bar legend label adapts similarly. When cross-reference mode is active, both `sym:` and `doc:` items appear in the cache viewer — `sym:` items use the 📦 icon and `doc:` items use the 📝 icon, regardless of the current mode.

### Stability Bars

Per-item: numeric `N/threshold` label displayed inline, plus a proportional fill bar with tier color. Tooltip shows `N={n}/{threshold}`. Only shown for items that have an N value (symbols, files). The numeric value gives precise progress toward promotion; the bar gives a visual summary.

### Item Click → View Map Block

Clicking an item name opens a modal showing the full index block for that file. The backend (`get_file_map_block`) dispatches to the appropriate index based on the item's key prefix, not the current mode — so `doc:` items in code mode's cross-reference view correctly show the document outline, and `symbol:` items in doc mode show the symbol block. If the primary index for the current mode has no data for the path, the other index is tried before returning an error.

### Fuzzy Search

Character-by-character matching against item names. Hides non-matching items and tiers with no matching items.

### Defaults

L0 and active tiers expanded by default; L1/L2/L3 collapsed.

### Stale Indicator

When the tab is hidden during a stream-complete or files-changed event, a `● stale` badge appears. Auto-refreshes when the tab becomes visible.

### Color Palette

Tiers use a warm-to-cool spectrum:
- L0: Green `#50c878` (most stable)
- L1: Teal `#2dd4bf`
- L2: Blue `#60a5fa`
- L3: Amber `#f59e0b`
- Active: Orange `#f97316`

Token values in monospace green. Cache writes in yellow. Errors in red.

### Footer

Compact footer showing model name and total token count.

### Relationship to Tabs

| Component | Location | Trigger | Persistence |
|-----------|----------|---------|-------------|
| Token HUD | Diff viewer background | Each `streamComplete` | Transient (~8s) |
| Context Viewer | Dialog tab | Tab switch / file change | Persistent while visible |
| Cache Viewer | Dialog tab | Tab switch / file change | Persistent while visible |

---

## Token HUD (Floating Overlay)

Floating overlay on the diff viewer background, appearing after each LLM response.

### Placement

- `position: fixed; top: 16px; right: 16px; z-index: 10000`
- Uses `RpcMixin` to fetch breakdown independently
- Triggered by `stream-complete` window event (filters out error responses)

### Data Flow

1. `streamComplete` fires → HUD extracts `token_usage` from result for immediate display
2. HUD makes async `LLMService.get_context_breakdown()` call for full data
3. Once full data arrives, all sections render with complete information

### Sections (all collapsible via ▼/▶ toggle)

| Section | Content |
|---------|---------|
| **Header** | Model name, cache hit % badge (color-coded: ≥50% green, ≥20% amber, <20% red), ✕ dismiss button |
| **Cache Tiers** | Per-tier horizontal bar chart. Each tier shows: name, proportional bar (colored by tier), token count, 🔒 if cached. Bar width relative to largest tier. Sub-items show icon, name, numeric `N/threshold` label, small stability bar (colored by tier), and token count. N value and bar only shown for items that have an N value |
| **This Request** | Prompt tokens, completion tokens. Cache read (green, shown if >0) and cache write (yellow, shown if >0) |
| **History Budget** | Total tokens vs max input tokens with usage bar. Bar colored green/yellow/red by percentage. History token count shown separately |
| **Tier Changes** | 📈 promotions and 📉 demotions as individual items with description text (e.g., "L3 → L2: symbol:src/file.py") |
| **Session Totals** | Prompt in, completion out, total. Cache saved (green, if >0) and cache written (yellow, if >0) |

### Behavior

- **Auto-hide**: 8 seconds → 800ms CSS opacity fade → hidden
- **Hover pauses**: mouse enter cancels timers and removes fade; mouse leave restarts auto-hide
- **Dismiss**: click ✕ to immediately hide
- **Width**: 320px fixed, max-height 80vh with overflow scroll
- **Error filtering**: HUD does not appear for error responses or empty results

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

Click match → dispatch `search-navigate` with file path + line number → diff viewer opens file at line.

---

## Settings Tab

Access to configuration editing and hot-reload.

### Layout

Info banner (model names, config directory), card grid of config types, inline editor area.

### Config Cards

| Card | Icon | Format | Reloadable |
|------|------|--------|------------|
| LLM Config | 🤖 | JSON | Yes |
| App Config | ⚙️ | JSON | Yes |
| System Prompt | 📝 | Markdown | No |
| System Extra | 📎 | Markdown | No |
| Compaction Skill | 🗜️ | Markdown | No |
| Snippets | ✂️ | JSON | No |

### Editing Flow

1. Click config card → content loaded via `Settings.get_config_content`
2. Content shown in inline monospace textarea within the settings tab. The active card is highlighted
3. User edits directly in the textarea
4. Click 💾 Save (or Ctrl+S) → `Settings.save_config_content`
5. For reloadable configs (LLM, App), save automatically triggers reload
6. Separate ↻ Reload button available for reloadable configs
7. Click ✕ to close editor and return to card grid

### Editor Toolbar

Config type icon and label, file path, ↻ Reload (reloadable only), 💾 Save, ✕ Close.

### Feedback

Toast messages for success/error, auto-dismiss after 3 seconds.