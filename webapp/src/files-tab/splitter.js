// Splitter pane — drag-to-resize and double-click-collapse.
//
// Extracted from index.js so the orchestrator class stays
// focused on state ownership and event routing. Every
// function here takes the host (FilesTab instance) as its
// first argument; reactive state (`_pickerWidthPx`,
// `_pickerCollapsed`) and non-reactive drag bookkeeping
// (`_splitterDrag`) live on the host.
//
// Why pure functions over methods: the chat-panel split
// established the pattern. Bound forwarders in the host's
// constructor (e.g. `this._onSplitterPointerDown = (e) =>
// onSplitterPointerDown(this, e)`) keep the public surface
// identical while moving the bodies out of the class.

import {
  _PICKER_COLLAPSED_KEY,
  _PICKER_MIN_WIDTH,
  _PICKER_WIDTH_KEY,
} from './constants.js';

/**
 * Maximum width the picker pane is allowed to reach.
 * Computed from the host element's current width so it
 * tracks window / dialog resizes. Callers read this at
 * drag time rather than caching, so an ongoing drag
 * respects a resize that happens mid-drag.
 *
 * Falls back to an arbitrary large value if the host
 * isn't measurable yet (shouldn't happen in practice —
 * the user can't drag a splitter that isn't rendered).
 */
export function maxPickerWidth(host) {
  const rect = host.getBoundingClientRect?.();
  if (!rect || !rect.width) return 10000;
  return Math.floor(rect.width / 2);
}

/**
 * Begin a splitter drag. Snapshots the origin pointer
 * X and the picker's current width, then attaches
 * document-level pointermove / pointerup listeners so
 * we track the drag even when the pointer leaves the
 * splitter element itself.
 *
 * Skips non-primary buttons (right-click, middle-click)
 * and expanded-from-collapsed edge cases where the
 * drag base width would be meaningless — in collapsed
 * mode the splitter is clickable but not draggable.
 */
export function onSplitterPointerDown(host, event) {
  if (event.button !== 0) return;
  if (host._pickerCollapsed) return;
  event.preventDefault();
  host._splitterDrag = {
    startX: event.clientX,
    originWidth: host._pickerWidthPx,
  };
  document.addEventListener(
    'pointermove', host._onSplitterPointerMove,
  );
  document.addEventListener(
    'pointerup', host._onSplitterPointerUp,
  );
}

/**
 * Pointer move during drag. Mutates the picker pane's
 * inline width style directly rather than through the
 * reactive property — Lit's render cycle is expensive
 * enough that per-pointermove re-renders produce
 * visible lag on slower machines. Commits to
 * `_pickerWidthPx` on pointerup.
 *
 * Clamp to [_PICKER_MIN_WIDTH, host-width/2] so the
 * picker never goes below the readable threshold or
 * pushes the chat pane below half the dialog.
 */
export function onSplitterPointerMove(host, event) {
  if (!host._splitterDrag) return;
  const dx = event.clientX - host._splitterDrag.startX;
  const next = Math.max(
    _PICKER_MIN_WIDTH,
    Math.min(
      maxPickerWidth(host),
      host._splitterDrag.originWidth + dx,
    ),
  );
  const pane = host.shadowRoot?.querySelector('.picker-pane');
  if (pane) {
    pane.style.width = `${next}px`;
  }
}

/**
 * Commit the drag. Reads the final width from the
 * inline style (the pointermove path wrote there for
 * smooth tracking) and writes it back to the reactive
 * property so subsequent renders honour it. Persists
 * to localStorage so the width survives a reload.
 *
 * Below-threshold drags (no pointermove fired between
 * down and up, so the pane's inline style is still
 * empty) skip the read and leave state unchanged.
 */
export function onSplitterPointerUp(host) {
  document.removeEventListener(
    'pointermove', host._onSplitterPointerMove,
  );
  document.removeEventListener(
    'pointerup', host._onSplitterPointerUp,
  );
  if (!host._splitterDrag) return;
  host._splitterDrag = null;
  const pane = host.shadowRoot?.querySelector('.picker-pane');
  if (!pane) return;
  const styleWidth = parseInt(pane.style.width, 10);
  if (Number.isNaN(styleWidth)) return;
  host._pickerWidthPx = styleWidth;
  savePickerWidth(host);
}

/**
 * Toggle collapsed state on double-click. In collapsed
 * mode the picker renders at _PICKER_COLLAPSED_WIDTH
 * (just wide enough for an affordance glyph); the
 * stored _pickerWidthPx is untouched so expanding
 * restores the user's prior size.
 *
 * The first click of a double-click would normally
 * start a drag via onSplitterPointerDown. That drag
 * is cancelled here because we null `_splitterDrag`
 * and remove the document listeners — the second
 * click's pointerdown would attach fresh listeners but
 * the intervening double-click event fires first
 * (browsers fire dblclick after the second mouseup).
 */
export function onSplitterDoubleClick(host, event) {
  event.preventDefault();
  // Cancel any in-flight drag. The first click of the
  // double-click opened a drag; we release its
  // listeners so the state doesn't leak.
  if (host._splitterDrag) {
    document.removeEventListener(
      'pointermove', host._onSplitterPointerMove,
    );
    document.removeEventListener(
      'pointerup', host._onSplitterPointerUp,
    );
    host._splitterDrag = null;
  }
  host._pickerCollapsed = !host._pickerCollapsed;
  saveCollapsed(host);
}

/**
 * Persist the picker width to localStorage. Errors
 * (storage quota, private mode) are swallowed — width
 * persistence is a nice-to-have, not a correctness
 * requirement.
 */
export function savePickerWidth(host) {
  try {
    localStorage.setItem(
      _PICKER_WIDTH_KEY, String(host._pickerWidthPx),
    );
  } catch (_) {}
}

/**
 * Persist the collapsed flag to localStorage. Same
 * error-swallowing rationale as `savePickerWidth`.
 */
export function saveCollapsed(host) {
  try {
    localStorage.setItem(
      _PICKER_COLLAPSED_KEY, String(host._pickerCollapsed),
    );
  } catch (_) {}
}

/**
 * Release any document-scope listeners that an in-
 * flight drag attached. Called from the host's
 * `disconnectedCallback` so a hot-reload or tab
 * switch mid-drag doesn't leave dangling pointermove
 * handlers firing into a detached component.
 */
export function detachSplitter(host) {
  document.removeEventListener(
    'pointermove', host._onSplitterPointerMove,
  );
  document.removeEventListener(
    'pointerup', host._onSplitterPointerUp,
  );
}