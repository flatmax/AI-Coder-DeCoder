# Chat Interface

## Overview

The chat panel renders conversation messages, handles streaming display, and manages auto-scrolling. It is the primary interaction surface within the Files tab.

## Message Display

Messages render as a scrollable list of cards:
- **User cards** — with optional image attachments
- **Assistant cards** — markdown rendering, edit blocks, file mentions

Cards use keyed rendering for DOM reuse.

---

## File Mentions

### Detection

On **final render only** (not streaming), assistant message HTML is scanned against known repo files:

1. Pre-filter by substring match (cheap)
2. Sort candidates by path length descending
3. Build combined regex, replace matches with clickable spans
4. Also collect file paths from edit block headers

Matches become `<span class="file-mention" data-file="path">` (with `.in-context` if already selected). Matches inside `<pre>` blocks or HTML tags are skipped.

### File Summary Section

Below each assistant message with file references:
```
📁 Files Referenced            [+ Add All (N)]
[✓ src/app.js] [+ src/utils/helpers.js]
```

Chips show ✓ (in context, muted) or + (not in context, accent). "Add All" button for 2+ unselected files.

### Click → Toggle Selection

Clicking a file mention dispatches `file-mention-click`. The Files tab **toggles** the file's selection state:

- **Not selected** → add to selection, update picker checkbox, accumulate input text
- **Already selected** → remove from selection, update picker checkbox

**Inline text mentions** (in message body): navigate to the file in the diff viewer in both cases.

**File summary chips** (in the "Files Referenced" section): only toggle selection — no navigation. The "Add All" button also only toggles without navigation.

### File Summary Chips vs Inline Mentions

**Inline text mentions** (in message body) navigate to the diff viewer on click.

**File summary chips** (in the "Files Referenced" section below messages) only toggle selection — they do not open the diff viewer. The "Add All" button also only toggles selection without navigation.
═══════ REPL is wrong, let me redo

### Input Accumulation (on add)

When a file is added via mention click:

- Empty input: `The file helpers.js added. Do you want to see more files before you continue?`
- Existing pattern: appends filename to list
- Unrelated text: appends `(added helpers.js)`

---

## Streaming Display

### Chunk Processing

Coalesced per animation frame. Each chunk carries full accumulated content. First chunk creates card; subsequent chunks update.

### Code Block Copy Button

📋 button injected into every `<pre class="code-block">` element **unconditionally** (including during streaming). The button has `opacity: 0` by default and fades in on `<pre>` hover via CSS, so it doesn't cause visual flicker during streaming. Click handling delegated through the `.md-content` click handler. Shows "✓ Copied" for 1.5s after click.

### Edit Block Rendering

During streaming: edit blocks detected mid-stream render as `edit-pending` with a pending badge and partial diff. On completion:
- File path (clickable → navigates to diff viewer with `searchText` from the edit block's old/new lines)
- Status badge: ✅ Applied (green), ❌ Failed: reason (red), ⚠️ Skipped (orange), ☑ Validated (blue), 🆕 New (green, for file creates), ⏳ Pending (grey)
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
| `_renderEditBlockHtml(seg, result)` | Renders a single edit block card: header with file path and status badge, optional error, diff lines |
| `_renderDiffLineHtml(line)` | Renders one diff line with optional character-level `<span class="diff-change">` highlights |

### Edit Summary

Banner after all edits: counts of applied/failed/skipped with color-coded stat badges (green/red/orange). Rendered by `_renderEditSummary(msg)` using Lit templates (not HTML strings).

### Dependencies

| Package | Import | Used In |
|---------|--------|---------|
| `diff` (npm) | `diffLines`, `diffWords` | `webapp/src/utils/edit-blocks.js` — line-level and word-level Myers diff |

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

During streaming: scroll-to-bottom on each update, unless user has scrolled up. Uses IntersectionObserver on a sentinel element.

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

Off-screen messages use `content-visibility: auto` with intrinsic size hints. The **last 15 messages** are forced to render fully to ensure accurate scroll heights near the bottom.

---

## Input Area

### Text Input
- Auto-resizing textarea
- Enter to send, Shift+Enter for newline
- Image paste (base64, 5MB max, 5 images max)

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

Up arrow at position 0: opens fuzzy search overlay. Most recent at bottom, oldest at top. Up/Down arrows navigate, Enter selects, Escape restores original input.

### Snippet Drawer

Toggleable quick-insert buttons from config. Click inserts at cursor.

### Speech to Text

🎤 toggle for continuous voice dictation. See [Speech to Text](speech_to_text.md).

### Images

| Property | Detail |
|----------|--------|
| Supported formats | PNG, JPEG, GIF, WebP |
| Max size per image | 5MB (reject with visible error before encoding) |
| Max images per message | 5 |
| Encoding | Base64 data URI |
| Display (input) | Thumbnail previews with remove button, below textarea |
| Display (message) | Thumbnails in user cards, clickable for lightbox overlay |
| Lightbox | Full-size view with Escape to close and focus trapping |
| Token counting | Provider's image token formula; fallback: ~1000 tokens per image |
| Persistence | See [Image Persistence](../4-features/image_persistence.md) |
| Re-send | NOT re-sent to LLM on subsequent messages — display-only after original send |

---

## Action Bar

| Side | Element | Action |
|------|---------|--------|
| Left | ✨ | New session |
| Left | 📜 | Browse history |
| Center | Search input | Case-insensitive substring search (see Chat Search below) |

### Chat Search

A compact search input between the session and git buttons with prev/next navigation. The search input fills available space (`flex: 1`, no max-width) to push git buttons to the right edge.

- Case-insensitive substring matching against message content
- Match counter shows `N/M` (current/total); ▲/▼ buttons for mouse navigation
- All messages remain visible — matches are highlighted and scrolled into view
- Current match scrolled to center with accent highlight
- Enter for next match, Shift+Enter for previous, Escape clears and blurs

#### Highlight Implementation

Message cards have `border: 1px solid transparent` by default with a CSS transition on `border-color` and `box-shadow`. The `.search-highlight` class (applied via `data-msg-index` attribute matching) sets:
- `border-color: var(--accent-primary)`
- `box-shadow: 0 0 0 1px var(--accent-primary), 0 0 12px rgba(79, 195, 247, 0.15)`

Files-tab reaches into chat-panel's shadow DOM to add/remove the class on `.message-card[data-msg-index="N"]` elements. Previous highlights are cleared before each new match navigation.

| Right | 📋 | Copy diff to clipboard |
| Right | 💾 | Stage all → generate message → commit |
| Right | ⚠️ | Reset to HEAD (with confirmation) |

---

## History Browser

Modal overlay for browsing past conversations:
- Left panel: session list or search results
- Right panel: messages for selected session
- Search: debounced (300ms) full-text
- Actions: copy message, paste to prompt, load session
- State preserved on close/reopen