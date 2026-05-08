// Viewport persistence and restoration helpers extracted from
// app-shell.js. These manage the "last open file" and viewport
// state (scroll, cursor, preview mode, SVG viewBox) saved to
// localStorage so a page reload reopens the previously-viewed
// file at its previous position.

import { repoKey, LAST_VIEWPORT_KEY } from './constants.js';

/**
 * Save the current viewport state on page unload. This
 * captures the scroll position and cursor so the next
 * page load can restore the exact view.
 */
export function onBeforeUnload(host) {
  saveViewportState(host);
}

/**
 * Save the current diff viewer's viewport state to
 * localStorage. SVG files are excluded (SVG zoom
 * restore is not yet supported).
 *
 * Post-D18: the diff viewer holds a single file slot
 * (`_file`), not a `_files[]` array. An older version
 * of this method read `_files[_activeIndex]` and
 * silently no-op'd after D18 — every save produced
 * nothing, reload-reopen had no viewport to restore.
 *
 * For markdown / TeX files the `preview` block is
 * populated by querying the viewer's public API
 * (isPreviewOpen / getPreviewScrollTop). The key is
 * omitted entirely for plain files so the stored
 * JSON stays compact and "preview closed" vs "no
 * preview concept" stay distinguishable.
 */
export function saveViewportState(host) {
  // Branch by active viewer. When the SVG viewer is
  // the active layer, persist its pan/zoom and
  // presentation state. Otherwise persist the diff
  // viewer's state (which includes the case where the
  // user toggled an .svg file to text diff — the
  // diff viewer becomes active, and we save with
  // type: "diff" even though the path ends in .svg).
  if (host._activeViewer === 'svg') {
    saveSvgViewportState(host);
    return;
  }
  const viewer = host.shadowRoot?.querySelector('ac-diff-viewer');
  if (!viewer) return;
  const file = viewer._file;
  if (!file || !file.path) return;
  try {
    const modifiedEditor = viewer._getModifiedEditor?.();
    if (!modifiedEditor) return;
    const pos = modifiedEditor.getPosition?.();
    const state = {
      path: file.path,
      type: 'diff',
      diff: {
        scrollTop: modifiedEditor.getScrollTop?.() || 0,
        scrollLeft: modifiedEditor.getScrollLeft?.() || 0,
        lineNumber: pos?.lineNumber || 1,
        column: pos?.column || 1,
      },
    };
    // Preview block — only for file types that have a
    // preview toggle. Populated via the viewer's
    // public API so we don't rely on private fields.
    if (typeof viewer.isPreviewOpen === 'function') {
      const previewOpen = !!viewer.isPreviewOpen();
      if (previewOpen) {
        state.preview = {
          open: true,
          scrollTop:
            (typeof viewer.getPreviewScrollTop === 'function'
              ? viewer.getPreviewScrollTop()
              : 0) || 0,
        };
      }
    }
    const key = repoKey(LAST_VIEWPORT_KEY, host._repoName);
    localStorage.setItem(key, JSON.stringify(state));
  } catch (_) {
    // Monaco mock or broken editor — skip silently.
  }
}

/**
 * Save the SVG viewer's viewport state. Separate from
 * the diff-viewer path because the viewers hold
 * independent state — the SVG viewer tracks multiple
 * open files with an active index, not a single file
 * slot. Reading the active file's viewBox from the
 * right editor (the editable side; the left mirrors
 * via the sync mutex) gives the canonical pan/zoom.
 *
 * Only writes when the active file is actually an
 * SVG. In practice the shell only flips `_activeViewer`
 * to 'svg' on SVG navigation, but a defensive check
 * costs nothing and protects against future viewer
 * sharing.
 */
export function saveSvgViewportState(host) {
  const viewer = host.shadowRoot?.querySelector('ac-svg-viewer');
  if (!viewer) return;
  if (typeof viewer.getActiveViewBox !== 'function') return;
  if (viewer._activeIndex < 0) return;
  const file = viewer._files?.[viewer._activeIndex];
  if (!file || !file.path) return;
  if (!file.path.toLowerCase().endsWith('.svg')) return;
  try {
    const vb = viewer.getActiveViewBox();
    if (!vb) return;
    const presentation =
      typeof viewer.isPresentation === 'function'
        ? !!viewer.isPresentation()
        : false;
    const state = {
      path: file.path,
      type: 'svg',
      svg: {
        viewBox: {
          x: vb.x,
          y: vb.y,
          width: vb.width,
          height: vb.height,
        },
        presentation,
      },
    };
    const key = repoKey(LAST_VIEWPORT_KEY, host._repoName);
    localStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    console.debug('[app-shell] SVG viewport save failed', err);
  }
}

/**
 * Load the saved viewport state from localStorage.
 * Returns null when nothing is saved or the data is
 * malformed.
 */
