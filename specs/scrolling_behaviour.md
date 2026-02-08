# PromptView Scrolling Behaviour

## Overview

The chat message container (`.messages` / `#messages-container`) uses a multi-layered scrolling system that balances auto-scrolling during streaming with user scroll freedom. The system combines an IntersectionObserver on a sentinel element, explicit scroll-position save/restore, content-visibility optimizations, and coalesced rAF-based scroll scheduling.

---

## DOM Structure

```
.messages-wrapper          (flex:1, position:relative, overflow:hidden)
  .messages                (#messages-container, overflow-y:auto, flex column)
    <user-card> ...        (content-visibility: auto)
    <assistant-card> ...   (content-visibility: auto)
    #scroll-sentinel       (height:0, flex-shrink:0 — always last child)
  .scroll-to-bottom-btn    (absolute, bottom:12px, right:20px — conditional)
```

- `.messages-wrapper` clips overflow and provides the positioning context for the scroll-to-bottom button.
- `.messages` is the actual scrollable container.
- `#scroll-sentinel` is a zero-height div at the bottom of the messages list, used as the scroll anchor and IntersectionObserver target.

---

## State Variables (MessageHandler)

| Variable | Type | Purpose |
|---|---|---|
| `_userHasScrolledUp` | Boolean | Set `true` by wheel-up; suppresses auto-scroll |
| `_showScrollButton` | Boolean | Controls visibility of the "↓" scroll-to-bottom button |
| `_scrollPending` | Boolean | Coalesces multiple `_scrollToBottom()` calls per frame |

---

## Auto-Scroll During Streaming

### Trigger Chain

1. Server sends chunk → `streamChunk()` (StreamingMixin)
2. → `streamWrite()` (MessageHandler) — coalesces via `requestAnimationFrame`, stores only the latest chunk
3. → `_processStreamChunk()` — mutates or appends message, calls `_scrollToBottom()`
4. → `_scrollToBottom()` — guards:
   - If `_userHasScrolledUp` is `true`, **does nothing** (respects user intent).
   - If `_scrollPending` is `true`, **does nothing** (coalesces).
   - Otherwise sets `_scrollPending = true`, waits for `this.updateComplete` (Lit DOM commit), then in a `requestAnimationFrame`:
     - Resets `_scrollPending`.
     - Re-checks `_userHasScrolledUp` (may have changed).
     - Calls `sentinel.scrollIntoView({ block: 'end' })`.

### Coalescing

Two levels of coalescing prevent scroll thrashing:

1. **streamWrite** coalesces chunks: only the most recent chunk matters (full accumulated content), scheduled via a single `requestAnimationFrame`.
2. **_scrollToBottom** coalesces scroll requests: at most one pending `updateComplete → rAF → scrollIntoView` chain at a time.

---

## User Scroll Detection

### Wheel Handler

```
@wheel=${(e) => component.handleWheel(e)}
```

Attached to the `.messages` container in the template.

- **Wheel up** (`deltaY < 0`): Sets `_userHasScrolledUp = true` and `_showScrollButton = true`. This immediately pauses auto-scroll and shows the scroll-to-bottom button.
- **Wheel down**: Does nothing. Re-engagement with auto-scroll is handled exclusively by the IntersectionObserver (see below).

### IntersectionObserver (Scroll Sentinel)

Set up in `setupScrollObserver()`, called:
- Once on `connectedCallback` (deferred via `updateComplete`)
- On tab switch back to `TABS.FILES`

Configuration:
- **root**: `#messages-container` (the scrollable element)
- **target**: `#scroll-sentinel`
- **threshold**: default (0)

Behaviour:
- **Sentinel enters viewport** (user scrolled to bottom, or content shrunk): Resets `_userHasScrolledUp = false` and `_showScrollButton = false`. Auto-scroll resumes.
- **Sentinel leaves viewport**: Does **nothing**. This is deliberate — only `handleWheel()` sets `_userHasScrolledUp = true`. This prevents false positives when content above the viewport expands (e.g., a code block renders) and pushes the sentinel out of view without any user scroll action.

### Scroll-to-Bottom Button

Rendered conditionally when `_showScrollButton` is `true`:

```html
<button class="scroll-to-bottom-btn" @click=${() => component.scrollToBottomNow()}>↓</button>
```

`scrollToBottomNow()`:
- Resets `_userHasScrolledUp = false`, `_showScrollButton = false`, `_scrollPending = false`.
- Calls `sentinel.scrollIntoView({ block: 'end' })` — immediate, no waiting.

---

## Content-Visibility Optimization

The `.messages` container and its children use CSS containment to avoid laying out off-screen messages:

```css
.messages {
  contain: strict;
  content-visibility: auto;
  contain-intrinsic-size: auto 500px;
}

.messages user-card,
.messages assistant-card {
  contain: content;
  content-visibility: auto;
  contain-intrinsic-size: auto 100px;
}
```

### Last-15-Messages Override

