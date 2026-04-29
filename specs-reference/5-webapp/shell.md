# Reference: App Shell

**Supplements:** `specs4/5-webapp/shell.md`

## Numeric constants

### Dialog dimensions

| Constant | Value |
|---|---|
| Default mode | Docked left (top/left/bottom anchored to viewport edges) |
| Default docked width | 50% of viewport |
| Minimum docked width override | 400 px |
| Minimum dialog width | 300 px (enforced by JS clamp, not CSS min-width) |
| Minimum dialog height | 200 px (undocked only; docked uses full viewport height) |
| Visible-margin safety | 100 px must remain visible on both X and Y axes when undocked |

### Resize handles

| Handle | Hit zone | Axis | Undock behavior |
|---|---|---|---|
| Right edge | 8 px wide, extends 4 px past border | Width only | Stays docked; writes `ac-dc-dialog-width` |
| Bottom edge | 8 px tall | Height only | Auto-undocks; writes full `ac-dc-dialog-pos` rectangle |
| Bottom-right corner | 14 × 14 px | Width + height | Auto-undocks; writes full `ac-dc-dialog-pos` rectangle |

### Drag behavior

| Constant | Value |
|---|---|
| Drag threshold | 5 px pointermove distance before undocking |
| Header is drag handle | `cursor: grab` on bare header; buttons inside (tabs, minimize) override with normal cursor |
| Undock trigger | First drag past threshold OR first bottom/corner resize |

### Reconnect backoff

```
[1000, 2000, 4000, 8000, 15000] milliseconds
```

See `specs-reference/6-deployment/startup.md` § Reconnection backoff schedule for the full policy. Attempt counter resets to 0 on successful `setupDone`.

### Startup overlay

| Constant | Value |
|---|---|
| Fade duration after `ready` stage | 400 ms |
| Doc-index stage filtering | Stages routed to header progress bar, not startup overlay |
| Reconnect behavior | Never show overlay; show "Reconnected" toast only |

### Global keyboard shortcuts

| Shortcut | Action |
|---|---|
| Alt+1 | Switch to Files tab |
| Alt+2 | Switch to Context tab |
| Alt+3 | Switch to Settings tab |
| Alt+4 | Switch to Doc Convert tab (gated on `_docConvertAvailable`) |
| Alt+M | Toggle dialog minimize |
| Ctrl+Shift+F | Activate file search in Files tab, prefill from text selection |

Alt+digit shortcuts call `preventDefault()` even on the no-op case (Alt+4 when doc-convert unavailable) to prevent browser-chrome shortcuts from grabbing the keystroke.

Alt+1..4 and Alt+M are handled at document bubble phase. They intentionally use digit/M keys rather than arrow keys to avoid conflict with the file navigation grid's Alt+Arrow (capture phase).

### Ctrl+Shift+F selection capture

**Critical:** The text selection must be read synchronously as the very first operation in the keydown handler, before any asynchronous work (Lit property updates, `updateComplete.then`, `requestAnimationFrame`, RPC calls).

```js
_onKeyDown(e) {
  if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    const sel = window.getSelection()?.toString()?.trim() || '';
    this._switchTab('files');
    this.updateComplete.then(() => {
      // Use the CAPTURED sel, not a fresh getSelection() call
      chatPanel.activateFileSearch(
        sel && !sel.includes('\n') ? sel : ''
      );
    });
  }
}
```

Focus changes between tab switch and search activation clear the selection. Reading it later returns empty. Multi-line selections are discarded (file search is single-line by design).

### Window resize handling

| Constant | Value |
|---|---|
| Resize throttling | One call per animation frame (per handler) |
| Dialog resize handle | `_resizeRAF` pending flag |
| Viewer relayout handle | `_viewerRelayoutRAF` pending flag (separate from `_resizeRAF` so drag-resize and window-resize don't cancel each other's pending frames) |

Without throttling, rapid resize events cause feedback loops: scroll → layout shift → resize → `layout()` → forced reflow → visible jank.

### Proportional rescaling baselines

Used by the "same fraction of viewport" rule in `specs4/5-webapp/shell.md` § Proportional Rescaling.

| Field | Type | Purpose |
|---|---|---|
| `_dockedWidthViewport` | integer px | `window.innerWidth` at the moment `_dockedWidth` was committed. Drives the scale ratio for docked-with-custom-width resizes. |
| `_undockedPosViewport` | `{w, h}` integer px | `window.innerWidth` and `window.innerHeight` at the moment `_undockedPos` was committed. Drives the per-axis scale ratio for undocked resizes. |

Both baselines are updated at three points:

