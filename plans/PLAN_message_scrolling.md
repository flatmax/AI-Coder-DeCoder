# Plan: Message List Scrolling Behavior

## Overview

Fix and verify scrolling behavior in the chat message list to ensure a consistent, predictable UX.

## Critical Context: `content-visibility: auto`

The CSS property `content-visibility: auto` was recently added to `.messages` and individual message cards in `PromptViewStyles.js` to fix textarea lag with long message histories (222+ messages). This optimization tells the browser to skip rendering off-screen messages, which dramatically improves input responsiveness.

**However, this breaks scrolling in several ways:**

1. **`scrollHeight` is inaccurate** - Based on estimated `contain-intrinsic-size` values, not actual content
2. **Distance-from-bottom checks fail** - The 50px threshold in `handleWheel()` may misfire
3. **Scroll-to-bottom may not reach true bottom** - Content renders after scroll, revealing more below
4. **Programmatic scrolling is unreliable** - `container.scrollTop = container.scrollHeight` may not reach the end

**We must keep `content-visibility: auto` in place** for performance, so the scrolling logic needs to be updated to work correctly with estimated scroll heights.

### Potential Solutions

1. **Multiple scroll attempts** - Scroll, wait for render, scroll again
2. **Use `scrollIntoView()` on last message** - More reliable than `scrollTop = scrollHeight`
3. **Observe content changes** - Use ResizeObserver or MutationObserver to re-scroll after content renders
4. **Adjust threshold calculations** - Account for estimation inaccuracy in bottom detection

## Requirements

### R1: Auto-scroll on new messages
- When `addMessage()` is called, scroll to bottom automatically
- When `streamWrite()` streams content, scroll to bottom on each chunk
- **Exception**: Do not auto-scroll if user has manually scrolled up (R2)

### R2: Pause auto-scroll when user scrolls up
- Detect upward mouse wheel scroll (`deltaY < 0`)
- Set `_userHasScrolledUp = true`
- Show floating "scroll to bottom" button (`_showScrollButton = true`)
- Prevent all auto-scroll until user returns to bottom

### R3: Resume auto-scroll when user scrolls to bottom
- Detect downward scroll (`deltaY > 0`)
- Check if within threshold (50px) of bottom
- If at bottom: reset `_userHasScrolledUp = false`, hide button
- Resume auto-scrolling behavior

### R4: Manual scroll-to-bottom button
- Floating button appears when user has scrolled up
- Clicking calls `scrollToBottomNow()`
- Forces immediate scroll to bottom
- Resets `_userHasScrolledUp = false`, hides button

### R5: Reset scroll state on history clear
- `clearHistory()` resets all scroll state
- `_userHasScrolledUp = false`
- `_showScrollButton = false`

### R6: Scroll to bottom on initial load (BUG - NOT IMPLEMENTED)
- When app starts and `loadLastSession()` loads previous messages
- Should scroll to bottom after all messages are rendered
- Currently stays at top - user must manually scroll

### R7: Preserve scroll position during tab switches
- When switching away from chat tab, save scroll position
- When switching back, restore position if user was scrolled up
- If user was at bottom, scroll to bottom (may have new content)

## Current Implementation

**Location**: `webapp/src/MessageHandler.js`

| Method | Purpose | Status |
|--------|---------|--------|
| `_scrollToBottom()` | Auto-scroll respecting user preference | ✅ Works |
| `scrollToBottomNow()` | Force scroll, reset state | ✅ Works |
| `handleWheel()` | Detect user scroll, toggle state | ✅ Works |
| `addMessage()` | Add message, trigger scroll | ✅ Works |
| `streamWrite()` | Stream chunk, trigger scroll | ✅ Works |
| `clearHistory()` | Reset state | ✅ Works |

**Location**: `webapp/src/PromptView.js`

| Method | Purpose | Status |
|--------|---------|--------|
| `loadLastSession()` | Load messages on startup | ❌ Missing scroll |
| `handleLoadSession()` | Load session from history browser | ❌ Missing scroll |
| `switchTab()` | Tab switching with scroll preserve | ⚠️ Partial |

## Implementation Plan

### Phase 1: Fix initial load scroll (R6)

1. In `PromptView.js`, after `loadLastSession()` completes:
   - Wait for `updateComplete`
   - Call `scrollToBottomNow()` to scroll to end

2. In `PromptView.js`, after `handleLoadSession()` completes:
   - Same fix - scroll to bottom after loading session

### Phase 2: Verify tab switch behavior (R7)

1. Review `switchTab()` in `PromptView.js`
2. Ensure `_wasScrolledUp` logic correctly handles:
   - Saving position when leaving chat
   - Restoring position OR scrolling to bottom when returning

### Phase 3: Testing checklist

- [ ] App startup: messages load, view scrolls to bottom
- [ ] New message: view scrolls to bottom
- [ ] Streaming: view follows stream
- [ ] Scroll up: auto-scroll pauses, button appears
- [ ] Scroll to bottom manually: button hides, auto-scroll resumes
- [ ] Click scroll button: jumps to bottom, resumes auto-scroll
- [ ] Clear history: scroll state resets
- [ ] Load session from history browser: scrolls to bottom
- [ ] Switch tabs and back: position preserved or scrolled to bottom

## Files to Modify

1. `webapp/src/PromptView.js` - Add scroll calls after session load
2. `webapp/src/MessageHandler.js` - No changes expected (logic is correct)

## Estimated Effort

- Phase 1: 15 minutes
- Phase 2: 15 minutes  
- Phase 3: 30 minutes testing

Total: ~1 hour
