// File-search bridge between the chat panel and the
// picker.
//
// When the user enters file-search mode in the chat
// panel, the picker shows a pruned tree of matching
// files. This module owns the four event handlers
// that bridge the two components:
//
//   - `file-clicked` routing: during search, route to
//     the chat panel's match-overlay scroll instead
//     of opening the file
//   - `file-search-changed`: enter / update / exit
//     search mode on the picker
//   - `filter-from-chat`: live-forward `@pattern`
//     input from the chat textarea to the picker's
//     filter
//   - `file-search-scroll`: keep the picker's focused
//     row in sync with the chat-side overlay
//
// State on the host: `_fileSearchActive` boolean,
// non-reactive. Read by `onFileClicked` to choose
// between viewer-open and overlay-scroll.

import { buildPrunedTree } from './helpers.js';

/**
 * Picker emits `file-clicked` when the user clicks a
 * file's name (not its checkbox). Normally this
 * translates to a `navigate-file` window event so the
 * viewer (Phase 3) opens the file.
 *
 * During file search, the picker shows a pruned tree
 * of matching files and clicking a file should scroll
 * the match overlay to that file rather than opening
 * it. We route to the chat panel's
 * scrollFileSearchToFile method instead.
 */
export function onFileClicked(host, event) {
  const path = event.detail?.path;
  if (!path) return;
  if (host._fileSearchActive) {
    event.stopPropagation();
    const chat = host._chat();
    if (chat && typeof chat.scrollFileSearchToFile === 'function') {
      chat.scrollFileSearchToFile(path);
    }
    return;
  }
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: { path },
      bubbles: false,
    }),
  );
}

/**
 * Chat panel dispatched `file-search-changed` — mode
 * entered, results updated, or mode exited. Swap the
 * picker tree to a pruned view containing only files
 * that have matches; on exit, restore the full tree and
 * the user's previous expand state.
 */
export function onFileSearchChanged(host, event) {
  const active = !!event.detail?.active;
  const results = Array.isArray(event.detail?.results)
    ? event.detail.results
    : [];
  const prev = host._fileSearchActive;
  host._fileSearchActive = active;
  const picker = host._picker();
  if (!picker) return;
  if (!active) {
    // Exiting file search mode. Restore picker state:
    // first the expand-state snapshot (so the user's
    // pre-search expansions come back), then the full
    // tree. `setTree` during the pruned phase snapshotted;
    // `restoreExpandedState` now installs the snapshot.
    if (prev) {
      picker.restoreExpandedState();
      picker.tree = host._latestTree;
      picker.selectedFiles = new Set(host._selectedFiles);
      picker.requestUpdate();
    }
    return;
  }
  // Entering file search mode (or results refreshed).
  // Build a pruned tree from the results. Empty results
  // produce an empty root; the picker renders its empty-
  // state placeholder.
  const pruned = buildPrunedTree(results);
  picker.setTree(pruned);
  picker.expandAll();
  picker.requestUpdate();
}

/**
 * Chat panel dispatched `filter-from-chat` — the user
 * typed `@pattern` in the chat textarea, or deleted/
 * exited a prior mention. Forward the query to the
 * picker's `setFilter` so the tree filters live as
 * the user types.
 *
 * Edge-triggered on the chat side — we only receive
 * this event when the mention state actually changes
 * (entering, updating, or exiting). Empty query is a
 * legitimate clearing signal.
 *
 * Defensive against missing detail or non-string
 * query — silently drop malformed events rather than
 * passing junk to the picker.
 */
export function onFilterFromChat(host, event) {
  const query = event?.detail?.query;
  if (typeof query !== 'string') return;
  const picker = host._picker();
  if (!picker) return;
  picker.setFilter(query);
}

/**
 * Chat panel dispatched `file-search-scroll` — the match
 * overlay scrolled, and we should update the picker's
 * focused-path highlight to show which file section is
 * currently at the top of the visible area.
 */
export function onFileSearchScroll(host, event) {
  if (!host._fileSearchActive) return;
  const filePath = event.detail?.filePath;
  if (typeof filePath !== 'string' || !filePath) return;
  const picker = host._picker();
  if (!picker) return;
  picker._focusedPath = filePath;
  // Also ensure ancestor directories are expanded so the
  // highlighted row is visible. The pruned tree was
  // `expandAll()`d on entry so this is usually a no-op,
  // but if the user collapsed a directory manually the
  // focused row might be hidden.
  const parts = filePath.split('/');
  const next = new Set(picker._expanded);
  let acc = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    next.add(acc);
  }
  picker._expanded = next;
}