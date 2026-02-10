# Chat Interface

## Overview

The chat panel renders conversation messages, handles streaming display, and manages auto-scrolling. It is the primary interaction surface within the Files tab.

## Message Display

Messages render as a scrollable list of card components:
- **User cards** — user messages with optional image attachments
- **Assistant cards** — LLM responses with markdown rendering, edit blocks, and file mentions

Cards use efficient keyed rendering for DOM reuse.

## Streaming Display

### Chunk Processing

Rapid chunks are coalesced per animation frame:
1. Store pending chunk
2. On next frame: create assistant card (first chunk) or update content
3. Each chunk carries full accumulated content (not deltas)

### Edit Block Rendering

During streaming, partially-received edit blocks render with an in-progress indicator. On completion, blocks show:
- File path (clickable → navigates to diff viewer)
- Status badge: applied, failed (with reason), or skipped
- Unified diff view with red/green + character-level highlighting

### Edit Summary

After all edits, a banner shows:
- Counts of applied/failed/skipped
- List of modified files (clickable)
- Failed edit details with errors

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

### Input History Navigation

**Up arrow** (at cursor position 0): opens fuzzy history search overlay

**Fuzzy Search Overlay**:
- Shows 10 most recent unique user messages
- Most recent pre-selected
- Typing filters with fuzzy matching (characters in order, not contiguous)
- Ranking: exact substring first, then fuzzy matches
- Full deduplicated history is searchable

**Keyboard in overlay**:
- Up/Down: navigate selection
- Enter: select message into textarea
- Escape: close without change

**Down arrow** (after selecting from history): restores original textarea content

**Saved input**: Original content saved when overlay opens, restored via down arrow at end of text.

### Snippet Drawer

Toggleable drawer of quick-insert buttons loaded from config. Clicking inserts text at cursor. Closes on outside click or Escape.

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
| 💾 Commit | Stage all → generate message via LLM → commit → refresh tree |
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
