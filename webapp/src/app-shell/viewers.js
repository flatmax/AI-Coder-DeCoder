// Viewer routing helpers for the app shell.
//
// Extracted from app-shell.js. These functions take a `host`
// parameter (the AppShell LitElement instance). The host
// retains ownership of methods these helpers call back into
// (`_saveViewportState`, `_saveLastOpenFile`, `_getFileNav`).
//
// Governing specs:
//   - specs4/5-webapp/diff-viewer.md (event routing, refresh)
//   - specs4/5-webapp/svg-viewer.md  (SVG ↔ text-diff swap)
//   - specs4/5-webapp/file-navigation.md (navigate-file flow)

import { viewerForPath } from '../viewer-routing.js';

/**
 * Route a `navigate-file` event to the appropriate viewer
 * based on the file's extension. Dispatches `openFile` on
 * the target viewer. The viewer's `active-file-changed`
 * event then triggers visibility toggling.
 *
 * The `_remote` flag on broadcasts is consumed by the
 * chat panel / picker to suppress re-broadcasts — we
 * don't care about it here. Same routing applies
 * whether the event came from a local click or a
 * collaboration broadcast.
 */
export function onNavigateFile(host, event) {
  const detail = event.detail || {};
  const path = detail.path;
  if (typeof path !== 'string' || !path) return;
  let target = viewerForPath(path);
  if (!target) return;
  // Edit-block clicks on SVG files carry a scroll hint
  // (`searchText` from the edit anchor, or a `line`).
  // The visual SVG viewer can't honor those — its
  // openFile signature has no notion of "scroll to this
  // text" — so the anchor would be dropped and the user
  // would land on the canvas with no indication of where
  // the edit happened. Route to the text diff viewer
  // instead when a scroll hint is present, matching what
  // happens on every other file type. The user can
  // toggle back to the visual editor from the diff
  // viewer's mode switch if they want.
  const hasScrollHint =
    (typeof detail.searchText === 'string' && detail.searchText)
    || typeof detail.line === 'number';
  if (target === 'svg' && hasScrollHint) {
    target = 'diff';
  }
  // Save viewport of the current file before navigating
  // away (so switching files preserves the prior file's
  // scroll state in localStorage).
  try {
    host._saveViewportState();
  } catch (_) {
    // Don't let a save failure block navigation.
  }
  // Persist the new path so page refresh reopens it.
  host._saveLastOpenFile(path);
  // Register with the file navigation grid unless the
  // event came from the grid itself or is a programmatic
  // refresh.
  if (!detail._fromNav && !detail._refresh) {
    const nav = host._getFileNav();
    if (nav) nav.openFile(path);
  }
  // Flip the active viewer to match the resolved target
  // so the text diff is actually visible when we routed
  // an SVG path there. Without this, the SVG viewer
  // stays foregrounded and the diff viewer's openFile
  // happens behind it. Only set when the routing
  // diverges from the path's natural viewer — for
  // non-SVG files, `active-file-changed` from the diff
  // viewer takes care of foregrounding.
  if (target === 'diff' && viewerForPath(path) === 'svg') {
    host._activeViewer = 'diff';
  }
  // Defer until the viewers exist in the DOM. Normally
  // they're rendered from the first template commit and
  // this is synchronous; the guard protects against
  // navigate-file firing before first render (rare,
  // but possible during startup).
  host.updateComplete.then(() => {
    const viewer =
      target === 'svg'
        ? host.shadowRoot?.querySelector('ac-svg-viewer')
        : host.shadowRoot?.querySelector('ac-diff-viewer');
    if (!viewer) return;
    viewer.openFile({
      path,
      line: detail.line,
      searchText: detail.searchText,
    });
  });
}

/**
 * Route a `load-diff-panel` event to the diff viewer's
 * loadPanel method. Dispatched by the history browser's
 * context menu for ad-hoc comparison. Shows the diff
 * viewer (switches active viewer if currently on SVG)
 * so the user sees the result immediately.
 */
export function onLoadDiffPanel(host, event) {
  const detail = event.detail || {};
  const { content, panel, label } = detail;
  if (typeof content !== 'string') return;
  if (panel !== 'left' && panel !== 'right') return;
  host._activeViewer = 'diff';
  host.updateComplete.then(() => {
    const viewer =
      host.shadowRoot?.querySelector('ac-diff-viewer');
    if (!viewer || typeof viewer.loadPanel !== 'function') {
      return;
    }
    viewer.loadPanel(content, panel, label);
  });
}

/**
 * Handle `toggle-svg-mode` from either viewer. Switches
 * between the visual SVG viewer and the Monaco text diff
 * editor for the same file, carrying content and dirty
 * state across.
 */
