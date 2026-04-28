# Chat
**Status:** stub
The chat panel renders conversation messages, handles streaming display, manages auto-scrolling, and owns the user input area. It is the primary interaction surface within the Files tab. It also hosts the history browser and session-management controls.
## Message Display
- Scrollable list of message cards — user, assistant, system event
- Keyed rendering for DOM reuse across updates
- User cards may include image thumbnails
- Assistant cards render markdown with syntax highlighting, math, edit blocks, and file mentions
- System event cards (commit, reset, mode switch) use distinct styling — dashed border, muted color, "System" role label
## Streaming Display
### Chunk Processing
- Chunks coalesced per animation frame — a pending variable stores the latest content; the frame callback reads and clears it before updating the streaming content property
- Each chunk carries full accumulated content, not deltas — dropped or reordered chunks are harmless
- First chunk begins rendering the streaming card; subsequent chunks update content in place
- Streaming card uses a force-visible class so content-visibility optimizations don't hide it
### Code Block Scroll Preservation
- Markdown HTML replacement on each chunk loses horizontal scroll positions on code blocks
- Before updating, snapshot scrollLeft of every code block inside the streaming card (by index)
- After DOM rebuild completes, restore the saved scroll positions
- Skipped when no code block was scrolled (common case)
### Passive Stream Adoption
- When a chunk arrives with a request ID the client did not initiate, adopt the stream as passive
- Sets current request ID and a passive-stream flag
- On completion of a passive stream, prepend the user message from the result (since the passive client didn't add it optimistically)

### Streaming State Keyed by Request ID

Streaming state (current content buffer, passive flag, streaming card DOM node) is keyed by request ID, not held as a singleton. In single-stream operation, there is at most one active key at a time; the singleton-like behavior is an emergent property, not a structural assumption.

A future parallel-agent mode (see [parallel-agents.md](../7-future/parallel-agents.md)) produces N concurrent streams under a parent user-request ID, each with a child ID. The chat panel renders N streaming cards, keyed by child ID. Chunk routing dispatches each chunk to its card by matching its request ID against the keyed state map.

The transport never assumes a singleton stream — every chunk carries the exact ID of the stream it belongs to (see [streaming.md](../3-llm/streaming.md#chunk-delivery-semantics)). The chat panel's routing layer is the frontend counterpart to that contract.
## Markdown Rendering
- Dedicated Marked instance for chat, separate from the diff-viewer preview instance
- Code renderer override — language label, copy button, syntax highlighting
- All other block elements use marked defaults (no preview-specific logic)
- Math extension — display and inline expressions rendered via KaTeX with parse-failure fallback
- Applies to user and assistant messages equally — users type markdown-literate text (matching what the LLM receives), so the UI renders it the same way. The renderer handles escaping internally, so passing user content through it is safe against HTML injection
### Syntax Highlighting
- Explicit language registration for common languages (JavaScript, TypeScript, Python, JSON, Bash, CSS, HTML, YAML, C, C++, diff, markdown)
- Fenced blocks with recognized language are highlighted directly
- Fenced blocks without a language use auto-detection
- Unrecognized languages fall back to escaped plain text
## Code Block Copy Button
- Injected into every fenced code block unconditionally, including during streaming
- Default opacity zero; fades in on hover via CSS — no visual flicker during streaming
- Click handling delegated through the markdown content click handler
- Shows brief confirmation after click
## Edit Block Rendering
- Edit blocks detected mid-stream render as pending with a partial diff preview
- On stream completion, per-edit results are merged into the assistant message
- On final render, each edit block shows — file path (clickable, navigates to diff viewer at the edit location), status badge, error message (for failed edits), diff lines
### Edit Block Segmentation
- Frontend parser splits raw LLM text into segments — text, edit, edit-pending
- Segment types distinguish complete from incomplete blocks (stream ended mid-block)
- File path line immediately preceding the start marker is attached to the edit segment
- Code fence stripping — handles LLM formatting quirk where blocks are wrapped in triple backticks
### Two-Level Diff Highlighting
- Line-level diff — Myers algorithm via diff library, produces context/remove/add typed lines
- Pairing — adjacent runs of remove followed by add are paired 1:1 for character-level diffing
- Character-level diff — word-level diff on each pair, producing segment arrays with equal/delete/insert types
- Rendering — paired lines show the word-level changes highlighted within the line-level background color
- Unpaired lines show only the line-level highlight
### Status Badges
- Applied — green, written to disk
- Already applied — green, new content already present in file
- Failed — red, with error detail
- Skipped — amber, pre-condition failure
- Not in context — amber, file was added to context for next attempt
- Validated — blue, dry-run passed
- New — green, file creation
- Pending — grey, streaming not yet complete
## File Mentions
### Detection (Final Render Only)
- Scan assistant message HTML for known repo file paths
- Pre-filter by substring match, sort candidates by path length descending (longer paths match first)
- Build combined regex, replace matches with clickable spans
- Also collect file paths from edit block headers
- Replacement operates only on text segments between HTML tags — tag attributes never touched
- Matches inside code blocks skipped; matches inside inline code replaced normally
### Click Handling
- Inline text mentions in message body navigate to the diff viewer
- File summary chips in the "Files Referenced" section only toggle selection — no navigation
- On add — accumulate input text with natural phrasing
- On remove — just update selection
- In-context files display with a muted "in-context" style
### File Summary Section
- Below each assistant message with file references
- Chips show check mark (in context) or plus (not in context)
- "Add All" button when multiple files can be added at once
- Section only shown for final rendered messages, never during streaming
### Input Accumulation on Add
- When a file is added via mention click, the chat input text is accumulated using natural phrasing
- Templates — "The file X added. Do you want to see more files before you continue?" for the first add, updated to join multiple files naturally on subsequent adds
- Falls back to appending a parenthetical note for non-matching input states
- Only basename (filename without directory path) used in accumulated text
## Edit Summary Banner
- Rendered at the end of the assistant message, not the top
- Aggregate counts — applied, already applied, failed, skipped, not-in-context
- Color-coded stat badges (green, amber, red)
- Individual failure listing when failures are present — file path (clickable), error type badge, error message
- When not-in-context edits are present, a note indicates the auto-populated retry prompt
- When ambiguous-anchor failures are present, a similar note references the retry prompt
## Retry Prompts
### Ambiguous Anchor Retry
- On stream completion, inspect edit results for ambiguous-match failures
- Auto-compose a retry prompt listing each failure with file path and error detail
- Place in chat textarea, auto-resize, but do not send
- User reviews, edits, or discards before sending
### Not-In-Context Retry
- When not-in-context edits are detected, auto-populate chat textarea with retry prompt naming added files
- Single file — "The file X has been added to context. Please retry the edit for: …"
- Multiple files — plural phrasing
- Not auto-sent — user reviews and sends when ready
- Note: may overwrite an earlier ambiguous-anchor prompt if both are present in the same response — acceptable
### Old-Text-Mismatch Retry
- When old-text-mismatch failures occur on files already in active context, auto-populate retry prompt
- Reminds the LLM that the file is already in context and asks it to re-read before retrying
- Not auto-sent
- Anchor-not-found failures do not trigger this prompt (different class of problem)
## Message Action Buttons
- Hoverable toolbars at top-right and bottom-right of each message card (both ends for long messages)
- Copy raw text to clipboard
- Insert raw text into chat input
- Not shown on streaming messages
## Scrolling
### Auto-Scroll
- During streaming — scroll-to-bottom on each update, unless user has scrolled up
- IntersectionObserver on a sentinel element at the bottom of the message container
- Scroll-up detection during streaming — a passive scroll listener tracks position and only disengages auto-scroll when the user scrolls upward by more than a threshold; pure observer-based detection would false-trigger during content reflows
- Observer only re-engages auto-scroll; never disengages during active streaming
- Double animation-frame wait pattern for scroll-to-bottom — ensures DOM has fully reflowed before setting scroll position
### Scroll-to-Bottom Button
- Appears when user has scrolled up
- Click scrolls to bottom
### Content-Visibility
- Off-screen messages use CSS content-visibility for performance
- Last N messages (around 15) forced to render fully — ensures accurate scroll heights near the bottom
### Scroll Preservation
- Tab switching — container stays in DOM (hidden), scroll position passively preserved
- Minimize/maximize — same, no explicit save/restore needed
- Session load — reset scroll state, scroll to bottom
### Auto-Scroll for Non-Streaming Messages
- Messages added outside streaming (commit, compaction) follow the same scroll-respect rule — if at bottom, scroll down; if scrolled up, leave unchanged
## Input Area
### Text Input
- Auto-resizing textarea
- Enter to send, Shift+Enter for newline
- Image paste — base64 encoded, size and count limits enforced
- Undo/redo workaround — native undo is broken in shadow DOM textareas when the framework re-renders set value programmatically; intercept Ctrl+Z and delegate via deprecated exec-command fallback
### Paste Suppression
- When middle-click inserts a path into the textarea, a flag on the chat panel tells the paste handler to suppress the browser's selection-buffer paste
- Flag is a one-shot — set on insert, consumed by the next paste event
### @-Filter
- Typing `@text` activates the file picker filter
- Escape removes the filter query from the textarea and clears the filter
### Escape Priority Chain
1. @-filter active — remove query, clear filter
2. Snippet drawer open — close drawer
3. Default — clear textarea
### Stop Button
- During streaming, Send transforms into Stop
- Click cancels the active request
### Input History
- A separate component hosted inside the chat input area — the chat panel owns the interaction lifecycle
- Records every sent message
- Up-arrow at cursor position 0 opens an overlay showing recent history
- Keyboard priority — when the overlay is open, the chat panel delegates key events to it
- Substring filter, capped at a size limit, duplicates moved to the end rather than creating a second entry
- Items displayed oldest-first (top) to newest (bottom)
- Up/Down navigate; Enter selects; Escape restores original input
- Session seeding — when a session is loaded, all user messages from that session are added to the input history for up-arrow recall
### Snippet Drawer
- Toggleable quick-insert buttons from config
- Click inserts at cursor
- Open/closed state persisted to localStorage
- Automatically closed (and state persisted) when a message is sent
### Speech to Text
- Toggle button for continuous voice dictation
- Transcribed text inserted at cursor position (not appended) with automatic space separators
- See [speech.md](speech.md)
### Images
- Supported formats — PNG, JPEG, GIF, WebP
- Size limits enforced (reject with visible error before encoding)
- Base64 data URI encoding
- Thumbnail previews with remove button below textarea
- Lightbox overlay on click (full-size view, Escape to close)
- Re-attach button on thumbnails and in lightbox (see [images.md](../4-features/images.md))
- Token counting via provider formula with fallback estimate
- Not automatically re-sent on subsequent messages — display-only after original send
## Action Bar

Two visual groups separated by a thin vertical divider:

- Search group — mode toggle (message/file), search input with inline toggles (ignore case, regex, whole word), result counter, arrow navigation
- Session group — new session, open history browser (hidden in file search mode)

Git action buttons (copy diff, commit, reset) and the review toggle live in the dialog header, not the chat action bar. See [shell.md](shell.md).

### Dual-Mode Search

- 💬 default — message search against raw message content
- 📁 toggle — file search via repo grep
- See [search.md](search.md) for the full search behavior

### Review Status Bar

- When review mode is active, a slim status bar appears above the chat input
- Shows review summary (branch, commits, file/line stats) and diff inclusion count
- Commit button is disabled during review
- See [code-review.md](../4-features/code-review.md)

### Snippet Reloading

- Snippets reloaded from the server whenever context changes:
  - On RPC ready (initial connection and reconnect)
  - On review state change (entering or exiting review mode)
  - On mode change (code ↔ document)
- Server returns mode-appropriate snippets; frontend does not distinguish between modes

## Agent Archive Integration

Turns in which the main LLM spawned agents have an associated archive of per-agent conversations (see [history.md](../3-llm/history.md#agent-turn-archive) and [agent-browser.md](agent-browser.md) for the UI spec).

- The chat panel surfaces these via a right-side agent region that fans out from the chat for the active turn
- A collapse tab on the right edge of the chat toggles the agent region open or closed; state persists per session
- The chat itself IS the spine of every turn — it shows the user message and the assistant response. In agent-mode turns, the assistant response's `content` naturally includes the main LLM's decomposition narration, any review-and-iterate decisions, and the final synthesis, because all of that came from the same LLM's output stream. The chat renders it exactly as any other assistant message; no special card layout is needed for agent-mode turns
- Assistant messages are schema-identical between agent-mode and non-agent-mode turns; the only distinguishing signal is the collapse tab, which appears whenever the active turn has an archive directory on disk

## Commit and Reset Flows

### Commit (Server-Driven)

- Commit button calls the commit-all RPC, which returns immediately with a started status
- Server performs the full pipeline in a background task (stage all → get diff → generate commit message → commit)
- On completion, server broadcasts the commit result to all connected clients
- All clients show a toast with the short SHA and first line, add a system event message card, and refresh the file tree
- A commit-in-progress guard on both client and server prevents concurrent commits
- Chat panel shows a progress message during the commit, replaced by the result when the broadcast arrives

### Reset to HEAD

- Click shows a confirmation dialog
- On confirm — calls reset RPC
- Server records a system event message in context and history
- Client displays the system event card and refreshes the file tree

## Broadcast Handling

### User Message Broadcast

- Server broadcasts the user message to all clients before streaming begins
- Sending client ignores the broadcast if it has an active request ID that is not a passive stream — it already added the message optimistically
- Collaborator clients add the message to their list immediately so the user message appears before streaming

### Session Sync

- Session-loaded event (from remote or local) replaces the entire message list
- Handler resets streaming state, enables auto-scroll, seeds input history from user messages in the loaded session
- Same event fires for both local history browser load and remote collaborator load — convergent handler

## Toast System (Chat-Local)

- Rendered inside the chat panel, positioned near the input
- Auto-dismisses after a short interval
- Used for chat-specific feedback — copy success, commit result, stream errors, URL fetch notifications
- Does not dispatch global toast events; separate from the shell's global toast layer

### Compaction Event Routing

Handler routes compaction/progress event stages to appropriate feedback:

| Stage | Handling |
|---|---|
| URL fetch / URL ready | Transient local toast during streaming |
| Compacting | Transient local toast indicating compaction in progress |
| Compacted | Replace message list with compacted messages from the event payload; success toast |
| Doc enrichment queued / file done / complete / failed | Not rendered as toast — header progress bar handles these (see [shell.md](shell.md) and [document-index.md](../2-indexing/document-index.md)) |

Handler accepts events for both the current streaming request ID and the most recently completed request ID, since compaction runs asynchronously after stream completion.

## History Browser

- Modal overlay hosted inside the chat panel
- Left panel — session list or search results; preview text, relative timestamp, message count badge
- Right panel — messages for selected session with simplified markdown rendering and image thumbnails
- Header — title, search input, close button

### Interactions

- Search — debounced full-text via the search RPC; switches left panel to search results mode; Escape clears or closes
- Session selection — click loads messages via the session messages RPC; preserves selection on close/reopen
- Message actions — hover reveals copy and paste-to-prompt buttons
- Context menu — right-click a message shows options to load in left or right panel of diff viewer, copy, paste to prompt
- Load session — calls the load-session RPC, dispatches session-loaded event (with messages), closes browser
- Close — backdrop click, close button, or Escape

### Events

| Event | Direction | Purpose |
|---|---|---|
| `session-loaded` | Outward (bubbles) | Carries loaded session messages to chat panel |
| `paste-to-prompt` | Outward (bubbles) | Carries message text to insert into chat input |
| `load-diff-panel` | Outward (bubbles) | Load content in diff viewer left or right panel |

## Invariants

- Each streaming chunk replaces the accumulated content, never appends a delta — order and completeness of chunks are independent
- Only final-rendered messages detect file mentions — streaming messages never process mentions
- Retry prompts are never auto-sent; user always reviews before sending
- Auto-scroll never disengages during active streaming without a deliberate upward scroll beyond a threshold
- The chat-local toast never dispatches global toast events
- Commit and reset messages persist to history as system event messages via the server, not client-side
- Session-loaded handler resets streaming state before replacing the message list
- Passive stream completion always prepends the user message from the result if present
- Turns that did not spawn agents render identically to today — the agent region and collapse tab never appear
- Agent-mode and non-agent-mode assistant messages share the same card layout; the only runtime signal of agent involvement is the collapse tab's presence for the active turn
- The active turn (for agent region routing) is determined solely by chat scroll position; no separate navigation state exists