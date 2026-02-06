# Plan: Message List Scrolling Behavior

## Status: PENDING

## Overview

Replace unreliable `scrollTop = scrollHeight` scrolling with a sentinel-based approach that works correctly with `content-visibility: auto`.

## Critical Context: `content-visibility: auto`

The CSS property `content-visibility: auto` is applied to `.messages` and individual message cards in `PromptViewStyles.js` to fix textarea lag with long message histories (222+ messages). This optimization tells the browser to skip rendering off-screen messages, which dramatically improves input responsiveness.

**However, this breaks scrolling in several ways:**

1. **`scrollHeight` is inaccurate** — based on estimated `contain-intrinsic-size` values, not actual content
2. **Distance-from-bottom checks fail** — the 50px threshold in `handleWheel()` may misfire
3. **Scroll-to-bottom may not reach true bottom** — content renders after scroll, revealing more below
4. **Programmatic scrolling is unreliable** — `container.scrollTop = container.scrollHeight` may not reach the end

**We must keep `content-visibility: auto` in place** for performance.

## Solution: Sentinel + `scrollIntoView` + `IntersectionObserver`

### Key idea

Add an invisible sentinel `<div>` as the last child of `.messages`. Use `scrollIntoView()` to scroll to it (forces browser to render the target, bypassing `content-visibility` estimation). Use `IntersectionObserver` on the sentinel to accurately detect "at bottom" state, replacing the fragile 50px `scrollHeight` threshold.

### Why this works

- `scrollIntoView()` forces the browser to render the target element even under `content-visibility: auto`, then scrolls to it. No dependency on `scrollHeight` accuracy.
- `IntersectionObserver` fires when the sentinel enters/leaves the viewport, providing reliable "at bottom" detection regardless of estimated sizes.
- Eliminates all `scrollHeight`-dependent math.

## Requirements

### R1: Auto-scroll on new messages
- `addMessage()` and `streamWrite()` scroll to bottom via sentinel
- **Exception**: do not auto-scroll if user has manually scrolled up (R2)

### R2: Pause auto-scroll when user scrolls up
- `handleWheel()` detects upward scroll (`deltaY < 0`)
- Sets `_userHasScrolledUp = true`, shows scroll button
- All auto-scroll suppressed until user returns to bottom

### R3: Resume auto-scroll when user reaches bottom
- `IntersectionObserver` on sentinel detects when bottom is visible
- Resets `_userHasScrolledUp = false`, hides scroll button
- Replaces the old `handleWheel` downward-scroll + 50px threshold check

### R4: Manual scroll-to-bottom button
- Clicking calls `scrollToBottomNow()` which uses `sentinel.scrollIntoView()`
- Resets state, hides button

### R5: Reset scroll state on history clear
- `clearHistory()` resets `_userHasScrolledUp`, `_showScrollButton`

### R6: Scroll to bottom on initial load
- After `loadLastSession()` loads messages, scroll to sentinel
- After `handleLoadSession()` loads session, scroll to sentinel

### R7: Preserve scroll position during tab switches
- Save `scrollTop` + `_wasScrolledUp` when leaving chat tab
- Restore position or scroll to sentinel when returning

## Implementation Plan

### Phase 1: Add sentinel element to template

**File: `webapp/src/prompt/PromptViewTemplate.js`**

1. Add `<div id="scroll-sentinel"></div>` as last child inside `.messages` container (after the `repeat()` block)
2. Style it invisible: zero height, no margin

**File: `webapp/src/prompt/PromptViewStyles.js`**

1. Add style for `#scroll-sentinel`: `height: 0; margin: 0; padding: 0;`

### Phase 2: Replace scroll logic in MessageHandler

**File: `webapp/src/MessageHandler.js`**

1. **`_scrollToBottom()`** — replace `container.scrollTop = container.scrollHeight` with:
   ```js
   const sentinel = this.shadowRoot?.querySelector('#scroll-sentinel');
   if (sentinel) sentinel.scrollIntoView({ block: 'end' });
   ```

2. **`scrollToBottomNow()`** — same replacement

3. **`handleWheel()`** — simplify:
   - Keep the upward scroll detection (`deltaY < 0` → set `_userHasScrolledUp = true`)
   - **Remove** the downward scroll + 50px threshold check entirely (IntersectionObserver handles this)

4. **`setupScrollObserver()`** — replace `ResizeObserver` with `IntersectionObserver`:
   ```js
   const sentinel = this.shadowRoot?.querySelector('#scroll-sentinel');
   this._intersectionObserver = new IntersectionObserver(([entry]) => {
     if (entry.isIntersecting) {
       this._userHasScrolledUp = false;
       this._showScrollButton = false;
     }
   }, { root: container });
   this._intersectionObserver.observe(sentinel);
   ```

   **Important**: The `IntersectionObserver` only handles the *resume* direction — when the sentinel becomes visible, it resets scroll state. It must **never** set `_userHasScrolledUp = true` when the sentinel leaves the viewport. Only `handleWheel()` sets that flag (explicit user intent). This prevents false positives when content above expands (e.g., image loads, code block renders) and briefly pushes the sentinel out of view.

5. **`disconnectScrollObserver()`** — disconnect `IntersectionObserver` instead of `ResizeObserver`

### Phase 3: Fix initial load and session load scroll

**File: `webapp/src/PromptView.js`**

1. **`loadLastSession()`** — after loading messages, use `updateComplete` + double `rAF` + sentinel scroll. The double `requestAnimationFrame` is needed because `content-visibility: auto` may require an extra frame to finalize layout before `scrollIntoView` can target the sentinel accurately:
   ```js
   await this.updateComplete;
   requestAnimationFrame(() => {
     requestAnimationFrame(() => this.scrollToBottomNow());
   });
   ```

2. **`handleLoadSession()`** — already calls `scrollToBottomNow()` after `updateComplete` + `rAF`. Update to use double `rAF` for consistency:
   ```js
   await this.updateComplete;
   requestAnimationFrame(() => {
     requestAnimationFrame(() => this.scrollToBottomNow());
   });
   ```

3. **`switchTab()`** — when returning to FILES tab:
   - If `_wasScrolledUp`: restore `scrollTop` position
   - If not: call `scrollToBottomNow()` (uses sentinel)
   - Reconnect `IntersectionObserver` after restoring scroll

### Phase 4: Testing checklist

- [ ] App startup: messages load, view scrolls to bottom
- [ ] New message: view scrolls to bottom
- [ ] Streaming: view follows stream
- [ ] Scroll up: auto-scroll pauses, button appears
- [ ] Scroll to bottom manually: button hides, auto-scroll resumes
- [ ] Click scroll button: jumps to bottom, resumes auto-scroll
- [ ] Clear history: scroll state resets
- [ ] Load session from history browser: scrolls to bottom
- [ ] Switch tabs and back: position preserved or scrolled to bottom
- [ ] 200+ messages: no performance regression from sentinel
- [ ] content-visibility still working (check devtools rendering stats)

## Files to Modify

1. `webapp/src/prompt/PromptViewTemplate.js` — add sentinel element
2. `webapp/src/prompt/PromptViewStyles.js` — sentinel style
3. `webapp/src/MessageHandler.js` — replace scroll logic
4. `webapp/src/PromptView.js` — fix initial load scroll, tab switch reconnection

## Execution Order

1 → 2 → 3 → 4 (phases are sequential, each builds on previous)

## Estimated Effort

- Phase 1: 5 minutes
- Phase 2: 20 minutes
- Phase 3: 15 minutes
- Phase 4: 30 minutes testing

Total: ~1 hour