export function loadViewportState(host) {
  try {
    const key = repoKey(LAST_VIEWPORT_KEY, host._repoName);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.path) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

/**
 * Try to reopen the last-viewed file. Deferred until
 * the startup overlay dismisses on first connect (to
 * avoid file-fetch RPCs blocking the server during
 * heavy init). On reconnect (init already complete),
 * reopens immediately.
 */
export function tryReopenLastFile(host) {
  const path = host._loadLastOpenFile();
  if (!path) return;
  if (host._initComplete || !host.overlayVisible) {
    // Init already complete (reconnect) or overlay
    // already dismissed — reopen now.
    doReopenLastFile(host, path);
  } else {
    // First connect, overlay still showing — defer.
    host._pendingReopen = true;
  }
}

/**
 * Actually reopen the file and restore viewport state.
 *
 * When the persisted viewport says preview was open,
 * toggle preview BEFORE the editor scroll restore —
 * preview mode disposes and rebuilds the Monaco
 * editor with `renderSideBySide: false` against a
 * half-width pane, and the scroll offsets we saved
 * were captured against that half-width layout. If
 * we restored scroll first and toggled preview
 * after, Monaco's layout math would run twice and
 * the scroll would snap to a different position.
 *
 * Preview scrollTop restores after the editor scroll
 * has settled, via a follow-up one-frame delay
 * inside the viewer's `restorePreviewScrollTop`.
 */
export function doReopenLastFile(host, path) {
  host._pendingReopen = false;
  if (!path) return;
  // Dispatch navigate-file to open the file. Routing
  // to the correct viewer happens via extension check
  // in _onNavigateFile; the viewport.type field below
  // determines WHICH viewer we wait on for the post-
  // open restore step.
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: { path, _refresh: true },
    }),
  );
  // Restore viewport state if it matches the file.
  const viewport = loadViewportState(host);
  if (!viewport || viewport.path !== path) return;
  // Branch by type. SVG files with svg-type state
  // route through the SVG restore path; everything
  // else (including .svg paths that the user
  // toggled to text diff) goes through the diff
  // restore path.
  if (viewport.type === 'svg' && viewport.svg) {
    doReopenSvg(host, path, viewport.svg);
    return;
  }
  if (!viewport.diff) return;
  // Diff path — wait for the file to open, then
  // restore. Use a one-shot active-file-changed
  // listener filtered to the target path. Timeout
  // after 10 seconds.
  const viewer = host.shadowRoot?.querySelector('ac-diff-viewer');
  if (!viewer) return;
  let settled = false;
  const timeoutId = setTimeout(() => {
    settled = true;
  }, 10000);
  const handler = (event) => {
    if (settled) return;
    if (event.detail?.path !== path) return;
    settled = true;
    clearTimeout(timeoutId);
    viewer.removeEventListener('active-file-changed', handler);
    // Step 1 — open preview if it was open before.
    // Must happen before editor scroll restore so
    // Monaco's layout computes against the split
    // pane the scroll offsets were captured in.
    const wantsPreview = !!(viewport.preview && viewport.preview.open);
    if (wantsPreview && typeof viewer.setPreviewMode === 'function') {
      try {
        viewer.setPreviewMode(true);
      } catch (err) {
        console.debug(
          '[app-shell] preview restore failed', err,
        );
      }
    }
    // Step 2 — wait for diff computation to settle
    // before restoring scroll + cursor.
    restoreViewport(host, viewer, viewport.diff, viewport.preview);
  };
  viewer.addEventListener('active-file-changed', handler);
}

/**
 * Restore the SVG viewer's viewport after navigate-
 * file has routed to the SVG viewer. Applies
 * presentation mode first (changes the right pane's
 * width), then writes the viewBox so the user's
 * last-seen framing returns.
 *
 * Presentation-before-viewBox ordering matches the
 * preview-before-scroll ordering in the diff path:
 * the layout change must land first so the coordinate
 * write targets the same layout it was captured in.
 */
export function doReopenSvg(host, path, svgState) {
  const viewer = host.shadowRoot?.querySelector('ac-svg-viewer');
  if (!viewer) return;
  let settled = false;
  const timeoutId = setTimeout(() => {
    settled = true;
  }, 10000);
  const handler = (event) => {
    if (settled) return;
    if (event.detail?.path !== path) return;
    settled = true;
    clearTimeout(timeoutId);
    viewer.removeEventListener('active-file-changed', handler);
    // Step 1 — presentation mode. Run idempotently
    // so a false value (the default) doesn't toggle
    // out of presentation if the viewer happened to
    // be in it already.
    if (typeof viewer.setPresentation === 'function') {
      try {
        viewer.setPresentation(!!svgState.presentation);
      } catch (err) {
        console.debug(
          '[app-shell] presentation restore failed', err,
        );
      }
    }
    // Step 2 — viewBox. Wrap in try/catch and wait
    // one frame so the presentation-mode refit (which
    // runs in requestAnimationFrame inside
    // _togglePresentation) lands before we overwrite
    // its viewBox. Without the deferral, our
    // setViewBox would race with presentation's
    // fitContent and whichever ran last would win.
    requestAnimationFrame(() => {
      if (typeof viewer.setActiveViewBox !== 'function') return;
      try {
        viewer.setActiveViewBox(svgState.viewBox);
      } catch (err) {
        console.debug(
          '[app-shell] SVG viewBox restore failed', err,
        );
      }
    });
  };
  viewer.addEventListener('active-file-changed', handler);
}

