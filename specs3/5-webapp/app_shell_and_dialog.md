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
        │   ├── Files & Chat tab (default, includes integrated file search)
        │   ├── Context tab (Budget / Cache sub-views)
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
| `startupProgress(stage, message, percent)` | Update startup overlay. **Special case:** `stage === 'doc_index'` is intercepted and forwarded to the dialog header progress bar (via `mode-switch-progress` DOM event) instead of updating the startup overlay — only in-progress updates (`percent < 100`) are forwarded; the completion signal arrives via `compactionEvent` with `doc_index_ready` stage |
| `navigateFile(data)` | Dispatch `navigate-file` window event with `_remote: true` flag to prevent re-broadcasting |
| `modeChanged(data)` | Dispatch `mode-changed` window event |
| `sessionChanged(data)` | Dispatch `session-loaded` window event |
| `docConvertProgress(data)` | Dispatch `doc-convert-progress` window event |
| `commitResult(result)` | Dispatch `commit-result` window event |
| `userMessage(data)` | Dispatch `user-message` window event |
| `admissionRequest(data)` | Add to `_admissionRequests` array (triggers admission toast) |
| `admissionResult(data)` | Remove from `_admissionRequests` (dismisses toast) |
| `clientJoined(data)` | Refresh connected client count |
| `clientLeft(data)` | Refresh connected client count |
| `roleChanged(data)` | Refresh collab role; toast if promoted to host |

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

| Tab | Icon | Label | Shortcut |
|-----|------|-------|----------|
| files | 🗨 | Chat | Alt+1 |
| context | 📊 | Context | Alt+2 |
| settings | ⚙️ | Settings | Alt+3 |

The Context tab has a **Budget / Cache** pill toggle at the top. The Budget sub-view shows token allocation breakdown (system prompt, symbol map, files, URLs, history). The Cache sub-view shows cache tier blocks, stability bars, and recent changes — delegating rendering to an embedded `<ac-cache-tab>` component. The active sub-view is persisted to localStorage (`ac-dc-context-subview`). Both sub-views share the same RPC data source (`LLMService.get_context_breakdown`) and the same stale-detection / refresh-on-visible behavior. When switching to the Cache sub-view, the embedded cache tab receives an `onTabVisible()` call to ensure fresh data.

The Doc Convert tab (📄, Alt+4) does not appear in the tab bar. Instead, when document conversion is available, a 📄 button appears in the right-side header actions area next to the doc/code mode toggle. Clicking it switches to the convert tab. The button highlights when the convert tab is active. Alt+4 remains the keyboard shortcut.

File search is integrated into the Files tab's chat panel action bar rather than occupying a separate tab. See [Search and Settings](search_and_settings.md#integrated-file-search).

### Lazy Loading and DOM Preservation

Non-default tabs (context, cache, settings, convert) are loaded on first visit via dynamic `import()`. A `lazyImports` map associates tab IDs with import functions. A `_visitedTabs` set tracks which tabs have been rendered — Lit templates conditionally include tab panels only for visited tabs, so unvisited tabs have no DOM presence at all.

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
| Alt+1..3 | Switch to tab (Alt+4 for Doc Convert when available) |
| Alt+M | Toggle minimize |
| Ctrl+Shift+F | Activate file search in Files tab, prefill from selection |

Ctrl+Shift+F captures `window.getSelection()` synchronously before focus change clears it. The dialog switches to the Files tab and calls `chatPanel.activateFileSearch(selection)`. Multi-line selections are ignored.

### Dragging & Resizing