To ensure accurate scroll heights near the bottom (critical for auto-scroll precision), the last 15 messages are forced to render fully:

```css
.messages user-card:nth-last-child(-n+15),
.messages assistant-card:nth-last-child(-n+15) {
  content-visibility: visible;
  contain-intrinsic-size: unset;
}
```

This avoids the problem where `content-visibility: auto` gives estimated sizes for recently-added messages, causing `scrollIntoView` to land at the wrong position.

### Double-rAF Pattern

Because `content-visibility: auto` can delay layout computation, several scroll operations use a double `requestAnimationFrame` to ensure layout is settled:

```js
requestAnimationFrame(() => {
  requestAnimationFrame(() => this.scrollToBottomNow());
});
```

This pattern appears in:
- `handleLoadSession()` — after loading a full session
- `loadLastSession()` — after loading the last session on startup
- `toggleMinimize()` — after restoring from minimized state

---

## Scroll Position Save/Restore (Minimize/Maximize)

Handled in `InputHandlerMixin.toggleMinimize()`.

### On Minimize

1. Reads `container.scrollTop`, `scrollHeight`, `clientHeight`.
2. Computes `distanceFromBottom = scrollHeight - scrollTop - clientHeight`.
3. Saves:
   - `_savedWasAtBottom = distanceFromBottom < 50` (within 50px of bottom).
   - `_savedScrollRatio = scrollTop / maxScroll` (proportional position, 0–1).

### On Maximize

1. Waits for `updateComplete` → double rAF (for content-visibility layout).
2. If `_savedWasAtBottom`: scrolls to `container.scrollHeight` (bottom).
3. Otherwise: restores `container.scrollTop = maxScroll * _savedScrollRatio`.

Initial values: `_savedScrollRatio = 1`, `_savedWasAtBottom = true` (assumes bottom on first render).

---

## Session Load Scrolling

Both `handleLoadSession()` and `loadLastSession()` follow the same pattern:

1. Clear history / add messages in a loop.
2. Reset `_userHasScrolledUp = false`, `_showScrollButton = false`.
3. Await `updateComplete`.
4. Double-rAF → `scrollToBottomNow()`.

This ensures the user sees the most recent message after loading a previous session.

---

## History Clear Scrolling

`clearHistory()` in MessageHandler:
- Sets `messageHistory = []`.
- Resets `_userHasScrolledUp = false`, `_showScrollButton = false`.
- Calls `requestUpdate()`.

No explicit scroll needed since the container becomes empty.

---

## Tab Switching

When the user switches between tabs (Files/Chat, Search, Context, Cache, Settings), the chat panel is **not destroyed** — it is hidden via CSS:

```css
.tab-hidden {
  visibility: hidden !important;
  position: absolute !important;
  pointer-events: none !important;
}
```

### Scroll Position Preservation

- The `.messages` container remains in the DOM across tab switches, so `scrollTop` is **passively preserved** by the browser. No explicit save/restore logic runs (unlike minimize/maximize).
- The `_userHasScrolledUp` and `_showScrollButton` flags are also preserved — if the user had scrolled up before switching tabs, auto-scroll remains paused when they return.

### IntersectionObserver Re-establishment

- When switching **away** from the FILES tab, the IntersectionObserver is **not disconnected**. However, because the container becomes `visibility: hidden` and `position: absolute`, the observer may stop firing reliably.
- When switching **back** to `TABS.FILES`, `setupScrollObserver()` is called (deferred via `updateComplete`). This is idempotent — if the existing observer is still connected, the call returns early without creating a duplicate.
- No scroll action is taken on tab return. The user sees the same scroll position they left.

### No Auto-Scroll on Tab Return

Unlike session load or minimize restore, switching back to the chat tab does **not** scroll to the bottom. The rationale: the user may have been reading earlier messages and switching tabs should not disrupt their position.

---

## Observer Lifecycle

| Event | Action |
|---|---|
| `connectedCallback` | `setupScrollObserver()` deferred via `updateComplete` |
| `switchTab(FILES)` | `setupScrollObserver()` deferred via `updateComplete` |
| `disconnectedCallback` | `disconnectScrollObserver()` |

`setupScrollObserver()` is idempotent — it guards against creating a second observer if one already exists (`if (this._intersectionObserver) return`).

`disconnectScrollObserver()` calls `_intersectionObserver.disconnect()` and nulls the reference.

---

## Summary of Scroll Entry Points

| Method | Location | When Called |
|---|---|---|
| `_scrollToBottom()` | MessageHandler | After `addMessage()`, after `_processStreamChunk()` |
| `scrollToBottomNow()` | MessageHandler | Scroll button click, session load, minimize restore |
| `handleWheel()` | MessageHandler | User wheel event on `.messages` |
| `setupScrollObserver()` | MessageHandler | Connect, tab switch to FILES |
| `disconnectScrollObserver()` | MessageHandler | Disconnect |
| `toggleMinimize()` | InputHandlerMixin | Header click (save/restore) |
