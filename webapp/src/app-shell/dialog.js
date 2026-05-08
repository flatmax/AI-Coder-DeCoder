// Dialog drag/resize/minimize helpers for the app shell.
//
// Extracted from app-shell.js. These functions take a `host`
// parameter (the AppShell LitElement instance). The host
// retains ownership of methods these helpers call back into
// (`_scheduleViewerRelayout`, `_saveDockedWidth`, etc.) — see
// the inline notes where those calls happen.
//
// Governing spec: specs4/5-webapp/shell.md (dialog geometry,
// drag thresholds, resize handles, proportional rescaling).

import {
  DIALOG_DRAG_THRESHOLD,
  DIALOG_VISIBLE_MARGIN,
  DIALOG_MIN_WIDTH,
  DIALOG_MIN_HEIGHT,
  RESIZE_RIGHT,
  RESIZE_BOTTOM,
  RESIZE_CORNER,
} from './constants.js';
import { saveDockedWidth, saveUndockedPos } from './persistence.js';

/**
 * Query the dialog element's current rect. Used at drag
 * start to snapshot the starting geometry — from there
 * we apply pointer deltas. Returns null when the shadow
 * root hasn't rendered yet (shouldn't happen in
 * practice since the pointer can't target it, but
 * defensive).
 */
export function getDialogRect(host) {
  const dialog = host.shadowRoot?.querySelector('.dialog');
  if (!dialog) return null;
  return dialog.getBoundingClientRect();
}

/**
 * Begin dragging from a header pointerdown. Skips when the
 * pointer is on a button inside the header — tab buttons
 * and the minimize button handle their own clicks.
 */
export function onHeaderPointerDown(host, event) {
  if (event.button !== 0) return;
  // closest('button') lets a click anywhere on a button
  // (including nested icons if we add them later) skip drag.
  if (
    event.target
    && typeof event.target.closest === 'function'
    && event.target.closest('button')
  ) {
    return;
  }
  const rect = getDialogRect(host);
  if (!rect) return;
  host._drag = {
    mode: 'drag',
    startX: event.clientX,
    startY: event.clientY,
    originLeft: rect.left,
    originTop: rect.top,
    originWidth: rect.width,
    originHeight: rect.height,
    committed: false,
  };
  document.addEventListener('pointermove', host._onPointerMove);
  document.addEventListener('pointerup', host._onPointerUp);
}

/**
 * Begin resizing from a handle pointerdown. The handle's
 * dataset carries which edge/corner it represents.
 */
export function onHandlePointerDown(host, event, which) {
  if (event.button !== 0) return;
  // Don't let the pointerdown bubble to the header (which
  // would also try to start a drag).
  event.stopPropagation();
  const rect = getDialogRect(host);
  if (!rect) return;
  host._drag = {
    mode: 'resize',
    which,
    startX: event.clientX,
    startY: event.clientY,
    originLeft: rect.left,
    originTop: rect.top,
    originWidth: rect.width,
    originHeight: rect.height,
  };
  document.addEventListener('pointermove', host._onPointerMove);
  document.addEventListener('pointerup', host._onPointerUp);
}

/**
 * Pointer move during drag or resize. Mutates inline styles
 * directly (not reactive state) so tracking is smooth. The
 * committed values are written back to reactive state on
 * pointerup.
 *
 * For drag: cross the threshold before committing to an
 * undock. Below the threshold, treat the gesture as a click
 * that'll fall through to pointerup with no change — this
 * is how the minimize-via-header-click behavior would work
 * if we ever bind that gesture. Currently minimize has a
 * dedicated button, so below-threshold drags are just no-ops.
 */