1. User pointerup after a right-edge resize (`_dockedWidthViewport`), drag (`_undockedPosViewport`), or bottom/corner resize (`_undockedPosViewport`).
2. After each resize-driven rescale completes — the just-captured viewport becomes the new baseline so subsequent resize events chain correctly against "now", not against the original commit.
3. At construction — initialised to `window.innerWidth` / `window.innerHeight` so the very first resize after page load scales from the current viewport, not from an implicit zero.

Baselines are in-memory state only (not persisted). On page reload they re-initialise from the current viewport; the first post-reload resize scales from that point. This means stored geometry doesn't drift across sessions — the dialog reopens at its saved pixel-literal values — but the first resize after reload may visibly "reset" the scaling reference. Acceptable trade-off: persisting the baseline would require storing an extra pair of viewport dimensions for every state change, and the drift from not persisting is bounded by the size of a single resize gesture.

The formula is `scaled = round(stored_pixels * current_viewport / baseline_viewport)` on each axis independently, followed by clamp to `[_DIALOG_MIN_WIDTH, viewport - _DIALOG_VISIBLE_MARGIN]` for width and analogous bounds for the other dimensions.

## Schemas

### localStorage keys

| Key | Type | Purpose |
|---|---|---|
| `ac-dc-active-tab` | `"files"` / `"context"` / `"settings"` / `"doc-convert"` | Last-selected tab (unknown values fall back to `"files"`) |
| `ac-dc-minimized` | `"true"` / `"false"` | Dialog minimize state |
| `ac-dc-dialog-width` | integer px (string) | Docked-mode width override (absent until first right-edge resize while docked) |
| `ac-dc-dialog-pos` | JSON `{left, top, width, height}` | Full undocked rectangle (absent until first drag past threshold or first bottom/corner resize) |
| `ac-last-open-file` | string (file path) | Last-opened file for restore on reload |
| `ac-last-viewport` | JSON `{path, type, diff?: {...}, preview?: {open, scrollTop}, svg?: {viewBox, presentation}}` | Last viewport state of the last-opened file. The `type` field discriminates restore routing: `"diff"` routes to the diff viewer (Monaco), `"svg"` routes to the SVG viewer. For `.svg` paths, `type` reflects which viewer the user last had active — a user who toggled to text diff gets `type: "diff"` and a `diff` block; a user editing visually gets `type: "svg"` and an `svg` block. The blocks are mutually exclusive in practice; schema permits both for future mixed-mode viewers but only one is read per restore. `diff` shape: `{scrollTop, scrollLeft, lineNumber, column}`. `preview` shape: `{open: boolean, scrollTop: px}` — present only for markdown/TeX; restore treats missing as false. `svg` shape: `{viewBox: {x, y, width, height}, presentation: boolean}` — present only when `type === "svg"`; `viewBox` values are in SVG user units (matches `SvgEditor.getViewBox()`), `presentation` is whether the right pane was full-width with the left pane collapsed. Unknown or absent branches mean the feature wasn't used — restore treats missing as the default (no preview, no presentation, no SVG block). |
| `ac-dc-enrichment-unavailable-shown` | `"true"` | One-shot flag suppressing the enrichment-unavailable warning toast across browser sessions |

**Repo-scoped keys:** `ac-last-open-file` and `ac-last-viewport` use a `_repoKey(key, repoName)` helper producing `{key}:{repoName}`. Prevents opening a different repo from restoring the wrong file. Falls back to the bare key when repo name not yet known.

Keys are read synchronously in the constructor (not in `connectedCallback`) so first paint doesn't flash defaults before jumping to stored values.

Width and position are independent — resizing the right edge while docked writes only `ac-dc-dialog-width`, leaving any stored undocked rectangle alone.

Malformed values (non-JSON, wrong shape, width below minimum, non-finite numbers) are treated as absent.

### File viewport state save triggers

| Trigger | Save scope |
|---|---|
| `beforeunload` | Save current viewport state — diff scroll/cursor OR svg viewBox/presentation, plus preview toggle/scroll |
| Before navigating to a different file | Save outgoing file's viewport |
| `active-file-changed` from either viewer | Save alone — the viewer has just reported a file is live, so the `type` discriminator (svg vs diff) becomes known. Without this, opening a file and reloading without further interaction leaves the stored viewport describing the *previous* file, and the restore short-circuits on path mismatch. The save is additive: when the viewer's editors aren't yet attached (SVG: `getActiveViewBox()` returns null; diff: no modified editor yet), the save no-ops via the same try/catch guards that protect the other paths, so it can't clobber a live stored viewBox. First real gesture or Monaco attach produces a follow-up save that fills in the geometry block |
| Preview toggle (on/off) | Save alone — capturing the toggle immediately means a reload right after a toggle-then-nothing still restores the correct pane |
| SVG viewBox change (pan, zoom, fit, presentation-mode refit) | Debounced save — the viewer emits `viewbox-changed` on every right-editor `onViewChange`; the shell coalesces via a short debounce so a wheel-zoom burst doesn't produce one write per frame |
| SVG presentation-mode toggle | Save alone — same reasoning as preview toggle |
| SVG ↔ text diff toggle (`toggle-svg-mode`) | Save alone — flips which viewer is reflected in the stored `type`, so a reload right after the toggle restores the intended view. Redundant with the `active-file-changed` save trigger (the swap fires `active-file-changed` on the target viewer), but kept as belt-and-braces against any future refactor that might bypass the active-file event |

