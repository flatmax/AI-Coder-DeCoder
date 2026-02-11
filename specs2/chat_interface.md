# Chat Interface

## Overview

The chat panel renders conversation messages, handles streaming display, and manages auto-scrolling. It is the primary interaction surface within the Files tab.

## Message Display

Messages render as a scrollable list of card components:
- **User cards** — user messages with optional image attachments
- **Assistant cards** — LLM responses with markdown rendering, edit blocks, and file mention detection

Cards use efficient keyed rendering for DOM reuse.

## File Mentions

Assistant messages frequently reference repository file paths in prose (e.g., "You should edit `src/utils/helpers.js` to fix this"). The system detects these paths, highlights them as clickable links, and shows a summary section with buttons to add files to context.

### Sources

File mentions are collected from **two sources** within each assistant message:

1. **Text segments** — file paths detected in prose via regex matching against known repo files
2. **Edit block headers** — the `filePath` from each edit block (files the LLM proposed changes to)

Both sources feed into the same deduplication and summary rendering. This ensures the "Files Referenced" section appears even when the assistant only produces edit blocks with no prose file mentions.

### Detection & Highlighting

On **final render only** (not during streaming), the rendered HTML of each text segment in an assistant message is scanned against the list of known repo files (from the file tree):

1. **Pre-filter** — only check files whose path appears as a substring in the raw message text (cheap check before regex)
2. **Sort candidates** by path length descending — so `src/utils/helpers.js` matches before `helpers.js`
3. **Build a single combined regex** from all candidate paths
4. **Replace matches** in the HTML with clickable spans

Edit block file paths are collected directly from the parsed segment data — no regex matching needed.

Each match becomes:
```html
<span class="file-mention" data-file="src/utils/helpers.js">src/utils/helpers.js</span>
```

If the file is already in context (selected by the user), it gets an additional class:
```html
<span class="file-mention in-context" data-file="src/utils/helpers.js">src/utils/helpers.js</span>
```

