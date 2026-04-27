# Layer 5 — webapp

Historical delivery record. Moved from `IMPLEMENTATION_NOTES.md` during the docs refactor.

Covers Phase 1 (minimum viable shell), Phase 2 (essential tabs — chat, files, picker), Phase 2e (search and refinements — message search, file search, speech-to-text, history browser refinements), and Phase 3 (richer components — Monaco diff viewer, SVG viewer + editor, Context/Cache/Settings tabs, file navigation grid, Token HUD).

## Layer 5 — in progress

Layer 5 (webapp) is the largest remaining surface. Delivering in sub-phases to keep each commit coherent:

- **Phase 1 — Minimum viable shell** (delivered): AppShell root component, WebSocket connection via JRPCClient, startup overlay, reconnection with exponential backoff, dialog container with tab placeholders, toast system, server-push callbacks as window events.
- **Phase 2 — Essential tabs** (delivered): Chat panel (send/receive/streaming/markdown/edit blocks/images/file mentions/retry prompts/compaction events/message action buttons), Files tab (file picker tree, selection sync), action bar with session controls.
- **Phase 2e — Search and refinements** (delivered): message search, file search with test coverage, speech-to-text, history browser refinements (per-message action buttons, image thumbnails, context menu).
- **Phase 3 — Richer components** (delivered): Diff viewer (Monaco) with markdown preview + TeX preview + LSP + markdown link provider, SVG viewer with pan/zoom + SvgEditor (selection, drag, resize, vertex edit, path edit, inline text edit, multi-selection, marquee, undo, copy/paste) + presentation mode + context menu + copy-as-PNG + SVG↔text toggle + embedded image resolution, Context/Cache tabs, Settings tab, file navigation grid, Token HUD.

### 5.1 — Phase 1 Minimum viable shell — **delivered**

- `webapp/src/app-shell.js` — `AppShell` class extending `JRPCClient`. Inherited `serverURI`/`call`/`remoteTimeout` properties from the parent; registers itself as `AcApp` via `addClass(this, 'AcApp')` in `connectedCallback` so the backend's server-push callbacks (streamChunk, streamComplete, compactionEvent, filesChanged, userMessage, commitResult, modeChanged, sessionChanged, navigateFile, docConvertProgress, admissionRequest, admissionResult, clientJoined, clientLeft, roleChanged) are all registered. Each callback translates the RPC call into a corresponding `window` `CustomEvent` dispatch. This decouples the shell from child-component subscriptions — Phase 2 components listen on `window` rather than reaching through the DOM to the shell.
- Lifecycle hooks override `setupDone` (publishes `this.call` to `SharedRpc`, flips state to `connected`, shows "Reconnected" toast on subsequent connects), `remoteDisconnected` (clears SharedRpc, schedules exponential-backoff reconnect), and `setupSkip` (schedules reconnect on first-connect failure without wedging the startup overlay).
- Startup overlay driven by `startupProgress(stage, message, percent)` RPC callback. Brand mark + progress bar + message. On `stage === 'ready'`, a 400ms delay lets the user see 100% before the CSS fade-out. Reconnects bypass the overlay entirely.
- Reconnect schedule — `[1000, 2000, 4000, 8000, 15000]` ms capped, per specs4. Attempt counter increments across disconnects; reset to 0 on successful `setupDone`. Reconnect re-triggers by nulling + restoring `serverURI` (JRPCClient's setter tears down + reopens the socket).
- Toast system — subscribes to `ac-toast` window events via `connectedCallback` / `disconnectedCallback`. 3-second auto-dismiss. Default type `info`; success/error/warning supported. Components dispatch via `window.dispatchEvent(new CustomEvent('ac-toast', {...}))` rather than calling a method on the shell directly.
- Dialog stub — three tab buttons (Chat, Context, Settings). Each tab renders a placeholder. Phase 2 wires Chat; Phase 3 wires the others.
- `webapp/src/main.js` updated to import `./app-shell.js` and mount `<ac-app-shell>` into the `#app` element, replacing the boot splash. Port-parse helpers retained for tests and exported.
- `webapp/src/app-shell.test.js` — 21 tests covering initial state (connecting/overlay/default tab), `setupDone` (SharedRpc publish, state flip, first-connect overlay persistence, reconnect overlay dismissal + toast), `remoteDisconnected` (SharedRpc clear, state flip, reconnect scheduling — only when was-connected), `startupProgress` (stage/message/percent update, 0..100 clamping, ready delay-then-fade), reconnect backoff (attempt increment, 15s cap), toast system (window event subscription, auto-dismiss timing, no-message guard, default type, unsubscribe on disconnect), server-push callbacks (window event translation, navigateFile remote flag, filesChanged payload, jrpc-oo ack return value), tab switching.
- Test strategy — `@flatmax/jrpc-oo/jrpc-client.js` is mocked via `vi.mock` with a minimal `JRPCClient` class that extends `HTMLElement` and exposes the hook points (setupDone, setupSkip, remoteDisconnected, addClass, serverURI, call). Avoids opening real WebSocket connections during test. Module-mocked import is registered before `app-shell.js` is imported — order matters for vitest's hoisting.

Design points pinned by tests:

- **SharedRpc lifecycle.** `setupDone` publishes, `remoteDisconnected` clears. Pinned so the microtask-deferred hooks in RpcMixin (Layer 1.4) fire correctly. Subsequent layers depend on this.
- **First-connect vs reconnect overlay behaviour.** First connect keeps the overlay up until `stage === 'ready'` fires. Reconnect dismisses immediately. Pinned because specs4 is explicit — the user sees the progress bar only during initial startup, not during transient disconnects.
- **Reconnect only when was-connected.** A connection attempt that fails before `setupDone` should NOT schedule a retry via `remoteDisconnected` — the setupSkip path handles that instead. Pinned by `does NOT schedule reconnect before first successful connect` which verifies no `_attemptReconnect` call after 20s of fake time.
- **Window-event decoupling.** Every server-push callback dispatches a window event rather than holding a direct reference to a child component. Future components (chat panel, file picker, token HUD) listen independently and the shell doesn't need to know they exist.
- **Remote-origin flag on navigateFile.** Collaboration echo-prevention — a broadcast-originated navigation must be distinguishable so the receiving client doesn't re-broadcast and create an infinite loop.

Phase 1 does NOT include:

- Chat panel, file picker, or any tab content (Phase 2)
- Dialog dragging, resizing, minimizing, position persistence (Phase 3)
- Viewer background routing (Phase 3)
- File navigation grid, Alt+Arrow shortcuts (Phase 3)
- Token HUD (Phase 3)
- Global keyboard shortcuts beyond tab clicking (Phase 3)

### 5.2 — Phase 2a File picker — **delivered**

Standalone file picker component. No RPC yet, no git status badges, no context menu, no keyboard navigation — those ride in later sub-phases when the orchestrator is available to feed them data.

- `webapp/src/file-picker.js` — `FilePicker` component plus four exported pure helpers:
  - `fuzzyMatch(path, query)` — subsequence matching, case-insensitive, empty-query matches everything. The spec-documented examples (`edt`/`edit_parser.py`, `sii`/`symbol_index/index.py`) work directly.
  - `sortChildren(children)` — dirs before files, alphabetical within each group. Returns new array, doesn't mutate.
  - `filterTree(tree, query)` — prunes to nodes whose paths (or descendant paths for dirs) match the query. Empty query returns the input verbatim.
  - `computeFilterExpansions(tree, query)` — set of directory paths that must be expanded for every matching file to be reachable. Merged with user-expanded state at render time so filter-induced expansions never collapse directories the user deliberately opened.
- Component state — `tree` (default empty root so mount-before-load renders cleanly), `selectedFiles` (a Set, owned by the parent — picker dispatches `selection-changed` events and never mutates its own prop), `filterQuery` (internal state), `_expanded` (internal Set of directory paths).
- Rendering — two-row types (`.row.is-dir` / `.row.is-file`). Click on a dir row toggles expansion. Click on a file name dispatches `file-clicked` with `{path}`. Checkbox clicks use `event.stopPropagation()` so they don't also fire the row handler.
- Directory checkbox tri-state — checked when all descendants selected, indeterminate when some, unchecked when none. Clicking toggles the whole subtree. Empty directories' checkbox is a no-op (no descendants to toggle).
- Event contract — both `selection-changed` and `file-clicked` are dispatched with `bubbles: true, composed: true` so they cross the shadow DOM boundary to the files-tab orchestrator.
- Public methods — `setTree(tree)` for imperative updates from an RPC callback, `setFilter(query)` for the @-filter bridge from the chat input (Phase 2c), `expandAll()` for operations that should reveal everything (file-search results, Phase 2e).
- `webapp/src/file-picker.test.js` — 41 tests across 9 describe blocks. Pure helpers tested directly (15 tests covering subsequence matching, case-insensitivity, empty-query behaviour, no-mutation guarantees). Component tested via mount-and-interact: initial render, expand/collapse, file selection with Set-passed-by-parent, directory tri-state checkbox, filter typing with auto-expansion, filter clearing restoring user's expanded state, event bubbling across shadow boundaries. All tests pass.

Deferred to later Phase 2 sub-phases:

- Git status badges (M/S/U/D) — needs status arrays from `Repo.get_file_tree()` plumbed through the orchestrator (Phase 2c)
- Sort modes (mtime / size) — defer until the data shape is exercised end-to-end
- Keyboard navigation (arrow keys, space/enter) — Phase 2c when the orchestrator is present
- Context menu (stage, unstage, rename, delete, etc.) — Phase 2d; each menu item routes to an RPC call
- Three-state checkbox with exclusion set — Phase 2d, needs `set_excluded_index_files` RPC
- Middle-click path insertion — needs chat panel (Phase 2d)
- Branch badge at root — needs `Repo.get_current_branch()` RPC call (Phase 2c)
- Active-file highlight — needs `active-file-changed` events from the viewer (Phase 2c)
- File search integration (swap to pruned tree) — Phase 2e when search is wired up

Phase 2a does NOT yet wire the picker into `main.js` or the shell. The component self-registers via `customElements.define('ac-file-picker', ...)` but nothing imports it yet. Phase 2c imports it from the `files-tab` component.

Next up — Phase 2b: chat panel (basic) — message rendering, input area, streaming display, markdown. No edit blocks or file mentions yet; those ride in Phase 2d.

### 5.3 — Phase 2b Chat panel (basic) — **delivered**

Standalone chat panel component. Message list, input area, streaming display, basic markdown rendering, Send/Stop button, RPC integration via RpcMixin. Listens for server-push events (stream-chunk, stream-complete, user-message, session-changed) dispatched on `window` by the AppShell.

- `webapp/src/markdown.js` — thin wrapper around the `marked` library. Shared Marked instance configured with `breaks: true` (single newlines → `<br>`), `gfm: true` (tables, task lists), `silent: true` (degrade on bad input rather than throw). Exports `renderMarkdown(text)` (returns HTML string) and `escapeHtml(text)` (used for user messages which are rendered verbatim, not markdown-rendered). `try/catch` fallback in `renderMarkdown` produces escaped plain text if marked throws despite `silent: true` — defensive, shouldn't fire in practice.
- `webapp/src/chat-panel.js` — `ChatPanel(RpcMixin(LitElement))`. Components:
  - Messages list rendered as `.message-card` elements per-message, distinguished by role (`role-user`, `role-assistant`, `role-system`). User content rendered escaped verbatim; assistant + system-event content rendered as markdown.
  - Streaming message card with accent-coloured border and blinking cursor appears below the settled messages when `_streaming === true`.
  - Input area with auto-resizing textarea (max 12rem), Send button that becomes Stop during streaming, disconnected note when RPC isn't ready.
  - Auto-scroll on state updates — passive scroll listener disengages at > 100px from bottom, re-engages at < 40px. Double-rAF wait pattern before measuring scrollHeight.
- **Architectural contracts preserved (D10):**
  - **Streaming state keyed by request ID.** `_streams` is a `Map<requestId, {...}>`. Single-agent operation has at most one entry. Parallel-agent mode will produce N keyed states under a parent ID. The map shape is load-bearing; don't flatten to a singleton.
  - **Chunks carry full accumulated content, not deltas.** Chunk handler replaces `_streamingContent`, doesn't append. Test `uses full content, not delta accumulation` pins this by firing chunks out of order and asserting the last-seen content wins.
  - **rAF coalescing.** `_pendingChunks` Map holds the latest-seen content per request ID. The rAF callback drains and applies to `_streamingContent`. Rapid-fire chunks between frames collapse into one Lit re-render. Test `applies the latest content on each animation frame` pins this.
- **Request ID generation.** `generateRequestId()` exports for tests and future callers. Format: `{epoch_ms}-{6-char-alnum}` matching specs3.
- **User-message echo handling.** When we're the sender (`_currentRequestId` is set), the server's userMessage broadcast is ignored — we already added the message optimistically in `_send`. When we're a passive observer (no in-flight request), we add the broadcast message to our list so the conversation stays in sync with the active client's activity. Phase 2d will expand this for passive stream adoption.
- **Session-changed event.** Replaces the message list wholesale. Resets streaming state. Normalises incoming messages (strips backend metadata like `files`, `edit_results`, which Phase 2d will render).
- **Cancellation.** Stop button calls `LLMService.cancel_streaming(requestId)`. The server's completion event is what actually cleans up local state (cancelled completion arrives with `result.cancelled = true`). Best-effort — if the cancel RPC fails (server already finished), local cleanup runs anyway so the UI doesn't wedge.
- **Error handling.** `chat_streaming` rejection produces an assistant error message with the error text. `stream-complete` carrying `result.error` produces an error message. Both paths converge on the same error-rendered shape.
- `webapp/src/markdown.test.js` — 17 tests: empty input, paragraph wrapping, code fences (fenced + inline), language class preservation, headings, bold/italic, `breaks: true` behaviour, GFM tables + task lists, HTML escaping in prose, malformed input resilience, escapeHtml direct coverage (five-char replacement, order-correctness for `&<>`, plain text pass-through, numeric stringification).
- `webapp/src/chat-panel.test.js` — 31 tests across 10 describe blocks:
  - `generateRequestId` — format + uniqueness
  - Initial state — empty state, disconnected behaviour, RPC-connected state, send-button disabled when empty, enables on typing
  - Message rendering — user vs assistant labels, user content escaped (not markdown-rendered), assistant content markdown-rendered, system-event distinct styling, code fences in assistant messages
  - Send flow — optimistic user message add, RPC call with request ID, input cleared, streaming state flip, empty-input guard, already-streaming guard, RPC error → error message
  - Streaming events — chunks render in assistant slot, other-request-id chunks ignored, stream-complete moves content to messages, falls back to last streaming content when `response` absent (cancelled streams), error in completion produces error message
  - Chunk coalescing — latest-content wins per frame, full-content semantics (not delta accumulation)
  - Cancel — calls cancel_streaming with active ID, recovers locally when cancel fails
  - user-message event — ignored when we're sender, added when passive observer
  - session-changed event — replaces list, clears for empty sessions, resets streaming state, preserves system_event flag
  - Input handling — Enter sends, Shift+Enter doesn't, IME composition Enter doesn't
  - Cleanup — event listeners removed on disconnect

Marked added as a dependency — `"marked": "^14.1.0"`. No syntax highlighting library yet; code blocks render as plain `<pre><code>` with a `language-{lang}` class so Phase 2d can wire highlight.js without changing the chat panel's output shape.

Not wired into `main.js` yet. The component self-registers via `customElements.define('ac-chat-panel', ...)` but no caller imports it. Phase 2c imports it from the `files-tab` component.

Deferred to later sub-phases — explicit boundaries:

- Phase 2c: @-filter bridge to file picker, middle-click path insertion.
- Phase 2d: edit block rendering with diff highlighting, file mentions in rendered assistant output, images (paste/display/re-attach), session controls (new session, history browser), snippet drawer, input history (up-arrow recall), message action buttons, retry prompts, compaction event routing.
- Phase 2e: message search overlay, file search overlay, history browser modal, speech-to-text.

Next up — Phase 2c: files tab orchestration — wires picker and chat panel together via the files-tab component. Selection sync, file tree RPC loading, file mention routing, git status badges.

### 5.5 — Phase 2e.3 Speech-to-text — **delivered**

Dedicated component wrapping the browser's Web Speech API with a microphone toggle button in the chat panel's action bar. Each final utterance fires a `transcript` event that the chat panel catches and inserts at the textarea's cursor position with auto-space separators. Errors surface as toasts via a `recognition-error` event.

- `webapp/src/speech-to-text.js` — `SpeechToText` LitElement. Single reactive state property `_state` (`'inactive'` / `'listening'` / `'speaking'`) drives the LED styling. `_active` field tracks the user's toggle state separately from recognition state — a recognition session can be mid-cycle (listening, speaking, ended) while the toggle remains on.
- **Continuous mode implemented via auto-restart loop, not the native flag.** Native `continuous=true` has inconsistent silence handling across browsers; the loop (`onend` → schedule restart in 150ms → new instance) gives predictable utterance boundaries. Fresh `SpeechRecognition` instance per cycle — some browsers misbehave when restarting a stopped instance.
- **Browser support detection hides the host.** `_getRecognitionCtor()` probes `window.SpeechRecognition` then `window.webkitSpeechRecognition`. Returns null for Firefox, older browsers, jsdom. When null, `connectedCallback` sets `this.hidden = true` so the chat panel doesn't render an action-bar button that can never work. Also exposed as a static `SpeechToText.isSupported` getter for programmatic callers.
- **Error classification.** `onerror` with `code === 'no-speech'` or `'aborted'` is silently ignored — these fire at utterance boundaries under `continuous=false` and during restart races. Any other error code stops the session, reverts `_state` to inactive, and dispatches `recognition-error` with the code. Missing error field defaults to `'unknown'` so the event shape is stable.
- **Synchronous start() failure handled.** Some browsers throw from `start()` when permission is denied inline rather than firing an async error. Try/catch around the call catches these; behaves identically to an async error.
- **Clean disconnect releases the microphone.** `_stopRecognition` clears all event handlers before calling `stop()` — critical because otherwise the cycle's `onend` fires during teardown and schedules a restart on a component that's about to be garbage-collected. Cleared handlers also prevent the auto-restart loop from resurrecting a session the user just toggled off.
- **Chat panel integration** — `_onTranscript` inserts transcribed text at the textarea cursor position. Auto-space separators: prepend a space when the char before cursor is non-whitespace, append a space when the char after is non-whitespace. Pattern covers "dictating mid-sentence" and "appending to existing text". Cursor moves to the end of the inserted text so successive utterances continue naturally. `_onRecognitionError` translates error codes to human-readable messages (`not-allowed` → "Microphone access denied", `audio-capture` → "No microphone detected", etc.) and surfaces via toast.
- `webapp/src/speech-to-text.test.js` — 35 tests across 7 describe blocks. Fake `SpeechRecognition` installed via `window.SpeechRecognition` assignment (jsdom has no built-in). Tests drive the lifecycle deterministically: browser support detection (null constructor hides host, webkit-only path, `isSupported` property), toggle (starts inactive, click creates instance with correct config, second click stops, programmatic `toggle()` matches click, active class + aria-pressed reflect state), LED transitions (inactive → listening on audiostart → speaking on speechstart → listening on speechend → inactive on stop), transcript events (final results dispatch, bubble across shadow DOM, interim results skipped, empty transcripts skipped, malformed results defensively handled, multiple final results fire multiple events), auto-restart (onend restarts session after delay, `no-speech` / `aborted` errors don't break the loop, stopping cancels pending restart), errors (real errors stop + dispatch, bubble across shadow DOM, synchronous start() failure caught, missing error field → "unknown"), cleanup (disconnect stops active session, no-op when inactive, restart timer cleared, handlers nulled before stop).
- Test file demonstrates an important technique — the `FakeRecognition` class accumulates constructed instances in a static array, so tests can assert on the newest instance without guessing when restarts fire. Makes the auto-restart tests (which create multiple sessions in sequence) trivial to verify.

Delivered test count: 867 total (up from 832 after file search), all 18 webapp test files passing.

### 5.5b — Phase 2e.4 History browser refinements — **delivered**

Closes out Phase 2e by adding the per-message interactions the initial history-browser commit deliberately deferred (the 2e.2 scope cut called these "scope creep; basic load flow matters more"). With the Phase 3 diff-viewer stub now in place, the context menu's ad-hoc-comparison items have somewhere meaningful to dispatch.

- `webapp/src/history-browser.js` — additions:
  - Per-message hover toolbar: `📋 Copy` and `↩ Paste to Prompt` buttons at each message's top-right, opacity-animated so they appear only on hover (same pattern as chat panel's message toolbar in 2d).
  - Image thumbnails in preview. `normalizeMessageContent` from `image-utils.js` extracts images from multimodal content arrays; pre-existing `msg.images` (server's flattened shape) takes precedence. 60px thumbnails (smaller than chat panel's 80px — preview pane is narrower and users are scanning, not interacting), no re-attach overlay (re-attaching from a past session into the current input isn't part of the 2e.4 scope).
  - Context menu on right-click. Four items — "◧ Load in Left Panel", "◨ Load in Right Panel", "📋 Copy", "↩ Paste to Prompt". Positioned at viewport coordinates via `position: fixed` + style bindings. Dismiss paths: click outside the menu (document-level click listener with `composedPath()` check for menu containment), Escape key (first press closes menu only, second closes modal), modal close (context menu state cleared via the existing `_close` path and the `updated()` reset block).
  - `load-diff-panel` event dispatch carrying `{content, panel, label}` — bubbles and composes out of the shadow DOM so chat panel's event listener (Phase 3.1 will wire this to diff viewer's `loadPanel`) can route it. `label` is `"{role} (history)"` so the floating panel label in the diff viewer tells the user where the content came from.
  - Extracted text for all actions goes through `_extractMessageText(msg)` which delegates to `normalizeMessageContent` — multimodal messages have text blocks joined with `\n`, image blocks dropped. Empty-text messages (image-only) produce a no-op for copy / paste / load-in-panel rather than emitting an empty toast.
  - Copy path reuses the clipboard-write-or-warning-toast pattern from chat panel's `_copyMessageText` with `ac-toast` window-event dispatch (the browser is modal, so local toast would be overkill; the app shell's global toast layer is already listening).