export function onPointerMove(host, event) {
  if (!host._drag) return;
  const dx = event.clientX - host._drag.startX;
  const dy = event.clientY - host._drag.startY;
  const dialog = host.shadowRoot?.querySelector('.dialog');
  if (!dialog) return;

  if (host._drag.mode === 'drag') {
    if (!host._drag.committed) {
      if (
        Math.abs(dx) < DIALOG_DRAG_THRESHOLD
        && Math.abs(dy) < DIALOG_DRAG_THRESHOLD
      ) {
        return;
      }
      host._drag.committed = true;
      dialog.classList.add('dragging');
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Clamp so the dialog never fully leaves the viewport.
    // Using DIALOG_VISIBLE_MARGIN here gives the user the
    // same recovery guarantee as the bounds check at
    // restore time.
    const newLeft = Math.max(
      DIALOG_VISIBLE_MARGIN - host._drag.originWidth,
      Math.min(
        vw - DIALOG_VISIBLE_MARGIN,
        host._drag.originLeft + dx,
      ),
    );
    const newTop = Math.max(
      0,
      Math.min(
        vh - DIALOG_VISIBLE_MARGIN,
        host._drag.originTop + dy,
      ),
    );
    dialog.style.left = `${newLeft}px`;
    dialog.style.top = `${newTop}px`;
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
    dialog.style.width = `${host._drag.originWidth}px`;
    dialog.style.height = `${host._drag.originHeight}px`;
    dialog.classList.add('floating');
    return;
  }

  // mode === 'resize'
  dialog.classList.add('resizing');
  let newWidth = host._drag.originWidth;
  let newHeight = host._drag.originHeight;
  if (
    host._drag.which === RESIZE_RIGHT
    || host._drag.which === RESIZE_CORNER
  ) {
    newWidth = Math.max(
      DIALOG_MIN_WIDTH,
      host._drag.originWidth + dx,
    );
  }
  if (
    host._drag.which === RESIZE_BOTTOM
    || host._drag.which === RESIZE_CORNER
  ) {
    newHeight = Math.max(
      DIALOG_MIN_HEIGHT,
      host._drag.originHeight + dy,
    );
  }
  dialog.style.width = `${newWidth}px`;
  // Bottom / corner resize forces undock — the docked
  // height is 100% of the viewport, so there's no way to
  // express a smaller height while still docked. Match
  // the spec: "Auto-undocks if still docked" for bottom /
  // corner handles.
  if (
    host._drag.which === RESIZE_BOTTOM
    || host._drag.which === RESIZE_CORNER
  ) {
    if (!host._undockedPos) {
      dialog.style.left = `${host._drag.originLeft}px`;
      dialog.style.top = `${host._drag.originTop}px`;
      dialog.style.right = 'auto';
      dialog.style.bottom = 'auto';
      dialog.classList.add('floating');
    }
    dialog.style.height = `${newHeight}px`;
  }
  // Viewer behind the dialog may have a different
  // visible area now — schedule a relayout so Monaco's
  // scrollbars / minimap and the SVG viewer's viewBox
  // track the change in real time. RAF-throttled so
  // rapid pointermove events coalesce to one call per
  // frame.
  host._scheduleViewerRelayout();
}

/**
 * Release drag / resize. Commits the final geometry to
 * reactive state and persists it. Below-threshold drags
 * that never crossed DIALOG_DRAG_THRESHOLD leave state
 * unchanged — the class toggles revert on the next render.
 */
export function onPointerUp(host) {
  document.removeEventListener('pointermove', host._onPointerMove);
  document.removeEventListener('pointerup', host._onPointerUp);
  const drag = host._drag;
  host._drag = null;
  if (!drag) return;
  const dialog = host.shadowRoot?.querySelector('.dialog');
  if (dialog) {
    dialog.classList.remove('dragging');
    dialog.classList.remove('resizing');
  }
  if (drag.mode === 'drag') {
    if (!drag.committed) return;
    const rect = getDialogRect(host);
    if (!rect) return;
    host._undockedPos = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
    host._undockedPosViewport = {
      w: window.innerWidth,
      h: window.innerHeight,
    };
    saveUndockedPos(host);
    return;
  }
  // resize
  const rect = getDialogRect(host);
  if (!rect) return;
  if (drag.which === RESIZE_RIGHT && !host._undockedPos) {
    // Docked width change only.
    host._dockedWidth = rect.width;
    host._dockedWidthViewport = window.innerWidth;
    saveDockedWidth(host);
    return;
  }
  // Bottom / corner always, or right when already undocked.
  host._undockedPos = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
  host._undockedPosViewport = {
    w: window.innerWidth,
    h: window.innerHeight,
  };
  saveUndockedPos(host);
}

/**
 * Toggle minimize state. Dedicated button in the header.
 * Minimized dialogs persist their undocked position — on
 * restore they reopen at the same spot.
 */
export function toggleMinimize(host) {
  host._minimized = !host._minimized;
  host._saveMinimized();
}

/**
 * RAF-throttled resize handler. Rapid resize events (drag
 * the window corner, laptop lid reopen) can fire dozens of
 * times per animation frame; without throttling the
 * proportional-rescale logic forces reflow faster than the
 * browser can display and produces visible jank.
 */
export function onWindowResize(host) {
  if (host._resizeRAF) return;
  host._resizeRAF = requestAnimationFrame(() => {
    host._resizeRAF = null;
    host._handleWindowResize();
  });
}

/**
 * Proportionally rescale undocked dialog dimensions so the
 * dialog keeps the same approximate fraction of the viewport
 * across resolution changes. Only applies when undocked —
 * docked dialogs already track viewport size via the CSS
 * `width: %` + `bottom: 0` rules.
 *
 * Also re-clamps position so the dialog never strands
 * off-screen (same bounds check as at restore time).
 *
 * Viewer relayout is scheduled unconditionally — even when
 * the dialog itself doesn't need rescaling, the viewer
 * behind it may need to recompute its internal layout.
 * Monaco caches scrollbar / minimap dimensions, and the
 * SVG viewer's editors use `preserveAspectRatio="none"`
 * which relies on explicit `fitContent()` calls to follow
 * container size changes.
 */
export function handleWindowResize(host) {
  host._scheduleViewerRelayout();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!host._undockedPos) {
    // Docked mode.
    //
    // When the user has never right-edge-resized, CSS
    // handles proportional scaling — the stylesheet's
    // `width: 50%` tracks the viewport automatically and
    // _dockedWidth is null. Nothing to do.
    //
    // Once _dockedWidth is committed (user dragged the
    // right edge while docked), the inline style overrides
    // the percentage rule and the pixel value becomes
    // static. Rescale it so the dialog keeps the same
    // fraction of the viewport the user chose. Without
    // this, setting the dialog to half on a 1200-wide
    // window would leave it at 600px when the window
    // grows to 2400 — the user would see the dialog
    // shrink to a quarter of the viewport.
    if (host._dockedWidth != null) {
      const baseVw = host._dockedWidthViewport || vw;
      if (baseVw > 0 && baseVw !== vw) {
        const ratio = host._dockedWidth / baseVw;
        let scaled = Math.round(ratio * vw);
        // Respect the same safety margin used elsewhere —
        // never let the dialog consume so much width that
        // fewer than DIALOG_VISIBLE_MARGIN pixels remain
        // for the viewer background.
        const maxW = Math.max(
          DIALOG_MIN_WIDTH, vw - DIALOG_VISIBLE_MARGIN,
        );
        scaled = Math.max(
          DIALOG_MIN_WIDTH, Math.min(scaled, maxW),
        );
        host._dockedWidth = scaled;
        saveDockedWidth(host);
      } else if (
        host._dockedWidth > vw - DIALOG_VISIBLE_MARGIN
      ) {
        // Same-viewport (or missing baseline) case — fall
        // through to the simple shrink-clamp so the dialog
        // never overflows the current viewport.
        host._dockedWidth = Math.max(
          DIALOG_MIN_WIDTH, vw - DIALOG_VISIBLE_MARGIN,
        );
        saveDockedWidth(host);
      }
      host._dockedWidthViewport = vw;
    }
    return;
  }

  // Undocked mode — scale the full rect proportionally
  // against the baseline viewport captured at the last
  // commit. Without this, resizing the browser leaves the
  // pixel-literal stored rectangle unchanged and the
  // dialog occupies a visibly different fraction of the
  // viewport than the user last chose.
  //
  // Left and top are scaled against width and height
  // respectively so the dialog's position tracks its
  // size — a dialog pinned to the right edge stays
  // pinned, a dialog centred stays centred.
  const p = host._undockedPos;
  const base = host._undockedPosViewport
    || { w: vw, h: vh };
  const baseW = base.w || vw;
  const baseH = base.h || vh;
  let newLeft = p.left;
  let newTop = p.top;
  let newWidth = p.width;
  let newHeight = p.height;
  if (baseW > 0 && baseW !== vw) {
    const rx = vw / baseW;
    newLeft = Math.round(p.left * rx);
    newWidth = Math.round(p.width * rx);
  }
  if (baseH > 0 && baseH !== vh) {
    const ry = vh / baseH;
    newTop = Math.round(p.top * ry);
    newHeight = Math.round(p.height * ry);
  }
  // Enforce minimums so a very small new viewport doesn't
  // produce an unusable sliver of a dialog.
  newWidth = Math.max(
    DIALOG_MIN_WIDTH, Math.min(newWidth, vw),
  );
  newHeight = Math.max(
    DIALOG_MIN_HEIGHT, Math.min(newHeight, vh),
  );
  // Clamp origin so the full rect fits on-screen.
  // Math.max(0, ...) guards against viewports smaller
  // than the minimum dialog size (newWidth > vw): prefer
  // anchoring at left=0/top=0 with the right edge
  // clipped over a negative origin that would hide the
  // header's drag handle.
  newLeft = Math.max(
    0, Math.min(newLeft, vw - newWidth),
  );
  newTop = Math.max(
    0, Math.min(newTop, vh - newHeight),
  );
  const changed =
    newLeft !== p.left
    || newTop !== p.top
    || newWidth !== p.width
    || newHeight !== p.height;
  if (changed) {
    host._undockedPos = {
      left: newLeft,
      top: newTop,
      width: newWidth,
      height: newHeight,
    };
    saveUndockedPos(host);
  }
  // Update the baseline even when nothing changed (e.g.
  // resize was along an axis the dialog didn't respond to)
  // so subsequent resizes chain correctly against the new
  // viewport, not the original one.
  host._undockedPosViewport = { w: vw, h: vh };
}

/**
 * Build the inline style string for .dialog. When undocked,
 * the entire rect comes from _undockedPos. When docked but
 * with a persisted custom width, only the width is overridden.
 * The default (fresh install) returns empty, letting the CSS
 * defaults take over.
 */
export function dialogInlineStyle(host) {
  if (host._undockedPos) {
    const { left, top, width, height } = host._undockedPos;
    return `left: ${left}px; top: ${top}px; `
      + `width: ${width}px; height: ${height}px; `
      + 'right: auto; bottom: auto;';
  }
  if (host._dockedWidth != null) {
    return `width: ${host._dockedWidth}px;`;
  }
  return '';
}