Save wraps Monaco layout queries, preview-scroll reads, and SvgEditor viewBox reads in try/catch. A diff editor on a detached DOM, a markdown preview mid-render, or an SVG editor with a partially-disposed CTM can each throw from inside their respective read path; the file navigation must not block on a broken save.

The preview fields are only written for files whose type has a preview toggle (markdown, TeX). Writing `preview: {open: false, scrollTop: 0}` for every plain file would bloat the stored JSON without expressing anything; omitting the key entirely keeps "no preview" and "preview closed" distinguishable in logs and future schema migrations. The same omission rule applies to `svg` — written only when the active viewer is the SVG viewer.

**SVG viewBox debounce window.** 150 ms after the last `viewbox-changed` event. Shorter than the smooth-scroll animation time and longer than a single wheel tick; captures the user's "settled" viewBox rather than every intermediate frame. The final write on `beforeunload` is not debounced — it runs synchronously so the last write survives a page reload.

### Restore flow

File reopen is deferred until the startup overlay dismisses (on `startupProgress("ready")` or when `init_complete` is true on reconnect). File-fetch RPCs during heavy init would block the server's event loop — synchronous `git show` subprocess calls can starve WebSocket pings and cause disconnects.

1. Read `ac-last-open-file` from localStorage
2. If startup overlay still visible, set `_pendingReopen = true` and return
3. When overlay dismisses, proceed
4. Read `ac-last-viewport` and verify `viewport.path === fileToRestore`
5. Dispatch `navigate-file` event to re-open. Routing happens via the path's extension — `.svg` paths land on the SVG viewer, everything else on the diff viewer
6. Branch on `viewport.type`:
   - `type === "diff"` → register one-shot `active-file-changed` listener on the diff viewer
   - `type === "svg"` → register one-shot `active-file-changed` listener on the SVG viewer
   - For the `.svg` path + `type === "diff"` case (user had toggled to text diff), the navigate-file already routed to the diff viewer based on extension, so the diff listener catches it naturally. No follow-up `toggle-svg-mode` dispatch is needed on restore — the stored `type` determines which viewer registered interest
7. When file opens, use double-rAF to wait for editor readiness
8. For diff `type`: if `viewport.preview?.open` is true, toggle the preview pane before restoring scroll — Monaco's editor and the preview element are separate scroll surfaces, so the editor-scroll restore in step 9 would target the wrong element if preview hadn't been opened first
9. For diff `type`: call `restoreViewportState()` — cursor position, reveal line, editor scroll offsets. Polls up to 20 animation frames for Monaco editor readiness. If `viewport.preview?.open` is true and `viewport.preview.scrollTop` is non-zero, restore the preview pane's `scrollTop` on the next animation frame after the editor scroll settles
10. For svg `type`:
    - If `viewport.svg.presentation === true`, toggle presentation mode before writing viewBox. Presentation mode changes the right pane's width (left pane collapsed to zero), and the viewBox we saved was framed against that layout. Applying viewBox first would frame against the two-pane layout and the content would re-fit after the presentation toggle
    - Write `viewport.svg.viewBox` to the right editor via the viewer's `setActiveViewBox`. The sync-mirror writes the same viewBox to the left editor silently. Wrap in try/catch — an SvgEditor with a not-yet-attached root can throw from `setViewBox` and the restore should degrade to "fit-content default" rather than crashing
    - No polling equivalent to Monaco's 20-frame loop — the SVG editors attach synchronously in `_initEditors` after the first `_injectSvgContent` call, which runs in the same `updated()` lifecycle as the navigate-file handler. By the time `active-file-changed` fires, the editors exist. Defensive guard anyway — if `_editorRight` is still null, skip the write and let fit-content stand
11. 10-second timeout removes the listener if the file never opens (deleted, etc.)

## Cross-references

- Behavioral specification: `specs4/5-webapp/shell.md`
- Reconnection backoff and startup progress: `specs-reference/6-deployment/startup.md`
- Token HUD integration: `specs-reference/5-webapp/viewers-hud.md`
- File navigation grid (Alt+Arrow capture-phase handler): `specs-reference/5-webapp/file-navigation.md`