/**
 * Restore scroll position and cursor on the diff
 * viewer's modified editor. Polls up to 20 animation
 * frames for the editor to be ready (it's created
 * asynchronously after the file content fetch
 * completes).
 *
 * When `preview` is non-null the caller has already
 * opened the preview pane via `setPreviewMode(true)`.
 * After the editor's own scroll lands, we hand off
 * to the viewer's `restorePreviewScrollTop`, which
 * waits one more frame before writing the preview
 * pane's scrollTop — the markdown/TeX pipeline may
 * still be mid-render when the editor scroll
 * settles, and scrolling an empty pane would snap
 * back to 0 once the content actually populates.
 */
export function restoreViewport(host, viewer, state, preview) {
  let attempts = 0;
  const maxAttempts = 20;
  const finishPreview = () => {
    if (!preview || !preview.open) return;
    if (typeof viewer.restorePreviewScrollTop !== 'function') return;
    try {
      viewer.restorePreviewScrollTop(preview.scrollTop || 0);
    } catch (err) {
      console.debug(
        '[app-shell] preview scroll restore failed', err,
      );
    }
  };
  const tryRestore = () => {
    attempts += 1;
    const modifiedEditor = viewer._getModifiedEditor?.();
    if (!modifiedEditor) {
      if (attempts < maxAttempts) {
        requestAnimationFrame(tryRestore);
      }
      return;
    }
    // Wait for diff ready, then set position + scroll.
    if (typeof viewer._waitForDiffReady === 'function') {
      viewer._waitForDiffReady().then(() => {
        try {
          modifiedEditor.setPosition?.({
            lineNumber: state.lineNumber || 1,
            column: state.column || 1,
          });
          modifiedEditor.setScrollTop?.(state.scrollTop || 0);
          modifiedEditor.setScrollLeft?.(state.scrollLeft || 0);
        } catch (_) {}
        finishPreview();
      });
    } else {
      try {
        modifiedEditor.setPosition?.({
          lineNumber: state.lineNumber || 1,
          column: state.column || 1,
        });
        modifiedEditor.setScrollTop?.(state.scrollTop || 0);
        modifiedEditor.setScrollLeft?.(state.scrollLeft || 0);
      } catch (_) {}
      finishPreview();
    }
  };
  requestAnimationFrame(tryRestore);
}

/**
 * Diff viewer told us preview-mode toggled. Save the
 * viewport immediately so a reload right after the
 * toggle restores the correct pane state. The save-
 * triggers table in specs-reference/5-webapp/shell.md
 * pins this as a standalone save point — distinct
 * from beforeunload and from the pre-navigate save.
 */
export function onPreviewModeChanged(host, _event) {
  try {
    saveViewportState(host);
  } catch (err) {
    // Don't let a broken save trip later event
    // handlers — preview toggle is cheap and can
    // always be recaptured on the next save trigger.
    console.debug(
      '[app-shell] viewport save on preview toggle failed', err,
    );
  }
}

/**
 * SVG viewer emitted viewbox-changed (wheel zoom,
 * pan, fit). Debounce saves so a continuous gesture
 * (wheel burst, drag) produces one save at the end
 * rather than dozens per frame.
 *
 * 150 ms per the save-triggers table. Shorter than a
 * smooth-scroll animation and longer than a single
 * wheel tick; captures the "settled" viewBox. The
 * beforeunload save runs synchronously and bypasses
 * the debounce so a reload right after the last
 * gesture still persists the final state.
 */
export function onSvgViewBoxChanged(host, _event) {
  if (host._svgViewBoxSaveTimer) {
    clearTimeout(host._svgViewBoxSaveTimer);
  }
  host._svgViewBoxSaveTimer = setTimeout(() => {
    host._svgViewBoxSaveTimer = null;
    try {
      saveViewportState(host);
    } catch (err) {
      console.debug(
        '[app-shell] viewport save on viewbox change failed', err,
      );
    }
  }, 150);
}

/**
 * SVG viewer toggled presentation mode. Same pattern
 * as preview-mode-changed — save immediately, no
 * debounce (the toggle is a single user gesture, not
 * a continuous stream).
 */
export function onSvgPresentationChanged(host, _event) {
  try {
    saveViewportState(host);
  } catch (err) {
    console.debug(
      '[app-shell] viewport save on presentation toggle failed',
      err,
    );
  }
}