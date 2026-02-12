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

📋 button on `<pre>` blocks (hover to reveal). Shows "✓ Copied" for 1.5s. Only on final renders, not during streaming.

### Edit Block Rendering

During streaming: in-progress indicator. On completion:
- File path (clickable → navigates to diff viewer with `searchText`)
- Status badge: ✓ Applied (green), ✗ Failed: reason (red), ⊘ Skipped (grey)
- Two-level diff: line-level background + character-level highlights within modified pairs

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

Tab switch: passive (container stays in DOM). Minimize/maximize: save/restore distance from bottom. Session load: scroll to bottom.

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

Paste support with thumbnail previews and remove buttons. Thumbnails in sent messages clickable for lightbox. Not re-sent on subsequent messages.

---

## Action Bar

| Side | Element | Action |
|------|---------|--------|
| Left | ✨ | New session |
| Left | 📜 | Browse history |
| Center | Search input | Case-insensitive search across messages (Enter/Shift+Enter for next/prev) |
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