**Smart skipping** — matches are not highlighted if they appear:
- Inside a `<pre>` block (fenced code — don't highlight paths in code examples)
- Inside an HTML tag (would break markup)
- Already wrapped in a `file-mention` span (avoid double-wrapping)

Inline `<code>` elements are fine to highlight — that's how file paths are typically referenced.

### File Summary Section

After detection, a summary box is appended below the assistant message showing all referenced files as chips:

```
┌─────────────────────────────────────────────┐
│ 📁 Files Referenced            [+ Add All (2)]│
│ [✓ src/app.js] [+ src/utils/helpers.js]      │
│ [+ src/config.py]                             │
└─────────────────────────────────────────────┘
```

Each chip shows:
- **`✓` prefix + muted styling** — file is already in context
- **`+` prefix + accent styling** — file is NOT in context, clickable to add

The **"+ Add All (N)"** button appears when 2+ files are not yet in context. It adds all unselected files at once.

### Click Handling

All clicks on file mentions are delegated through the assistant card's click handler:

| Element | Action |
|---------|--------|
| Inline file mention (`.file-mention`) | Dispatch `file-mention-click` event with `{ path }` |
| File chip in summary (`.file-chip`) | Dispatch `file-mention-click` event with `{ path }` |
| "Add All" button (`.add-all-btn`) | Dispatch `file-mention-click` for each unselected file |

The `file-mention-click` event bubbles up to the Files tab, which adds the file to selection and **accumulates a prompt message in the chat input textarea**.

### Input Text Accumulation

When a file is added via mention click, the chat input text is updated to communicate the addition to the LLM:

**First file** (input is empty):
```
The file helpers.js added. Do you want to see more files before you continue?
```

**Second file** (detects existing pattern, appends):
```
The files helpers.js, config.py added. Do you want to see more files before you continue?
```

**Third file** (continues appending):
```
The files helpers.js, config.py, app.js added. Do you want to see more files before you continue?
```

The handler detects whether the input already matches the pattern `The file(s) ... added. Do you want to see more files before you continue?` and appends the new filename to the list. If the input already has unrelated text, it appends a parenthetical instead:

```
fix the bug (added helpers.js)
```

The suffix `"Do you want to see more files before you continue?"` prompts the LLM — when sent, the LLM knows files were added to context and can ask for more or proceed.

**Removing** works in reverse — clicking a chip for an already-selected file removes that filename from the accumulated text. If all files are removed, the input clears to empty.

### "Add All" Button

The "Add All" button fires individual `file-mention-click` events in a loop for each unselected file. Each event triggers the same accumulation logic, so the input builds up the full list:

```
The files helpers.js, config.py, app.js added. Do you want to see more files before you continue?
```

### Data Flow

```
LLM response rendered (final, non-streaming)
    │
    ▼
Scan HTML against known repo files
    │ returns: modified HTML with clickable spans + list of found files
    ▼
Append file summary section with chips
    │
    ▼
User clicks a file mention, chip, or "Add All"
    │
    ▼
file-mention-click event(s) dispatched (bubbles, composed)
    │
    ▼
Files tab receives event → adds file to selection → auto-expands parent dir
    │
    ▼
Chat input text accumulated: "The file(s) X, Y added. Do you want to see more files?"
    │
    ▼
File added to context; mention and chip update to show ✓
```

### Performance

- Detection runs **only on final render**, never during streaming
- Pre-filtering by substring avoids expensive regex on messages that mention no files
- The combined regex is built once per render, not per-file

---

## Streaming Display

### Chunk Processing

Rapid chunks are coalesced per animation frame:
1. Store pending chunk
2. On next frame: create assistant card (first chunk) or update content
3. Each chunk carries full accumulated content (not deltas)

### Code Block Copy Button

Fenced code blocks in assistant messages include a **copy-to-clipboard button** (📋) positioned in the top-right corner of the `<pre>` block. The button appears on hover with a subtle background, and shows brief "Copied!" feedback after clicking.

- The button is injected by the markdown renderer into each `<pre class="code-block">` element
- Click handling is delegated through the `.md-content` click handler (same pattern as file mentions)
- On click: copy the code block's text content to clipboard, briefly change the button text to "✓ Copied" for 1.5 seconds
- The button does **not** appear during streaming (to avoid flicker) — only on final rendered messages

### Edit Block Rendering

During streaming, partially-received edit blocks render with an in-progress indicator. On completion, blocks show:
- File path (clickable → navigates to diff viewer)
- Status badge: applied, failed (with reason), or skipped
- Unified diff view with two-level highlighting (line-level + character-level)

#### Edit Block Structure

Each edit block renders as a card:

```html
<div class="edit-block">
  <div class="edit-block-header">
    <span class="edit-block-file" data-file="path/to/file.js">path/to/file.js</span>
    <span class="edit-block-status applied">✓ Applied</span>
  </div>
  <div class="edit-block-content">
    <!-- diff lines here -->
  </div>
</div>
```

File path is clickable (dispatches `navigate-file` event). Status badges: `✓ Applied` (green), `✗ Failed: reason` (red), `⊘ Skipped` (grey).

#### Two-Level Diff Highlighting

The diff renderer uses a two-stage pipeline to produce fine-grained highlighting:

**Stage 1: Line-level diff**

`computeDiff(oldLines, newLines)` produces an array of operations:
- `equal` — line unchanged (context)
- `delete` — line removed
- `insert` — line added
- `modify` — line changed (detected by pairing adjacent delete/insert that are similar)

Modified-line pairing: adjacent delete+insert pairs where the lines share enough common tokens are reclassified as a single `modify` operation rather than separate delete and insert. This is the key to enabling character-level highlighting.

**Stage 2: Character-level diff within modified pairs**

For each `modify` pair, `computeCharDiff(oldStr, newStr)` tokenizes both strings and diffs at the token level:

Tokenization splits on word boundaries:
```
"foo.bar()" → ["foo", ".", "bar", "(", ")"]
```

Tokens are diffed using an LCS-based algorithm, producing segments:
```
[{ type: 'equal', text: '...' }, { type: 'delete', text: '...' }, { type: 'insert', text: '...' }]
```

**Stage 3: Render with inline highlights**

Each line renders as a `<span>` with class `context`, `remove`, or `add`. For modified lines, changed token segments are wrapped in `<span class="diff-change">`:

```html
<!-- Context line -->
<span class="diff-line context"><span class="diff-line-prefix"> </span>unchanged code here</span>

<!-- Removed line with word highlights -->
<span class="diff-line remove"><span class="diff-line-prefix">-</span>return a <span class="diff-change">+ b  # BUG</span></span>

<!-- Added line with word highlights -->
<span class="diff-line add"><span class="diff-line-prefix">+</span>return a <span class="diff-change">* b</span></span>
```

#### Diff CSS: Two-Layer Coloring

Line-level backgrounds provide the base color; character-level highlights use a brighter variant of the same hue:

```css
/* Line-level background */
.diff-line.remove  { background: #3d1f1f; color: #ffa198; }
.diff-line.add     { background: #1f3d1f; color: #7ee787; }
.diff-line.context { background: #0d1117; color: #8b949e; }

/* Character-level highlight within changed lines */
.diff-line.remove .diff-change { background: #8b3d3d; border-radius: 2px; padding: 0 2px; }
.diff-line.add .diff-change    { background: #2d6b2d; border-radius: 2px; padding: 0 2px; }
```

A removed line gets a dark red background (`#3d1f1f`), and the specific changed words within it get a brighter red (`#8b3d3d`). Added lines: dark green base (`#1f3d1f`), brighter green for changed tokens (`#2d6b2d`).

### Edit Summary

After all edits, a banner shows:
- Counts of applied/failed/skipped
- List of modified files (clickable)
- Failed edit details with errors

## Message Action Buttons

Each message card (user and assistant) shows **hoverable action toolbars** at both the **top-right and bottom-right** corners. This ensures quick access regardless of scroll position within long messages. Each toolbar has two buttons:

| Button | Icon | Action |
|--------|------|--------|
| Copy to clipboard | 📋 | Copies the message's raw text content to the clipboard. Shows brief "✓ Copied" toast feedback. |
| Copy to prompt | ↩ | Inserts the message's raw text content into the chat input textarea. Dispatches a `copy-to-prompt` event with `{ text }` detail. |

### Behavior
- Toolbars fade in on message card hover, positioned top-right and bottom-right
- Both toolbars have identical functionality
- Buttons are small, unobtrusive, with icon-only display
- Both buttons work for user and assistant messages
- For assistant messages, the raw markdown text is copied (not rendered HTML)
- The toolbars do **not** appear on the streaming message card
- The `copy-to-prompt` event bubbles up to the Files tab, which sets the chat input value
- **Rationale**: Long assistant messages can span many screens; placing toolbars at both ends avoids scrolling back to copy or paste

## Scrolling System

### Architecture

```
.messages-wrapper (clips overflow)
    .messages (scrollable container)
        <user-card> ...
        <assistant-card> ...
        #scroll-sentinel (zero-height, always last)
    .scroll-to-bottom-btn (conditional overlay)
```

### Auto-Scroll During Streaming

1. Each chunk update calls scroll-to-bottom
2. **Guard**: if user has scrolled up, skip (respect intent)
3. **Coalesce**: at most one pending scroll chain at a time
4. Wait for DOM update → request animation frame → scroll sentinel into view

### Auto-Scroll for Non-Streaming Messages

Messages added outside of streaming (e.g., commit messages, compaction summaries) follow the same scroll-respect rule: if the user is already at the bottom, scroll down to show the new message; if the user has scrolled up, leave the scroll position unchanged.

### User Scroll Detection

**Wheel up**: immediately pauses auto-scroll, shows scroll-to-bottom button

**Scroll-to-bottom detection** (IntersectionObserver on sentinel):
- Sentinel enters viewport → re-enable auto-scroll, hide button
- Sentinel leaves viewport → do nothing (only wheel-up sets the flag, preventing false positives from content expansion)

### Scroll-to-Bottom Button

Appears when user has scrolled up. Click: reset flags, immediately scroll sentinel into view.

### Content-Visibility Optimization

Off-screen messages use CSS containment (`content-visibility: auto`) with intrinsic size hints to skip layout. The **last 15 messages** are forced to render fully to ensure accurate scroll heights near the bottom.

### Scroll Position Preservation

**Tab switching**: Container stays in DOM (hidden), scroll position passively preserved. No auto-scroll on tab return.

**Minimize/maximize**:
- On minimize: save `distanceFromBottom` and `scrollRatio`
- On maximize: restore to bottom (if was near bottom) or proportional position
- Uses double-requestAnimationFrame for layout settling

**Session load**: Reset scroll state, double-rAF → scroll to bottom

## Input Area

### Text Input
- Auto-resizing textarea
- Keyboard shortcuts: Enter to send (with modifier key option), Escape to clear
- Image paste support (base64 encoding)

### Stop Button
During streaming, the **Send button transforms into a Stop button** (⏹ Stop) with a red/danger style. Clicking dispatches a `stop-streaming` event. The parent (Files tab) handles it by calling `LLM.cancel_streaming(request_id)`. The button reverts to Send when streaming ends (via `streamComplete`).

### Input History Navigation

**Up arrow** (at cursor position 0): opens a search overlay showing deduplicated user messages from the current session.

**Display order**: Most recent message at the **bottom** of the list, oldest at the top. The overlay scrolls to the bottom on open, with the most recent (bottom) item pre-selected.

**Fuzzy search**: A text input at the top of the overlay filters results. Typing filters with fuzzy matching (characters in order, not necessarily contiguous). Ranking: exact substring matches first (scored by position), then fuzzy matches. Filtered results maintain the same bottom-is-newest order.

**Keyboard in overlay**:
- **Up arrow**: move selection upward (toward older messages)
- **Down arrow**: move selection downward (toward newer messages); past the newest item restores saved input and closes
- **Enter**: select highlighted message into textarea and close
- **Escape**: close without change, restore saved input

**Saved input**: Original textarea content is saved when the overlay opens. Restored via Escape or Down arrow past the newest item.

**Click**: Clicking any item selects it into the textarea and closes the overlay.

**Reset**: History index resets when the user sends a message.

### Snippet Drawer

Toggleable drawer of quick-insert buttons loaded from config. Clicking inserts text at cursor. Closes on outside click or Escape.

### Speech to Text

A microphone button for continuous voice dictation. Toggles auto-transcribe mode — recognized utterances are appended to the textarea. See [Speech to Text](speech_to_text.md) for full details.

### Image Support

Users can paste images into the input area for multimodal LLM queries.

| Property | Detail |
|----------|--------|
| Supported formats | PNG, JPEG, GIF, WebP |
| Max size per image | 5MB (reject with visible error before encoding) |
| Max images per message | 5 |
| Encoding | Base64 data URI |
| Display (input) | Thumbnail previews with remove button, shown below textarea |
| Display (message) | Inline images in user message cards |
| Token counting | Use provider's image token formula (e.g., pixel-based). Fallback: estimate 1000 tokens per image |
| Persistence | **Not persisted** in history JSONL — `images: integer` field records count only. On session reload, image context is lost |

## Git Action Buttons

Three buttons in the header (Files tab only):

| Button | Action |
|--------|--------|
| 📋 Copy diff | Fetch staged + unstaged diffs, copy combined to clipboard |
| 💾 Commit | Stage all → generate message via LLM → commit → show commit message in chat (auto-scroll only if already at bottom) → refresh tree |
| ⚠️ Reset | Confirm dialog → hard reset to HEAD → refresh tree |

## Token HUD Overlay

Floating overlay after each response:
- Cache tier breakdown with content summaries
- Cache hit percentage badge (color-coded)
- This-request prompt/completion/cache stats
- History token budget warning
- Tier promotions/demotions
- Session cumulative totals
- Auto-hides ~8 seconds, pauses on hover