export function onToggleSvgMode(host, event) {
  const detail = event.detail || {};
  const { path, target, modified, savedContent } = detail;
  if (!path || !target) return;
  // After the swap completes (one frame lets the
  // target viewer's openFile chain settle), save
  // viewport state so the new `type` — reflecting
  // which viewer is now active — is persisted. Per
  // specs-reference/5-webapp/shell.md save-triggers
  // table, `toggle-svg-mode` is a standalone save
  // point so a reload right after the toggle lands
  // back on the intended viewer rather than the
  // pre-toggle one.
  const saveAfterSwap = () => {
    requestAnimationFrame(() => {
      try {
        host._saveViewportState();
      } catch (err) {
        console.debug(
          '[app-shell] viewport save on svg-mode toggle failed',
          err,
        );
      }
    });
  };
  host.updateComplete.then(() => {
    const diffViewer =
      host.shadowRoot?.querySelector('ac-diff-viewer');
    const svgViewer =
      host.shadowRoot?.querySelector('ac-svg-viewer');
    if (target === 'diff') {
      // Visual → text diff.
      host._activeViewer = 'diff';
      if (diffViewer) {
        // No explicit closeFile — diffViewer.openFile
        // replaces the active file (single-file model,
        // D18). A closeFile would produce a one-frame
        // empty-state flash between the two calls.
        diffViewer.openFile({ path }).then(() => {
          // If we have modified content from the SVG
          // editor, update the diff viewer's active
          // file so visual edits appear as dirty in
          // text mode. _file is the single slot in the
          // no-cache model; _files[] is gone.
          if (typeof modified === 'string' && diffViewer._file?.path === path) {
            diffViewer._file = {
              ...diffViewer._file,
              modified,
              savedContent:
                typeof savedContent === 'string'
                  ? savedContent
                  : diffViewer._file.savedContent,
            };
            diffViewer._recomputeDirty?.();
            diffViewer._showEditor?.();
          }
          saveAfterSwap();
        });
      }
    } else if (target === 'visual') {
      // Text diff → visual.
      host._activeViewer = 'svg';
      if (svgViewer && diffViewer) {
        // Read latest content from the diff viewer's
        // single active-file slot (D18 — _files[] is
        // gone).
        const diffFile =
          diffViewer._file?.path === path
            ? diffViewer._file
            : null;
        const latestModified = diffFile?.modified;
        const latestSaved = diffFile?.savedContent;
        // Diff viewer's closeFile is still called because
        // the user is leaving the text diff entirely;
        // that returns the viewer to its empty state.
        // The SVG viewer still uses the multi-file model,
        // so closeFile+openFile there is the normal swap.
        diffViewer.closeFile(path);
        svgViewer.closeFile(path);
        svgViewer.openFile({
          path,
          ...(typeof latestModified === 'string'
            ? { modified: latestModified }
            : {}),
        }).then(() => {
          if (typeof latestSaved === 'string') {
            const svgFile = svgViewer._files?.find(
              (f) => f.path === path,
            );
            if (svgFile) {
              svgFile.savedContent = latestSaved;
              svgViewer._recomputeDirtyCount();
            }
          }
          saveAfterSwap();
        });
      }
    }
  });
}

/**
 * Handle `active-file-changed` bubbling up from either
 * viewer. When a viewer reports it has an active file,
 * that viewer becomes visible. When it reports null
 * (no files open), we keep the currently-visible viewer
 * as-is — flipping to the other one would just show
 * its empty state, which isn't what the user wants.
 *
 * Uses `event.composedPath()` to identify which viewer
 * emitted the event, so the handler is robust even if
 * additional viewers are added later.
 */
export function onActiveFileChanged(host, event) {
  const detail = event.detail || {};
  if (!detail.path) return;
  // Identify the source viewer by walking the composed
  // path — the event originates inside the viewer's
  // shadow root and bubbles up through the host element.
  const path = event.composedPath ? event.composedPath() : [];
  let newActive = null;
  for (const el of path) {
    if (el && el.tagName === 'AC-SVG-VIEWER') {
      newActive = 'svg';
      break;
    }
    if (el && el.tagName === 'AC-DIFF-VIEWER') {
      newActive = 'diff';
      break;
    }
  }
  if (!newActive) return;
  host._activeViewer = newActive;
  // Save a baseline viewport now that the viewer has a
  // file active. Without this, a user who opens an SVG
  // and reloads without any further interaction has no
  // persisted record of which viewer was active — the
  // stored `ac-last-viewport` still reflects the
  // previously-open file, and the restore short-circuits
  // because `viewport.path !== fileToRestore`. Saving
  // here captures the `type` discriminator (svg vs diff)
  // the moment the viewer reports its file, so every
  // reload has the right routing info regardless of
  // whether the user interacted with the viewer.
  //
  // For the SVG viewer this also covers the case where
  // the editors haven't finished attaching yet —
  // `_saveSvgViewportState` will see `getActiveViewBox()`
  // return null and the save becomes a no-op for that
  // trigger, but subsequent `viewbox-changed` events
  // (initial fit, first pan/zoom) arrive with editors
  // live and populate the viewBox block then.
  //
  // Wrapped in try/catch so a broken save never trips
  // downstream viewer-swap logic — the viewport save
  // is a best-effort persistence, not a correctness
  // requirement for the current render.
  try {
    host._saveViewportState();
  } catch (err) {
    console.debug(
      '[app-shell] viewport save on active-file-changed failed',
      err,
    );
  }
}

/**
 * RAF-throttled viewer relayout. Multiple calls within
 * a single animation frame coalesce to one actual
 * relayout call on each viewer. Called from both the
 * window-resize path and the dialog-resize pointermove
 * path; distinct from `_resizeRAF` so the two paths
 * don't cancel each other's pending frames.
 */
export function scheduleViewerRelayout(host) {
  if (host._viewerRelayoutRAF) return;
  host._viewerRelayoutRAF = requestAnimationFrame(() => {
    host._viewerRelayoutRAF = null;
    relayoutViewers(host);
  });
}

/**
 * Call `relayout()` on both viewers if they're mounted
 * and the method exists. Safe to call in tests where
 * the viewers haven't been constructed yet.
 */
export function relayoutViewers(host) {
  const diff = host.shadowRoot?.querySelector('ac-diff-viewer');
  const svg = host.shadowRoot?.querySelector('ac-svg-viewer');
  if (diff && typeof diff.relayout === 'function') {
    diff.relayout();
  }
  if (svg && typeof svg.relayout === 'function') {
    svg.relayout();
  }
}