// Search controllers for the ChatPanel.
//
// Two modes share one input box and one navigation
// pair (Enter/Shift+Enter or ↑/↓):
//
//   - 'message' — searches the current tab's
//     messages via the pure `findMessageMatches`
//     helper. Matches are computed on every render
//     (cheap — messages are small and the regex
//     compiles once) and the current-match index
//     drives a CSS highlight on the matching card.
//
//   - 'file' — searches repository file content via
//     the `Repo.search_files` RPC. Debounced (300
//     ms) so rapid typing doesn't thrash the
//     server. Stale responses are discarded via a
//     generation counter — the user may have typed
//     more between the RPC issue and its response,
//     and an earlier response arriving after a
//     later one would roll back the visible
//     state.
//
// Mode switching dispatches `file-search-changed`
// so the files-tab orchestrator can swap the
// picker tree to match (showing only files with
// hits during file-search). Reciprocal scrolling
// between the picker and the overlay is mediated
// by `_fileSearchScrollPaused` to break feedback
// loops.
//
// Public entry point: `activateFileSearch(panel,
// prefill)` — called from app-shell's Ctrl+Shift+F
// handler. Switches to file mode, optionally
// prefills the query, focuses the search input,
// kicks off a debounced search.

import { findMessageMatches } from '../message-search.js';
import {
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
  _saveSearchToggle,
} from './helpers.js';

// ---------------------------------------------------------------
// Message-search match computation
// ---------------------------------------------------------------

/**
 * Compute current message-search matches.
 *
 * Delegates to the pure `findMessageMatches`
 * helper with the current toggle state. Called
 * from render and from navigation handlers.
 *
 * Returns an array of message indices, stable
 * between re-renders for the same query +
 * messages + toggle state.
 */
export function computeSearchMatches(panel) {
  return findMessageMatches(panel.messages, panel._searchQuery, {
    ignoreCase: panel._searchIgnoreCase,
    regex: panel._searchRegex,
    wholeWord: panel._searchWholeWord,
  });
}

// ---------------------------------------------------------------
// Search input + toggles
// ---------------------------------------------------------------

/**
 * Handle typing in the search input. Updates the
 * query state; match computation happens in render
 * (message mode) or via a debounced RPC (file
 * mode).
 *
 * Message mode — resets the current-match cursor
 * to 0 and scrolls the first match into view on
 * each keystroke (immediate visual confirmation).
 *
 * File mode — schedules a debounced RPC call via
 * `runFileSearch`. The RPC only fires after the
 * user stops typing for a short interval; stale
 * responses are discarded via a generation
 * counter.
 */
export function onSearchInput(panel, event) {
  panel._searchQuery = event.target.value;
  if (panel._searchMode === 'file') {
    panel._fileSearchFocusedIndex = -1;
    scheduleFileSearch(panel);
    return;
  }
  panel._searchCurrentIndex = 0;
  // Defer the scroll until Lit has rendered — the
  // new match might be a message that wasn't
  // previously highlighted, and the DOM needs to
  // reflect the class change before scrollIntoView
  // can target the right element.
  panel.updateComplete.then(() => {
    scrollToCurrentMatch(panel);
  });
}

/**
 * Toggle one of the three search options. Persists
 * the new value to localStorage so it survives
 * page reloads. ``which`` is a static string so
 * the switch is cheap and the method signature
 * stays narrow.
 */
export function toggleSearchOption(panel, which) {
  switch (which) {
    case 'ignoreCase':
      panel._searchIgnoreCase = !panel._searchIgnoreCase;
      _saveSearchToggle(
        _SEARCH_IGNORE_CASE_KEY,
        panel._searchIgnoreCase,
      );
      break;
    case 'regex':
      panel._searchRegex = !panel._searchRegex;
      _saveSearchToggle(_SEARCH_REGEX_KEY, panel._searchRegex);
      break;
    case 'wholeWord':
      panel._searchWholeWord = !panel._searchWholeWord;
      _saveSearchToggle(
        _SEARCH_WHOLE_WORD_KEY,
        panel._searchWholeWord,
      );
      break;
    default:
      return;
  }
  if (panel._searchMode === 'file') {
    panel._fileSearchFocusedIndex = -1;
    scheduleFileSearch(panel);
    return;
  }
  // Toggle change alters which messages match —
  // reset the cursor and re-scroll so the user
  // sees the first match under the new settings.
  panel._searchCurrentIndex = 0;
  panel.updateComplete.then(() => {
    scrollToCurrentMatch(panel);
  });
}

