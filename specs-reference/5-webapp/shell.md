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

## Schemas

### localStorage keys

| Key | Type | Purpose |
|---|---|---|
| `ac-dc-active-tab` | `"files"` / `"context"` / `"settings"` / `"doc-convert"` | Last-selected tab (unknown values fall back to `"files"`) |
| `ac-dc-minimized` | `"true"` / `"false"` | Dialog minimize state |
| `ac-dc-dialog-width` | integer px (string) | Docked-mode width override (absent until first right-edge resize while docked) |
| `ac-dc-dialog-pos` | JSON `{left, top, width, height}` | Full undocked rectangle (absent until first drag past threshold or first bottom/corner resize) |
| `ac-last-open-file` | string (file path) | Last-opened file for restore on reload |
| `ac-last-viewport` | JSON `{path, type, diff: {scrollTop, scrollLeft, lineNumber, column}}` | Last viewport state of the last-opened file |
| `ac-dc-enrichment-unavailable-shown` | `"true"` | One-shot flag suppressing the enrichment-unavailable warning toast across browser sessions |

**Repo-scoped keys:** `ac-last-open-file` and `ac-last-viewport` use a `_repoKey(key, repoName)` helper producing `{key}:{repoName}`. Prevents opening a different repo from restoring the wrong file. Falls back to the bare key when repo name not yet known.

Keys are read synchronously in the constructor (not in `connectedCallback`) so first paint doesn't flash defaults before jumping to stored values.

Width and position are independent — resizing the right edge while docked writes only `ac-dc-dialog-width`, leaving any stored undocked rectangle alone.

Malformed values (non-JSON, wrong shape, width below minimum, non-finite numbers) are treated as absent.

### File viewport state save triggers

| Trigger | Save scope |
|---|---|
| `beforeunload` | Save current viewport state |
| Before navigating to a different file | Save outgoing file's viewport |
| SVG files | Excluded (SVG zoom restore not yet supported) |

Save wraps Monaco layout queries in try/catch so the file navigation never blocks on a throw from a detached-DOM editor.

### Restore flow

File reopen is deferred until the startup overlay dismisses (on `startupProgress("ready")` or when `init_complete` is true on reconnect). File-fetch RPCs during heavy init would block the server's event loop — synchronous `git show` subprocess calls can starve WebSocket pings and cause disconnects.

1. Read `ac-last-open-file` from localStorage
2. If startup overlay still visible, set `_pendingReopen = true` and return
3. When overlay dismisses, proceed
4. Read `ac-last-viewport` and verify `viewport.path === fileToRestore`
5. Dispatch `navigate-file` event to re-open
6. For diff files with saved viewport, register a one-shot `active-file-changed` listener filtered to the target path
7. When file opens, use double-rAF to wait for editor readiness
8. Call `restoreViewportState()` — cursor position, reveal line, scroll offsets
9. `restoreViewportState()` polls up to 20 animation frames for Monaco editor readiness
10. 10-second timeout removes the listener if the file never opens (deleted, etc.)

## Cross-references

- Behavioral specification: `specs4/5-webapp/shell.md`
- Reconnection backoff and startup progress: `specs-reference/6-deployment/startup.md`
- Token HUD integration: `specs-reference/5-webapp/viewers-hud.md`
- File navigation grid (Alt+Arrow capture-phase handler): `specs-reference/5-webapp/file-navigation.md`