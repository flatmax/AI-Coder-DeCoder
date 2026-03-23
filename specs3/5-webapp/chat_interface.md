# Chat Interface

## Overview

The chat panel renders conversation messages, handles streaming display, and manages auto-scrolling. It is the primary interaction surface within the Files tab.

## Message Display

Messages render as a scrollable list of cards:
- **User cards** — with optional image attachments
- **Assistant cards** — markdown rendering, edit blocks, file mentions
- **System event cards** — operational events (commit, reset) with distinct styling

Cards use keyed rendering for DOM reuse.

### System Event Messages

Operational events (git commit, git reset) are recorded as messages with `role: "user"` and a `system_event: true` flag. This design ensures:

- The **LLM sees them** as part of conversation history (it knows when git was reset or committed)
- They are **persisted** in the history store and survive page refresh / session reload
- They render with **distinct styling** — dashed border, left-aligned text, muted color, "System" role label — visually distinct from both user and assistant messages
- The history compactor treats them as regular messages (they count toward token budgets)

Events that produce system event messages:

| Event | Message Content |
|-------|----------------|
| Commit | `**Committed** \`{sha}\`\n\n\`\`\`\n{message}\n\`\`\`` |
| Reset to HEAD | `**Reset to HEAD** — all uncommitted changes have been discarded.` |
| Mode switch | `Switched to {mode} mode.` |

Commit and reset events are recorded server-side (via `LLMService.commit_all` and `LLMService.reset_to_head`) so they appear in persistent history and are visible to the LLM. The frontend renders the `system_event` flag from the message dict to apply the distinct card style.

---

## File Mentions

### Detection

On **final render only** (not streaming), assistant message HTML is scanned against known repo files:

1. Pre-filter by substring match (cheap — only files whose path appears as a substring in the rendered HTML)
2. Sort candidates by path length descending (so longer paths match first, preventing partial matches)
3. Build combined regex from all candidates, replace matches with clickable spans
4. Also collect file paths from edit block headers

Matches become `<span class="file-mention" data-file="path">` (with `.in-context` if already selected).

**HTML-aware replacement:** The replacement processes only text segments between HTML tags (tag attributes are never touched). Matches inside `<pre>` blocks are skipped to avoid corrupting code blocks. Matches inside inline `<code>` elements are replaced normally.

### File Summary Section

Below each assistant message with file references:
```
📁 Files Referenced            [+ Add All (N)]
[✓ src/app.js] [+ src/utils/helpers.js]
```

Chips show ✓ (in context, muted) or + (not in context, accent). "Add All" button for 2+ unselected files. The "Add All" button stores the list of unselected file paths as a JSON `data-files` attribute for the click handler to parse.

### Click → Toggle Selection

Clicking a file mention dispatches `file-mention-click`. The Files tab **toggles** the file's selection state:

- **Not selected** → add to selection, update picker checkbox, accumulate input text
- **Already selected** → remove from selection, update picker checkbox

**Inline text mentions** (in message body): navigate to the file in the diff viewer in both cases.

**File summary chips** (in the "Files Referenced" section): only toggle selection — no navigation. The "Add All" button also only toggles without navigation.

### File Summary Chips vs Inline Mentions

**Inline text mentions** (in message body) navigate to the diff viewer on click.
**File summary chips** (in the "Files Referenced" section below messages) only toggle selection — they do not open the diff viewer. The "Add All" button also only toggles selection without navigation.


### File Mention Orchestration

The `ac-files-tab` component acts as the orchestration hub for file mention clicks. When a `file-mention-click` event bubbles up from the chat panel:

1. It syncs the current messages from the chat panel to prevent stale overwrites during re-render
2. Toggles the file in the selected files list (add if absent, remove if present)
3. Updates the file picker's checkbox state directly
4. Updates the chat panel's `selectedFiles` property directly
5. Notifies the server of the new selection
6. On add: calls `accumulateFileInInput()` on the chat panel
7. If `navigate: true` (inline text mentions): dispatches `navigate-file` to open in diff viewer
8. If `navigate: false` (file summary chips, "Add All"): no navigation

