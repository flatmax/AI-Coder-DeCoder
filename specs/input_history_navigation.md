# Input History Navigation & Fuzzy Search

## Overview

The textarea input supports navigating previous user messages via Up/Down arrow keys and a fuzzy search overlay.

## Up Arrow Behaviour

1. **Cursor must be at position 0** (start of textarea) — otherwise, normal cursor movement applies.
2. Opens the **fuzzy history search overlay** above the input area.
3. The overlay:
   - Shows the 10 most recent unique user messages.
   - The **most recent message is pre-selected** (highlighted at the bottom of the list, which is displayed in reverse chronological order).
   - The search input starts **empty** — no text is pre-filled.
   - The results list scrolls to show the selected item at the bottom.

## Fuzzy Search Overlay

### Search Input
- Typing filters the history list using fuzzy matching (characters must appear in order, not necessarily contiguous).
- Results are ranked: exact substring matches first (by position), then fuzzy matches.
- Up to 10 results are displayed at a time. The full deduplicated history is searchable — typing a query can surface older messages beyond the initial 10 shown when the overlay first opens.

### Keyboard Navigation (within overlay)
- **Up Arrow**: Move selection to the next older message (increment index).
- **Down Arrow**: Move selection to the next newer message (decrement index).
- **Enter**: Select the highlighted message — places it in the textarea and closes the overlay.
- **Escape**: Close the overlay without changing the textarea; refocus textarea.
- **Click outside / focus loss**: Close the overlay without changing the textarea (same as Escape).

### Selection scrolls into view
- When navigating with arrows, the selected item scrolls into view automatically.

## Down Arrow Behaviour (in textarea, after selecting from history)

When a message has been selected from fuzzy search, the original textarea content is saved. Down arrow then provides a way to restore it:

1. **Cursor on last line but not at end**: Move cursor to end of line.
2. **Cursor already at end of text**: Restore the original textarea content from before the history search was opened. Clear the saved state.
3. **Otherwise**: Normal cursor movement.

## Saved Input

- When the fuzzy search overlay opens, the current textarea content is saved (`_savedInputBeforeHistory`).
- Selecting a history item replaces the textarea content but the saved original remains.
- Down arrow at end-of-text restores the saved original and clears the saved state.
- This allows the user to browse history and return to what they were typing.

## Deduplication

- History entries are deduplicated: if the same message was sent multiple times, it appears only once (most recent occurrence).
- Messages are ordered most-recent-first.