// ---------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------

/**
 * Handle keydown in the search input. In message
 * mode, Enter/Shift+Enter navigate message
 * matches; Escape clears and blurs. In file mode,
 * Enter opens the focused match in the viewer; ↑/↓
 * navigate matches; Escape clears, then on second
 * press exits file mode.
 */
export function onSearchKeyDown(panel, event) {
  if (panel._searchMode === 'file') {
    onFileSearchKeyDown(panel, event);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      onSearchPrev(panel);
    } else {
      onSearchNext(panel);
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    panel._searchQuery = '';
    panel._searchCurrentIndex = -1;
    // Blur so the user's next keystroke goes to
    // the main textarea.
    event.target.blur();
    return;
  }
}

/**
 * Keyboard handling specific to file-search mode.
 *
 * - Enter → open the focused match in the diff
 *   viewer (via a `navigate-file` window event)
 *   and keep the overlay open so the user can
 *   continue scanning
 * - Shift+Enter → previous match
 * - ↑/↓ → navigate matches
 * - Escape → clear query; on second press (empty
 *   query), exit file search mode
 */
export function onFileSearchKeyDown(panel, event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.shiftKey) {
      onFileSearchPrev(panel);
    } else {
      onFileSearchOpenFocused(panel);
    }
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    onFileSearchNext(panel);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    onFileSearchPrev(panel);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    if (panel._searchQuery) {
      // First press — clear the query, results
      // will clear on the next debounce tick.
      panel._searchQuery = '';
      panel._fileSearchResults = [];
      panel._fileSearchFocusedIndex = -1;
      panel._fileSearchLoading = false;
      return;
    }
    // Second press — exit file mode.
    setSearchMode(panel, 'message');
    event.target.blur();
    return;
  }
}

// ---------------------------------------------------------------
// Message-search navigation
// ---------------------------------------------------------------

export function onSearchNext(panel) {
  const matches = computeSearchMatches(panel);
  if (matches.length === 0) return;
  // Wrap around at end.
  panel._searchCurrentIndex =
    (Math.max(0, panel._searchCurrentIndex) + 1) %
    matches.length;
  panel.updateComplete.then(() => {
    scrollToCurrentMatch(panel);
  });
}

export function onSearchPrev(panel) {
  const matches = computeSearchMatches(panel);
  if (matches.length === 0) return;
  // Wrap around at start — `(-1 + total) % total`
  // handles the wrap without a conditional.
  const base = Math.max(0, panel._searchCurrentIndex);
  panel._searchCurrentIndex =
    (base - 1 + matches.length) % matches.length;
  panel.updateComplete.then(() => {
    scrollToCurrentMatch(panel);
  });
}

/**
 * Scroll the currently-highlighted match into
 * view.
 *
 * Noop when there's no current match or the
 * message card is missing (streaming card isn't
 * indexed, shouldn't be the current match anyway).
 *
 * The `scrollIntoView` availability check is
 * defensive — jsdom doesn't implement it on
 * Element, so tests that don't stub it would
 * produce unhandled promise rejections from the
 * `updateComplete.then` callers. Older browser
 * contexts could similarly lack it.
 */
export function scrollToCurrentMatch(panel) {
  const matches = computeSearchMatches(panel);
  if (matches.length === 0) return;
  const idx = Math.max(0, panel._searchCurrentIndex);
  if (idx >= matches.length) return;
  const msgIndex = matches[idx];
  const card = panel.shadowRoot?.querySelector(
    `.message-card[data-msg-index="${msgIndex}"]`,
  );
  if (!card) return;
  if (typeof card.scrollIntoView !== 'function') return;
  card.scrollIntoView({
    block: 'center',
    behavior: 'smooth',
  });
}

// ---------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------

/**
 * Switch search mode. Resets state specific to the
 * mode being LEFT (message highlights cleared on
 * exit; file results cleared on exit). Dispatches
 * `file-search-changed` so the files-tab
 * orchestrator can swap the picker tree
 * accordingly.
 *
 * Safe to call with the current mode — becomes a
 * no-op (no state change, no event dispatch).
 */