- Header drag with 5px threshold (under = click → toggle minimize)
- Three resize handles: right edge, bottom edge, and bottom-right corner (see [Resize Handles](#resize-handles))
- Undocking: on first drag beyond threshold (or first bottom/corner resize), dialog switches from docked layout (top/left/height: 100%) to explicit fixed positioning with pixel coordinates
- Min width: 300px, min height: 200px (enforced during resize)
- Once undocked, position is persisted to localStorage as JSON (`ac-dc-dialog-pos`: left, top, width, height)

### Tab Restoration

On RPC ready (not on construction), the dialog restores the last-used tab from localStorage (`ac-dc-active-tab`). This is deferred to `onRpcReady()` rather than `connectedCallback()` so that lazy-loaded tab components can fetch data immediately when activated. The default tab is `files` if no saved preference exists. A stale `search` preference (from before search was integrated into the Files tab) is migrated to `files` on load.

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
| Left | Tab icon buttons |
| Center | [👥 | 📋▾ 💾⚠️ | 👁️] |
| Right | Cross-ref toggle (+doc/+code), mode toggle (💻/📝), doc convert (📄, conditional), minimize (▼) |

**Collab indicator (👥):** Positioned to the left of the tab buttons (between the label and tabs), the collab button shows the connected client count when > 1. Clicking opens a popover with client details and a share URL. In single-user mode (no `--collab` flag), the popover explains how to enable collaboration. This placement treats it as a status indicator rather than an action, keeping the right-side actions area focused on workflow controls.

**Cross-reference toggle:** A checkbox labeled **+doc** (in code mode) or **+code** (in document mode) appears in the header actions area, to the left of the review toggle. The checkbox is **always visible** once the initial startup completes — in code mode the doc index's structural extraction finishes within ~250ms of the "ready" signal (before any user interaction is possible), so the toggle is available immediately; in document mode the symbol index is always available. Checking the box calls `LLMService.set_cross_reference(true)` via RPC; unchecking calls `set_cross_reference(false)`. A toast notifies the user of the token impact on activation and confirms removal on deactivation. The checkbox resets to unchecked on mode switch.

**Git action buttons** (📋▾ copy diff, 💾 commit, ⚠️ reset) and the **review toggle** (👁️) are placed in a `.git-actions` group centered in the gap between the tab buttons and the right-side controls (`margin-left: auto; margin-right: auto`). This keeps frequently-used actions near the center of the header where they're easy to reach, and prevents the header from looking lopsided. The commit and reset buttons are only rendered when `_canMutate` is true (localhost clients in collab mode, or all clients in single-user mode). The commit button shows a spinning ⏳ while committing and is disabled during review mode or active streaming. The reset button shows a confirmation dialog via the chat panel. These buttons delegate to `ac-files-tab` → `ac-chat-panel` methods where the commit/reset logic lives. The review toggle highlights with `accent-primary` when review is active; clicking it opens the review selector or exits review mode. The review toggle is disabled when `_canMutate` is false. **Session buttons** (✨ new session, 📜 history browser) remain in the chat panel's action bar. See [Chat Interface — Action Bar](chat_interface.md#action-bar).

**Copy Diff Dropdown (📋▾):** The copy diff button includes a `▾` dropdown indicator. Clicking it opens a branch picker popover (`.diff-popover`) that lists all local and remote branches via `Repo.list_all_branches()`. The popover includes:

- **Fuzzy filter input** — subsequence matching on branch names, with `Enter` to select the first match and `Escape` to dismiss
- **Branch list** — each item shows the branch name (monospace), a `remote` tag for remote branches, a `current` tag for the active branch, and the short SHA. Clicking a branch calls `Repo.get_diff_to_branch(branch)` (two-dot diff: `git diff <branch>`, comparing the branch tip against the working tree including uncommitted changes) and copies the result to the clipboard
- **"Copy working diff" fallback** — a button at the bottom that copies the regular staged+unstaged diff (same as the old single-click behavior), delegating to `ac-files-tab` → `ac-chat-panel._copyDiff()`
- **Loading state** — shows "⏳ Generating diff…" while the RPC call is in flight
- **Backdrop dismiss** — clicking outside the popover closes it

The popover reuses the same styling pattern as the collab popover (`.collab-popover`). Branch data is fetched fresh each time the popover opens.

The dialog tracks doc enrichment state via `_enrichingDocs` property:
- `doc_enrichment_queued` compaction event → sets `true` (header progress bar shows)
- `doc_enrichment_complete` compaction event → sets `false` (header progress bar hides)
- `doc_index_progress` compaction events after `_docIndexReady` → updates `_modeSwitchMessage` and `_modeSwitchPercent` for header bar display; also sets `_enrichingDocs = true` to recover the bar state after browser refresh (when `doc_enrichment_queued` was missed but progress events continue arriving)

The dialog tracks cross-ref state via `_crossRefEnabled` property, synced from:
- `onRpcReady` / `state-loaded`: reads `cross_ref_enabled` from `get_current_state()`
- `mode-changed` event: resets `_crossRefEnabled = false`

The dialog tracks review state via `_reviewActive` property, synced from:
- `onRpcReady`: fetches `LLMService.get_review_state()`
- `review-started` window event → sets `true`
- `review-ended` window event → sets `false`

The dialog tracks streaming state via `_streamingActive` and `_committing` properties:
- `_streamingActive`: set `true` on `stream-chunk`, set `false` on `stream-complete`
- `_committing`: set `true` when commit button clicked, set `false` on `stream-complete` or `commit-result`
- Both disable the commit button when `true`; `_streamingActive` also disables the reset button

**Session buttons** (✨ new session, 📜 history browser) remain in the chat panel's action bar. See [Chat Interface — Action Bar](chat_interface.md#action-bar).

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

Window resize events (display change, maximize, laptop lid reopen) trigger two actions:

1. **Proportional dialog scaling** — the dialog container's width and height are scaled proportionally to maintain the dialog/editor split ratio across viewport size changes. The previous viewport dimensions (`_lastViewportWidth`, `_lastViewportHeight`) are tracked and the ratio is applied to the new dimensions. The new width is persisted to localStorage.

2. **Monaco layout** — `layout()` is called to recalculate the editor dimensions.

Both are **throttled to one call per animation frame** via `requestAnimationFrame` to prevent jank:

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

**Repo-scoped keys:** Both keys are scoped per repository using a `_repoKey(key, repoName)` helper that produces `{key}:{repoName}` (e.g., `ac-last-open-file:my-project`). This prevents opening a different repo from restoring the wrong file. Falls back to the bare key if the repo name is not yet known. The `_repoKey` function is defined at module level (not as a class method) and used by the app shell for both save and restore operations.

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
| Chat panel | `ac-dc-snippet-drawer`, `ac-dc-search-ignore-case`, `ac-dc-search-regex`, `ac-dc-search-whole-word` |
| Context tab | `ac-dc-context-expanded`, `ac-dc-context-subview` |
| Cache tab (embedded) | `ac-dc-cache-expanded`, `ac-dc-cache-sort` |
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