This direct-update pattern (rather than relying on reactive property propagation through the parent) avoids full re-renders that would reset scroll position and streaming state.

### Input Accumulation (on add)

When a file is added via mention click, the chat input text is accumulated using specific patterns:

| Current input state | Result |
|---|---|
| Empty | `The file {basename} added. Do you want to see more files before you continue?` |
| Matches `The file X added. Do you want to see more files...` | Replaced with `The files X, {basename} added. Do you want to see more files before you continue?` |
| Matches `The files X, Y added. Do you want to see more files...` | Updated to `The files X, Y, {basename} added. Do you want to see more files before you continue?` |
| Ends with `(added X)` | Appends ` (added {basename})` |
| Any other text | Appends ` (added {basename})` |

Only the basename (filename without directory path) is used in the accumulated text.

---

## Streaming Display

### Chunk Processing

Coalesced per animation frame via `requestAnimationFrame`. A pending chunk variable stores the latest content; the rAF callback reads and clears it, then updates the `_streamingContent` property. If auto-scroll is engaged, `updateComplete.then(() => requestAnimationFrame(() => scrollToBottom()))` ensures the DOM has reflowed before scrolling.

Each chunk carries full accumulated content (not deltas). First chunk sets `streamingActive = true` and begins rendering the streaming card; subsequent chunks update `_streamingContent`. The streaming card is rendered separately from the message list with a `force-visible` class and streaming indicator.

**Code block scroll preservation:** Since `unsafeHTML` replaces the entire DOM subtree on each chunk, any horizontal scroll position on `<pre>` elements is lost. Before updating `_streamingContent`, the handler snapshots `scrollLeft` of every `<pre>` inside the streaming card (by index). After `updateComplete` resolves and the DOM has been rebuilt, the saved `scrollLeft` values are restored to the corresponding `<pre>` elements. This restore step is skipped entirely if no `<pre>` was scrolled, avoiding overhead in the common case.

### Markdown Rendering

Assistant messages are rendered via `renderMarkdown()` from `webapp/src/utils/markdown.js`, which uses a dedicated `Marked` instance (`markedChat`) with `highlight.js` for syntax highlighting. This is a **separate instance** from the one used by the diff viewer's Markdown preview (`markedSourceMap`) — the two do not share any renderer state.

**Chat renderer overrides:** Only the `code()` renderer method is overridden. All other block elements (headings, paragraphs, lists, tables, blockquotes) use marked's built-in defaults. This keeps the chat renderer simple and immune to regressions from preview-specific logic.

**Configuration:** GFM enabled, `breaks: true` (newlines become `<br>`). A KaTeX math extension handles `$$...$$` (display math) and `$...$` (inline math) — expressions are rendered to MathML/HTML via `katex.renderToString` with `throwOnError: false`, falling back to escaped code on parse failure.

**Syntax highlighting:** The `code()` renderer uses `highlight.js` with explicit language registration. Registered languages: `javascript`/`js`, `python`/`py`, `typescript`/`ts`, `json`, `bash`/`sh`/`shell`, `css`, `html`/`xml`, `yaml`/`yml`, `c`, `cpp`, `diff`, `markdown`/`md`. When a language is specified on a fenced code block and recognized, it is highlighted directly. When no language is specified, `highlightAuto` attempts auto-detection. Unrecognized languages fall back to HTML-escaped plain text.

**Code block output:** Each fenced code block renders as `<pre class="code-block">` containing a language label (`<span class="code-lang">`), a copy button, and `<code class="hljs">` with highlighted markup.

### Code Block Copy Button

📋 button injected into every `<pre class="code-block">` element **unconditionally** (including during streaming). The button has `opacity: 0` by default and fades in on `<pre>` hover via CSS, so it doesn't cause visual flicker during streaming. Click handling delegated through the `.md-content` click handler. Shows "✓ Copied" for 1.5s after click.