export function setSearchMode(panel, mode) {
  if (mode !== 'message' && mode !== 'file') return;
  if (mode === panel._searchMode) return;
  panel._searchMode = mode;
  // Leaving message mode — clear highlight cursor
  // so the settled cards don't show stale borders
  // when the user re-enters later.
  panel._searchCurrentIndex = -1;
  // Leaving file mode — clear results and cancel
  // any pending RPC. Entering file mode — results
  // start empty until the first RPC returns.
  panel._fileSearchResults = [];
  panel._fileSearchFocusedIndex = -1;
  panel._fileSearchLoading = false;
  if (panel._fileSearchDebounceTimer != null) {
    clearTimeout(panel._fileSearchDebounceTimer);
    panel._fileSearchDebounceTimer = null;
  }
  // Clear the query on mode switch — otherwise a
  // message-search query would suddenly become a
  // file-search query (or vice versa) with
  // surprising results. Explicit clear keeps the
  // mental model clean.
  panel._searchQuery = '';
  // Notify the files-tab. Emits on EVERY mode
  // change so entry triggers a tree swap and exit
  // triggers a restore. Carries the current
  // results (empty) so the files-tab doesn't need
  // to guess.
  dispatchFileSearchChanged(panel);
  // Kick off a debounced search if we just
  // entered file mode with a pre-filled query
  // (from activateFileSearch). Normal mode entry
  // has empty query so this is a no-op.
  if (mode === 'file' && panel._searchQuery) {
    scheduleFileSearch(panel);
  }
}

/**
 * Toggle between message and file search modes
 * via the mode button.
 */
export function toggleSearchMode(panel) {
  setSearchMode(
    panel,
    panel._searchMode === 'message' ? 'file' : 'message',
  );
  // Focus the search input after the mode switch
  // so the user can start typing immediately.
  panel.updateComplete.then(() => {
    const input = panel.shadowRoot?.querySelector(
      '.search-input',
    );
    if (input) input.focus();
  });
}

// ---------------------------------------------------------------
// File-search RPC + debounce
// ---------------------------------------------------------------

/**
 * Schedule a debounced file-search RPC call.
 * Clears any pending timer. The RPC fires 300ms
 * after the last keystroke (matches specs3's
 * debounce value). Empty queries clear results
 * immediately without a round-trip.
 */
export function scheduleFileSearch(panel) {
  if (panel._fileSearchDebounceTimer != null) {
    clearTimeout(panel._fileSearchDebounceTimer);
    panel._fileSearchDebounceTimer = null;
  }
  const query = panel._searchQuery.trim();
  if (!query) {
    // Empty query — clear results immediately.
    // Bump the generation so any in-flight
    // response is discarded when it arrives.
    panel._fileSearchGeneration += 1;
    panel._fileSearchResults = [];
    panel._fileSearchFocusedIndex = -1;
    panel._fileSearchLoading = false;
    dispatchFileSearchChanged(panel);
    return;
  }
  panel._fileSearchDebounceTimer = setTimeout(() => {
    panel._fileSearchDebounceTimer = null;
    runFileSearch(panel, query);
  }, 300);
}

/**
 * Run the file-search RPC. Generation-guarded so a
 * stale response (user typed faster than the
 * server responded) is silently discarded rather
 * than overwriting fresher results.
 *
 * Mode-guarded too — if the user exited file
 * search between the debounce firing and the RPC
 * returning, the response is discarded.
 */
export async function runFileSearch(panel, query) {
  if (!panel.rpcConnected) {
    panel._fileSearchLoading = false;
    return;
  }
  const gen = ++panel._fileSearchGeneration;
  panel._fileSearchLoading = true;
  let results;
  try {
    results = await panel.rpcExtract(
      'Repo.search_files',
      query,
      panel._searchWholeWord,
      panel._searchRegex,
      panel._searchIgnoreCase,
      // context_lines — single line before and
      // after each match per
      // specs4/5-webapp/search.md.
      1,
    );
  } catch (err) {
    // Stale-gen check first — a later call may
    // have already replaced our future.
    if (gen !== panel._fileSearchGeneration) return;
    if (panel._searchMode !== 'file') return;
    console.error('[chat] Repo.search_files failed', err);
    panel._fileSearchLoading = false;
    panel._fileSearchResults = [];
    panel._fileSearchFocusedIndex = -1;
    panel._emitToast(
      `Search failed: ${err?.message || String(err)}`,
      'error',
    );
    dispatchFileSearchChanged(panel);
    return;
  }
  if (gen !== panel._fileSearchGeneration) return;
  if (panel._searchMode !== 'file') return;
  panel._fileSearchLoading = false;
  panel._fileSearchResults = Array.isArray(results) ? results : [];
  // Focus the first match when results arrive.
  // Flat match-count-driven index — 0 means first
  // match of first file.
  panel._fileSearchFocusedIndex =
    totalFileSearchMatches(panel) > 0 ? 0 : -1;
  dispatchFileSearchChanged(panel);
}