- `webapp/src/history-browser.test.js` — three new test blocks covering:
  - **Image thumbnails** (4 tests) — renders for `images` field, renders for multimodal content arrays, absent image renders no section, renders alongside text.
  - **Hover action buttons** (9 tests) — toolbar shape, copy writes raw markdown source (not rendered HTML) to clipboard, copy success toast, copy warning when clipboard API unavailable, paste dispatches `paste-to-prompt` with text, event bubbles across shadow DOM, paste closes the modal, actions work on multimodal messages (text extracted), copy on empty content is a no-op.
  - **Context menu** (15 tests) — right-click opens menu, positions at click coordinates, four items render with correct labels, contextmenu event's `preventDefault` is called (stops native browser menu), Load-in-Panel dispatches `load-diff-panel` with correct panel + content + label, event bubbles across shadow DOM, Load-in-Panel keeps modal open (lets users load both panels in succession), Load-in-Panel closes the context menu, Copy uses clipboard path and closes menu, Paste dispatches and closes modal, click-outside dismisses, Escape closes menu first then modal on second press, modal close also clears menu, reopening modal resets context menu state, document click listener removed on disconnect.

Design points pinned by tests:

- **Load-in-Panel doesn't close the modal.** Users often load a message into the left panel and then want to load a different message into the right panel for ad-hoc comparison. Closing after the first load would force them to reopen the browser every time. The Copy and Paste-to-Prompt items DO close (paste's point is to return to the input; copy's point is that the user now wants to paste elsewhere — usually outside the modal). Pinned explicitly because the asymmetry is easy to miss.

- **Escape priority: context menu → modal.** Two-step Escape matches how most desktop apps handle modal-plus-popover stacks. Without this, right-clicking and then Escape-ing would dismiss the entire history browser, making the user re-open it to try again. Pinned by `test_escape_after_menu_already_closed_closes_the_modal`.

- **composedPath() used for dismiss click detection.** The context menu lives in the history browser's shadow DOM; the document-level click listener sees the shadow host as the target. Walking `composedPath()` lets us distinguish "click inside the menu" (let the button handler run) from "click anywhere else" (dismiss). Matches the same pattern Phase 3's SVG viewer uses for its context menu.

- **Raw markdown source on copy, not rendered HTML.** Pinned by `test_copy_button_writes_raw_text_to_clipboard` which asserts `"use **bold** here"` (asterisks intact) rather than an HTML `<strong>` representation. A user pasting into another editor wants the markdown source, and the assistant message renders bold-via-markdown is a presentation-layer concern.

- **`msg.images` takes precedence over multimodal extraction.** The history store's `get_session_messages` path reconstructs image_refs into a top-level `images` array — that's the server's canonical shape and should win when present. Multimodal content arrays are the fallback for callers that pass the raw message shape directly. Both paths covered by separate tests.

Not included (explicit scope boundaries):

- **Image lightbox in history preview.** Clicking a thumbnail currently does nothing. Adding a lightbox would duplicate chat panel's implementation and the spec isn't explicit that it's needed here. A user who wants to examine a past image closes the browser, loads the session, and views it in the main chat panel where the lightbox already lives.
- **Re-attach overlay on history thumbnails.** Chat panel's thumbnails have a `📎` button that re-adds the image to the current input. History browser doesn't — re-attaching an image from an earlier session is a reasonable feature but specs4 doesn't call for it, and the Paste-to-Prompt path already lets users bring back past text; images are a separate concern with a different UX path.
- **Wiring the `load-diff-panel` consumer.** Phase 3.1 will add a handler on the chat panel (or directly on the app shell) that calls `diffViewer.loadPanel(content, panel, label)`. The event fires correctly today; the payload is ready; only the final consumer is Phase 3's job.

## Layer 5 — Phase 2 complete

Phase 2 (essential tabs) is complete. All of: chat panel with full message rendering pipeline, files tab orchestration, file picker, search integration (message + file), speech-to-text, history browser with per-message actions. Ready to proceed to Phase 3 (richer components — diff viewer with Monaco, SVG viewer, Context/Cache/Settings tabs, file navigation grid, TeX preview, Doc convert tab).

### 5.29 — Phase 3.6 Token HUD — **delivered**

Floating transient overlay showing per-request token breakdown after each LLM response. Appears in the top-right corner of the viewport, auto-hides after 8 seconds with an 800ms fade. Hover pauses the timer; mouse leave restarts. Dismiss button hides immediately. Five collapsible sections with state persisted to localStorage.

- `webapp/src/token-hud.js` — `TokenHud(RpcMixin(LitElement))`:
  - Listens for `stream-complete` window events; filters out errors and empty results
  - Extracts `token_usage` from the result immediately for the "This Request" section
  - Fetches full `get_context_breakdown` asynchronously for tier data, budget, changes, totals
  - Auto-hide: 8s → 800ms CSS opacity fade → hidden. Hover pauses; mouse leave restarts
  - Five collapsible sections: Cache Tiers (per-tier bar chart with lock icon), This Request (prompt/completion/cache read/write), History Budget (usage bar with percentage), Tier Changes (promotions/demotions), Session Totals (cumulative)
  - Section collapse state persisted to `ac-dc-hud-collapsed` as JSON-serialized Set
  - Cache hit rate badge in header with color coding (≥50% green, ≥20% amber, <20% red)
  - Prefers `provider_cache_rate` over local `cache_hit_rate` when available
  - `visible` attribute reflected manually for CSS `:host([visible])` selector
  - Tier colors follow warm-to-cool spectrum (L0 green, L1 teal, L2 blue, L3 amber, active orange)
  - Handles missing/partial data gracefully (placeholder text for each section)

- `webapp/src/app-shell.js` — imports `token-hud.js`, renders `<ac-token-hud>` after the toast layer

## Layer 5 — Phase 3 complete

Phase 3 (richer components) is complete. All of: Monaco diff viewer with markdown preview, TeX preview, LSP integration, and markdown link provider; SVG viewer with synchronized pan/zoom, full SvgEditor visual editing surface (selection, drag-to-move, resize handles, vertex edit, path command parsing, inline text editing, multi-selection with marquee, undo stack, copy/paste/duplicate), presentation mode, context menu, copy-as-PNG, SVG↔text mode toggle, embedded image resolution; Context tab with Budget and Cache sub-views; Settings tab; file navigation grid with Alt+Arrow traversal and fullscreen HUD; Token HUD floating overlay.

Remaining Layer 5 work:
- **Doc Convert tab** — delivered across six commits (one remaining). Commits 1–5 landed the full interaction surface:
  - **Commit 1** — component scaffold with RpcMixin wiring
  - **Commit 2** — `is_available` probe + `scan_convertible_files` list rendering with status badges, sizes, over-size markers; filter bar with fuzzy match; toolbar with select-all / deselect-all / disabled Convert button
  - **Commit 3** — app-shell tab registration + visibility gate on `doc_convert_available`
  - **Commit 4** — conversion trigger + progress view with per-file status (background async + inline sync modes); event subscription driving `start` / `file` / `complete` stages; summary view with retry/done buttons
  - **Commit 5** — clean-tree gate via `Repo.is_clean` probe (`2f5451e`). `_treeClean` tri-state property (true/false/null) drives amber dirty-tree banner and Convert button disabling. Null state keeps button enabled — backend gate is final authority. Refetched on every `files-modified` so banner follows commits/resets performed elsewhere. Also: `⚠ conflict` label with explicit overwrite+diff-review tooltip; `is-oversize` row class with disabled checkbox and skip-plus-non-selectable tooltip; `_toggleSelection` and `_selectAll` guards against over-size paths; `_convertError` prefers `result.reason` over `result.error` so users see "Participants cannot convert files" rather than a bare "restricted" code.
  - **Commit 6** — remaining. Per-sub-commit plan still to confirm.
- **Dialog polish** — dragging, resizing, minimizing, position persistence to localStorage. Currently the dialog is fixed left-docked at 50% width.
- **File picker enhancements** — git status badges (M/S/U/D), branch badge at root, context menu (stage/unstage/rename/delete/new file), three-state checkbox with exclusion, keyboard navigation, sort modes (mtime/size), active-file highlight from viewer events, middle-click path insertion.
- **App shell polish** — ~~state restoration cascade (get_current_state on setupDone)~~, ~~file/viewport persistence to localStorage~~, window resize handling, global keyboard shortcuts (Alt+1..4 for tabs, Alt+M for minimize, Ctrl+Shift+F prefill from selection).
- **Collaboration UI** — admission flow (pending screen, admission toast), participant UI restrictions, connected users indicator, collab popover with share link.

These are enhancement-level items that build on the working foundation. The core interaction loop (chat + file selection + file viewing + editing + search) is fully functional.

### 5.28 — Phase 3.5 File navigation grid — **delivered**

Implements the 2D spatial file navigation grid with Alt+Arrow traversal and fullscreen HUD overlay. Every file-open action creates a new node adjacent to the current node; Alt+Arrow keys traverse spatially; a semi-transparent HUD appears while Alt is held showing the grid structure with connector lines and travel counts.

- `webapp/src/file-nav.js` — `FileNav` LitElement component with:
  - Grid data model: `_nodes` Map, `_gridIndex` position→id lookup, `_travelCounts` per-edge, `_currentNodeId`, auto-incrementing `_nextId`
  - `openFile(path)` — same-file suppression, adjacent same-file reuse (increments travel count), placement in PLACEMENT_ORDER priority (right → up → down → left), replacement when surrounded (REPLACEMENT_ORDER tie-break: left → down → up → right)
  - `navigateDirection(dir)` — adjacent lookup with edge wrapping (left wraps to rightmost on same row, etc.), travel count increment
  - `show()` / `hide()` — HUD visibility with fade-out
  - `clear()` — resets grid, keeps current file as root
  - Replacement undo — 3-second toast with Undo button, restores removed node + travel counts
  - HUD rendering — centered on current node, connector lines between adjacent nodes, travel counts at midpoints, file-type-colored node cards with truncated basenames, current-node highlight, same-file glow
  - File type colors following visible spectrum by language family
  - Click-to-teleport on any node (dispatches navigate-file with `_fromNav` flag)
- `webapp/src/app-shell.js` — integration:
  - Imports `file-nav.js`, renders `<ac-file-nav>` before the dialog
  - `_onGridKeyDown` (capture phase) — Alt+Arrow consumed when grid has nodes, navigates direction, shows HUD, routes to viewer; Escape hides HUD
  - `_onGridKeyUp` — Alt release hides HUD
  - `_onNavigateFile` — registers files with the grid unless `_fromNav` or `_refresh` flags are set

### 5.27 — Phase 3.4 Context tab (Budget + Cache sub-views) — **delivered**

Wires the Context dialog tab to `LLMService.get_context_breakdown`. Budget/Cache pill toggle at the top; active sub-view persisted to localStorage. Both sub-views listen for `stream-complete`, `files-changed`, and `mode-changed` window events — refresh when visible, mark stale when hidden, auto-refresh on `onTabVisible()`.

Budget sub-view shows:
- Model name + cache hit rate + mode indicator
- Token budget bar (green ≤75%, amber 75–90%, red >90%)
- Proportional stacked horizontal bar by category (system/symbol-map/files/URLs/history) with colored segments
- Legend row with per-category token counts
- Per-category detail rows with proportional bars
- Session totals grid (prompt in, completion out, total, cache read/write when non-zero)

Cache sub-view shows:
- Cache performance header with hit-rate bar (color-coded: ≥50% green, ≥20% amber, <20% red)
- Recent changes section (promotions 📈 and demotions 📉) when any occurred this cycle
- Per-tier collapsible groups with tier-colored headers, total tokens, and cached lock icon
- Per-item rows within expanded tiers: type icon (⚙️/📖/📦/📝/📄/🔗/💬), name/path, stability bar (N/threshold with tier-colored fill), and token count
- Unmeasured items collapsed into a summary line ("N pre-indexed symbols/documents (awaiting measurement)")
- Empty tiers show "Empty tier" placeholder
- Tier expand/collapse state persisted to `ac-dc-cache-expanded` localStorage key (defaults: L0 and active expanded)
- Footer with model name and total token count

- `webapp/src/context-tab.js` — `ContextTab(RpcMixin(LitElement))` component:
  - `_subview` persisted to `ac-dc-context-subview` localStorage key
  - `_refresh()` fetches via `get_context_breakdown`, guarded by loading flag
  - `_isTabActive()` checks parent `.tab-panel.active` class
  - Stale detection on `stream-complete` / `files-changed` / `mode-changed` when hidden
  - `onTabVisible()` public hook for the dialog to call on tab switch
  - `_fmtTokens(n)` formats with K suffix
  - `_budgetColor(pct)` returns green/amber/red by threshold
  - `_COLORS` map for category segments
  - Budget sub-view handles missing/partial backend data gracefully (empty state, field defaults)
  - Cache sub-view:
    - `_cacheExpanded` Set persisted to `ac-dc-cache-expanded` (defaults: L0, active)
    - `_TIER_COLORS` map (L0 green → L1 teal → L2 blue → L3 amber → active orange)
    - `_TYPE_ICONS` map for per-item type classification
    - `_renderCacheTier(block)` — collapsible tier group with measured/unmeasured item split
    - `_renderCacheItem(item, block, tierColor)` — per-item row with icon, name, stability bar, N/threshold label, token count
    - Unmeasured items (tokens=0) collapsed into summary line with mode-aware label
    - Recent changes section (promotions/demotions) rendered above tier groups
    - Footer with model name and total tokens

- `webapp/src/app-shell.js` — imports `context-tab.js`, renders `<ac-context-tab>` when `activeTab === 'context'`. Removes the last placeholder tab fallback.

### 5.26 — Phase 3.3 Settings tab — **delivered**

Wires the Settings dialog tab to the `Settings` RPC service (Layer 4.5). Card grid of eight whitelisted config types; clicking a card opens an inline monospace textarea editor. Save writes via `Settings.save_config_content`; reloadable configs (LLM, App) auto-trigger their reload RPC on save. Ctrl+S shortcut within the textarea. Info banner shows model names and config directory from `Settings.get_config_info`.

- `webapp/src/settings-tab.js` — new `SettingsTab(RpcMixin(LitElement))` component:
  - `CONFIG_CARDS` array — eight entries matching the backend's `CONFIG_TYPES` whitelist (litellm, app, system, system_extra, compaction, snippets, review, system_doc). Each has icon, label, format hint, and reloadable flag.
  - `_loadInfo()` — fetches model names + config dir on RPC ready.
  - `_openCard(key)` — loads content via `get_config_content`, sets `_activeKey` to show the editor.
  - `_save()` — writes via `save_config_content`, surfaces advisory JSON warnings, auto-triggers reload for reloadable types.
  - `_reload()` — dispatches to `reload_llm_config` or `reload_app_config` based on the active key.
  - `_onEditorKeyDown` — Ctrl+S shortcut within the textarea.
  - Toast feedback for all success/error/warning paths via `ac-toast` window events.

- `webapp/src/app-shell.js` — imports `settings-tab.js`, renders `<ac-settings-tab>` when `activeTab === 'settings'`. Context tab remains a placeholder.

### 5.25 — Phase 3.2e SVG embedded image resolution — **delivered**

Resolves relative `<image href="...">` references in SVG files rendered by the viewer. PDF/PPTX-converted SVGs produced by doc-convert reference sibling raster images with relative paths (e.g., `<image href="01_slide_img1.png"/>`). When injected into the webapp DOM, the browser resolves these against the webapp's origin URL — which doesn't serve repo files — so images silently fail to load.

- `webapp/src/svg-viewer.js` — additions:
  - `_resolveImageHrefs(container, svgPath)` — scans a `.svg-container` for `<image>` elements, skips data URIs and absolute URLs, resolves relative paths against the SVG file's directory, fetches via `Repo.get_file_base64`, rewrites `href` and `xlink:href` in-place. Runs in parallel via `Promise.all`. Non-blocking — panels are interactive immediately, images appear as fetches complete. Failed fetches log a warning.
  - `_resolveOneImageHref(imgEl, repoPath, call)` — per-image fetch + rewrite. Handles both `href` and `xlink:href` attribute forms.
  - `_extractBase64Uri(result)` — unwraps Repo.get_file_base64 responses (plain string, `{data_uri}`, `{content}`, jrpc-oo envelope).
  - Called from `_injectSvgContent` after SVG injection on both panels (left skipped in presentation mode).

### 5.24 — Phase 3.2d SVG viewer presentation, context menu, copy-as-PNG, mode toggle — **delivered**

Adds four features to the SVG viewer surface:

1. **Presentation mode** — `◱` button (or F11) toggles left panel hidden, right panel full-width. Editor stays active. Escape exits. CSS `display: none` on the left pane rather than DOM removal so the editor's SVG element and event listeners survive the toggle. Pan-zoom skipped in presentation mode (no left panel to sync). Mode resets to select when the last file closes.

2. **Context menu** — right-click on the right panel shows a "📋 Copy as PNG" item. Positioned at click coordinates via `position: fixed`. Dismissed on click outside (document-level listener with `composedPath()` containment check) or on Escape.

3. **Copy as PNG** — renders the current modified SVG to a canvas with white background and quality scaling (up to 4× for small SVGs, capped at 4096px). Clipboard write via `ClipboardItem` with a promise-of-blob (preserves user-gesture context across async). Download fallback when clipboard API unavailable. Toast feedback via `ac-toast` window event.

4. **SVG ↔ text diff mode toggle** — `</>` button on the SVG viewer dispatches `toggle-svg-mode` with `target: 'diff'`. `🎨 Visual` button on the diff viewer dispatches `toggle-svg-mode` with `target: 'visual'`. App shell handler orchestrates the swap: captures content + savedContent from the source viewer, closes the file on both viewers, opens on the target with carried state so dirty tracking survives the transition.