### Edit Block Rendering

During streaming: edit blocks detected mid-stream render as `edit-pending` with a pending badge and partial diff. On stream completion, the `streamComplete` result's `edit_results` array is merged into the assistant message as an `editResults` map (keyed by file path) along with aggregate counts (`passed`, `failed`, `skipped`, `not_in_context`, `files_auto_added`). On final render:
- File path (clickable → navigates to diff viewer with `searchText` from the edit block's old/new lines)
- Status badge: ✅ Applied (green), ❌ Failed: reason (red), ⚠️ Skipped (orange), ☑ Validated (blue), 🆕 New (green, for file creates), ⏳ Pending (grey), ⚠️ Not in context — file added (amber, for not-in-context edits)
- Two-level diff highlighting (see below)
- Error message below header (for failed edits only)

#### Edit Block Segmentation (`edit-blocks.js`)

`segmentResponse(text)` splits raw LLM text into an array of segments using the same markers as the backend parser (`««« EDIT` / `═══════ REPL` / `»»» EDIT END`):

| Segment Type | Description |
|-------------|-------------|
| `text` | Markdown prose between edit blocks |
| `edit` | Complete edit block with `filePath`, `oldLines`, `newLines`, `isCreate` |
| `edit-pending` | Incomplete edit block (stream ended mid-block) |

The file path line preceding `««« EDIT` is stripped from the text segment and attached to the edit segment. Consecutive file-path-like lines are handled by treating only the last one before `««« EDIT` as the actual path.

**Note:** This is a separate, simplified parser from the backend's `edit_parser.py`. The frontend parser only needs to identify block boundaries for rendering — it does not perform anchor matching or validation. Its file-path heuristic (`_isFilePath`) uses simpler rules than the backend: rejects lines starting with `#`, `/`, `*`, `-`, `>`, or triple backticks; accepts lines containing `/` or `\`, or matching `word.ext` patterns; rejects lines over 200 characters.

**Code fence stripping:** When the LLM wraps an edit block inside a markdown code fence (`` ``` ``), the parser strips the opening fence (if it immediately precedes the file path) and the closing fence (if it immediately follows `»»» EDIT END`). This handles a common LLM formatting quirk without requiring the backend to be aware of it.

#### State Machine (Frontend)

| State | Trigger | Action |
|-------|---------|--------|
| `text` | File path pattern | Record path → `expect_edit` |
| `text` | Other line | Accumulate text |
| `expect_edit` | `««« EDIT` | Strip any trailing code fence from text buffer, flush text → `old` |
| `expect_edit` | Another file path | Previous path was just text; update path |
| `expect_edit` | Other line | Push path + line to text buffer → `text` |
| `old` | `═══════ REPL` | → `new` |
| `old` | Other line | Accumulate old lines |
| `new` | `»»» EDIT END` | Emit `edit` segment, skip trailing code fence → `text` |
| `new` | Other line | Accumulate new lines |
| End of input in `old`/`new` | — | Emit `edit-pending` segment |

#### Two-Level Diff Highlighting

Uses the `diff` npm package (Myers diff algorithm).

**Stage 1: Line-level diff** — `computeDiff(oldLines, newLines)` calls `diffLines()` to produce flat line objects typed as `context`, `remove`, or `add`.

**Stage 2: Pairing** — Adjacent runs of consecutive `remove` lines followed by consecutive `add` lines are paired 1:1 for character-level diffing. Unpaired lines (more removes than adds or vice versa) get whole-line highlighting only.

**Stage 3: Character-level diff** — For each paired remove/add line, `computeCharDiff(oldStr, newStr)` calls `diffWords()` to find word-level differences. Returns two segment arrays (`old` and `new`), each containing `equal`/`delete`/`insert` typed segments. Consecutive segments of the same type are merged via `_mergeSegments()`.

**Stage 4: Render** — `_renderDiffLineHtml(line)` renders each line as a `<span class="diff-line {type}">` with a non-selectable prefix (`+`/`-`/` `). Lines with `charDiff` data wrap changed segments in `<span class="diff-change">`:

```css
.diff-line.remove  { background: #2d1215; color: var(--accent-red); }
.diff-line.add     { background: #122117; color: var(--accent-green); }
.diff-line.context { background: var(--bg-primary); color: var(--text-primary); }
.diff-line.remove .diff-change { background: #6d3038; }
.diff-line.add .diff-change    { background: #2b6331; }
```

#### Instance Methods

Edit block rendering uses instance methods on `AcChatPanel` (not standalone functions) to access component state:

| Method | Purpose |
|--------|---------|
| `_renderAssistantContent(content, editResults, isFinal)` | Segments response, renders text with markdown and edit blocks inline. Applies file mentions only on final render |
| `_renderEditBlockHtml(seg, result)` | Renders a single edit block card: header with file path (click to toggle selection), goto icon (click to open in diff viewer with searchText), status badge, optional error, diff lines |
| `_renderDiffLineHtml(line)` | Renders one diff line with optional character-level `<span class="diff-change">` highlights |

### Edit Summary

Banner **after** all edit blocks (at the end of the assistant message, not the top): counts of applied/failed/skipped/not-in-context with color-coded stat badges (green/red/orange/amber). When not-in-context edits are present, the banner includes a note about the auto-populated retry prompt. Rendered by `_renderEditSummary(msg)` using Lit templates (not HTML strings).

### Not-In-Context Retry Prompt

When `streamComplete` delivers `files_auto_added`, the system auto-populates the chat textarea with a retry prompt:

- **Single file**: "The file {name} has been added to context. Please retry the edit for: ..."
- **Multiple files**: "The files {name1}, {name2} have been added to context. Please retry the edits for: ..."

The prompt lists each file's full path. It is placed into the textarea (auto-resized, focused) but **not auto-sent** — the user reviews and sends when ready. This parallels the ambiguous anchor retry prompt behavior.

### Ambiguous Anchor Retry Prompt

When `streamComplete` delivers edit results containing **ambiguous anchor failures** (status `failed`, message containing "Ambiguous anchor"):

1. A retry prompt is auto-composed listing each failed file with the error detail
2. The prompt is placed into the chat textarea (auto-resized) but **not sent**
3. The edit summary banner appends a note: *"A retry prompt has been prepared in the input below."*
4. The user can review, edit, augment, or discard the prompt before sending

This is consistent with the not-in-context pattern: suggest an action but let the user control when and what to send.

### Old Text Mismatch Retry Prompt

When `streamComplete` delivers edit results containing **old text mismatch failures** (status `failed`, message containing "Old text mismatch") where the target file is **already in the active context** (present in `selectedFiles`):

1. A retry prompt is auto-composed listing each failed file with the error detail
2. The prompt reminds the LLM that the file is already in context and asks it to re-read the actual file content before retrying
3. The prompt is placed into the chat textarea (auto-resized) but **not sent**
4. The edit summary banner appends a note: *"A retry prompt has been prepared in the input below."*

**Template:**

```
The following edit(s) failed because the old text didn't match the actual file content. The file(s) are already in your context — please re-read them carefully and retry with the correct text:

{file}: {error detail}
...
```

Only in-context mismatch failures trigger this behavior. Mismatch failures on files that were auto-added (not-in-context) are covered by the not-in-context retry prompt instead. Anchor-not-found failures do not trigger this prompt since they indicate a different class of problem (the anchor text doesn't exist in the file at all).

### Dependencies

| Package | Import | Used In |
|---------|--------|---------|
| `diff` (npm) | `diffLines`, `diffWords` | `webapp/src/utils/edit-blocks.js` — line-level and word-level Myers diff |
| `marked` (npm) | `Marked` | `webapp/src/utils/markdown.js` — GFM markdown parsing with `breaks: true` |
| `highlight.js` (npm) | `hljs` (core + per-language) | `webapp/src/utils/markdown.js` — syntax highlighting in code blocks |
| `katex` (npm) | `katex` | `webapp/src/utils/markdown.js` — LaTeX math rendering (`$$...$$` display, `$...$` inline) |

---

## Message Action Buttons

Hoverable toolbars at **top-right and bottom-right** of each message card (both ends for long messages):

| Button | Action |
|--------|--------|
| 📋 | Copy raw text to clipboard |
| ↩ | Insert raw text into chat input |

Not shown on streaming messages.

---

## Scrolling

### Auto-Scroll

During streaming: scroll-to-bottom on each update, unless user has scrolled up. Uses IntersectionObserver on a sentinel element at the bottom of the message container.

**Scroll-up detection during streaming**: The IntersectionObserver alone is insufficient during active streaming — content reflows can briefly push the sentinel out of view, which would falsely disengage auto-scroll. To handle this, the container tracks `_lastScrollTop` via a passive scroll listener and only disengages auto-scroll when the user has scrolled **upward by more than 30px** from the last known position. The observer only re-engages auto-scroll on `isIntersecting=true`; it never disengages during active streaming. Only the manual scroll-up check disengages.

**Double-rAF scroll pattern**: Scroll-to-bottom uses `requestAnimationFrame(() => requestAnimationFrame(() => ...))` (double-rAF) to ensure the DOM has fully reflowed before setting `scrollTop`. This is necessary because Lit's template rendering and the browser's layout pass may not complete within a single animation frame. This pattern is used after: streaming chunks (via `updateComplete.then`), stream completion, message bulk-load (session restore), and explicit scroll-to-bottom button clicks.

### Scroll-to-Bottom Button

Appears when user scrolls up. Click: scroll to bottom.

### Content-Visibility

Off-screen messages use `content-visibility: auto`. Last 15 messages forced to render fully.

### Scroll Preservation

**Tab switching**: Container stays in DOM (hidden), scroll position passively preserved. No auto-scroll on tab return.

**Minimize/maximize**: Container stays in DOM (hidden via CSS), scroll position passively preserved. No explicit save/restore logic — the browser maintains scroll offset since the element is not removed.

**Session load**: Reset scroll state, double-rAF → scroll to bottom.

### Auto-Scroll for Non-Streaming Messages

Messages added outside of streaming (e.g., commit messages, compaction summaries) follow the same scroll-respect rule: if the user is already at the bottom, scroll down; if scrolled up, leave unchanged.

### Content-Visibility Detail

Off-screen messages use `content-visibility: auto` with `contain: layout style paint` and intrinsic size hints (80px for user cards, 200px for assistant cards — reflecting typical rendered heights). The **last 15 messages** are forced to render fully (`content-visibility: visible`, `contain: none`) to ensure accurate scroll heights near the bottom.

---

## Input Area

### Text Input
- Auto-resizing textarea
- Enter to send, Shift+Enter for newline
- Image paste (base64, 5MB max, 5 images max)

### Paste Suppression for Middle-Click

When the file picker's middle-click inserts a path into the textarea, the browser's selection-buffer paste is suppressed to prevent duplicating the inserted path. The paste handler blocks the next paste event following a programmatic path insertion.

### @-Filter

Typing `@text` activates file picker filter. Escape removes `@query` from textarea and clears filter.

### Escape Priority Chain

| Priority | Condition | Action |
|----------|-----------|--------|
| 1 | @filter active | Remove @query, clear filter |
| 2 | Snippet drawer open | Close drawer |
| 3 | Default | Clear textarea |

### Stop Button

During streaming, Send becomes ⏹ Stop. Dispatches `stop-streaming` → `LLM.cancel_streaming`.

### Input History

A separate component (`AcInputHistory`) hosted inside the chat input area. The chat panel owns the interaction lifecycle:

**Host/guest API contract:**
- `addEntry(text)` — called on every send to record the input
- `show(currentInput)` — called on up-arrow at cursor position 0; saves the current textarea content for restoration
- `handleKey(e)` — called from the chat panel's `_onKeyDown` when the overlay is open; returns `true` if handled. The overlay gets **keyboard priority** — the chat panel delegates to it before processing its own shortcuts
- `history-select` event — fired on Enter; carries the selected text
- `history-cancel` event — fired on Escape; carries the original input text that was in the textarea when the overlay opened

**Overlay behavior:**
- Contains its own filter input for substring matching (not the main textarea)
- History capped at 100 entries; duplicates are moved to the end rather than creating a second entry
- Items displayed oldest-first (top) to newest (bottom)
- Up/Down arrows navigate the filtered list; Enter selects; Escape restores original input and closes
- Clicking an item selects it

**Session seeding:** When a session is loaded (from the history browser or on startup state restore), all user messages from that session are added to the input history via `addEntry()`. This lets up-arrow recall previous messages from the loaded conversation, not just messages typed since the page loaded. Multimodal user messages (containing image blocks) have their text blocks extracted and joined. Empty/whitespace-only messages are skipped.

### Snippet Drawer

Toggleable quick-insert buttons from config. Click inserts at cursor. Drawer open/closed state persisted to localStorage (`ac-dc-snippet-drawer`).

### Speech to Text

🎤 toggle for continuous voice dictation. Transcribed text is inserted at the current cursor position in the textarea (not appended), with automatic space separators and cursor repositioning. See [Speech to Text](speech_to_text.md).

### Images

| Property | Detail |
|----------|--------|
| Supported formats | PNG, JPEG, GIF, WebP |
| Max size per image | 5MB (reject with visible error before encoding) |
| Max images per message | 5 |
| Encoding | Base64 data URI |
| Display (input) | Thumbnail previews with remove button, below textarea |
| Display (message) | Thumbnails in user cards with 📎 re-attach overlay (appears on hover), clickable for lightbox overlay |
| Lightbox | Full-size view with Escape to close. "📎 Re-attach to input" action button at bottom. Overlay is focusable (`tabindex="0"`) for keyboard handling but does not implement full focus trapping |
| Re-attach | 📎 button on thumbnails or lightbox adds image to pending input (same as paste). Respects 5-image limit and deduplication. See [Image Persistence — Re-Attaching](../4-features/image_persistence.md#re-attaching-previous-images) |
| Token counting | Provider's image token formula; fallback: ~1000 tokens per image |
| Persistence | See [Image Persistence](../4-features/image_persistence.md) |
| Re-send | NOT automatically re-sent to LLM on subsequent messages — display-only after original send, but can be manually re-attached |

---

## Action Bar

The action bar is divided into two visual groups by a thin vertical divider (`.action-divider`):

| Group | Elements | Purpose |
|-------|----------|---------|
| Search | 🗨/🔎 toggle, search input with inline Aa/.*/ab toggles, result counter + ▲/▼ | Unified search area |
| Session | ✨ 📜 | New session, browse history (hidden in file search mode) |

Git actions (📋 💾 ⚠️) are in the dialog header — see [App Shell and Dialog — Header Sections](../5-webapp/app_shell_and_dialog.md#header-sections).

The search input and its inline toggle buttons share a single border (`.chat-search-box` wrapper). The three toggles (`Aa` ignore case, `.*` regex, `ab` whole word) sit inside the input's right edge, following the VS Code pattern. Focus-within highlights the shared border.

### Chat Search (Dual Mode)

The search area supports two modes via the 🗨/🔎 toggle button (left of the input). See [Search and Settings — Integrated File Search](search_and_settings.md#integrated-file-search) for the full file search specification.

**Message search (💬 — default):**

- Case-insensitive substring matching against raw message `content` strings (not rendered HTML)
- `Aa` toggle affects case sensitivity
- Match counter shows `N/M` (current/total); ▲/▼ buttons for mouse navigation
- All messages remain visible — matches are highlighted and scrolled into view
- Current match scrolled to center with accent highlight via `scrollIntoView({ block: 'center' })`
- Enter for next match (wraps around), Shift+Enter for previous (wraps around), Escape clears query and blurs input
- Match indices reference message array positions, matched against `data-msg-index` attributes on message cards

**File search (📁):**

- Debounced (300ms) RPC call to `Repo.search_files` with the three toggle states
- Results appear in an overlay covering the messages area (messages are hidden via `display:none`)
- The file picker swaps to a pruned tree showing only matching files
- Bidirectional scroll sync between overlay and picker (see search_and_settings.md)
- ↑/↓ navigate matches, Enter opens in diff viewer, Escape clears query then exits mode
- Sending a chat message auto-exits file search mode

#### Highlight Implementation (Message Search)

Message cards have `border: 1px solid transparent` by default with a CSS transition on `border-color` and `box-shadow`. The `.search-highlight` class (applied via `data-msg-index` attribute matching) sets:
- `border-color: var(--accent-primary)`
- `box-shadow: 0 0 0 1px var(--accent-primary), 0 0 12px rgba(79, 195, 247, 0.15)`

The chat panel manages highlights internally — `_scrollToSearchMatch(msgIndex)` clears all previous `.search-highlight` classes, then queries its own shadow DOM for `.message-card[data-msg-index="N"]` and applies the class. `scrollIntoView({ block: 'center' })` brings the match into view. All highlight state (matches array, current index) is managed within the chat panel component.

#### File Search Overlay

When file search mode is active, the messages area is hidden (`display: none`) and a `.file-search-overlay` is shown in its place (both inside a `position: relative` wrapper div with `flex: 1`). The overlay uses `position: absolute; inset: 0` to fill the wrapper. This preserves the chat panel's DOM state (streaming, scroll position, input text) while file search is active.

The overlay renders file match sections with `data-file-section` attributes for scroll sync targeting. Match text is highlighted using `unsafeHTML` with regex-built highlight spans.

### Review Status Bar

When review mode is active, a slim status bar appears above the chat input showing review summary and diff inclusion count. See [Code Review — Review Status Bar](../4-features/code_review.md#review-status-bar). The commit button is disabled during review.

### Review Snippets

When review mode is active, `LLMService.get_snippets()` returns review-specific snippets (from the `"review"` key in the unified `snippets.json`). The snippet drawer displays whichever mode's snippets are returned — it does not merge modes. See [Code Review — Review Snippets](../4-features/code_review.md#review-snippets).

### Commit Flow (Server-Driven)

The commit button calls `LLMService.commit_all()`, which returns `{status: "started"}` immediately. The server performs the full commit pipeline in a background task (stage all → get diff → generate commit message via LLM → commit). On completion, the server broadcasts `AcApp.commitResult(result)` to **all** connected clients via `self.call`.

All clients (including collaborators on other machines) receive the commit result and:
- Show a toast with the short SHA and first line of the commit message
- Add an assistant message card with the full commit info
- Dispatch `files-modified` to refresh the file tree

A `_committing` guard on both client and server prevents concurrent commits. The chat panel shows a progress message ("Staging changes and generating commit message...") which is replaced by the actual commit info when the result arrives.

### User Message Broadcast

When a user sends a chat message, the server broadcasts `AcApp.userMessage({content})` to all clients before streaming begins. This ensures collaborators see the user's message immediately rather than waiting for `streamComplete`.

The sending client ignores this broadcast — it already added the message optimistically in `_send()`. Collaborator clients (detected by having no active `_currentRequestId` or being in passive stream mode) add it to their message list.

### Session Sync (Collaborator)

When a `session-loaded` CustomEvent fires on `window` (dispatched by the app shell on receiving `AcApp.sessionChanged` from the server), the chat panel replaces its entire message list with the received messages. This handles two collaboration scenarios:

- **New session**: another localhost client called `new_session` → messages array is empty, chat clears
- **Loaded session**: another localhost client called `load_session_into_context` → messages array contains the loaded conversation

The handler resets streaming state (`_streamingContent`, `_currentRequestId`, `streamingActive`), enables auto-scroll, and seeds input history from user messages in the loaded session via `_seedInputHistory()`. This method iterates all user messages, extracts text content (joining text blocks from multimodal messages), and calls `addEntry()` on the input history component for each non-empty message. This ensures up-arrow recall works for messages from the loaded conversation, not just messages typed since the page loaded.

The same `session-loaded` event is also fired by the local history browser path, so both local and remote session loads converge on the same handler.

---

## Toast System

Two independent toast layers exist:

**Chat panel local toast** — rendered inside the chat panel's shadow DOM (`this._toast` property), positioned fixed at bottom-center. Shown by `_showToast(message, type)`. Auto-dismisses after 3 seconds. Used for chat-specific feedback: copy, commit, reset, stream errors, URL fetch notifications.

**App shell global toast** — rendered in the app shell's shadow DOM (`this._toasts` array). Triggered by `ac-toast` custom events on `window`. Supports multiple simultaneous toasts with independent fade-out (300ms after 3s auto-dismiss). Used by components outside the chat panel (settings tab, file save errors).

The chat panel's `_showToast` only sets its local `_toast` property — it does **not** dispatch global `ac-toast` events. The settings tab's `_showToast` does both (local rendering plus global dispatch). Components using `RpcMixin` have a `showToast()` helper that dispatches global events only.

### Compaction Event Toasts

The chat panel's `_onCompactionEvent` handler routes compaction event stages to appropriate toast types:

- `url_fetch` and `url_ready` → transient local toast (during streaming)
- `doc_enrichment_queued` → create persistent enrichment toast showing pending files
- `doc_enrichment_file_done` → update persistent toast (remove completed file)
- `doc_enrichment_complete` → transition persistent toast to success state, auto-dismiss after 3s
- `doc_enrichment_failed` → show warning in persistent toast for the failed file

See [Document Mode — Enrichment Toast](../2-code-analysis/document_mode.md#enrichment-toast) for the full persistent toast specification.

## History Browser

Modal overlay (`<ac-history-browser>`) for browsing past conversations. Hosted inside the chat panel's shadow DOM.

### Layout

- **Left panel**: Session list (default) or search results. Each session shows preview text (first ~100 chars), relative timestamp, and message count badge
- **Right panel**: Messages for the selected session, with simplified markdown rendering. Includes image thumbnails when messages have `images` arrays (reconstructed from `image_refs` by the backend)
- **Header**: Title, search input, close button

### Interactions

- **Search**: Debounced (300ms) full-text via `LLMService.history_search`. Switches left panel to search results mode. Escape in search input: clears query (if non-empty) or closes browser (if empty)
- **Session selection**: Click loads messages via `LLMService.history_get_session`. Preserves selection on close/reopen
- **Message actions**: Hover reveals copy (📋) and paste-to-prompt (↩) buttons. Copy writes raw content to clipboard. Paste-to-prompt dispatches `paste-to-prompt` event and closes the browser
- **Context menu**: Right-click on a message shows a context menu with: "◧ Load in Left Panel", "◨ Load in Right Panel", "📋 Copy", "↩ Paste to Prompt". The load-in-panel actions dispatch `load-diff-panel` events with the message content for ad-hoc comparison in the diff viewer
- **Load session**: "Load into context" button calls `LLMService.load_session_into_context`, dispatches `session-loaded` event (with sessionId and messages), and closes the browser
- **Close**: Click backdrop, click ✕, or press Escape

### Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `session-loaded` | Outward (bubbles) | Carries loaded session messages to chat panel |
| `paste-to-prompt` | Outward (bubbles) | Carries message text to insert into chat input |