/**
 * Total match count across all files in the
 * current results. Used for counter display and
 * for bounding the focus index on navigation.
 */
export function totalFileSearchMatches(panel) {
  let total = 0;
  for (const r of panel._fileSearchResults) {
    if (r && Array.isArray(r.matches)) {
      total += r.matches.length;
    }
  }
  return total;
}

/**
 * Map a flat match index to a `{file, match,
 * matchIndex, fileIndex}` structure. `matchIndex`
 * is the position within the file; `fileIndex` is
 * the position of the file in the results array.
 * Returns null when the index is out of range.
 */
export function resolveFileSearchFocus(panel, flatIndex) {
  if (flatIndex < 0) return null;
  let cursor = 0;
  for (let fi = 0; fi < panel._fileSearchResults.length; fi += 1) {
    const entry = panel._fileSearchResults[fi];
    const matches = Array.isArray(entry?.matches) ? entry.matches : [];
    if (flatIndex < cursor + matches.length) {
      const mi = flatIndex - cursor;
      return {
        file: entry.file,
        match: matches[mi],
        fileIndex: fi,
        matchIndex: mi,
      };
    }
    cursor += matches.length;
  }
  return null;
}

// ---------------------------------------------------------------
// File-search navigation
// ---------------------------------------------------------------

export function onFileSearchNext(panel) {
  const total = totalFileSearchMatches(panel);
  if (total === 0) return;
  panel._fileSearchFocusedIndex =
    (Math.max(0, panel._fileSearchFocusedIndex) + 1) % total;
  panel.updateComplete.then(() =>
    scrollFocusedFileSearchMatchIntoView(panel),
  );
}

export function onFileSearchPrev(panel) {
  const total = totalFileSearchMatches(panel);
  if (total === 0) return;
  const base = Math.max(0, panel._fileSearchFocusedIndex);
  panel._fileSearchFocusedIndex = (base - 1 + total) % total;
  panel.updateComplete.then(() =>
    scrollFocusedFileSearchMatchIntoView(panel),
  );
}

export function onFileSearchOpenFocused(panel) {
  const target = resolveFileSearchFocus(
    panel,
    panel._fileSearchFocusedIndex,
  );
  if (!target) return;
  // Dispatch navigate-file with the line number
  // so the viewer can scroll to the match.
  // specs4/5-webapp routes this to the diff
  // viewer.
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: {
        path: target.file,
        line: target.match?.line_num,
      },
      bubbles: false,
    }),
  );
}

/**
 * Scroll the focused match row into view within
 * the overlay. Also dispatches
 * `file-search-scroll` so the files-tab can sync
 * the picker's focused path.
 */