- `webapp/src/svg-viewer.js` — additions:
  - `_MODE_SELECT` / `_MODE_PRESENT` constants and `_mode` reactive property
  - `_togglePresentation()` — flips mode, clears content caches so re-injection fires
  - `.split.present` CSS hides left pane, expands right to 100%
  - `.floating-actions` stack replaces the standalone fit button — three buttons (presentation toggle, text-diff toggle, fit)
  - `_onContextMenu` / `_onContextDismiss` — context menu lifecycle
  - `_copyAsPng()` — full pipeline: parse dimensions → scale → canvas → clipboard or download
  - `_switchToTextDiff()` — captures editor content and dispatches `toggle-svg-mode`
  - `_emitToast` routes through `ac-toast` window event (matches app shell's toast layer)
  - F11 and Escape keyboard handling in `_onKeyDown`
  - Ctrl+Shift+C for copy-as-PNG
  - Presentation mode skips left-panel SVG injection and pan-zoom init

- `webapp/src/diff-viewer.js` — additions:
  - `_isSvgFile(file)` helper
  - `_switchToVisualSvg()` — reads live editor content and dispatches `toggle-svg-mode`
  - `🎨 Visual` button rendered when active file is `.svg`

- `webapp/src/app-shell.js` — additions:
  - `_onToggleSvgMode` handler — catches `toggle-svg-mode` window events, routes content between viewers with dirty-state preservation
  - Event listener wiring in connectedCallback/disconnectedCallback

### 5.23 — Phase 3.2c.5 SvgEditor undo stack + copy/paste — **delivered**

Adds undo stack (SVG innerHTML snapshots before each mutation, Ctrl+Z to restore, bounded to 50 entries) and internal copy/paste (Ctrl+C/V/D). Completes the Phase 3.2c editing surface.

- `webapp/src/svg-editor.js` — additions:
  - `_undoStack` array and `_clipboard` array on the constructor
  - `_pushUndo()` — snapshots `this._svg.innerHTML` with handle group and text-edit foreignObject temporarily stripped so undo doesn't restore stale selection chrome. Bounded to `_UNDO_MAX` (50) entries
  - `undo()` — pops the stack, replaces innerHTML, clears selection (DOM element references become stale after innerHTML replacement), fires onChange. Returns boolean indicating whether an undo was performed
  - `canUndo` getter for UI/test visibility
  - `copySelection()` — serializes selected elements' outerHTML to the internal clipboard array
  - `pasteClipboard(offsetX?, offsetY?)` — deserializes clipboard HTML via a temporary SVG wrapper, applies positional offset via `_applyPasteOffset`, inserts before the handle group, selects pasted elements
  - `duplicateSelection()` — copy + paste with zero offset
  - `_applyPasteOffset(el, dx, dy)` — per-element-type position dispatch matching the drag-to-move pattern (rect/image/use via x/y, circle/ellipse via cx/cy, line via all four endpoints, text via x/y or transform, path/g/polygon/polyline via transform)
  - Keyboard handlers for Ctrl+Z (undo), Ctrl+C (copy), Ctrl+V (paste), Ctrl+D (duplicate)
  - `deleteSelection()`, drag commit (`_onPointerMove` threshold crossing), and `commitTextEdit()` all call `_pushUndo()` before mutating
  - `detach()` clears both `_undoStack` and `_clipboard`
  - Shift+click now takes priority over handle hit-test in `_onPointerDown` — prevents accidental resize drags when the user intends to modify the selection set

- `webapp/src/svg-editor.test.js` — 25 new tests across 2 describe blocks:
  - **Undo stack** (13 tests): undo after delete restores SVG, undo clears selection (stale refs), undo fires onChange, empty stack returns false, undo after drag commit restores pre-drag state, undo after text edit commit restores original text, unchanged text edit doesn't push undo, stack bounded to 50, detach clears stack, Ctrl+Z keyboard trigger, multiple progressive undos, undo snapshot excludes handle group
  - **Copy/paste** (12 tests): copy populates clipboard, paste inserts with offset, pasted rect has correct offset, paste selects pasted element, paste fires onChange, paste pushes undo, empty clipboard no-op, empty selection copy no-op, Ctrl+C/V keyboard flow, duplicate in place (zero offset), Ctrl+D keyboard, multi-selection copy/paste, circle cx/cy offset, path transform offset, detach clears clipboard

Design points pinned by tests:

- **Undo snapshot excludes handle group.** `_pushUndo` temporarily removes the `<g id="svg-editor-handles">` before reading `innerHTML` and restores it after. Without this, undo would restore stale handle chrome from a prior selection state, and repeated undo/redo would accumulate duplicate handle groups.

- **Undo after innerHTML replacement clears selection.** DOM element references held in `_selected` and `_selectedSet` become stale after `innerHTML` replacement — the old DOM nodes are detached and new ones created. Keeping stale refs would cause subsequent operations (drag, delete, resize) to silently fail or corrupt the SVG. Clearing forces the user to re-select, which is the correct UX after undo.

- **Unchanged text edits don't push undo.** Opening a text edit, not typing, then pressing Enter should not pollute the undo stack. The commit path checks `newContent !== originalContent` before calling `_pushUndo`. This keeps the stack clean so Ctrl+Z always undoes a meaningful change.

- **Paste inserts before the handle group.** Pasted elements render below the selection chrome (handles, bounding boxes) so the user sees both the pasted content and the selection overlay. Without this ordering, the pasted element would render on top of the handles, making them unclickable.

- **Shift+click priority over handle hit-test.** Before this change, shift+click on a selected element with visible handles would fall through to the handle hit-test (which returns null since no handle is exactly under the pointer) and then to the move-drag path. After this change, shift+click always dispatches to `toggleSelection` regardless of handle state. This fixes three test failures where shift+click was starting drags instead of modifying the selection.

### 5.22 — Phase 3.2c.4 SvgEditor multi-selection + marquee — **delivered**

Adds shift+click toggle, marquee selection (forward=containment, reverse=crossing), group drag, and multi-element delete. Per-element bounding-box rendering in multi-selection mode (no resize handles — those only make sense for single selection). Double-click on text in a multi-selection collapses to single + opens inline edit.

- `webapp/src/svg-editor.js` — additions:
  - `_selectedSet: Set` alongside `_selected`. `_selected` is the "primary" for single-element operations; `_selectedSet` holds every selected element.
  - `getSelectionSet()` returns a fresh Set copy each call.
  - `toggleSelection(element)` adds/removes from set; updates primary.
  - `setSelection` now clears the set and replaces with a single element.
  - `deleteSelection` iterates the full set; fires onChange once.
  - `_onPointerDown` branches on `event.shiftKey`: shift+click on element → toggle; shift+click on empty → begin marquee; plain click on set member → group drag; plain click elsewhere → replace selection.
  - `_beginDrag` snapshots every element in `_selectedSet` via `entries` array. `_applyDragDelta` iterates entries. `_cancelDrag` restores every entry.
  - Marquee machinery: `_beginMarquee`, `_updateMarquee`, `_endMarquee`, `_cancelMarquee`, `_marqueeCandidates`, `_marqueeHitTest`, `_elementBBoxInSvgRoot`, `_createMarqueeRect`, `_marqueeBBox`, `_marqueeBBoxFor`, `_svgDistToScreenDist`.
  - `_renderHandles` dispatches by set size: empty→clear, single→full handles, multi→per-element bbox overlay via new `_renderBBoxOverlay(group, element, isPrimary)`.
  - `_onDoubleClick` collapses multi-selection to the double-clicked text element before opening edit.
  - Module-level helpers: `_bboxOverlaps`, `_bboxContains`, `_MARQUEE_MIN_SCREEN`, `MARQUEE_ID`.

- `webapp/src/svg-editor.test.js` — 34 new tests across 7 describe blocks:
  - **Shift+click** (6): add, remove, primary promotion, last-removal clears, plain click replaces, non-selectable no-op.
  - **Rendering** (4): single → bbox + handles, multi → per-element bbox no handles, three-element → three bboxes, clearing removes all.
  - **Group drag** (6): starts on set member, moves all uniformly, onChange once, mixed types, detach rolls back all, click-unselected collapses.
  - **Delete** (3): removes all, keyboard removes all, onChange once.
  - **Double-click on text** (1): collapses + opens edit.
  - **Marquee** (10): shift+drag starts, shift+click no-op, forward containment, reverse crossing, adds to baseline, no-hits preserves, renders rect, below-threshold no rect, detach removes, scans `<g>` children.

### 5.21 — Phase 3.2c.3c SvgEditor inline text editing — **delivered**

Double-clicking a `<text>` element opens a foreignObject-hosted textarea positioned at the element's bounding box. The textarea inherits the text's font size and color. Enter commits, Escape cancels, blur commits (user-friendly — accidental click-aways don't discard work). Only one edit can be active at a time. Completes the 3.2c editing surface for visible SVG content.

- `webapp/src/svg-editor.js` — additions:
  - `_textEdit` state field in the constructor — `{element, originalContent, foreignObject, textarea}` during an active edit, null otherwise
  - Three new bound handlers: `_onDoubleClick`, `_onTextEditKeyDown`, `_onTextEditBlur`
  - `attach` / `detach` wire up the `dblclick` listener; `detach` calls `cancelTextEdit` so a detach during an edit rolls back rather than leaving an orphaned foreignObject
  - New public methods: `beginTextEdit(element)`, `commitTextEdit()`, `cancelTextEdit()`
  - New private methods: `_renderTextEditOverlay` (builds the foreignObject + textarea), `_teardownTextEditOverlay` (removes them), `_onDoubleClick` (dispatch gate)
  - foreignObject carries `HANDLE_CLASS` so `_hitTest` skips it — clicks inside the textarea don't re-hit-test to the underlying text element

- `webapp/src/svg-editor.test.js` — 39 new tests across 7 describe blocks:
  - **`beginTextEdit`** (11 tests): null argument no-op, non-text element no-op, opens foreignObject overlay for text, textarea value matches element content, overlay positioned from bounding box with padding, font-size inherited, fill color inherited, default font-size when attribute absent, foreignObject has handle class (hit-test exclusion), starting new edit commits prior one, captures original content for rollback
  - **`commitTextEdit`** (7 tests): no-op when not editing, replaces content with textarea value, removes foreignObject, clears state, fires onChange when changed, does NOT fire onChange when unchanged (clicking in and pressing Enter without typing doesn't mark file dirty), flattens tspan children wholesale, allows empty content
  - **`cancelTextEdit`** (5 tests): no-op when not editing, restores original content, removes foreignObject, no onChange fired, clears state
  - **Keyboard handling** (5 tests): Enter commits, Shift+Enter does not commit (multi-line), Escape cancels, other keys flow through, Delete key in textarea does not delete the underlying element (propagation stopped)
  - **Blur handling** (2 tests): blur commits, blur after commit is a no-op
  - **Double-click dispatch** (5 tests): text element opens edit, non-text ignored, empty space ignored, tspan resolves to parent text, stopPropagation on text hit
  - **Lifecycle** (4 tests): detach cancels active edit + restores content, detach doesn't fire onChange, handles re-render after commit, beginTextEdit during active drag doesn't crash

Design points pinned by tests:

- **Single text node replacement flattens tspan structure.** `commitTextEdit` clears all children and appends one text node. A `<text>` element with multiple `<tspan>` children loses the structure on first commit. Pinned by `flattens tspan children on commit`. Documented trade-off — most SVGs use plain text elements; tspan-heavy documents should be edited at the source. Alternative (per-tspan editing) would require a richer UI that's out of 3.2c scope.

- **Blur commits rather than cancels.** Users accidentally clicking outside the textarea shouldn't lose their edits. Pinned by `blur commits the edit`. If the user wants to abandon, Escape is explicit. The cost is that a deliberate click-away acts as an implicit save; the benefit is forgiving behavior for the common case.

- **onChange only fires on actual content change.** Opening an edit and committing without typing is a no-op — the file stays clean. Pinned by `does NOT fire onChange when content unchanged`. Without this, every double-click-to-inspect action would mark the file dirty, defeating dirty-tracking.

- **Enter vs Shift+Enter.** Plain Enter commits (matches IDE / form convention). Shift+Enter falls through to the textarea's default behavior — inserting a newline. Pinned separately. Allows multi-line text in SVG, though rendering multi-line in the committed text element requires the caller to handle the newline (our textarea value round-trips verbatim; the rendered `<text>` shows the content as a single line per standard SVG text rendering unless the caller adds tspan structure).

- **textarea keydown stops propagation for non-commit/cancel keys.** Without this, the document-level keydown handler would hijack Delete/Backspace and delete the selected text element while the user is editing it. Pinned by `textarea Delete key does not delete the element`. The commit/cancel keys do stopPropagation too (for symmetry), but they'd already have fired their action.

- **foreignObject carries HANDLE_CLASS.** `_hitTest` excludes elements with this class, so clicks inside the textarea don't re-hit-test to the text element underneath. Pinned by `foreignObject has handle class`. If this broke, clicking the textarea would fire pointerdown → hit-test returns text → already selected → starts a drag. The drag wouldn't commit (no pointermove) but the state thrash would be confusing.

- **Double-click routes via hit-test.** `_onDoubleClick` calls `_hitTest` which handles tspan → text resolution. Pinned by `double-click routes via tspan → parent text`. Users who double-click on a tspan child (the rendered text run) get the text element opened for editing — which is what they meant.

- **Starting a new edit commits the previous one.** Prevents orphaned foreignObjects stacking on the SVG. Pinned by `commits prior edit when starting a new one`. If the prior textarea had modifications, they're committed to the first element before the second edit opens.

- **Detach rolls back.** Same pattern as detach cancels drag. Pinned by `detach cancels active text edit` which verifies both the overlay removal and the content restoration.

Phase 3.2c editing surface is complete for visible SVG content: selection + drag-to-move + resize or vertex edit where meaningful + inline text editing. Remaining 3.2c work: multi-selection + marquee (3.2c.4), undo stack + copy/paste (3.2c.5).

### 5.20 — Phase 3.2c.3b-iii SvgEditor path arc endpoint edit (A) — **delivered**

Arc commands get an endpoint handle using the standard `p{N}` role format. Arc shape parameters (rx, ry, rotation, flags) stay fixed during drag — only args[5..6] move. Completes the path editing surface for all SVG path commands.

- `webapp/src/svg-editor.js` — no code changes needed.
  - `_computePathEndpoints` already emits arc endpoints (had since 3.2c.3b-i to support pen-position tracking across multi-command paths that include arcs)
  - `_renderResizeHandles` path branch already emits a `p{N}` handle for any non-null endpoint, which includes arcs
  - `_applyPathEndpointResize` already has a `case 'A':` branch (`args[5] += dx; args[6] += dy`) from 3.2c.3b-i
  - Module docstring updated with 3.2c.3b-iii scope note

- `webapp/src/svg-editor.test.js` — 17 new tests across 2 describe blocks:
  - **Path arc endpoint rendering** (5 tests): A command produces exactly one handle (p0 + p1, no c-handles), handle positioned at absolute endpoint, relative arc handle positioned at computed pen+delta endpoint, A produces no tangent lines (no control points → no tangents), multi-arc path renders one handle per arc endpoint with no cross-contamination.
  - **Path arc endpoint drag** (12 tests): dragging arc endpoint moves only args[5..6]; shape parameters preserved during drag (rx=15, ry=25, rotation=45, large-arc=1, sweep=0 all verified); relative arc endpoint drag applies delta to relative args; flag args stay as integers across round-trip (no "0.0" drift); arc drag in multi-command path leaves other commands alone; negative deltas work; repeated pointermoves recompute from origin; onChange fires after committed drag; tiny move doesn't commit; detach mid-drag restores `d`; clicking arc endpoint handle starts resize drag with correct kind+role; parse-serialize round-trip is lossless (re-parsed output matches expected command structure with mutated endpoint).

Design points pinned by tests:

- **Arc shape preserved during drag.** Dragging an arc endpoint doesn't reshape the curve — rx, ry, rotation, and the two flags stay exactly as they were. Pinned by `arc shape parameters preserved during drag` which uses distinctive shape values (45° rotation, large-arc=1, sweep=0) and asserts byte-exact preservation after a drag.

- **No control-point handles for arc shape parameters.** rx, ry, rotation are scalars; large-arc-flag and sweep-flag are booleans. None have a natural positional interpretation on screen, so there's nothing meaningful to drag. Users wanting to reshape an arc edit the source directly. Pinned by `A command produces exactly one handle (endpoint only)` which asserts only two handles exist total for a `M A` path (initial M's p0 plus A's p1).

- **Flag integers survive round-trip.** SVG path flag args are 0 or 1 — never fractional. The serializer's `String(n)` conversion handles these cleanly (integer numbers stringify as "0" and "1", not "0.0"). Pinned by `flags stay as integers across round-trip` which drags an arc with both flags set to 1 and asserts the output is byte-exact.

- **Endpoint dispatch was already correct.** The existing `case 'A': args[5] += dx; args[6] += dy; break;` in `_applyPathEndpointResize` has been there since 3.2c.3b-i landed. This sub-phase is primarily test coverage — proving the existing dispatch behaves correctly through the full pipeline (handle render → hit test → drag → serialize → re-parse). The parser round-trip test explicitly verifies this end-to-end.

- **No per-command relative math special-casing.** Arc's relative form uses the same "args are deltas from pen, adding drag delta shifts endpoint by exactly that delta" rule as every other relative command. Pinned by `relative arc endpoint drag applies delta to args`.

3.2c.3b is complete. The path editing surface covers every SVG path command — M, L, H, V, C, S, Q, T, A, Z — with appropriate handle shapes (endpoints for all non-Z, plus control points for C/S/Q). 3.2c.3c will add inline text editing via foreignObject textarea on double-click.

### 5.21 — Post-Phase-3 SvgEditor paired-editor refactor — **delivered** (commit `9770dc6`)

Replaces the `svg-pan-zoom` library with a paired-editor model. See [D18](decisions.md#d18--dropped-svg-pan-zoom-in-favor-of-unified-svgeditor-on-both-panes) for the architectural rationale.

**Before (5.11–5.20 as-shipped):** `svg-pan-zoom` instances ran on both panels for pan/zoom/fit; `SvgEditor` ran on the right pane only for visual editing. Two libraries, two coordinate systems, two viewBox authorities.

**After (this commit):** Both panes host `SvgEditor` instances — left in read-only mode, right fully editable. Pan/zoom/fit live inside the editor; there's no longer a separate navigation library. Each editor fires `onViewChange(viewBox)` on every viewBox write; the viewer mirrors writes between panes via `setViewBox(..., { silent: true })` guarded by a `_syncingViewBox` mutex.

- `webapp/src/svg-editor.js` — additions:
  - Constructor accepts `readOnly: boolean` option. When set, `_onPointerDown` and `_onKeyDown` bail immediately after allowing pan/zoom/fit. Selection, handles, marquee, text-edit, and the `onChange` callback are all skipped.
  - Constructor accepts `onViewChange(viewBox)` callback. Fired on every viewBox write — wheel zoom, pan drag, fit-content, programmatic `setViewBox`. The callback is the sole sync primitive; there is no longer a separate pan/zoom event surface.
  - `setViewBox(x, y, width, height, { silent })` — writes the viewBox attribute and fires `onViewChange` unless `silent: true`. The silent flag is for mirror writes so the sibling's own viewChange doesn't re-fire and cascade.
  - `fitContent({ silent })` — new option. The initial fit-on-setup path passes silent so the two panes' initial fits don't ping-pong through their respective callbacks.

- `webapp/src/svg-viewer.js` — replaces pan/zoom infrastructure:
  - `_panZoomLeft` / `_panZoomRight` / `_syncingPanZoom` removed. `_editorLeft` / `_editorRight` / `_syncingViewBox` replace them. `_editor` kept as a back-compat alias pointing at `_editorRight` so existing callers (tests, Phase 3.2c change handler) don't need path updates.
  - `_initPanZoom` / `_disposePanZoom` renamed to `_initEditors` / `_disposeEditors`. Both panes get an editor instance wired to a `_onLeftViewChange` / `_onRightViewChange` handler that mirrors to the sibling via silent `setViewBox`.
  - `preserveAspectRatio="none"` applied to BOTH panes (was right-pane only). The left pane's editor now drives its own viewBox; browser aspect-ratio fitting would fight the editor's coordinate math the same way it did on the right.
  - Mirror path is belt-and-braces with two guards: the silent-write flag on `setViewBox` skips the sibling's viewChange entirely, AND the `_syncingViewBox` mutex prevents any remaining cascade if a future refactor adds a code path that emits viewChange independently of setViewBox. Either guard alone would suffice; both together make the sync provably loop-free.
  - `_onFitClick` (fit button) now calls `fitContent()` on both editors under the mutex. No more calls to pan-zoom's `resize()` + `fit()` + `center()` sequence.

- `webapp/src/svg-viewer.test.js` — rewritten:
  - Module-level `vi.mock('svg-pan-zoom', ...)` removed. The editor class is pure DOM manipulation and runs fine under jsdom without mocking.
  - "Pan/zoom initialization" / "Pan/zoom synchronization" / "Pan/zoom disposal" describe blocks deleted wholesale.
  - "SvgEditor integration" block rewritten to cover both panes: both editors created, left is read-only, right is editable, back-compat alias, both panes have `preserveAspectRatio="none"`, both dispose on file close / switch / disconnect, change callback syncs modified content, handle group stripped from serialized content.
  - New "ViewBox synchronization" describe block: left pan mirrors to right, right pan mirrors to left, mutex prevents feedback loops, sync is a no-op when partner editor is missing, initial fit clears the mutex.
  - "Fit button" block rewritten to spy on `fitContent()` on both editors rather than the pan-zoom library's fit/center/resize.

- `webapp/package.json` — `svg-pan-zoom` dependency removed.

**Why keep the 5.11–5.12 and 5.15–5.20 entries?** They document what was built, tested, and committed at the time. The refactor doesn't invalidate the history — the drag/resize/vertex/path/text editing surface those entries describe is still in place, still covered by its tests, still the feature shape users see. The paired-editor change swaps the navigation substrate (pan-zoom library → editor read-only mode) without touching the editing surface. Future readers piecing together how selection math evolved should still see the full record; D18 is the pointer that tells them the navigation plumbing changed after-the-fact.

### 5.19 — Phase 3.2c.3b-ii SvgEditor path control-point edit (C/S/Q) — **delivered**

Cubic and quadratic Bézier curve commands get draggable control-point handles in addition to the endpoint handles from 3.2c.3b-i. Each control point is independently draggable with dashed tangent lines showing the connection to its endpoint.

- `webapp/src/svg-editor.js` — additions:
  - New module-level `_computePathControlPoints(commands)` — walks the command list (same pen-tracking machinery as `_computePathEndpoints`) and returns an array aligned with `commands`. Each entry is either an array of `{x, y}` control points (for C/S/Q) or null (for M/L/H/V/T/A/Z). C emits two CPs, S and Q emit one, T emits none (its control is reflected from the previous command, not independently draggable).
  - `_renderResizeHandles` — `path` branch extended to emit control-point handles with role `c{N}-{K}` (N = command index, K = 1 or 2) plus tangent lines connecting each control point to its endpoint. Tangent lines render BEFORE the endpoint dots so the endpoints visually stack on top when control points sit near them.
  - New `_makeTangentLine(x1, y1, x2, y2)` factory — dashed SVG line with `HANDLE_CLASS` and `pointer-events="none"`. Dash pattern and stroke width scale inversely with zoom. Carries handle class so `_hitTest` and `_hitTestHandle` both filter it out; only the control-point dots are interactive.
  - `_applyPathEndpointResize` — dispatch routes `c{N}-{K}` roles to the new `_applyPathControlPointResize` before the existing `p{N}` endpoint logic. Keeps the two paths clean rather than multiplexing everything through one switch.
  - New `_applyPathControlPointResize(el, o, role, dx, dy)` — parses `c{N}-{K}` via regex, validates the command index and K value, clones the command list, mutates the target command's control-point args (C with K=1 → args[0..1]; C with K=2 → args[2..3]; S/Q with K=1 → args[0..1]; invalid K or non-curve command → silent no-op).
  - `_computePathControlPoints` exported for tests.

- `webapp/src/svg-editor.test.js` — 38 new tests across 3 describe blocks:
  - **`_computePathControlPoints`** (8 tests): empty/null input, null for non-curve commands, C produces two CPs, S produces one CP, Q produces one CP, relative C/Q/S offset from pen, pen position tracked across non-curve commands.
  - **Control-point handle rendering** (10 tests): C produces 3 handles (p0 from M + c1-1 + c1-2 + p1), C handle positions match args, S produces 2 handles (c2-1 + p2 only — no c2-2), Q produces 2 handles, T produces no CP handle, relative C handles at computed coords, tangent lines from CPs to endpoint, tangent line positions (x1/y1 = CP, x2/y2 = endpoint), tangent lines carry HANDLE_CLASS and pointer-events="none", Q produces one tangent line, non-curve commands produce no tangent lines.
  - **Control-point drag** (16 tests): c1-1 on C moves first CP only, c1-2 on C moves second CP only, endpoint drag leaves CPs untouched, c1-1 on Q moves single CP, c2-1 on S moves single draggable CP, relative C control-point drag applies delta to args, relative Q control-point drag, repeated pointermoves recompute from origin, onChange fires after committed drag, tiny move doesn't commit, detach mid-drag restores `d`, malformed c-role (`c1` without K) no-op, out-of-range K (`c1-3`) no-op, K=2 on Q (only has one CP) no-op, control-point role on non-curve command no-op, click on `c1-1` handle starts resize drag with correct kind+role.

Design points pinned by tests:

- **Tangent lines render before endpoint dots.** The render order is: for each curve command, emit tangent line(s) first, then control-point dot(s), then the endpoint dot. DOM order becomes z-order in SVG — later siblings render on top. When a control point sits very close to its endpoint (e.g., a nearly-straight "curve" that's actually a line-like C), the endpoint dot stays clickable because it's on top of both the tangent line and the CP dot. Pinned indirectly by the click-starts-drag test which relies on `_hitTestHandle` finding the correct handle under the pointer.

- **`c2-1` not `c1-2` for S's control point.** The command index N refers to the command's position in the parsed array, NOT to which control point it is within the path. A path `M 0 0 C ... S ...` has the S at index 2, so its single control point is `c2-1`. Pinned by `S command produces 2 handles` which explicitly asserts `c2-1` and rejects `c2-2`. If the role format encoded the curve-number instead of command-index, dispatch would need a separate lookup table to map back.

- **T has no independently draggable control point.** The T command's control point is the reflection of the previous Q/T's last control through the previous endpoint. Making it draggable would either require mutating the previous command (surprising — the user didn't click on that command) or decoupling the T from its predecessor (violates SVG spec). Pinned by `T command produces no control-point handle`.

- **S has only one draggable control point.** Like T, S's first control point is reflected from the previous C/S. Only args[0..1] (the second control point) is user-draggable. K=2 on S produces a no-op. Pinned by `ignores K=2 on Q` (same rule applies — Q only has one CP) and by `S command produces 2 handles` which confirms the rendered role list contains `c2-1` but never `c2-2`.

- **Control-point role format is regex-matched.** `/^c(\d+)-(\d+)$/` — strict. A malformed role like `c1` (no K) fails the match and the handler returns early. Pinned by `ignores malformed control-point role`. If the regex was looser (e.g., `startsWith('c')` + split on `-`), a role like `c1-1-extra` would match and potentially crash on arg index out-of-bounds.

- **Non-curve commands never receive CP drag.** The dispatch's default case returns without mutation. If a future refactor emitted a `c{N}-{K}` role on an L command (bug), the drag would cleanly no-op rather than crash or silently corrupt the `d` attribute. Pinned by `ignores control-point role on non-curve command`.

- **Relative-form math is identical to endpoints.** The existing relative-command analysis from 3.2c.3b-i carries over: the pen position at the command's start doesn't change when args are mutated (earlier commands are untouched), so adding the drag delta to relative control-point args shifts the effective absolute control point by exactly the delta. Pinned by `relative C control-point drag applies delta to args` and the Q variant. No per-command relative math special-casing needed.

- **Tangent lines are pointer-events: none.** Users dragging near a control point shouldn't have the drag initiate on the line instead of the dot. Lines explicitly opt out; dots explicitly opt in (from 3.2c.2b). Pinned by `tangent lines carry handle class (excluded from hit-test)`.

3.2c.3b-ii completes curve editing. 3.2c.3b-iii will add A (arc) endpoint handles — arc shape parameters (rx, ry, rotation, flags) stay as-is; dragging the arc endpoint preserves the arc's shape while moving its destination.

### 5.18 — Phase 3.2c.3b-i SvgEditor path endpoint edit (M/L/H/V/Z) — **delivered**

Path elements get one draggable handle per non-Z command endpoint. Reuses the resize-drag machinery with a new `path-commands` snapshot kind. Parser covers all SVG path commands (M/L/H/V/C/S/Q/T/A/Z in both cases) so the follow-up sub-phases 3.2c.3b-ii (C/S/Q/T control points) and 3.2c.3b-iii (A arc parameters) only need to add handle rendering and per-command dispatch.

- `webapp/src/svg-editor.js` — additions:
  - `_PATH_ARG_COUNTS` — module-level dispatch table mapping command letters to arg counts. Both cases share the same counts; case determines coordinate interpretation (absolute vs relative) not arg shape.
  - `_parsePathData(d)` — tokenizes path string into command letters and numbers (regex handles signed numbers with sign-change as separator: `M-5-10` → `M`, `-5`, `-10`). Walks tokens, consuming the configured arg count after each command letter. Expands implicit command repetitions: `M 0 0 10 10 20 20` expands to `M 0 0 L 10 10 L 20 20` (M repeats become L, m repeats become l, others repeat themselves). Returns empty array on any parse failure for silent-no-op behavior.
  - `_serializePathData(commands)` — inverse of the parser. Individual command emission (no compaction) so round-tripping is lossless in the parser→serializer→parser direction. Number formatting via `.toString()` rather than `toFixed(N)` to preserve input precision.
  - `_computePathEndpoints(commands)` — walks the command list tracking pen position and most recent subpath start. Returns an array aligned with `commands`, each entry either `{x, y}` (absolute endpoint of that command) or `null` (for Z). Handles all commands: M/L/T use args[0..1]; H single-axis sets x only; V single-axis sets y only; C uses args[4..5]; S/Q use args[2..3]; A uses args[5..6]; Z returns null and advances pen to subpath start.
  - `_renderResizeHandles` — new `path` branch. Parses `d`, computes endpoints, emits one `_makeHandleDot` per non-null entry with role `p{N}`. Z commands produce null endpoints so they naturally skip handle emission.
  - `_captureResizeAttributes` — new `path` case producing `{kind: 'path-commands', commands: [...]}` with deeply-cloned args arrays (prevents drag mutations from leaking back into the snapshot). Kind name distinct from move-drag's `transform` kind — move translates via the transform attribute; vertex resize mutates the `d` attribute directly.
  - `_applyResizeDelta` — new `path-commands` dispatch → `_applyPathEndpointResize`.
  - New method `_applyPathEndpointResize(el, o, role, dx, dy)`. Parses role index, validates bounds, clones the command list, mutates the target command's endpoint args based on command letter (M/L/T at [0..1]; H at [0] x-only; V at [0] y-only; C at [4..5]; S/Q at [2..3]; A at [5..6]; Z skipped). Relative commands (lowercase) work naturally: their args ARE the delta-from-pen, so adding the drag delta shifts the effective endpoint by exactly the drag delta regardless of form.
  - `_restoreResizeAttributes` — new `path-commands` case calls `_serializePathData(snapshot.commands)` to write the origin `d` attribute back.
  - Test-only exports added: `_computePathEndpoints`, `_parsePathData`, `_serializePathData`.

- `webapp/src/svg-editor.test.js` — flipped one test + 50+ new tests:
  - Updated: `path selection produces no resize handles` → `path selection produces handles for each command endpoint`.
  - **`_parsePathData`** (12 tests): empty / null, simple M+L, case preservation, all commands, comma separators, sign-change tokenization, decimals / scientific, implicit repetition after M as L (uppercase and lowercase), implicit repetition for non-M commands, explicit command required after Z, whitespace variations, malformed input → empty.
  - **`_serializePathData`** (6 tests): empty / null, simple M+L, Z with no args, case preservation, numeric precision, round-trip through parser, mixed absolute + relative.
  - **`_computePathEndpoints`** (12 tests): empty, absolute M, absolute L chain, relative L chain (pen accumulation), H single-axis y-unchanged, V single-axis x-unchanged, relative H/V, Z returns null, Z updates pen to subpath start, multi-subpath tracks subpath start across M commands, C endpoint (args[4..5]), Q endpoint (args[2..3]), A endpoint (args[5..6]).
  - **Path handle rendering** (5 tests): one handle per non-Z command, Z commands produce no handle, handles at absolute coords for absolute commands, handles at computed coords for relative commands, H handle inherits y from pen.
  - **Path endpoint drag** (13 tests): p1 drag on M+L moves L endpoint only, p0 drag on M+L moves M only, H drag adjusts x only (y delta ignored), V drag adjusts y only (x delta ignored), relative command drag applies delta to args (endpoint shifts by drag delta), p2 drag on 3-command path leaves others unchanged, negative deltas, repeated pointermoves recompute from origin (no compounding), click on p0 starts resize drag with correct kind + role, onChange fires after committed drag, tiny move below threshold doesn't commit, detach mid-drag restores `d`, malformed role is no-op, out-of-range index is no-op.

Design points pinned by tests:

- **Implicit command repetition is per-SVG-spec.** `M 0 0 10 10 20 20` means moveto followed by two linetos, with the second and third coord pairs promoted to L. Same rule for lowercase — trailing pairs after `m` become `l`. Other commands repeat themselves verbatim. Test `expands implicit repetitions after M as L` pins the uppercase form; `expands implicit repetitions after m as l (lowercase)` pins the lowercase form; `expands implicit repetitions for non-M commands` pins the L self-repeat case. If this broke, paths written in the compact form common in real-world SVGs would fail to parse.

- **Sign changes tokenize as number boundaries.** `M-5-10L20-30` must parse as `M -5 -10 L 20 -30`. The tokenizer regex alternates between a command-letter match and a signed-number match, so sign characters always start a new number token. Pinned by `splits tokens on sign changes`. If the regex treated `-` as requiring preceding whitespace, compact paths would fail.

- **Relative command drag via arg addition.** When the user drags the endpoint of a relative command like `l 15 10`, the handle is rendered at its computed absolute position (pen + args). The drag delta (dx, dy) is added to the command's args directly: the new args become (15+dx, 10+dy). Since the pen position at this command's start is unchanged (earlier commands weren't touched), the effective endpoint shifts by exactly (dx, dy) — matching what the user sees on screen. Pinned by `relative command endpoint drag applies delta to args`. The subtle correctness here: relative command semantics (pen-relative) naturally align with how drag deltas work, so no special math is needed.

- **H and V ignore the irrelevant axis.** Dragging an H endpoint up/down should produce no change because H is horizontal-only. Strict users could drag exactly horizontally, but accepting both and discarding the off-axis component is more forgiving. Pinned by `dragging H handle adjusts x only (y delta ignored)` and the V counterpart. The alternative (reject the drag unless strictly on-axis) would make H/V handles feel broken.

- **Z updates pen to subpath start.** After Z, the pen logically returns to the most recent M's target position. A following relative command like `l 5 5` should start from that subpath start, not from the Z's no-endpoint position. Pinned by `Z updates pen position to subpath start` which uses a relative `l` after Z and verifies the endpoint is computed from the subpath start (not from somewhere else in the path).

- **Multiple subpaths each have their own start.** `M 0 0 L 10 10 Z M 100 100 L 110 110 Z l 5 5` has two subpaths. After the second Z, the pen is at the second subpath's start (100, 100), so the final relative `l 5 5` computes to (105, 105). Pinned by `tracks subpath start across multiple M commands`. If the subpath-start tracking was per-path (not per-subpath), multi-subpath Z semantics would be wrong.

- **Parse-serialize round-trip is lossless.** `round-trips through parser losslessly` pins that `_parsePathData(_serializePathData(parsed))` produces the same command array. Matters because drag dispatch goes through this round-trip on every pointermove (parse on snapshot, serialize on apply). If round-tripping lost precision or reordered commands, paths would subtly drift over extended edit sessions.

- **Parser failure silent.** Malformed `d` attributes return empty arrays. Handle rendering then emits zero handles — user sees no drag affordances for the broken path but the rest of the editor works. Alternative (throw) would strand the whole viewer on a single broken file. Pinned by `returns empty array on malformed input`.

- **3.2c.3b-i deliberately excludes control points.** C/S/Q/T handles render their endpoint only for now — 3.2c.3b-ii will add handles for the control points (C gets two extra, S/Q get one, T gets none because it's a reflected quadratic). The dispatch code in `_applyPathEndpointResize` has TODO-free switch cases for all command types including curves, so adding control-point handles in 3.2c.3b-ii only needs new role format (e.g. `c{N}-1`, `c{N}-2`) and new dispatch math — no refactor of the existing endpoint code.

Path endpoint editing complete for straight-line commands. 3.2c.3b-ii will add C/S/Q/T control-point handles; 3.2c.3b-iii will add A arc endpoint handles (arc shape parameters — rx, ry, rotation, flags — stay as-is, draggable arc endpoints move the arc while preserving its shape).

### 5.17 — Phase 3.2c.3a SvgEditor polyline/polygon vertex edit — **delivered**

Polylines and polygons get one draggable handle per vertex. Each handle moves a single point; other vertices stay put. Reuses the resize-drag machinery with two new snapshot kinds (`polyline-vertices` / `polygon-vertices`) and one new dispatch (`_applyVertexResize`). Path vertex handles deferred to 3.2c.3b where the `d`-attribute parser lives.

- `webapp/src/svg-editor.js` — additions:
  - `_renderResizeHandles` — new `polyline` / `polygon` branch. Parses the `points` attribute via `_parsePoints`, emits one handle dot per vertex with role `v{N}`. Handle position is the vertex coordinate verbatim — same reasoning as line endpoint handles: bbox-corner handles would be the wrong drag targets on non-rectangular shapes.
  - `_captureResizeAttributes` — new `polyline` / `polygon` cases producing `{kind: 'polyline-vertices', points: [...]}` or `{kind: 'polygon-vertices', ...}`. Kinds distinct from the move-drag `'points'` kind in `_captureDragAttributes` so dispatch branches never collide.
  - `_applyResizeDelta` — new `polyline-vertices` / `polygon-vertices` → `_applyVertexResize`.
  - New method `_applyVertexResize(el, o, role, dx, dy)`. Parses the role via `parseInt(role.slice(1), 10)`. Validates the index bounds. Clones the snapshot's points array and updates only the Nth point, leaving others unchanged. Serializes with the canonical `x,y` form (comma between components, space between points) matching the move-drag output.
  - `_restoreResizeAttributes` — new `polyline-vertices` / `polygon-vertices` cases restoring the `points` attribute from the snapshot.

- `webapp/src/svg-editor.test.js` — 1 existing test updated plus 16 new tests:
  - Updated: `polyline selection produces no resize handles` → `polyline selection produces one handle per vertex`. Previously scoped to 3.2c.2b; now flipped.
  - **Handle rendering** (2 tests): polyline produces N vertex handles at actual vertex coords (not bbox corners); polygon produces N vertex handles with sequential roles v0..v{N-1}.
  - **Per-vertex dispatch** (4 tests): v0 / v1 / v2 each move only their own vertex, leaving others unchanged. Polygon variant proves the dispatch works regardless of shape.
  - **No clamping** (1 test): dragging one vertex onto another produces coincident vertices — legal SVG (a zero-length edge renders invisibly), fully recoverable.
  - **Separator normalization** (1 test): input with mixed comma-space separators normalizes to canonical `x,y` form on output. Matches the move-drag path's behavior.
  - **Origin-relative deltas** (1 test): repeated pointermoves recompute from snapshot, not from previous position — prevents runaway compounding.
  - **Negative deltas** (1 test): leftward / upward vertex drags work symmetrically with rightward / downward.
  - **Lifecycle** (3 tests for polyline, 1 for polygon): clicking a vertex handle starts a resize drag with the correct kind + role; onChange fires after committed drag; tiny move below threshold doesn't commit; detach rolls back all points.
  - **Defensive error paths** (2 tests): malformed role (not `v{N}`) is a no-op; out-of-range index (e.g., `v99` on a 2-point polyline) is a no-op. Shouldn't happen in practice because roles come from our own handle rendering, but defensive against future refactors that might feed a snapshot from an external source.

Design points pinned by tests:

- **Origin-relative delta application.** `handles repeated pointermoves relative to origin` pins the invariant: every pointermove recomputes the Nth point from the snapshot, never from the previous move's result. Mirrors the move-drag's compounding prevention from 3.2c.2a. If this broke, dragging a vertex would produce exponential movement (each frame applying its delta on top of the previous delta's mutation), and the handle would fly away from the pointer.

- **Canonical output format regardless of input.** `handles comma-space-mixed input by normalizing on output` pins that input format variety doesn't contaminate output. SVG accepts many separator forms (`x,y` / `x y` / `x, y` / `x , y`); `_parsePoints` handles all of them. Re-serialization uses `x,y` with single space between pairs — same format the move-drag produces, so re-serialised polylines are visually stable across edit operations.

- **Defensive bounds checking.** `ignores out-of-range vertex index` and `ignores malformed role` both exercise the parseInt / validation paths. These shouldn't fire in production (roles come from our own handle rendering), but if a future refactor introduced a dispatch from an external source (e.g., undo-stack replay), a malformed role would silently corrupt the points attribute without the guards. Treating the invalid case as a no-op means the drag completes cleanly and the user's work isn't lost.

- **Snapshot kinds distinct per shape.** The polygon case uses `polygon-vertices` rather than `polyline-vertices` even though the serialization logic is identical. Keeping them separate matches the pattern established by `line-endpoints` vs `line` (the move-drag kind) — dispatch branches in `_applyResizeDelta` and `_restoreResizeAttributes` read cleanly without inspecting drag mode. If a future rendering difference emerges (e.g., polygons need implicit-close handling in some edge case), the dispatch already has a dedicated branch.

Phase 3.2c.3a is complete. 3.2c.3b adds path vertex editing (requires parsing the `d` attribute into command objects — M/L/H/V/C/S/Q/T/A/Z — and producing draggable handles at each command's endpoint and control points). 3.2c.3c adds inline text editing via foreignObject textarea on double-click.

### 5.16 — Phase 3.2c.2c SvgEditor line endpoint drag — **delivered**

Line elements get two handles — one at each endpoint — that drag independently. Closes out the 3.2c.2 resize-handle work. Reuses the `_beginResizeDrag` machinery with a new `line-endpoints` snapshot kind and a `_applyLineEndpointResize` dispatch.

- `webapp/src/svg-editor.js` — additions:
  - `_renderResizeHandles` now handles `line` tag: emits two `_makeHandleDot` instances at `(x1, y1)` and `(x2, y2)` with roles `p1` and `p2`. Reads endpoint coords directly from the element rather than from the bounding box — a diagonal line's handles sit on the line itself, not at the enclosing rect's corners, which would be the wrong drag-target positions.
  - `_captureResizeAttributes` extended with `case 'line'`: snapshot `{kind: 'line-endpoints', x1, y1, x2, y2}`. Kind name chosen not to collide with the existing `'line'` kind in `_captureDragAttributes` (which covers the move-drag case where both endpoints translate together).
  - `_applyResizeDelta` gains a `'line-endpoints'` dispatch branch → `_applyLineEndpointResize`.
  - `_applyLineEndpointResize(el, o, role, dx, dy)` — pure role dispatch. `p1` sets `x1 = o.x1 + dx; y1 = o.y1 + dy`. `p2` sets `x2/y2` similarly. No clamping.
  - `_restoreResizeAttributes` extended with `'line-endpoints'` case — writes all four attributes back. x2/y2 are written even when p1 was dragged (and vice versa), matching the pattern of other shapes' restore which always writes the full snapshot.

- `webapp/src/svg-editor.test.js` — 10 new tests plus one existing test updated:
  - Updated: `line selection produces no resize handles` renamed to `line selection produces two endpoint handles`. The previous behavior (no handles on line) was scoped to 3.2c.2b; this sub-phase reverses that.
  - **Handle positioning** (1 test): handles land at actual `(x1, y1)` and `(x2, y2)` coords for a diagonal line, not at bbox corners.
  - **Per-endpoint dispatch** (2 tests): p1 drag moves x1/y1 only (x2/y2 unchanged); p2 drag moves x2/y2 only (x1/y1 unchanged).
  - **No clamping** (2 tests): p1 dragged past p2 works without mutation; p1 dragged exactly onto p2 produces a degenerate zero-length line (legal SVG, renders invisible, handles remain grabbable).
  - **Negative deltas** (1 test): endpoints handle leftward/upward drags symmetrically with the rightward/downward cases.
  - **Lifecycle** (4 tests): clicking a `p1` handle initiates resize drag with correct role + snapshot kind; onChange fires after a committed p2 drag; tiny p1 move below threshold doesn't commit; detach mid-drag restores all four attributes (including the ones that shouldn't have changed — the restore path is consistent).

Design points pinned by tests:

- **No clamping.** `dragging p1 past p2 is allowed` pins that lines aren't clamped. Rects and ellipses clamp at 1 to prevent flipping (a flipped shape would leave the user holding the wrong handle mid-drag and the visual would be broken). Lines have no "front face" that flips — a line from (80, 80) to (50, 50) renders identically to one from (50, 50) to (80, 80), and the handles move with their endpoint coordinates regardless of ordering. Trying to clamp would complicate the code for no user-visible benefit.

- **Degenerate line allowed.** `dragging to same point produces degenerate line` pins that a zero-length line is legal and recoverable. Handles at identical coordinates visually overlap but both remain grabbable (the top handle wins the click; the user can drag it off to separate them). Unlike a zero-width rect (which would hide all 8 handles and strand the user), a zero-length line only loses visibility of the rendered stroke — the handle overlay stays at the point.

- **Endpoints read from attributes, not bounding box.** `handles positioned at actual endpoint coords` pins this explicitly with a diagonal line where bbox corners differ from endpoint coords. If this invariant broke (e.g., someone "simplified" by treating line handles like rect corners), the user would see handles floating in empty space next to the line — frustrating and inverse math would be needed to translate bbox-corner drags back to endpoint coords.

- **Snapshot kind distinct from move-drag kind.** The `_captureDragAttributes` path already uses `kind: 'line'` for the move case where the drag translates both endpoints together. Endpoint resize uses `kind: 'line-endpoints'` to keep the dispatch branches in `_applyResizeDelta` and `_restoreResizeAttributes` from colliding with the move-drag handlers. Pinned by `editor._drag.originAttrs.kind` equality in the click-starts-drag test.

Phase 3.2c.2 (resize handles for rect/circle/ellipse/line) is now complete. Ready to proceed to 3.2c.3 — vertex edit for polylines/polygons/paths plus inline text editing via foreignObject textarea.

### 5.15 — Phase 3.2c.2b SvgEditor resize handles — **delivered**

Adds corner/edge resize handles for rect, circle, and ellipse on top of 3.2c.2a's drag-to-move. Rect gets eight handles (four corners + four edges), circle and ellipse get four cardinal handles. Per-handle drag math pins the opposite corner/edge. Width/height/r/rx/ry clamped to a positive minimum so dragging past the opposite edge collapses to a small shape rather than flipping.

- `webapp/src/svg-editor.js` — additions:
  - `HANDLE_ROLE_ATTR = 'data-handle-role'` — dataset attribute name carrying the handle's compass direction. `nw`/`n`/`ne`/`e`/`se`/`s`/`sw`/`w` for rects; `n`/`e`/`s`/`w` for circles/ellipses.
  - `_MIN_RESIZE_DIMENSION = 1` — SVG-unit floor. A drag past the opposite edge clamps to this rather than producing a negative dimension (which renders as a flipped shape in most browsers but is confusing — which handle is the user now holding?).
  - `_renderResizeHandles(group, el, bbox)` — dispatches by tag. Rect emits eight handles at the bbox corners + edge midpoints. Circle and ellipse emit four cardinal handles. Other tags emit nothing (line endpoints land in 3.2c.2c; polyline/polygon/path vertices in 3.2c.3).
  - `_makeHandleDot(cx, cy, role)` — factory. Produces a `<circle>` with the shared `HANDLE_CLASS`, the role attribute, `pointer-events: auto` (opting back in from the group's `none`), accent-blue fill + white stroke. Radius from `_getHandleRadius()` so handles stay visually ~6px regardless of zoom.
  - `_drag` gained a `mode` field (`'move'` or `'resize'`) and a `role` field (resize only). `_onPointerMove` dispatches by mode; `_cancelDrag` dispatches the restore call likewise.
  - `_hitTestHandle(clientX, clientY)` — composed-aware `elementsFromPoint` walker that filters FOR handles rather than against them (the inverse of `_hitTest`). Returns the role string of the topmost handle under the pointer, or null.
  - `_onPointerDown` runs handle hit-test FIRST when something is selected. A handle hit starts resize drag; otherwise the normal select/move-drag flow proceeds. Guarded on `_selected` so a fresh click on an unselected shape can never accidentally start a resize.
  - `_beginResizeDrag(event, role)` — snapshots dimensional attributes via `_captureResizeAttributes`, captures pointer, sets `_drag.mode = 'resize'` with the role.
  - `_captureResizeAttributes(el)` — per-shape snapshot: rect captures x/y/width/height; circle captures cx/cy/r; ellipse captures cx/cy/rx/ry. Unknown tags return null (defensive — shouldn't reach here because handles are shape-specific).
  - `_applyResizeDelta(dx, dy)` — dispatches to `_applyRectResize`, `_applyCircleResize`, or `_applyEllipseResize`.
  - `_applyRectResize(el, o, role, dx, dy)` — role-based dispatch. Corners (nw/ne/se/sw) affect both axes; edges (n/e/s/w) affect one. Clamp applies to width/height; when the clamp fires AND the role is position-moving (w/nw/sw for x, n/nw/ne for y), the position is pinned so the opposite edge stays put. Without the pin, clamping width to `_MIN_RESIZE_DIMENSION` would leave x tracking the pointer and the shape would walk off-screen.
  - `_applyCircleResize(el, o, dx, dy)` — all four handles set radius = `hypot(pointer - center)`. Clamp to min.
  - `_applyEllipseResize(el, o, role, dx, dy)` — n/s handles set `ry = abs(pointer_y - cy)`; e/w handles set `rx = abs(pointer_x - cx)`. Center unchanged. Clamp to min.
  - `_restoreResizeAttributes(el, snapshot)` — mirror for cancel path.

- `webapp/src/svg-editor.test.js` — 46 new tests across 10 describe blocks:
  - **Handle rendering** (12 tests): rect produces eight handles, all compass directions present, handle positions match bbox corners + edge midpoints (NW at x/y, SE at x+width/y+height, etc.), circle produces four, ellipse produces four, line/polyline/path produce none, handles opt into pointer events, handles carry the shared class, handles replaced on reselection, clearing selection removes handles.
  - **Handle hit-test routing** (6 tests): clicking a handle starts resize drag with the correct role, handle click does NOT initiate the move-drag flow (verified by spying on `_hitTest` and asserting it's not called), handle hit-test only runs when there's a selection, `_hitTestHandle` returns null when no handle under pointer, returns role when a real handle is under the pointer, stops propagation on handle hit.
  - **Rect corners** (4 tests): se corner grows w/h; nw corner moves x/y AND shrinks w/h; ne moves y + grows w shrinks h; sw moves x + shrinks w grows h.
  - **Rect edges** (4 tests): n moves y + shrinks h; e grows w only; s grows h only; w moves x + shrinks w.
  - **Rect clamping** (3 tests): drag e past left edge clamps width to 1 and leaves x at origin; drag w past right edge clamps width to 1 AND pins x so the right edge (originally at 30) stays at 30 (x = 29); drag n past bottom edge clamps height to 1 and pins y.
  - **Circle** (4 tests): outward drag grows r, inward shrinks, drag through center clamps to 1 (Math.hypot always positive + clamp), any cardinal handle adjusts r (tested with n instead of e).
  - **Ellipse** (5 tests): e handle adjusts rx only, w handle also adjusts rx (abs distance), n handle adjusts ry, rx/ry clamp to 1 when dragged to center, center unchanged during resize.
  - **Lifecycle** (4 tests): onChange fires after committed resize, tiny resize move doesn't commit, detach mid-rect-resize rolls back all four attributes, detach mid-circle-resize restores r, detach mid-ellipse-resize restores rx+ry.

Design points pinned by tests:

- **Clamp AND pin for position-moving handles.** `drag past opposite edge with position-moving handle pins x` verifies that dragging the w handle way past the right edge clamps width to 1 but also freezes x at `original_right_edge - min_width`. Without the pin, x would continue to track the pointer and the shape would walk off the original right edge — confusing behavior. This matters for nw/sw/n/ne too (any corner/edge that normally moves a position attribute).

- **Circle symmetry.** All four cardinal handles use the same formula (radius = distance from center to pointer). `any cardinal handle adjusts the single radius` pins this by using the `n` handle and verifying the same vertical-distance math produces the expected radius. If we ever added per-handle behavior (which would be wrong for circles), this test would catch it.

- **Ellipse axis independence.** `n handle adjusts ry only` and `e handle adjusts rx only` verify that dragging one axis doesn't affect the other. The `other axis unchanged` assertions in each test are the key pin.

- **Handles are shape-specific.** `line selection produces no resize handles` pins that we don't render rect-style 8-handle overlays on non-resizable shapes. Line endpoint handles will land as a separate rendering path in 3.2c.2c.

- **Handle hit-test precedes main hit-test.** `handle click does not initiate move drag` spies on `_hitTest` and asserts it's not called when `_hitTestHandle` returns a role. Order matters: if main hit-test ran first, a click on a handle over the selected rect would initiate a move drag (since the handle is above the rect in the DOM tree). The gate is on `_selected` being non-null — without a selection, there are no handles, so `_hitTestHandle` would waste time walking elements.

- **Clamp floor is a positive value.** `_MIN_RESIZE_DIMENSION = 1` rather than 0 — a zero-width rect is legal SVG but renders as invisible, which would strand the user's resize drag in a state with no visible handle to grab. Positive minimum keeps the shape always-selectable.

Open carried over for 3.2c.2c:

- **Line endpoint drag.** Line elements get two endpoint handles (one at `x1,y1`, one at `x2,y2`). Differs from the bounding-box dragging 3.2c.2a provides because each endpoint moves independently — dragging the x1/y1 handle doesn't move x2/y2. Will reuse the `_beginResizeDrag` machinery with a line-specific dispatch that stores the original x1/y1/x2/y2 and adjusts only the endpoint matching the clicked handle.

### 5.14 — Phase 3.2c.2a SvgEditor drag-to-move — **delivered**

Adds drag-to-move on top of 3.2c.1's foundation. Click a selected element and drag to move it. Per-element attribute dispatch for every supported tag. Pointer capture so drags continue smoothly off the SVG bounds. Click-without-drag threshold prevents spurious mutations from stray pointer jitter.

- `webapp/src/svg-editor.js` — additions:
  - `_drag` state field — `{pointerId, startX, startY, originAttrs, committed}` or null. Populated on pointerdown that hits the already-selected element. Cleared on pointerup or detach.
  - `_dragThresholdScreen = 3` — pixel threshold below which a pointermove is treated as click-with-jitter. Converted to SVG units at runtime via `_screenDistToSvgDist` so zoom doesn't make it too sensitive or insensitive.
  - `attach()` / `detach()` updated — `pointermove`, `pointerup`, `pointercancel` listeners added/removed. `detach()` calls `_cancelDrag()` so a mid-drag detach rolls back to the origin state rather than leaving the element partially moved and the captured pointer orphaned.
  - `_onPointerDown` — two-branch logic. Click on the already-selected element starts drag via `_beginDrag(event)`. Click on a different element (or first click) falls through to `setSelection`. Matches click-to-select-first, click-to-drag convention used by most editors.
  - `_beginDrag(event)` — converts pointer position to SVG root coords via `_screenToSvg`, snapshots current element attributes via `_captureDragAttributes`, calls `setPointerCapture` on the SVG. Wraps the capture call in try/catch — not all environments support it, drag still works via bubbling pointermove even without capture.
  - `_onPointerMove` — guarded by `_drag !== null` and matching pointerId. Computes current SVG position, subtracts start to get delta. Before commit, checks threshold — if both axes under threshold, skip the application. Once committed, every subsequent move applies the delta from origin (not from previous position) so moves never compound.
  - `_onPointerUp` — releases pointer capture, clears `_drag`. Fires `onChange()` callback only if the drag was committed (moved beyond threshold). Click-without-drag produces zero onChange calls, so the viewer doesn't spuriously mark the file dirty when the user just meant to select.
  - `_cancelDrag()` — restores original attributes from snapshot, releases capture, clears `_drag`. Used by `detach()`. Does NOT fire onChange — the caller's intent was to abandon the drag.
  - `_captureDragAttributes(el)` — per-element snapshot dispatch. Returns `{kind, ...fields}` or null. Eight dispatch cases: `rect`/`image`/`use` → `{kind: 'xy', x, y}`; `circle`/`ellipse` → `{kind: 'cxcy', cx, cy}`; `line` → `{kind: 'line', x1, y1, x2, y2}`; `polyline`/`polygon` → `{kind: 'points', points: [[x,y]...]}`; `text` → `{kind: 'xy', x, y}` OR `{kind: 'transform', transform}` depending on whether the element already has a transform attribute; `path`/`g` → `{kind: 'transform', transform}`. Null return for unknown tags — drag silently doesn't start.
  - `_applyDragDelta(dx, dy)` — switches on the snapshot's `kind`, applies the delta. For `xy` / `cxcy` / `line` / `points` the math is direct. For `transform` — appends `translate(dx dy)` to the existing transform. Browsers parse transform chains left-to-right so our translate is applied AFTER any existing rotation/scale, which gives the user-expected visual result ("move the rendered element by dx,dy regardless of rotation").
  - `_restoreDragAttributes(el, snapshot)` — mirror of `_applyDragDelta` that writes the origin values back. For `transform`, removes the attribute entirely if it was empty originally, otherwise writes it back verbatim.
  - Handle overlay re-renders on every committed pointermove via existing `_renderHandles()` call. Bounding box follows the element smoothly during drag.
  - Module-level `_parseNum(value)` helper — SVG-attribute-to-number. Returns 0 for null/missing/non-numeric. Matches browser SVG behavior (which treats missing numeric attributes as 0).
  - Module-level `_parsePoints(value)` helper — parses `points` attribute into `[[x, y], ...]`. Accepts whitespace- and comma-separated tokens and mixes. Returns empty array on odd token count or any non-numeric value — caller emits empty `points` which renders as an empty polyline rather than crashing.

- `webapp/src/svg-editor.test.js` — 36 new tests across 9 describe blocks:
  - `_parseNum` (4 tests): numeric strings, null/missing, non-numeric, scientific notation.
  - `_parsePoints` (6 tests): whitespace-separated, comma-separated, mixed, empty/null, odd tokens, non-numeric.
  - Pointerdown routing (6 tests): click on unselected selects, click on selected starts drag, click on empty doesn't cancel non-existent drag, pointer capture on drag start, graceful failure when `setPointerCapture` throws, unsupported element dispatches to no-op.
  - Threshold (5 tests): tiny pointermove doesn't commit, drag beyond threshold commits, onChange fires only once per drag, pointermove without drag ignored, pointermove with wrong pointerId ignored.
  - Per-element dispatch:
    - `rect` (2 tests): moves x/y, handles negative deltas.
    - `circle` + `ellipse` (2 tests): moves cx/cy, radii unchanged.
    - `line` (1 test): both endpoints move by same delta.
    - `polyline` + `polygon` (3 tests): shifts every point, point separators normalize to `x,y` form on output.
    - `path` + `g` (4 tests): uses transform, preserves existing transform, g uses transform dispatch, path's `d` attribute untouched.
    - `text` (2 tests): uses x/y without existing transform, uses transform dispatch when transform exists.
    - `image` + `use` (2 tests): both use x/y dispatch.
  - Incremental application (1 test): repeated pointermoves compute relative to origin, never compound.
  - Handle tracking (1 test): handle group repositions during drag.
  - Lifecycle (5 tests): pointercancel before commit (no onChange), pointercancel after commit (fires onChange), detach rolls back, detach removes transform when it wasn't there originally, detach restores original transform, pointerup releases pointer capture.

Design points pinned by tests:

- **Click-before-drag convention.** The first click on an element only selects; a SECOND click (while already selected) initiates drag. Pinned by `click on unselected element selects it (no drag)` (no drag after first click) AND `click on already-selected element starts drag` (drag after second click). Prevents accidental drags when the user is scanning elements — a small pointer jitter during a selection click doesn't move the element.

- **Click threshold prevents spurious mutations.** `tiny pointermove does not commit drag` dispatches a 1-pixel pointermove and verifies the element's x attribute is unchanged AND onChange doesn't fire. Without the threshold, every real-world click would produce a 0-pixel mutation and mark the file dirty.

- **Transform append preserves existing transforms.** `path with existing transform preserves it` verifies that dragging a `<path transform="rotate(45 5 5)">` produces `rotate(45 5 5) translate(10 20)` — the rotation is unaffected by the drag. If this broke, users would see their rotated shapes unexpectedly flip during a move.

- **Text attribute auto-detection.** `text without transform uses x/y dispatch` and `text with existing transform uses transform dispatch` prove the two paths. Users dragging a plain text element get clean x/y changes (readable in editor output); users dragging a rotated text element get an additional translate (preserves rotation). The alternative (always use transform) would leave plain text elements with cruft that's harder to hand-edit.

- **Delta from origin, not from previous position.** `repeated pointermoves compute relative to drag origin` pins the invariant by dispatching three pointermoves and asserting the element's final position matches `origin + final_delta`, not `origin + dx1 + dx2 + dx3`. Compounding would make fast drags move the element exponentially further than the pointer.

- **Detach mid-drag rolls back.** `detach during drag rolls back and cancels` verifies that an editor detached mid-drag leaves the element at its original position with no onChange fired. If the rollback were absent, a file-switch or component-unmount during an active drag would leave orphaned partial-move mutations the user didn't intend.

- **Capture failure is non-fatal.** `survives setPointerCapture throwing` pins that a runtime without pointer capture (older browsers, some jsdom environments) still starts the drag. Capture is an enhancement for off-SVG pointer tracking, not a requirement.

Open carried over for 3.2c.2b and 3.2c.2c:

- **3.2c.2b — corner/edge resize handles.** Interactive handles for `rect` (eight handles — four corners and four edges), `circle` (four handles at cardinal points for symmetric resize), `ellipse` (four handles — two for rx, two for ry, independently draggable). Handle's drag math pins the opposite corner — e.g. dragging the top-left corner moves x/y AND adjusts width/height so the bottom-right stays fixed. Needs per-handle data (which corner/edge it represents) in a dataset attribute so the pointermove dispatch knows what to adjust.

- **3.2c.2c — line endpoint drag.** `line` elements get two endpoint handles (one per endpoint) — currently the bounding-box handle doesn't allow independent endpoint drag. Differs from the bounding-box dragging that 3.2c.2a provides because each endpoint moves independently; dragging the x1/y1 handle doesn't move x2/y2.

- **Path vertex handles and inline text editing.** Land with 3.2c.3.

### 5.13 — Phase 3.2c.1 SvgEditor foundation + selection — **delivered**

Introduces the `SvgEditor` class and wires it into the right panel of `SvgViewer`. First sub-phase of 3.2c — foundation layer for visual editing. No move/resize/vertex-edit yet; those come in 3.2c.2. Coexists with pan/zoom — pan/zoom handles viewport navigation, editor handles element selection.

- `webapp/src/svg-editor.js` — new standalone class (not a Lit component). Operates on an externally-provided `<svg>` element. Responsibilities:
  - Pointer-based click hit-testing via `elementsFromPoint` (shadow-DOM aware via `getRootNode().elementsFromPoint`). Filters out handle overlay (`svg-editor-handle` class, `svg-editor-handles` group id), the root SVG itself, non-visual tags (`defs`, `style`, `metadata`, `title`, `desc`, `filter`, gradients, `clipPath`, `mask`, `marker`, `pattern`, `symbol`), and elements outside the SVG subtree.
  - Single-element selection via `setSelection(el)`. Selection fires `onSelectionChange` callback. Same-element no-op.
  - `<tspan>` → parent `<text>` resolution. Click targets inside text runs resolve to the whole text element, not the tspan child.
  - Handle overlay group rendered as `<g id="svg-editor-handles">` at the end of the root SVG. For 3.2c.1 contains only a dashed bounding-box rect; 3.2c.2 will add corner/edge/vertex handles. Group has `pointer-events="none"` so empty-space clicks fall through to content.
  - Coordinate math helpers: `_screenToSvg` (invert CTM), `_localToSvgRoot` (compose inverse of root CTM with element's CTM), `_screenDistToSvgDist` (for handle size constancy under zoom), `_getHandleRadius` (handle visual radius in SVG units).
  - Keyboard: Escape clears selection (only consumes event when something is selected, otherwise lets it pass to textareas). Delete/Backspace remove the selected element (only consumes event when selected).
  - `attach()`/`detach()` — caller owns the lifecycle. Attach is idempotent. Detach clears selection and removes event listeners.
  - `deleteSelection()` — public API for programmatic delete. Fires `onChange` callback.
- `webapp/src/svg-editor.test.js` — 41 tests across 10 describe blocks: construction (requires SVG, accepts SVG, exports constants, exports tag sets), attach/detach (wiring, idempotence, cleanup), setSelection (programmatic, onSelectionChange, clearing, same-element no-op, tspan resolution, non-selectable rejection), handle rendering (group creation, last-child ordering, handle class, clearing on deselect, persistence across selection, re-attach reuses existing group), pointer dispatch (hit-test called, selection on hit, deselect on empty-space, non-primary button ignored, stopPropagation on hit, no stopPropagation on miss), hit-test filtering (handle class, handle group id, root SVG, non-selectable tags, tspan resolution, outside-SVG elements), keyboard (Escape clears, Escape no-op without selection, Delete removes, Backspace removes, Delete without selection doesn't preventDefault, onChange fires, detached editor ignores keys), deleteSelection (removes element, clears selection, no-op without selection, fires onSelectionChange), coordinate helpers (identity CTM pass-through, positive distances, handle radius positive).
- `webapp/src/svg-viewer.js` — integration:
  - Import `SvgEditor`
  - `_editor` field, `_onEditorChange` bound handler in constructor
  - `_initEditor(rightSvg)` called after `_initPanZoom` in `_injectSvgContent` — creates editor on the right panel's SVG
  - `_disposeEditor()` — detaches and nulls. Called before re-injection, on component disconnect, and as part of file close/switch flow
  - `_onEditorChange()` — temporarily removes the handle group from the right panel's SVG before reading `innerHTML`, restores in a `finally`. Updates `file.modified` and recomputes dirty count. Keeps `_lastRightContent` in sync so the next file-switch injection doesn't treat the just-read content as "changed"
- `webapp/src/svg-viewer.test.js` — new `SvgViewer SvgEditor integration` describe block with 8 tests: editor created on open, editor's root is the right panel's SVG (not left), editor disposed on close, editor disposed+recreated on file switch, editor disposed on disconnect, change callback syncs modified content, handle group stripped from serialized content, editor init failure doesn't break viewer.

Design points pinned by tests:

- **Editor and pan-zoom coexist on the right panel.** Pan-zoom handles wheel zoom and drag-on-empty-space panning; the editor handles element selection. The editor's `pointerdown` handler stops propagation when it hits a real element, preventing pan-zoom from initiating a pan. Empty-space clicks (hit test returns null) don't stop propagation, letting pan-zoom take over. Pinned by `stops propagation on element hit` and `does not stop propagation on empty-space click`.

- **tspan → text resolution is both in hit-test AND setSelection.** The hit-test resolution catches pointer events; the setSelection resolution catches programmatic calls (e.g., from a future "select by ID" feature or a load-selection-from-undo-stack flow). Pinned by `tspan selection resolves to parent text` (programmatic) and `resolves tspan to parent text` (hit-test).

- **Handle group is stripped from saved content.** Serializing `innerHTML` would otherwise leak `<g id="svg-editor-handles">...</g>` into the file. The `_onEditorChange` handler temporarily removes the group, reads innerHTML, then restores. Pinned by `editor change strips handle group from serialized content` which verifies both that the saved content is clean AND that the handle group is back in the live DOM.

- **Non-selectable tags are filtered at both hit-test AND setSelection.** `defs`, `style`, `filter`, gradients — clicking one silently resolves to null (or to a parent selectable if any). Setting one programmatically also yields null. Pinned by `non-selectable element selection returns null` and `skips non-selectable tags` (hit-test).

- **Editor failure is isolated.** `_initEditor` wraps construction in try/catch and leaves `_editor = null` on failure. The viewer continues to function (pan/zoom still works, save/close still work). No explicit test forces the failure (would require module-level SvgEditor mock), but the pattern is documented in code and in the `editor init failure does not break viewer` regression test.

- **Delete is keyboard-scoped.** Pressing Delete while a textarea is focused (and nothing is selected in the editor) does NOT get preventDefault — the event flows to the textarea. The editor only consumes Delete when it has something to delete. Pinned by `Delete without selection does not consume the event`.

- **Handle group is pointer-events: none.** Otherwise clicks on the bounding-box rect would land on the handle instead of falling through to the element. For 3.2c.2's interactive handles (corner drag, vertex drag), individual handle elements will opt back in via their own `pointer-events="auto"`.

Open carried over for later sub-phases:

- **3.2c.2 — move + resize.** Drag-to-move for all visible elements. Corner and edge handles for rect/circle/ellipse resize. Line endpoint handles for `<line>`. Needs pointer capture for smooth drag; needs coordinate conversion in the drag handler (start pos in local coords, delta applied to attributes). Will need per-element dispatch (rect uses x/y/width/height; circle uses cx/cy/r; ellipse uses cx/cy/rx/ry; line uses x1/y1/x2/y2; paths and polys use transform attribute).
- **3.2c.3 — vertex edit + inline text.** Per-vertex handles for polylines/polygons (each point draggable independently). Path command parsing (`M/L/C/Q/Z` etc.) to surface drag-able control points for cubic and quadratic beziers. `<foreignObject>` textarea for inline text editing on double-click.
- **3.2c.4 — multi-selection + marquee.** Shift+click toggle into a Set of selected elements. Marquee-drag on empty space: forward drag (top-left to bottom-right) = containment mode (only fully-inside elements); reverse drag = crossing mode (any-intersection). Group drag applies delta to every selected element.
- **3.2c.5 — undo stack + copy/paste.** Snapshot the SVG innerHTML before every mutation, bounded to 50 entries. Ctrl+Z pops and re-injects. Ctrl+C/V clone selected element(s) with a slight offset. Ctrl+D duplicates in place.

### 5.12 — Phase 3.2b SVG pan/zoom — **delivered**

Adds `svg-pan-zoom` library integration so both panels' viewports move in lockstep, mouse wheel zooms centered on cursor, and a floating fit button re-centers after manipulation. Preserves all of 3.2a's surface — no public API changes.

- `webapp/package.json` — added `svg-pan-zoom ^3.6.2`. Pure JS, ~20KB minified. MIT license.

- `webapp/src/svg-viewer.js` additions:
  - Module-level import of `svgPanZoom` factory.
  - `_PAN_ZOOM_OPTIONS` frozen constant — shared config for both panels. `panEnabled: true`, `zoomEnabled: true`, `mouseWheelZoomEnabled: true`, `dblClickZoomEnabled: true`, `preventMouseEventsDefault: true`, `zoomScaleSensitivity: 0.2`, `minZoom: 0.1`, `maxZoom: 10`, `fit: true`, `center: true`, `controlIconsEnabled: false` (we render our own fit button).
  - Constructor fields — `_panZoomLeft`, `_panZoomRight` (instance refs, null when no file open), `_syncingPanZoom` (boolean mutex). Bound handlers `_onLeftPan`, `_onLeftZoom`, `_onRightPan`, `_onRightZoom`, `_onFitClick`.
  - `_injectSvgContent` now tracks whether either side's content changed. On change, sets `preserveAspectRatio="none"` on the right panel's root SVG (per specs4 — the future 3.2c editor needs sole viewBox authority; left panel keeps browser default for the read-only reference). Calls `_initPanZoom` after attribute application.
  - `_initPanZoom(leftContainer, rightContainer)` — tears down existing instances first (via `_disposePanZoom`), then wraps each `svgPanZoom` construction in try/catch. Each side gets the other side as its sync target via the bound `onPan`/`onZoom` callbacks. Failures are logged and leave the corresponding instance ref as null — keeps the viewer working even when the library can't initialise (e.g., malformed SVG).
  - `_disposePanZoom` — null-safe, wraps `destroy()` in try/catch so a throwing destroy (already-destroyed, detached DOM) doesn't break close/switch flows.
  - Sync callback pattern — `_onLeftPan(newPan)` checks the guard, sets it, calls `rightPanZoom.pan(newPan)` in a try/finally that always clears the guard. Symmetric for zoom and for the right→left direction. The guard is also held around the mirror call so when the library internally fires `onPan` on the mirrored panel as part of its `.pan()` implementation, the callback short-circuits on the guard check and doesn't cascade back.
  - `_onFitClick` — calls `resize()` + `fit()` + `center()` on both panels, all within a single sync-guard scope. `resize()` ensures the library picks up current container dimensions (the dialog may have been resized since the last init). The guard scope covers the whole fit operation so callbacks from one panel's reset don't trigger the other panel to mirror back mid-reset.
  - Fit button rendered alongside the status LED in the bottom-right corner — `position: absolute`, 28×28px, backdrop-blur, matching visual language to the LED. `⊡` glyph for "fit to view". Hidden in empty state (no files open).

- `webapp/src/svg-viewer.test.js` additions:
  - Module-level `vi.mock('svg-pan-zoom', ...)` with a factory that records every construction. Each instance exposes spies for `pan`, `zoom`, `fit`, `center`, `resize`, `destroy` plus `options` (to drive callbacks) and `element` (to verify wiring). Factory has `_instances` array and `_reset()` helper used by `beforeEach`/`afterEach`.
  - Four new describe blocks, 21 tests total:
    - **Pan/zoom initialization** (5 tests) — one instance per panel, different SVG elements wired, `preserveAspectRatio="none"` only on right, documented options applied, onPan/onZoom callbacks registered.
    - **Pan/zoom synchronization** (6 tests) — left→right mirror (pan + zoom), right→left mirror (pan + zoom), guard prevents ping-pong via simulated reentrant callback, sync no-op when counterpart instance is null.
    - **Fit button** (6 tests) — renders when file open, hidden in empty state, click fires fit+center on both, click fires resize too, click doesn't trigger feedback loop (verified via simulated onPan/onZoom from inside the mocked fit), click with null instances is safe.
    - **Pan/zoom disposal** (5 tests) — disposed on last file close, disposed+recreated on file switch, disposed on component disconnect, disposed on refreshOpenFiles, throwing destroy handled gracefully.

Design points pinned by tests:

- **`preserveAspectRatio="none"` asymmetry.** Right panel gets the attribute; left panel does not. Pinned by `test_applies_preserveAspectRatio_none_only_to_right_panel`. When 3.2c's SvgEditor lands, the editor manipulates the right panel's viewBox directly; browser-side aspect fitting would fight that math. Left panel stays default because it's a read-only reference — the browser's default fitting centers the SVG in its pane, which is what the user wants for comparison.
- **Sync guard is test-verifiable via simulated reentrance.** The library's real behaviour is that calling `.pan()` on one instance fires that instance's `onPan` callback after the pan completes. Tests simulate this by making a mocked `pan()` invoke the instance's `options.onPan` from inside the mock — if the guard is broken, the callback cascades back and calls the other instance's `pan` again, which the test catches via a `reentered` boolean flag. Caught a subtle sequencing bug in the initial implementation where the guard was set after the mirror call; now set before and cleared in `finally`.
- **Fit button calls `resize()` before `fit()`.** `resize()` is the library's mechanism for picking up changed container dimensions. Without it, fit computes against stale container size if the dialog was resized between open and fit-click. Pinned by `test_click_also_calls_resize_on_both_panels`.
- **Disposal on refresh, not just close.** `refreshOpenFiles` sets `_lastLeftContent = null` / `_lastRightContent = null` which forces `_injectSvgContent` to treat content as changed on the next call, which triggers `_initPanZoom` which calls `_disposePanZoom` first. Pinned by `test_disposes_instances_on_refreshOpenFiles` — ensures the indirect path still reaches disposal even though `refreshOpenFiles` doesn't call `_disposePanZoom` directly.
- **Throwing destroy is survivable.** The `svg-pan-zoom` library throws from `destroy()` when called twice, or when the underlying SVG has been detached from the DOM. Both cases can happen during rapid file switches or component unmounts. `_disposePanZoom` wraps each destroy in try/catch so the instance refs always get nulled out regardless. Pinned by `test_handles_destroy_throwing_gracefully`.

Notes from delivery:

- **Vitest hoists `vi.mock()` above imports.** The test file reads top-to-bottom with `vi.mock('svg-pan-zoom', ...)` before `import './svg-viewer.js'`, but vitest's transform hoists mock declarations above all imports regardless of source position. This means the svg-viewer module, when loaded, sees the mocked factory — no circular-import gymnastics needed.
- **Mock factory resets via `_reset()` helper.** Per-test cleanup needs to both clear the `_instances` array and reset the `mockClear()` state. The `_reset` helper handles both; called in the top-level `beforeEach`/`afterEach` alongside RPC cleanup. Without the reset, instance counts from previous tests would leak into `svgPanZoom._instances.length` assertions in later tests.
- **`fit: true, center: true` at init.** The library's built-in fit-on-init does what we want for first render — initial SVG appears sized and centered in its panel. This means we don't need to manually fit after init in production; the fit button is for *re-fitting* after the user has panned/zoomed, not for the initial view.
- **Control icons deliberately disabled.** `controlIconsEnabled: false` in `_PAN_ZOOM_OPTIONS` suppresses the library's built-in zoom in / zoom out / reset buttons. They'd conflict visually with the status LED (which is in the same corner area) and don't match the app's minimal chrome design. Our floating fit button serves the reset-view role; mouse wheel covers zoom.
- **Zoom bounds chosen to match specs4.** `minZoom: 0.1` (10× zoomed out) and `maxZoom: 10` (10× zoomed in) — covers the practical range for architecture diagrams and flowcharts. Going below 0.1 makes SVGs unreadable; going above 10 hits rendering fidelity limits in most SVG viewers.

Open carried over for later sub-phases:

- **3.2c — `SvgEditor` visual editing.** Visual editing surface for the right panel. Multi-selection, drag-to-move, corner-handle resize, vertex-handle edit for polylines/polygons/paths, inline text edit via `foreignObject` textarea, marquee selection with containment / crossing modes, path command parsing for bezier/quadratic/line handles, undo stack (50 snapshots), coordinate math (screen → SVG root → element-local via getScreenCTM inversion), handle rendering as a separate `<g>` with dataset markers for hit-test exclusion. Will need to hook into the pan/zoom's current transform to compute correct coordinates — the library exposes `getZoom()` and `getPan()` for this. The `preserveAspectRatio="none"` already set on the right panel means viewBox manipulation works cleanly. Likely needs its own sub-sub-splits.
- **3.2d — presentation mode, context menu, copy-as-PNG.** F11 toggle for full-width editor, right-click context menu with copy-as-PNG item, `toggle-svg-mode` event dispatch for switching to the diff viewer's text view, and the reciprocal `🎨 Visual` button on the diff viewer side.
- **3.2e — embedded image resolution.** PDF/PPTX-converted SVGs reference sibling raster images via `<image href="...">`. Fetch via `Repo.get_file_base64` and rewrite hrefs in-place. Parallel to the diff viewer's markdown preview image resolution (Phase 3.1b).

### 5.11 — Phase 3.2a SVG viewer lifecycle — **delivered**

Replaces the Phase 3 groundwork stub with a real side-by-side SVG viewer. Lifecycle surface mirrors the diff viewer — multi-file tracking, content fetching via Repo RPCs, dirty tracking, save pipeline, status LED, keyboard shortcuts. No pan/zoom yet (3.2b), no visual editing (3.2c), no copy-as-PNG (3.2d), no embedded image resolution (3.2e).

- `webapp/src/svg-viewer.js` — `SvgViewer` LitElement. Same public API as `DiffViewer` — `openFile`, `closeFile`, `refreshOpenFiles`, `getDirtyFiles`, `saveAll`, `hasOpenFiles`. Fires `active-file-changed` + `file-saved` events with `bubbles: composed`. Renders side-by-side panels with "Original" (left, HEAD) and "Modified" (right, working copy) labels. Status LED in top-right corner with clean / dirty / new-file states, click-to-save affordance.
- **`innerHTML` injection after Lit commits template.** Lit doesn't natively support raw SVG string injection (it would HTML-escape the content). `updated()` lifecycle hook queries the pane containers and sets `innerHTML` directly. A content cache (`_lastLeftContent` / `_lastRightContent`) skips reassignments when nothing changed — without this, every property update would force a full SVG re-parse and visual flash. Matches the approach specs4/5-webapp/svg-viewer.md documents for the production viewer.
- **Content is text, not base64.** SVG is XML. Fetched via `Repo.get_file_content` (same as the diff viewer does for text files), NOT `Repo.get_file_base64`. base64 is for rendering images where we don't need the source; editing SVG requires the XML verbatim.
- **Empty-content fallback SVG.** When a panel has no content (e.g., new files where HEAD is absent), a minimal valid SVG is injected instead. Keeps the panel from collapsing visually and lets DOMParser succeed on both sides so future passes can assume a consistent parsed tree.
- **Dirty tracking is external-driven.** 3.2a has no editor. The working-copy content can only change when an external caller mutates `this._files[i].modified` (the future `SvgEditor` commit). The public test surface calls `el._recomputeDirtyCount()` after mutating `.modified` directly; in production, `SvgEditor` will dispatch a content-change event that the viewer subscribes to.
- **Status LED matches the diff viewer visually.** Same three states, same CSS classes, same pulse animation on dirty. Keeps the two viewers consistent when the app shell toggles between them based on file extension.
- **Concurrent-openFile guard.** Same pattern as diff viewer — `_openingPath` field drops duplicate async calls for the same path. Opening a different file while another is still loading proceeds independently.
- **Keyboard shortcuts.** Ctrl+S (save), Ctrl+W (close), Ctrl+PageDown (next), Ctrl+PageUp (previous). Same `composedPath` guard as diff viewer — shortcuts fire only when focus is inside the viewer.
- **SharedRpc override pattern.** `globalThis.__sharedRpcOverride` injection lets tests provide a fake proxy without mocking the SharedRpc module. Production reads from SharedRpc via the same helper.

- `webapp/src/svg-viewer.test.js` — 50+ tests across 9 describe blocks replacing the 15-test stub suite. Covers initial state (empty watermark, no files, no split container), openFile lifecycle (events fire, panes render with labels, HEAD + working fetched, missing HEAD → isNew, missing working → empty, no RPC graceful, same-file no-op, multi-file switching, malformed input rejected, concurrent same-path + different-path), SVG injection (both panes populated with fetched content, empty fallback with viewBox, re-injects on file switch), closeFile (last file clears state, switches to next, inactive close preserves active, unknown no-op), dirty tracking (clean after open, dirty after external mutation, save clears + fires event with content, saveAll), status LED (all three classes, click-to-save, tooltip reflects path), keyboard shortcuts (all four, non-Ctrl ignored, outside focus ignored), refreshOpenFiles (re-fetches all), event composition (bubbles across shadow DOM, close carries null path).

Design points pinned by tests:

- **Same-file open is a no-op even when re-invoked.** `test_same_file_open_is_a_no_op` pins this because openFile is async and it's easy for a future refactor to drop the early-return check. Without it, every re-open would fire active-file-changed, re-fetch content, re-inject SVG — all wasted work.
- **External content mutation triggers LED update via `_recomputeDirtyCount`.** `test_shows_dirty_after_external_content_change` asserts the LED reflects the change after the caller mutates `.modified` and explicitly calls recompute. In 3.2c when SvgEditor lands, the editor will dispatch events that the viewer catches and calls recompute on; until then, the explicit call makes the dirty-tracking path observable.
- **Status LED is click-to-save, not click-to-open.** Clicking a clean LED is a no-op — the point of the LED is to surface an action (save pending work) or state (clean / new-file), not to re-trigger anything.
- **Keyboard shortcut focus guard is `composedPath()`-based.** Events fired on document.body without the viewer in the composed path are ignored. Prevents shortcut hijacking when focus is in an unrelated part of the page (e.g., chat panel).
- **Close-inactive-file doesn't fire active-file-changed.** Closing a sibling file while another remains active shifts the underlying `_activeIndex` but doesn't change which file is active. The event fires only when the active-path identity actually changes. Matches the semantics of `active-file-changed` — it signals "which file is now showing", not "the file list was modified". Pinned by `test_closing_inactive_file_does_not_change_active` after a first-run failure caught the unconditional dispatch.

Open carried over for later sub-phases:

- **3.2b — synchronized pan/zoom.** Now scoped and queued as 5.12 above.
- **3.2c — `SvgEditor` visual editing.** The big one. Multi-selection, drag-to-move, corner-handle resize, vertex-handle edit for polylines/polygons/paths, inline text edit via `foreignObject` textarea, marquee selection with containment / crossing modes, path command parsing for bezier/quadratic/line handles, undo stack (50 snapshots), coordinate math (screen → SVG root → element-local via getScreenCTM inversion), handle rendering as a separate `<g>` with dataset markers for hit-test exclusion. Likely needs its own sub-sub-splits.
- **3.2d — presentation mode, context menu, copy-as-PNG.** F11 toggle for full-width editor, right-click context menu with copy-as-PNG item, `toggle-svg-mode` event dispatch for switching to the diff viewer's text view, and the reciprocal `🎨 Visual` button on the diff viewer side.
- **3.2e — embedded image resolution.** PDF/PPTX-converted SVGs reference sibling raster images via `<image href="...">`. Fetch via `Repo.get_file_base64` and rewrite hrefs in-place. Parallel to the diff viewer's markdown preview image resolution (Phase 3.1b).

### 5.10 — Phase 3.1e Markdown link provider — **delivered**

Closes out Phase 3.1. Makes `[text](relative-path)` links Ctrl+clickable inside the Monaco editor for markdown files. Mirrors the preview pane's click-based link navigation (delivered in 3.1b) for users who stay in the source view.

- `webapp/src/markdown-link-provider.js` — pure module with `installMarkdownLinkProvider(monaco, getActivePath, onNavigate)`, `buildMarkdownLinkProvider(getText)`, `buildMarkdownLinkOpener(onNavigate)`, plus helpers `findLinks`, `findLinksInLine`, `buildNavigateUri`, `parseNavigateUri`, `shouldSkip`. Idempotent install guard via module-scoped `WeakSet` (same pattern as `lsp-providers.js`). No Monaco mount required for testing.
- `webapp/src/diff-viewer.js` — imports `installMarkdownLinkProvider`, calls it from `_createEditor` alongside `installLspProviders`. The `onNavigate` callback reads the active file's path via closure, resolves relative paths via the existing `resolveRelativePath` helper, and dispatches `navigate-file` events with `bubbles: true, composed: true` so the app shell's handler catches them.
- `webapp/src/markdown-link-provider.test.js` — 48 tests across 8 describe blocks covering `shouldSkip` (http/data/blob/mailto/tel/protocol-relative/fragment/root-anchored/empty/null → true; relative paths → false), `findLinksInLine` (empty/null handling, simple link, 1-indexed columns, multiple per line, skip absolute URLs, skip fragment-only, accept relative+fragment, accept parent dirs, empty link text, reference-style links skipped), `findLinks` multi-line (line numbers 1-indexed, ac-navigate URI emission, tooltip preservation, mixed absolute+relative filtering, empty-line tolerance), `buildNavigateUri` + `parseNavigateUri` round-trips (path preservation, fragment preservation, Monaco Uri object form, wrong scheme → null, type guards), `buildMarkdownLinkProvider` (callback dispatch, model passthrough, getValue fallback), `buildMarkdownLinkOpener` (ac-navigate dispatch, other schemes pass through, Monaco Uri objects, fragment strip, error swallow, null/undefined guards), and `installMarkdownLinkProvider` (registers for markdown language, registers opener, idempotent, `registerOpener` fallback for older Monaco versions, individual registration failures don't block others).
- `webapp/src/diff-viewer.test.js` — extended Monaco mock with `registerLinkProvider` + `registerEditorOpener`; new `monacoState.linkProviders` and `monacoState.linkOpeners` arrays; `_resetLinkGuard` imported and called in the global `beforeEach`. New `DiffViewer markdown link provider` describe block with 8 integration tests: provider registered on first editor build, opener registered, no re-registration on file switch, opener resolves relative path + dispatches navigate-file with bubbles+composed, opener handles parent-directory references via active-file context, opener ignores non-ac-navigate URIs, opener no-op when no active file, provider finds links in markdown content, provider skips absolute URLs.

Design points pinned by tests:

- **Line-by-line scanning, not multi-line regex.** `findLinks` splits on `\n` and processes each line independently. Alternative (single regex with `gm` flags) would need multi-line handling for line-number computation; line-by-line gives natural 1-indexed line/column construction with no offset bookkeeping.

- **ac-navigate scheme.** Deliberately non-standard (`ac-navigate:///{path}`) so Monaco's default link handler never accidentally hands these to the OS. The scheme is unique to our app; no external URI handler registration could intercept them. Pinned by `test_returns_false_for_wrong_scheme` (the opener doesn't claim non-ac-navigate URIs) and by `test_link_opener_ignores_non-ac-navigate_URIs` (integration test proving fallthrough works).

- **Resolution at click time, not scan time.** The provider emits the verbatim relative path inside the URI; the opener resolves it against the currently-active file's directory when the user clicks. Alternative (pre-resolving during `provideLinks`) would couple the provider to file state and force re-scans on every file switch. Callback-based resolution means the provider is registered once and works across arbitrary file switches.

- **Fragment stripping at open time, not scan time.** The scan preserves fragments in the URI (`buildNavigateUri('x.md#sec')` → `'ac-navigate:///x.md#sec'`) so the tooltip shows them correctly, but the opener strips `#section` before dispatching `navigate-file` because the app shell navigates by path only. A future enhancement could forward the fragment for scroll-to-heading support.

- **Error swallow in the opener.** `onNavigate` wrapped in try/catch — a broken callback shouldn't crash Monaco's opener chain and leave every subsequent link click dead. Debug-log + continue is the right shape here (same pattern as the LSP providers).

- **`registerEditorOpener` vs `registerOpener` fallback.** Some Monaco versions expose `registerEditorOpener`, some expose `registerOpener`. The installer probes both. Covered by `test_falls_back_to_registerOpener_when_registerEditorOpener_is_missing`. If neither is present (very old Monaco), link provider registration still succeeds; clicks fall through to Monaco's default behavior (which tries to open as external URL and fails).

- **Skipping root-anchored paths.** A link like `[root](/docs/spec.md)` is skipped rather than navigated because the repo has no concept of an absolute-root anchor. The preview pane's click handler has the same rule for symmetry.

Open carried over:

- **Forwarding fragments.** Today the opener strips `#section` before dispatch. A future enhancement could forward the fragment to the `navigate-file` event's detail, letting the app shell route to the destination viewer's scroll-to-anchor logic. Not blocking any current flow — users typically navigate to the file and then scroll, which is what the current behavior supports.

### 5.9 — Phase 3.1d LSP integration — **delivered**

Adds four Monaco language-service providers wired to the backend's `Repo.lsp_*` RPCs. Hover, definition, references, completions. Registered once against the `'*'` wildcard selector — one provider per type handles every language, with backend-side dispatch by file extension via the symbol index.

- `webapp/src/lsp-providers.js` — pure provider module. Exports `installLspProviders(monaco, getActivePath, getCall)` (idempotent install with a `monaco.__acDcLspInstalled` guard), four `build*Provider` functions, plus helpers `unwrapEnvelope`, `pathFromModel`, and the test-only `_resetInstallGuard`. Separated from the viewer so the coordinate / path / shape transformation logic is unit-testable without mounting an editor. Mirrors the layering pattern of `markdown-preview.js` and `tex-preview.js`.
- `webapp/src/diff-viewer.js` — imports `installLspProviders`, calls it from `_createEditor` with callbacks that read the currently-active file's path and the SharedRpc call proxy. The install function's guard prevents re-registration across editor recreations and viewer remounts.
- `webapp/src/lsp-providers.test.js` — 68 tests across 8 describe blocks covering `unwrapEnvelope` (null/undefined/primitive/array pass-through, single-key-with-object-inner unwrap, multi-key non-unwrap, primitive-inner non-unwrap, array-inner non-unwrap), `pathFromModel` (leading-slash strip, no-slash pass-through, missing model/uri/path defensive), hover provider (no-path / no-RPC returns null, 1-indexed coordinate passthrough, string-vs-array contents wrapping, empty-string filter, envelope unwrap, RPC error swallow), definition provider (shape validation, snake_case range normalisation, clamp-to-1 for negative/zero coordinates, cross-file URI construction, malformed-payload rejection, envelope unwrap, error swallow), references provider (null → [], non-array → null, malformed entries skipped, envelope unwrap, error swallow), completion provider (trigger character declaration, word-at-position range derivation, fallback empty range, insertText defaults, kind validation + clamping, documentation preservation, malformed entry skip, error swallow), and `installLspProviders` (all four registered, wildcard selector, idempotent, disposable return, null/missing-languages guards, callbacks wired correctly, individual registration failures don't block others).
- `webapp/src/diff-viewer.test.js` — extended with an `LSP integration` describe block: providers installed on first editor build, wildcard selector, not re-registered on file switch, hover dispatches with active path, hover reflects file switches (same provider instance, fresh state per invocation), no-RPC graceful degradation, definition builds cross-file location, references empty for null, completions empty when no active path, install guard survives viewer dispose/reuse cycles.

Design points pinned by tests:

- **Callbacks, not values.** The providers take `getActivePath` and `getCall` as callbacks — not values — because the viewer's state changes across file switches and reconnects, and the providers are registered once. Pinned by `test_hover_provider_reflects_file_switches` which opens two files in sequence and verifies the hover RPC is called with the SECOND file's path.

- **Wildcard registration matches every language.** Single registration of each provider type handles all languages. Backend's symbol index dispatches by file extension; the provider layer doesn't need to know about language IDs at all. Alternative (per-language registration) would require maintaining a list in sync with `monaco-setup.js`'s extension map — more brittle for no benefit.

- **Idempotent install guard lives on the monaco namespace.** `monaco.__acDcLspInstalled` is set on the first install call. Re-calling from a recreated editor, remounted viewer, or any other retry path is a no-op. Pinned by multiple tests — three consecutive installs produce one registration each; viewer dispose/reuse cycles similarly only produce one.

- **Envelope unwrap is heuristic, not universal.** `unwrapEnvelope` unwraps single-key objects only when the inner value is a non-array object. This matches the jrpc-oo envelope shape (UUID → payload object) without clobbering legitimate single-key payloads like `{file: "path"}` (inner is a primitive) or `{items: [1,2,3]}` (inner is an array). Pinned by three explicit tests for the non-unwrap cases.

- **1-indexed coordinates at the RPC boundary.** Monaco's `Position.lineNumber` and `.column` are 1-indexed; specs4's symbol index stores the same. No conversion — providers pass through unchanged. Pinned by `test_calls_RPC_with_active_path_and_1-indexed_position` which asserts the RPC was called with the exact position values.

- **Range field name normalisation.** Backend may return `startLineNumber`/`startColumn` OR `start_line`/`start_column`. Normaliser accepts both shapes. Pinned by `test_normalizes_snake_case_range_fields_from_backend` — matters because different RPC methods in the backend use different naming conventions and the frontend shouldn't care.

- **Clamp to minimum 1 for range coordinates.** Defensive against backend bugs that might emit 0 or negative values. Monaco rejects such ranges silently; clamping produces a valid (1, 1) zero-width range instead.

- **Error swallow with debug log.** Every RPC rejection is caught, logged at debug level, and returns null/empty. Hover popup and completion list continue to function; transient RPC failures don't blow up the editor. Pinned by one error-swallow test per provider.

- **Word-at-position for completion range.** When the user triggers completions mid-identifier, Monaco needs to know what range to replace with the accepted suggestion. `model.getWordUntilPosition` gives the prefix being typed; the provider uses that as the range. Fallback to empty range at cursor when no word is under the cursor (e.g., user typed `.` to trigger completions on a fresh identifier).

- **Kind clamping for completions.** Backend sends integers matching `monaco.languages.CompletionItemKind`. Invalid values (non-numeric, negative, or out of 0-30 range) degrade to `Text` (0). Pinned by `test_clamps_invalid_kind_to_Text_0` with three variants.

Open carried over for later sub-layers:

- **Markdown link provider (3.1e).** Separate Monaco registration for `.md` files that matches `[text](relative-path)` patterns and emits `ac-navigate:///` URIs with a companion LinkOpener intercepting that scheme. The preview pane's click-based link navigation already works (delivered in 3.1b); 3.1e adds the Monaco-side equivalent so Ctrl+click inside the editor also navigates.

### 5.8 — Phase 3.1c TeX preview — **delivered** (see separate commit)

### 5.7 — Phase 3.1a Monaco diff viewer — **delivered**

Replaces the Phase 3 groundwork stub with a real Monaco-based side-by-side diff editor. Core viewer surface — multi-file tracking, content fetching, dirty tracking, save pipeline, status LED, viewport restoration, loadPanel for ad-hoc comparisons, virtual files, keyboard shortcuts. Markdown preview, TeX preview, LSP integration, and markdown link provider deferred to 3.1b–3.1e respectively to keep this commit focused.

- `webapp/package.json` — added `monaco-editor` ^0.52.0 dependency.
- `webapp/src/monaco-setup.js` — new module. Three responsibilities, all executed at module load so they precede any editor construction:
  - `installMonacoWorkerEnvironment()` — configures `self.MonacoEnvironment.getWorker` with a hybrid: real Worker from monaco-editor's ESM build for `editorWorkerService` (required for diff computation), no-op Blob worker for everything else (language services are handled by backend LSP per Layer 3.1d). Guard flag prevents double-install.
  - `registerMatlabLanguage()` — Monaco has no built-in MATLAB. Registers via `monaco.languages.register` + `setMonarchTokensProvider` with a Monarch grammar covering keywords, ~80 common builtins, line + block comments, single and double-quoted strings, numbers (int/float/scientific/complex), operators (arithmetic + element-wise + comparison + logical), and the transpose operator with context-sensitive dispatch. Guard flag prevents double-registration.
  - `languageForPath(path)` — extension-to-language-id map. 40+ extensions mapped. Case-insensitive. Falls back to `plaintext`. `.h` claimed by C (matches the symbol index's convention; mixed-language repos avoid cross-viewer inconsistency).
  - Side-effect invocation of both `installMonacoWorkerEnvironment()` and `registerMatlabLanguage()` at module load. Callers that import this module get both automatically; the `monaco` re-export from this module is the canonical import path so the worker env is always installed first.

- `webapp/src/diff-viewer.js` — complete rewrite from the Phase 3 stub. ~900 lines covering:
  - **Editor reuse.** Single `DiffEditor` instance handles all files. Switching files calls `setModel` with new original/modified models, THEN disposes the old models. Reversing the order throws "TextModel got disposed before DiffEditorWidget model got reset". Editor only fully disposed when the last file closes.
  - **Concurrent-openFile guard.** `_openingPath` field drops duplicate async calls for the same path. Different-path calls proceed independently. Covered by two explicit tests.
  - **Content fetching via SharedRpc.** `_getRpcCall` reads from a `globalThis.__sharedRpcOverride` (test injection) or `SharedRpc.call` (production). Each of HEAD and working-copy fetches is wrapped in its own try/catch so a missing HEAD (new file) or missing working-copy (deleted) doesn't prevent the other from loading. RPC envelope unwrap handles both plain-string and `{content: string}` return shapes plus single-key jrpc-oo envelopes.
  - **Dirty tracking.** Per-file `savedContent` vs current `modified`. Editor's `onDidChangeModelContent` listener updates the file object and bumps a reactive `_dirtyCount`. Virtual and read-only files are never dirty (returns false from `_isDirty`).
  - **Save pipeline.** `_saveFile(path)` reads live content from the editor when the file is active, falls back to the stored `modified` field otherwise. Dispatches `file-saved` (bubbles, composed) with `{path, content, isConfig?, configType?}` — parent routes to Repo write or Settings save. `saveAll()` iterates dirty files in sequence.
  - **Status LED.** Floating overlay button in top-right corner. Three states: clean (green steady), dirty (orange pulsing — click to save), new-file (accent blue). Tooltip adapts to state + file path. Clicking a dirty LED invokes `_saveFile` for the active file.
  - **Viewport state.** `_viewportStates: Map<path, {scrollTop, scrollLeft, lineNumber, column}>` captured before switching away, restored after diff computation settles. `_waitForDiffReady()` registers a one-shot `onDidUpdateDiff` listener with a 2-second fallback timeout (identical-content files never fire the event). Session-only — not persisted. Cleared when the file closes.
  - **loadPanel(content, panel, label).** Three behaviour modes: (a) no files open → create `virtual://compare` with content on the target side; (b) existing `virtual://compare` → update only the target side so both accumulate independently; (c) real file open → overwrite the target panel of that file. Panel labels stored per-file in `_panelLabels` and rendered as floating overlays when non-empty.
  - **Virtual files.** `virtual://` prefix. Content held in `_virtualContents` Map. Never RPC-fetched. Always read-only. Cleared from the map when closed. Used by loadPanel and by Phase 2e.4's history browser's context menu.
  - **Shadow DOM style sync.** Two mechanisms per specs4. `_syncAllStyles()` runs on every editor creation/recreation — removes prior clones (tagged with `data-ac-dc-monaco-clone` attribute via the `_CLONED_STYLE_MARKER` dataset key) and re-clones all current `document.head` styles and linked stylesheets. Full re-sync catches Monaco's synchronous style insertion during construction. `_ensureStyleObserver()` installs a MutationObserver on `document.head` once per component lifetime for styles added/removed after initial construction (e.g., when a new language grammar loads).
  - **Keyboard shortcuts.** Document-level `keydown` listener. Ctrl+S saves active file. Ctrl+W closes active file. Ctrl+PageDown / Ctrl+PageUp cycle through open files. All shortcuts gated on `_eventTargetInsideUs` check (via `composedPath()`) so focus outside the viewer doesn't trigger them.
  - **Code editor service patching.** `monacoEditor._codeEditorService.openCodeEditor` is intercepted so cross-file Go-to-Definition lands files in the tab system rather than spawning a standalone editor. Patch guarded by a component-level `_editorServicePatched` flag — not per-editor, so repeated editor creations don't chain override closures. Specs4 calls this out explicitly.
  - **Search-text scroll.** `_scrollToSearchText(text)` tries progressively shorter prefixes (full text, first two lines, first line only) via `model.findMatches` so whitespace drift between anchor text and file content still locates the edit. Highlighted match gets a `deltaDecorations` call with `isWholeLine: true` + overview-ruler marker, cleared after 3 seconds.

- `webapp/src/diff-viewer.test.js` — rewrite from stub tests. Mocks `monaco-editor` at the module level via `vi.mock` factory. The mock records `createDiffEditor` and `createModel` calls; each editor instance tracks `setModel` / `dispose` / scroll / position / content-listener state. `_simulateContentChange(value)` on a mock editor fires registered content-change listeners so dirty-tracking tests can drive them without a real textarea. `setFakeRpc(handlers)` / `clearFakeRpc()` inject a proxy via `globalThis.__sharedRpcOverride`. 50+ tests across initial state, openFile (dispatch, RPC fetching, HEAD-missing, working-missing, no-RPC, same-file, second-file models, swap models, model disposal, malformed input, concurrent same-path guard, concurrent different-paths), closeFile (editor dispose on last, keep alive for multi-file, activate next, unknown no-op), dirty tracking (not dirty after open, dirty after edit, save clears + dispatches, saveAll), virtual files (explicit content, never dirty, no RPC, cleanup on close), loadPanel (no-files creates compare, accumulates both panels, real file panel update, invalid panel rejected, label stored), viewport state (capture on switch, session-only), refreshOpenFiles (re-fetch real files, skip virtual), status LED (clean/dirty/new-file classes, click saves dirty, click clean is no-op), keyboard shortcuts (Ctrl+S saves, Ctrl+W closes, Ctrl+PageDown/Up cycles, single-file no-op, no-Ctrl no-op, focus-outside no-op), event composition (active-file-changed + file-saved both bubble across shadow).

- `webapp/src/monaco-setup.test.js` — new test file. Mocks monaco-editor at module level (monaco-setup itself imports it). Tests `languageForPath` across every mapped extension, case-insensitivity, extensionless paths, unknown extensions, directory paths, paths-with-dots-in-directories. Tests `installMonacoWorkerEnvironment` idempotence + `MonacoEnvironment` global installation. Tests `registerMatlabLanguage` idempotence + `getLanguages` reflects registration.

- `webapp/src/app-shell.js` — added `_onLoadDiffPanel` handler wired as a `window` event listener. History browser dispatches `load-diff-panel` with `{content, panel, label}`; the app shell flips `_activeViewer` to `'diff'` so the user sees the comparison, then calls `viewer.loadPanel`. Bound handler follows the same add/remove pattern as `_onNavigateFile`.

Design points pinned by tests:

- **Model disposal order is load-bearing.** `test_disposes_old_models_on_swap` verifies dispose is called AFTER the new `setModel` — swapping it around would crash Monaco. The mock's `setModel` stores the new models and `dispose` just flips a flag, so out-of-order disposal would pass the mock but fail in real Monaco. The ordering is enforced in code; the test confirms we're calling dispose at all.

- **Concurrent same-path guard.** `test_concurrent_openFile_for_same_path_drops_the_duplicate` fires two rapid calls for the same path and asserts only one model pair is created. Without the guard, the second call's async fetch would interleave with the first's model construction and leave Monaco in a half-initialized state.

- **RPC errors never propagate out.** HEAD fetch failure (test: `test_handles_HEAD_fetch_failure_as_a_new_file`) sets `isNew: true` and continues. Working-copy failure (test: `test_handles_working_copy_fetch_failure_gracefully`) leaves `modified: ''` and continues. Both paths produce an open file, not an error toast — a file missing from HEAD because it's new isn't an error.

- **loadPanel accumulation semantics.** `test_accumulates_both_panels_in_a_virtual_compare` proves that successive loadPanel calls on the same virtual://compare add to both sides. Specs4 is explicit about this; alternative designs (replace the whole file each call) would lose the "load-left-then-load-right" workflow the history browser's context menu depends on.

- **Virtual files never dirty.** `test_virtual_files_are_never_dirty_even_after_edit` edits a virtual file's modified side and verifies `getDirtyFiles()` still returns empty. `_isDirty` checks both `isVirtual` and `isReadOnly`; without the virtual check, URL content viewers (which use virtual paths) would show a dirty LED that can never be saved.

- **Status LED is the primary state indicator.** Three classes (clean/dirty/new-file) + the hover-to-save affordance replace the traditional tab bar. Pinned by four separate LED tests. `test_new_file_shows_new_file_class` specifically verifies the accent-blue "new" state — important because a new file's `modified` content matches its saved content (both equal to the working-copy fetch), so a naive dirty check would show clean, losing the "this file isn't in HEAD yet" signal.

- **Keyboard shortcuts are focus-scoped.** `test_keyboard_shortcuts_when_focus_is_outside_do_not_fire` proves Ctrl+S dispatched on `document.body` (without the viewer in the composed path) doesn't save. Otherwise every textarea anywhere in the app would trigger the viewer's save path. The `composedPath().includes(this)` check is the guard.

- **SharedRpc injection via globalThis.** The test pattern uses `globalThis.__sharedRpcOverride` rather than mocking `./rpc.js` at the module level. Means a single mock-less import of `diff-viewer.js` works across every test describe block — simpler than a per-file `vi.mock` for `rpc.js` that would need scope management. Production code reads the override first, then falls back to SharedRpc; the override path has zero cost when unset.

Notes from delivery:

- **The worker env is installed at module load.** monaco-setup.js calls `installMonacoWorkerEnvironment()` as a side effect. With the Monaco mock, this is effectively a no-op (the mock doesn't use `getWorker`). In production, installation must complete before the first `createDiffEditor` call — otherwise Monaco tries to spawn a worker via an uninstalled env and falls back to a broken default. The side-effect-at-import pattern is the only reliable way to guarantee this ordering; putting the install call in the diff viewer's constructor would miss the window if another consumer of monaco-editor (e.g., a future code editor tab) ran first.

- **MATLAB registration is likewise side-effect-at-import.** Grammar must register before any editor instance that might open a `.m` file. Monaco captures language providers at editor construction; a pre-registration editor opening a `.m` file would show plain text even after the grammar lands.

- **Mock's `getModifiedEditor` returns a fresh object per call.** Real Monaco returns the same object, but the mock's current implementation creates a new one each call. Tests that chain `getModifiedEditor().onDidChangeModelContent(...)` then observe via `getModifiedEditor().getValue()` work because the mock stashes state on the parent editor. This asymmetry is a test-mock concession; production diff-viewer code reads `modifiedEditor` once per lifecycle phase and doesn't rely on identity.

- **Shadow DOM style sync is observable only by live DOM inspection.** No unit test checks it directly — the test mock never lets Monaco actually insert styles, so there's nothing to sync. The implementation is pinned by specs4 prose rather than tests. Integration testing this would need real Monaco in a real browser (Phase 6's e2e harness).

- **Scroll-to-edit highlight duration.** 3 seconds, per specs4. Long enough that the user sees where the edit landed; short enough that stale highlights don't clutter the editor. The timer is cleared on a new highlight or on file switch.

### 5.8 — Phase 3.1b Markdown preview — **delivered**

Split-view live markdown preview for `.md` and `.markdown` files, with bidirectional scroll sync, image resolution, and preview-pane link navigation.

Delivered across three passes:

**Step 2a — toggle + live rendering.** Preview button on markdown files, split layout on toggle, inline diff on the editor side, live markdown rendering via the separate `markedSourceMap` instance from `markdown-preview.js` (created in Layer 5 alongside the pure helpers). Content flows through `_updatePreview` on every content-change event. Auto-exit when switching to a non-markdown file.

**Step 2b — scroll sync + KaTeX CSS.** Bidirectional scroll sync via `data-source-line` anchors injected by `renderMarkdownWithSourceMap`. `_collectPreviewAnchors` dedupes first-seen-per-line and filters for monotonic `offsetTop` (nested containers can have children with earlier positions than their outer block). Binary search + linear interpolation via `_mapLineToOffsetTop` / `_mapOffsetTopToLine`. Scroll-lock mutex (`_scrollLock` + `_scrollLockTimer`) prevents feedback loops — auto-releases after 120ms, which covers Monaco's smooth-scroll duration without suppressing genuine user scrolling. KaTeX CSS imported as raw string via Vite's `?raw` loader, injected into shadow root with a sentinel fallback for environments where the import doesn't resolve (vitest's default resolver). Editor scroll listener attached only in preview mode via `_refreshEditorScrollListener` so non-markdown files don't pay for scroll-sync machinery.

**Step 2c — image resolution + link navigation.** Post-render scan of `<img>` tags in the preview pane. Absolute URLs (`data:`, `blob:`, `http://`, `https://`) pass through. Relative paths are percent-decoded (to undo `_encodeImagePaths`'s space encoding), resolved against the current file's directory via `resolveRelativePath`, and fetched in parallel. SVG files use `Repo.get_file_content` + URL-encoded data URI (preserves internal relative refs, unlike base64); raster images use `Repo.get_file_base64` which already returns a ready data URI. Failed loads degrade gracefully — alt text indicates the problem, image dimmed via opacity. A generation counter (`_imageResolveGeneration`) bumped on every `_updatePreview` call discards stale fetches whose DOM writes would otherwise clobber fresher content. Preview pane click listener intercepts `<a>` clicks with relative `href`, resolves the path, and dispatches `navigate-file` events. Absolute URLs, fragment-only refs, and scheme-qualified URLs (`mailto:`, `tel:`, etc.) pass through to browser defaults.

Design points pinned by tests:

- **Dual Marked instances.** `markedChat` (chat panel) and `markedSourceMap` (preview) share KaTeX math but have completely separate renderer overrides. `markedSourceMap` injects `data-source-line` attributes on block-level elements; `markedChat` doesn't. Keeping them separate means preview-specific logic never affects chat rendering.

- **Generation counter for stale fetches.** Without it, a slow image RPC from keystroke N could overwrite an img's src after keystroke N+1 populated the DOM with a different image. Every `_updatePreview` bumps the counter; stale DOM writes check `generation !== this._imageResolveGeneration` before writing and bail.

- **SVG inline via URL-encoding, not base64.** Larger output but preserves searchability in devtools and — more importantly — lets relative refs *inside* the SVG work after data-URI injection. Base64 would break those. Matches specs4/5-webapp/diff-viewer.md's explicit "SVG files fetched as text and injected as data URIs with URL-encoded content" rule.

- **`.closest('a')` in the click handler, not `target.tagName === 'A'`.** Users click on `<em>` / `<strong>` inside links; `.closest()` walks up to find the anchor. Without it, clicking bold text inside a link would fall through to browser default navigation.

- **`preventDefault()` only fires when we're handling the click.** Ignored-click tests (absolute URL, fragment-only, mailto) assert `ev.defaultPrevented === false` so we're not silently breaking browser defaults for out-of-scope clicks.

- **KaTeX CSS fallback sentinel.** Vitest's default module resolver doesn't understand Vite's `?raw` suffix — the import returns `undefined` in tests. Without a fallback, `_ensureKatexCss` would bail early at the `typeof` check and the shadow DOM would never get the marker element, breaking tests. The fallback is a one-line CSS comment — production gets real KaTeX styles, tests get the sentinel, the injection path is always exercised.

Open carried over for Phase 3.1 follow-ups:

- **3.1c — TeX preview.** Depends on Repo's compile_tex_preview RPC. Save-triggered (not keystroke) since compilation is subprocess-bound. KaTeX client-side math rendering via sentinel comments. Two-pass anchor-and-interpolation scroll sync (structural anchor extraction → block-element interpolation → back-to-front attribute injection). Availability check hides Preview button on .tex/.latex when make4ht isn't installed.

- **3.1d — LSP integration.** Four Monaco providers: hover, definition, references, completions. Each dispatches to the corresponding Repo.lsp_* RPC. Coordinate system is already 1-indexed on both sides (Monaco's convention, specs4's convention); no conversion needed. Cross-file go-to-definition already wired via the code-editor-service patch; this adds the provider side.

- **3.1e — Markdown link provider.** Monaco LinkProvider for `.md` language. Matches `[text](relative-path)` patterns, skips absolute URLs and `#` anchors. Maps matched links to `ac-navigate:///` URIs; a companion LinkOpener intercepts that scheme and dispatches `navigate-markdown-link` events. The preview pane's click-based link navigation is already delivered in 3.1b — 3.1e adds the Monaco-side equivalent so Ctrl+click inside the editor also works.

### 5.6 — Phase 3 groundwork Viewer background routing — **delivered**

Lays the integration surface between `navigate-file` events and the file viewers. Phase 3.1 (diff viewer) and 3.2 (SVG viewer) can now be built against a fully-tested routing contract — each real viewer just swaps in for its stub without app-shell changes.

- `webapp/src/viewer-routing.js` — pure `viewerForPath(path)` function. Returns `'svg'` for `.svg` paths (case-insensitive), `'diff'` for everything else, `null` for malformed input. Extracted as a standalone module so the routing rule is testable without mounting the shell and evolvable without editing the shell's render logic.
- `webapp/src/diff-viewer.js` — Phase 3 stub. LitElement with reactive `_files` / `_activeIndex` state. Public API (`openFile({path, line?, searchText?})`, `closeFile(path)`, `refreshOpenFiles()`, `getDirtyFiles()`, `hasOpenFiles` getter) matches the shape Phase 3.1's Monaco-backed viewer will inherit. Dispatches `active-file-changed` events (bubbles, composed) on open/close/switch. Same-file suppression: re-opening the current file produces no event. Empty state renders the AC⚡DC watermark; populated state shows a placeholder `.stub-content` naming the active file.
- `webapp/src/svg-viewer.js` — same contract as diff-viewer, just for `.svg` files. Phase 3.2's real SVG viewer (side-by-side pan/zoom) will replace the stub. Identical public API + event surface so the app shell treats both uniformly.
- `webapp/src/app-shell.js` — integration:
  - Imports both viewers and the routing helper
  - New `_activeViewer` reactive state (`'diff'` or `'svg'`, default `'diff'`)
  - `_onNavigateFile(event)` — reads `detail.path`, dispatches to `viewerForPath`, calls `openFile` on the right viewer via `updateComplete.then` to guard against first-render edge cases. Forwards `line` and `searchText` through so Phase 3.1 doesn't need shell changes to use them.
  - `_onActiveFileChanged(event)` — walks `event.composedPath()` to find which viewer emitted the event, flips `_activeViewer` to that tag. Pinpoint source identification (rather than tracking which viewer we last called `openFile` on) means the handler stays correct if future viewers dispatch the same event.
  - Both viewers rendered as absolutely-positioned siblings in `.viewer-background`. CSS class toggling (`viewer-visible` / `viewer-hidden`) does the visibility via opacity + pointer-events + z-index with a 150ms transition.
  - Replaced the static watermark `div` in `.viewer-background` — now each viewer carries its own empty-state watermark. Transitions between viewers or between empty and populated states are visually stable (same mark in the same position).
- `webapp/src/viewer-routing.test.js` — 6 tests: svg extension routing (case-insensitive), non-svg fallback to diff, extensionless paths, defensive substring match prevention (`foo.svg.old` → diff), malformed input (`null`, `42`, empty string → null).
- `webapp/src/diff-viewer.test.js` — 18 tests across initial state (empty watermark, `hasOpenFiles` / `getDirtyFiles` empty), `openFile` lifecycle (fires event, renders path, same-file suppression, multi-file, re-open inactive switches, malformed-input guard, line/searchText accepted), `closeFile` lifecycle (clears active, activates next, inactive-close still fires for list-changed, unknown-path no-op), event composition (bubbles across shadow DOM), stub API no-ops.
- `webapp/src/svg-viewer.test.js` — 13 tests mirroring the diff-viewer contract for the SVG viewer.
- `webapp/src/app-shell.test.js` — new `viewer routing` describe block with 11 tests: both viewers render, diff default-visible, `.py` routes to diff, `.svg` routes to svg, opening `.svg` flips active viewer, switching extensions toggles visibility, file lists preserved across visibility toggles (critical — Phase 3.1 will have expensive Monaco instances, viewer-hiding must not destroy them), empty path ignored, missing detail ignored, `line`/`searchText` forwarded to viewer's `openFile`, unsubscribe on disconnect.

Design points pinned by tests:

- **Hiding a viewer never destroys its state.** The key invariant behind the whole approach — switching from a `.py` to an `.svg` must not close the `.py` viewer's tabs. `both viewers preserve their file lists across visibility toggles` pins this explicitly. Matters for Phase 3.1's Monaco: constructing a `DiffEditor` is expensive (hundreds of ms), so keeping it alive in a hidden container is load-bearing.

- **Same-file suppression at the viewer layer.** The diff-viewer's `openFile` checks `existing === _activeIndex` and returns early. Without this, a user clicking a file mention for the already-active file would re-fire `active-file-changed`, causing the app shell to re-flip visibility (harmless but noisy) and Phase 3.1's viewport-restore logic to treat the call as a tab switch and re-scroll.

- **`_activeViewer` flips based on emitted events, not call site.** The shell could track "which viewer did I last call openFile on" but that's fragile — if another code path calls `viewer.openFile` directly, the shell wouldn't know. Walking `composedPath` identifies the source viewer reliably.

- **`line` and `searchText` forwarded through the routing boundary.** The stub ignores them, but the app shell passes them verbatim. Phase 3.1 just implements them on the real viewer; no shell change needed.

- **Empty-string path ignored at the shell layer.** `viewerForPath('')` returns null, and the shell's guard `if (!target) return` short-circuits. Two belt-and-braces rejections of the same bogus input, but the shell doesn't have to know that — it trusts the routing helper.

- **Both viewers share the same empty-state watermark.** Previously the watermark lived in `.viewer-background` itself. Moving it into each viewer's empty-state means the mark stays visible regardless of which viewer is currently active, and the transition between empty and populated states is smooth (the mark fades out as content fades in, both at 150ms ease). Visual parity with the pre-Phase-3 look.

Delivered test count: 915 total (up from 867 after speech-to-text — +48 tests from Phase 3 groundwork across four new test files).

### 5.4 — Phase 2c Files tab orchestration — **delivered**

Standalone orchestrator component that combines the file picker (2a) and chat panel (2b) in a single tab. Owns the authoritative selected-files state. Loads the file tree from `Repo.get_file_tree` on RPC-ready. Wires selection sync both directions: user actions in the picker → server via `LLMService.set_selected_files`; server broadcasts (`files-changed`) → picker via direct prop assignment. Reloads the tree on `files-modified`. Translates `file-clicked` from the picker into `navigate-file` window events that Phase 3 will consume.

- `webapp/src/files-tab.js` — `FilesTab(RpcMixin(LitElement))`. Structure:
  - Two-pane layout — picker pane on the left (fixed width with min/max constraints; draggable handle lands in Phase 3), chat pane fills the remaining space.
  - Authoritative selection held as `this._selectedFiles: Set<string>`. NOT exposed as a reactive Lit property — reactive properties would trigger parent re-renders that reset child state (see architectural rationale below).
  - Child references accessed via `this._picker()` / `this._chat()` shadow-DOM queries. Called on demand rather than cached in fields — Lit's template may recreate the children if the tab is unmounted and remounted.
  - Default picker width of 280px. Tests don't exercise the resizer (Phase 3 work); the width is stable for now.
- **Architectural contract preserved — DIRECT-UPDATE PATTERN (load-bearing).** When selection changes, the tab updates both `picker.selectedFiles` and `chat.selectedFiles` by direct assignment plus `requestUpdate()`, NOT via Lit's reactive template propagation. specs4/5-webapp/file-picker.md#direct-update-pattern-architectural documents why: changing a property on a parent triggers a full template re-render, which reassigns child component properties. For the chat panel, that would reset scroll position and disrupt in-flight streaming. For the picker, it would collapse interaction state (context menus when they land in 2d, inline inputs, focus). The pattern: update our own `_selectedFiles` Set (source of truth) → assign `picker.selectedFiles = new Set(...)` + requestUpdate → assign `chat.selectedFiles = [...]` + requestUpdate → notify server via RPC.
- **Chat panel selection assignment is forward-looking.** The chat panel in Phase 2b doesn't yet consume `selectedFiles` — it will in Phase 2d for file-mention click toggling. Assigning now means 2d's work drops in without a refactor. The assignment is a no-op visually today; tests can observe it via `chat.selectedFiles`.
- **Set-equality short-circuit.** `_applySelection` compares against the current set and returns early if unchanged. Prevents loopback: when we call `set_selected_files` and the server echoes back via `filesChanged`, applying the echo would re-trigger the server call — infinite loop. The short-circuit makes the server-broadcast handler safe to be noisy about its source (always apply, never round-trip).
- **RPC dispatch target is `Repo.get_file_tree`, not `LLMService`.** The file tree is a Repo-layer concern, not an LLM service concern. specs3's RPC inventory had this as `Repo.get_file_tree` returning `{tree, modified, staged, untracked, deleted, diff_stats}`. Phase 2c uses only `tree`; Phase 2d's git status badges will consume the sibling arrays.
- **Restricted-error surfacing via toast.** `LLMService.set_selected_files` returns `{error: "restricted", reason: ...}` for non-localhost callers in collab mode. The tab's optimistic update stays (the picker already toggled); the server's follow-up `filesChanged` broadcast restores the authoritative state for the offending client. Toast type is `warning` rather than `error` — the user wasn't deceived, they were stopped.
- **RPC-reject handling.** Both `get_file_tree` and `set_selected_files` rejections surface as `error`-type toasts, matching the AppShell's toast layer expectations. Console logs accompany so debugging context is preserved.
- **Event contract:**
  - Listens on `window` for `files-changed` (server broadcast) and `files-modified` (commit/reset reload signal dispatched by the streaming handler or the commit RPC after mutation)
  - Listens on itself for `selection-changed` (picker event, bubbles up) and `file-clicked` (picker event, bubbles up)
  - Dispatches `navigate-file` on `window` for Phase 3's viewer
  - Dispatches `ac-toast` on `window` for error/warning surfacing (AppShell's toast layer catches these)
- **AppShell integration.** `app-shell.js` imports `./files-tab.js` and renders `<ac-files-tab>` when `activeTab === 'files'`. The dialog-body's CSS changed from `padding: 1rem` with `overflow: auto` to `display: flex; flex-direction: column; overflow: hidden` so the files tab can flex-grow to fill the container. The `.tab-placeholder` class retains its own padding for the remaining stub tabs (context, settings).

- `webapp/src/files-tab.test.js` — 14 tests across 6 describe blocks:
  - Initial state — picker and chat children render, `_treeLoaded` stays false until RPC is ready, RPC-ready triggers file-tree load with real tree data reaching the picker, rejection surfaces as error toast.
  - Selection sync picker → server — checkbox click calls `set_selected_files` with the right array, internal state and picker prop both update, restricted-error surfaces as warning toast, RPC reject surfaces as error toast.
  - Selection sync server → picker — `files-changed` broadcast applies to picker, no echo back to server (infinite-loop prevention), same-set broadcast short-circuits (no redundant prop reassignment — identity check on the picker's `selectedFiles` reference), malformed payloads tolerated without crash.
  - File click → navigate-file — name click dispatches `navigate-file` with `{path}`, checkbox click doesn't, malformed event ignored.
  - files-modified reload — event triggers re-fetch of the tree, reload errors surface as toast without unhandled rejection.
  - Cleanup — window listeners removed on disconnect; `files-modified` after remove produces no reload.

- Test infrastructure — uses the same `SharedRpc` fake proxy pattern as `chat-panel.test.js`. The `settle()` helper drains microtasks AND both children's `updateComplete` cycles so the full orchestration round-trip is observable.

Design points pinned by tests:

- **Reject broadcasts aren't echoed back.** `test_does_not_re_send_server_broadcast_back_to_server` proves the `notifyServer` flag on `_applySelection` isn't set when the source is the `files-changed` handler. Without this, the server's broadcast would trigger our `set_selected_files` call, which would trigger another broadcast, etc. The set-equality short-circuit provides a second line of defence, but the explicit flag is the primary one.
- **Set-equality identity check.** `test_ignores_broadcasts_with_the_same_set` asserts `picker.selectedFiles` is reference-equal before and after a same-set broadcast. Catches regressions where a future refactor helpfully reassigns the set unconditionally, which would cost us a redundant picker re-render every time the server echoes.
- **Malformed payloads don't crash.** `test_ignores_malformed_broadcast_payloads` exercises null, non-array, missing-field, and fully-null detail. A rogue broadcast from a future backend version (or a test artifact in collab mode) can't wedge the UI.
- **Restricted errors don't block the optimistic update.** The picker's checkbox has already flipped by the time we hear back from the server. The warning toast tells the user what happened; the server's `filesChanged` broadcast (which WILL fire in collab mode) does the actual restore. Testing the full collab handshake belongs to a Phase 4 integration test; Phase 2c just proves the single-client restricted path surfaces the warning without wedging state.

Not wired to advance scope further. The files-tab deliberately stops at navigation-event dispatch (`navigate-file`) without consuming it — Phase 3's viewer is the consumer. The @-filter bridge and middle-click path insertion are Phase 2d (they need chat-textarea work that doesn't exist yet).

Deferred to later sub-phases:

- Phase 2d: @-filter bridge between chat textarea and picker's `setFilter()`, middle-click path insertion with paste suppression, git status badges (picker rendering changes), branch badge at the root, context menu on picker rows, file-mention click toggling (uses the selectedFiles on the chat panel that this commit lays the groundwork for).
- Phase 2e: file search integration (pruned tree + match overlay).
- Phase 3: draggable resizer between picker and chat panes, localStorage persistence of pane widths, active-file highlight (needs viewer's `active-file-changed` event).

Next up — Phase 2d: chat panel advanced features — edit block rendering with diff highlighting, file mentions, snippet drawer, session controls, input history, message action buttons. The @-filter bridge and middle-click path insertion also land here since they need the chat textarea side.

## Post-Phase-3 design change — DiffViewer single-file, no-cache model

After Phase 3 shipped the Monaco diff viewer, end-user testing exposed a mismatch between the multi-file `_files[]` design and how the viewer is actually used. The symptoms:

- Switching files preserved Monaco models silently, so users holding unsaved edits in file A and opening file B found A's edits still there on return. The dirty LED also lied after a switch-back because `_dirtySet.delete` wasn't called on the switch-away path.
- Clicking the same file didn't refetch. External changes (git pull, another tool writing) were invisible until an explicit refresh trigger (stream-complete, commit result, files-modified).
- Picker "Discard Changes" didn't propagate to the viewer — open tabs showed pre-discard content indefinitely.
- Review mode enter/exit silently shifted HEAD/working-copy underneath the viewer without refetching open tabs.

The multi-file design also supported features the user does not need:

- Ctrl+PageUp/PageDown/W for cycling between tabs (no visible tab bar, so the shortcuts were discoverable only by reading the keyboard reference)
- `loadPanel`'s "accumulate across both panels" pattern, which only the history browser's context menu uses
- Per-file viewport state preservation

**Decision: rewrite DiffViewer to single-file, no-cache, refetch-on-every-click.** Rationale:

- Matches user's stated model: "every openFile fetches fresh; unsaved edits are lost on switch."
- Collapses the bug list from six items (caching lies, stale LED, discard-changes silence, review-mode silence, rename-points-to-dead-path, Monaco Go-to-Def bypass) to one (Monaco Go-to-Def, addressed separately as a dispatch fix).
- Eliminates ~150 lines of state management in diff-viewer.js.
- Aligns viewer cost with user action: one click = one fetch, predictably.

**What stays:**

- Single Monaco editor instance, reused across opens (disposal only when returning to empty state). Editor construction is expensive; the rewrite preserves the reuse pattern.
- `loadPanel` for ad-hoc comparison. Uses a dedicated virtual-comparison slot separate from the active-file slot. Two successive `loadPanel` calls accumulate across the slot's left and right sides, preserving the history-browser workflow.
- File navigation grid (`ac-file-nav`). The grid becomes pure navigation history — it tracks visited paths and supports Alt+Arrow traversal, but the diff viewer refetches on every navigation. Alt+Arrow is debounced (on Alt release or a short pause) so rapid sequences coalesce to a single fetch for the final target.
- Status LED, save pipeline, LSP, markdown/TeX preview, markdown link provider, Ctrl+S, Ctrl+F find widget.

**What goes:**

- `_files[]` array, `_activeIndex`, `closeFile`, `saveAll`, `getDirtyFiles` (all collapse to operations on the single active-file slot or become no-ops)
- `_viewportStates`, `_panelLabels`, `_texPreviewStates` maps (content-keyed persistence across switches)
- `_openingPaths` set (replaced by a single-slot guard plus generation-counter discard for superseded fetches)
- Ctrl+PageUp, Ctrl+PageDown, Ctrl+W keyboard shortcuts
- Same-file suppression in `openFile`
- Adjacent same-file reuse in `file-nav.openFile` (grid-side change)

**What changes:**

- Monaco Go-to-Def cross-file navigation: `_codeEditorService.openCodeEditor` patch dispatches `navigate-file` on the window instead of calling `this.openFile` directly. Aligns cross-file navigation with the single dispatch graph.
- Review mode enter/exit: `LLMService.start_review` and `end_review` responses trigger `files-reverted` so the active file refetches.
- `refreshOpenFiles` becomes `refreshActiveFile` (alias kept for backward compatibility with app-shell callers).

Spec updates landed alongside the code change:
- `specs4/5-webapp/diff-viewer.md` — rewrote File Management, Same-File Suppression, Concurrent openFile Guard, Load Panel, Editor Reuse, Per-File Viewport State, File Object Schema, Invariants sections
- `specs4/5-webapp/file-navigation.md` — added the debounce contract to Alt+Arrow; rewrote "Viewport Restoration" as "Pure Navigation History" to reflect no per-node cache

Implementation work tracked in `/IMPLEMENTATION_NOTES.md` under "DiffViewer redesign plan".

## Remaining Layer 5 work

Tracked in `/IMPLEMENTATION_NOTES.md`:

- **DiffViewer redesign** — single-file, no-cache, refetch-on-every-click. Planned; see IMPLEMENTATION_NOTES.md.
- **Doc Convert tab** — Commits 1–5 delivered; commit 6 remaining
- **Dialog polish** — dragging, resizing, minimizing, position persistence
- **File picker enhancements plan** — 12 increments, all delivered or documented
- **App shell polish** — window resize handling, global keyboard shortcuts
- **Collaboration UI** — admission flow, participant indicators

The active working log in `/IMPLEMENTATION_NOTES.md` carries the file-picker completion plan and the compaction UI plan (both delivered) plus current Layer 5 remaining scope.