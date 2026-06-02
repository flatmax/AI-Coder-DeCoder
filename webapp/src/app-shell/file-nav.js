// File navigation grid (Alt+Arrow) helpers for the app shell.
//
// Extracted from app-shell.js. These functions take a `host`
// parameter (the AppShell LitElement instance). The host
// retains ownership of methods these helpers call back into
// (`_switchTab`, `_toggleMinimize`).
//
// Governing spec: specs4/5-webapp/file-navigation.md (grid
// rendering, Alt+Arrow semantics, debounce window).

import { ALT_ARROW_DEBOUNCE_MS } from './constants.js';
import { viewerForPath } from '../viewer-routing.js';
import {
  captureDiffViewportState,
  applyDiffViewportState,
} from './viewport.js';

export function getFileNav(host) {
  return host.shadowRoot?.querySelector('ac-file-nav') || null;
}

/**
 * Alt+Arrow keydown — navigate the file grid. When the
 * grid has nodes, all Alt+Arrow events are consumed
 * (preventDefault + stopPropagation) to prevent Monaco's
 * word-navigation and line-move bindings from firing.
 *
 * Escape while the HUD is visible hides it immediately.
 *
 * Capture phase (`true` in addEventListener) ensures we
 * intercept before Monaco sees the event.
 */
export function onGridKeyDown(host, event) {
  const nav = getFileNav(host);
  if (!nav) return;

  // Escape hides the HUD if visible.
  if (event.key === 'Escape' && nav.visible) {
    event.preventDefault();
    event.stopPropagation();
    nav.visible = false;
    nav.classList.remove('fading');
    return;
  }

  // Only process Alt+Arrow.
  if (!event.altKey) return;
  const dirMap = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  };
  const dir = dirMap[event.key];
  if (!dir) return;

  // When the grid has nodes, consume the event regardless
  // of whether a neighbor exists — prevents Monaco's
  // Alt+Arrow bindings from firing while the HUD is
  // potentially visible.
  if (!nav.hasNodes) return;
  event.preventDefault();
  event.stopPropagation();

  const targetPath = nav.navigateDirection(dir);
  nav.show();
  nav.requestUpdate();

  if (targetPath) {
    // Debounce the viewer fetch. HUD already updated via
    // navigateDirection + show above. The dispatch defers
    // so rapid sequences coalesce to one fetch for the
    // final target — matches the no-cache contract's
    // intent ("one click, one fetch" at the user-gesture
    // level, not the keystroke level).
    host._altArrowPending = targetPath;
    if (host._altArrowTimer) {
      clearTimeout(host._altArrowTimer);
    }
    host._altArrowTimer = setTimeout(() => {
      host._altArrowTimer = null;
      flushAltArrowPending(host);
    }, ALT_ARROW_DEBOUNCE_MS);
  }
}

/**
 * Fire the pending Alt+Arrow navigation. Called from the
 * debounce timer and from Alt release (`_onGridKeyUp`).
 * No-op when nothing is pending.
 *
 * For diff-viewer targets, this captures the outgoing
 * file's scroll/cursor/preview state into an in-session
 * per-path map keyed on the host (`_diffViewportMemory`),
 * then restores the incoming file's stored state after
 * `openFile` resolves. The SVG viewer is multi-file in
 * memory (`_files[]` with per-entry viewBox) so it
 * already preserves viewport across alt-arrow swaps —
 * the diff viewer is single-file (D18) and discards
 * Monaco model state on `swapModel`, so we mirror the
 * SVG viewer's behaviour at the shell level for the
 * diff path.
 *
 * The map is in-memory only; it does not persist across
 * page reloads. `loadViewportState` / `doReopenLastFile`
 * cover the reload case via the single localStorage slot
 * keyed by repo + last-open-file.
 */
export function flushAltArrowPending(host) {
  const targetPath = host._altArrowPending;
  host._altArrowPending = null;
  if (!targetPath) return;
  const target = viewerForPath(targetPath);
  if (!target) return;
  if (!host._diffViewportMemory) {
    host._diffViewportMemory = new Map();
  }
  // Capture the outgoing diff-viewer state synchronously,
  // before updateComplete resolves and openFile runs.
  // Reading after openFile would see the new file's
  // (zero) scroll, not the outgoing file's.
  const outgoing = captureDiffViewportState(host);
  if (outgoing && outgoing.path && outgoing.path !== targetPath) {
    host._diffViewportMemory.set(outgoing.path, outgoing);
  }
  host.updateComplete.then(() => {
    const viewer =
      target === 'svg'
        ? host.shadowRoot?.querySelector('ac-svg-viewer')
        : host.shadowRoot?.querySelector('ac-diff-viewer');
    if (!viewer) return;
    const result = viewer.openFile({ path: targetPath });
    if (target !== 'diff') return;
    const stored = host._diffViewportMemory.get(targetPath);
    if (!stored) return;
    // openFile is async on the diff viewer (fetches file
    // content). Wait for it before restoring; if it isn't
    // a thenable for some reason, fall back to a one-frame
    // delay so the editor at least has a chance to mount.
    const apply = () => applyDiffViewportState(host, stored);
    if (result && typeof result.then === 'function') {
      result.then(apply);
    } else {
      requestAnimationFrame(apply);
    }
  });
}