export function scrollFocusedFileSearchMatchIntoView(panel) {
  const target = resolveFileSearchFocus(
    panel,
    panel._fileSearchFocusedIndex,
  );
  if (!target) return;
  const row = panel.shadowRoot?.querySelector(
    `[data-file-match-flat="${panel._fileSearchFocusedIndex}"]`,
  );
  if (row && typeof row.scrollIntoView === 'function') {
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  // Sync the picker highlight. Dispatch
  // unconditionally of scroll success — the
  // picker's highlight shouldn't depend on
  // whether scrollIntoView was a no-op.
  dispatchFileSearchScroll(panel, target.file);
}

// ---------------------------------------------------------------
// File-search ↔ files-tab event dispatch
// ---------------------------------------------------------------

export function dispatchFileSearchChanged(panel) {
  panel.dispatchEvent(
    new CustomEvent('file-search-changed', {
      detail: {
        active: panel._searchMode === 'file',
        results: panel._fileSearchResults,
      },
      bubbles: true,
      composed: true,
    }),
  );
}

export function dispatchFileSearchScroll(panel, filePath) {
  panel.dispatchEvent(
    new CustomEvent('file-search-scroll', {
      detail: { filePath },
      bubbles: true,
      composed: true,
    }),
  );
}

// ---------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------

/**
 * Public entry point for Ctrl+Shift+F from the
 * shell. Switches to file mode (if not already),
 * prefills the query, focuses the search input,
 * and kicks off a debounced RPC call. The prefill
 * typically comes from window.getSelection()
 * captured synchronously at the shell keydown
 * handler.
 *
 * Accepts empty prefill — switches to file mode
 * with an empty query, ready for the user to
 * type.
 */
export function activateFileSearch(panel, prefill = '') {
  const query = typeof prefill === 'string' ? prefill.trim() : '';
  if (panel._searchMode !== 'file') {
    setSearchMode(panel, 'file');
  }
  // Set query AFTER mode switch (mode switch
  // clears the query). Schedule a search if the
  // query is non-empty.
  if (query) {
    panel._searchQuery = query;
    scheduleFileSearch(panel);
  }
  panel.updateComplete.then(() => {
    const input = panel.shadowRoot?.querySelector(
      '.search-input',
    );
    if (input) input.focus();
  });
}

/**
 * Public entry point for picker clicks during
 * file search. The files-tab forwards
 * `file-clicked` events from the picker here so
 * the overlay scrolls to the corresponding file
 * section.
 *
 * Sets a brief scroll-pause flag so the
 * reciprocal overlay-scroll → picker-focus sync
 * doesn't re-fire and create a feedback loop.
 * The pause auto-clears after a short delay.
 */
export function scrollFileSearchToFile(panel, filePath) {
  if (panel._searchMode !== 'file') return;
  if (typeof filePath !== 'string' || !filePath) return;
  // Find the first match index for this file and
  // focus it. Gives the user a consistent focus
  // state after the scroll — clicking a file
  // both scrolls the overlay AND focuses that
  // file's first match so Enter-to-open works
  // right away.
  let cursor = 0;
  let targetFlatIndex = -1;
  for (const entry of panel._fileSearchResults) {
    if (entry?.file === filePath) {
      targetFlatIndex = cursor;
      break;
    }
    const matches = Array.isArray(entry?.matches) ? entry.matches : [];
    cursor += matches.length;
  }
  if (targetFlatIndex < 0) return;
  panel._fileSearchFocusedIndex = targetFlatIndex;
  panel._fileSearchScrollPaused = true;
  panel.updateComplete.then(() => {
    const section = panel.shadowRoot?.querySelector(
      `[data-file-section="${cssEscape(filePath)}"]`,
    );
    if (section && typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    // Release the pause after the scroll settles.
    // 400ms matches the smooth-scroll duration
    // generously.
    setTimeout(() => {
      panel._fileSearchScrollPaused = false;
    }, 400);
  });
}

// ---------------------------------------------------------------
// Overlay scroll handling
// ---------------------------------------------------------------

/**
 * Overlay scroll handler. Dispatches
 * `file-search-scroll` with the file path at the
 * top of the visible area so the picker can sync
 * its focus. Throttled via the scroll-paused flag
 * so an externally-driven scroll (picker click →
 * scrollFileSearchToFile) doesn't bounce back.
 */
export function onFileSearchOverlayScroll(panel, event) {
  if (panel._fileSearchScrollPaused) return;
  const overlay = event.currentTarget;
  const sections = overlay.querySelectorAll(
    '[data-file-section]',
  );
  const overlayTop = overlay.getBoundingClientRect().top;
  let topFile = null;
  for (const section of sections) {
    const rect = section.getBoundingClientRect();
    // The section at the top of the visible area
    // is the one whose bottom edge is still below
    // the overlay's top edge.
    if (rect.bottom > overlayTop + 1) {
      topFile = section.getAttribute('data-file-section');
      break;
    }
  }
  if (topFile) {
    dispatchFileSearchScroll(panel, topFile);
  }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/**
 * Defensive CSS selector escape — file paths may
 * contain characters that need escaping when
 * embedded in a `[data-file-section="..."]`
 * selector. `CSS.escape` is the standard API;
 * fallback to a manual quote-escape when
 * unavailable (older jsdom).
 */
export function cssEscape(value) {
  if (typeof CSS !== 'undefined' && CSS && CSS.escape) {
    return CSS.escape(value);
  }
  return String(value).replace(/(["\\])/g, '\\$1');
}