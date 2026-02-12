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

### Click → Input Accumulation

Clicking a file mention dispatches `file-mention-click`. The Files tab adds the file to selection and accumulates input text:

- Empty input: `The file helpers.js added. Do you want to see more files before you continue?`
- Existing pattern: appends filename to list
- Unrelated text: appends `(added helpers.js)`
- Removing: removes filename from accumulated text

---

## Streaming Display

### Chunk Processing

Coalesced per animation frame. Each chunk carries full accumulated content. First chunk creates card; subsequent chunks update.

### Code Block Copy Button

📋 button injected into every `<pre class="code-block">` element **unconditionally** (including during streaming). The button has `opacity: 0` by default and fades in on `<pre>` hover via CSS, so it doesn't cause visual flicker during streaming. Click handling delegated through the `.md-content` click handler. Shows "✓ Copied" for 1.5s after click.

### Edit Block Rendering

During streaming: in-progress indicator. On completion:
- File path (clickable → navigates to diff viewer with `searchText` from the edit block's old/new lines)
- Status badge: ✓ Applied (green), ✗ Failed: reason (red), ⊘ Skipped (grey)
- Two-level diff highlighting (see below)

#### Two-Level Diff Highlighting

**Stage 1: Line-level diff** — `computeDiff(oldLines, newLines)` produces `equal`, `delete`, `insert`, and `modify` operations. Adjacent delete+insert pairs that share enough common tokens are reclassified as `modify` (enabling character-level highlighting).

**Stage 2: Character-level diff** — For each `modify` pair, `computeCharDiff(oldStr, newStr)` tokenizes on word boundaries and diffs tokens via LCS, producing `equal`/`delete`/`insert` segments.

**Stage 3: Render** — Each line gets a class (`context`, `remove`, `add`). For modified lines, changed segments are wrapped in `<span class="diff-change">`:

```css
.diff-line.remove  { background: #3d1f1f; color: #ffa198; }
.diff-line.add     { background: #1f3d1f; color: #7ee787; }
.diff-line.context { background: #0d1117; color: #8b949e; }
.diff-line.remove .diff-change { background: #8b3d3d; }
.diff-line.add .diff-change    { background: #2d6b2d; }
```

### Edit Summary

Banner after all edits: counts of applied/failed/skipped, clickable modified files, failed edit details.

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