/**
 * Alt keyup — hide the HUD when Alt is released and
 * flush any pending viewer fetch immediately. Without
 * the flush, the user would see the HUD fade out
 * BEFORE the viewer updated — the fetch would still
 * fire ~200ms later, but visually it'd look like the
 * final keystroke got dropped.
 */
export function onGridKeyUp(host, event) {
  if (event.key !== 'Alt') return;
  if (host._altArrowTimer) {
    clearTimeout(host._altArrowTimer);
    host._altArrowTimer = null;
  }
  flushAltArrowPending(host);
  const nav = getFileNav(host);
  if (nav && nav.visible) {
    nav.hide();
  }
}

/**
 * Global Alt+digit / Alt+M / Ctrl+Shift+F keyboard
 * shortcuts. Fires on any keydown that isn't hitting
 * the capture-phase grid handler (Alt+Arrow is already
 * consumed there).
 *
 *   Alt+1 → Chat (returns to default body from any overlay)
 *   Alt+2 → Context tab
 *   Alt+3 → Settings tab
 *   Alt+4 → Convert tab (when available — silently consumed
 *           but no-op when Convert is unavailable)
 *   Alt+M → Toggle minimize
 *   Ctrl+Shift+F → Activate file search in the chat panel,
 *           prefilling with the current text selection
 *           (single-line selections only; multi-line and
 *           empty selections produce an empty prefill).
 *
 * Alt+1 acts as a "back to chat" shortcut equivalent to
 * clicking the back arrow on whichever overlay is open.
 *
 * Alt+3 is fixed on Settings regardless of Convert
 * availability — muscle memory shouldn't shift just because
 * markitdown is or isn't installed. Alt+4 is the optional
 * Convert slot.
 *
 * Ctrl+Shift+F MUST capture window.getSelection() as its
 * first synchronous operation. Any deferred work (Lit
 * property updates, requestAnimationFrame, RPC calls) loses
 * the selection because the focus changes that follow tab
 * switching clear it. See specs-reference/5-webapp/shell.md
 * § Ctrl+Shift+F selection capture.

 *
 * Guards:
 *   - Skips when Ctrl / Meta / Shift are also held.
 *     Alt+Shift+digit is a macOS symbol-entry shortcut
 *     and Alt+Ctrl+digit is used by some window
 *     managers. We only handle the pure-Alt case.
 *   - Skips when RPC isn't connected. Switching to a
 *     tab whose RPC calls will fail into error toasts
 *     is worse than a no-op.
 *   - Alt+4 silently no-ops when doc-convert is
 *     unavailable, rather than switching to a hidden
 *     tab with a blank body.
 *
 * preventDefault fires on every handled key so the
 * browser's own Alt+digit bindings (some versions of
 * Firefox use Alt+digit for tab switching at the
 * browser chrome level) don't steal the keystroke.
 */
export function onGlobalKeyDown(host, event) {
  // Ctrl+Shift+F — activate file search. Read the
  // selection FIRST, synchronously, before any await
  // or property update. Tab switching clears focus
  // which clears the selection; reading later returns
  // empty.
  if (
    event.ctrlKey
    && event.shiftKey
    && !event.altKey
    && !event.metaKey
    && (event.key === 'f' || event.key === 'F')
  ) {
    event.preventDefault();
    const raw = window.getSelection?.()?.toString?.() || '';
    const trimmed = raw.trim();
    // Multi-line selections aren't sensible as a search
    // query (file search is single-line by design), so
    // discard them. Empty selection → empty prefill,
    // which just opens the search bar with focus.
    const prefill = trimmed && !trimmed.includes('\n')
      ? trimmed
      : '';
    host._switchTab('files');
    host.updateComplete.then(() => {
      const filesTab = host.shadowRoot?.querySelector('ac-files-tab');
      const chatPanel = filesTab?.shadowRoot?.querySelector('ac-chat-panel');
      if (chatPanel
          && typeof chatPanel.activateFileSearch === 'function') {
        chatPanel.activateFileSearch(prefill);
      }
    });
    return;
  }
  if (!event.altKey) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;
  // Alt+M — toggle minimize. Accept both cases so
  // Caps Lock doesn't break the shortcut.
  if (event.key === 'm' || event.key === 'M') {
    event.preventDefault();
    host._toggleMinimize();
    return;
  }
  // Alt+1..4 — tab switch. event.key is the digit
  // character ('1', '2', …), not KeyboardEvent.code
  // which would be 'Digit1'. The digit form matches
  // physical layout on non-US keyboards where the
  // keycap's primary label might differ.
  const tabMap = {
    '1': 'files',
    '2': 'context',
    '3': 'settings',
    '4': 'doc-convert',
  };
  const targetTab = tabMap[event.key];
  if (!targetTab) return;
  // Gate Alt+4 on Convert availability — the tab isn't
  // rendered when markitdown is missing, and switching
  // to a hidden tab leaves the dialog body blank. Still
  // consume the keystroke so a subsequent Alt+4 doesn't
  // bubble to browser chrome (some Firefox builds use
  // Alt+digit for tab switching at the chrome level).
  if (targetTab === 'doc-convert' && !host._docConvertAvailable) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  host._switchTab(targetTab);
}