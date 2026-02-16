# SVG Viewer

## Overview

A side-by-side SVG diff viewer for `.svg` files. Replaces the Monaco diff editor when an SVG file is opened. Uses `svg-pan-zoom` for native SVG viewBox manipulation — stays crisp at any zoom level. Both panels are synchronized: pan or zoom one and the other follows.

## Routing

The app shell inspects the file extension on every `navigate-file` event:

| Extension | Viewer |
|-----------|--------|
| `.svg` | `<ac-svg-viewer>` |
| All others | `<ac-diff-viewer>` (Monaco) |

Both viewers live in the same background layer as absolutely positioned siblings. CSS classes (`viewer-visible` / `viewer-hidden`) toggle `opacity` and `pointer-events` with a 150ms transition. When either viewer dispatches `active-file-changed`, the app shell activates the correct layer based on the active file's extension.

### Event Flow

```
File picker click → navigate-file event
    │
    ├─ .svg extension? → ac-svg-viewer.openFile()
    │                     Show SVG viewer, hide diff viewer
    │
    └─ other extension? → ac-diff-viewer.openFile()
                          Show diff viewer, hide SVG viewer
```

Both viewers maintain independent tab state. Switching between an open `.svg` tab and an open `.js` tab toggles the viewer layer.

## Layout

```
┌──────────────────────────────────────────────────┐
│ [sample.svg ×] [diagram.svg ×]        Tab bar    │
├────────────────────┬─┬───────────────────────────┤
│    Original        │ │    Modified               │
├────────────────────┤ ├───────────────────────────┤
│                    │ │                           │
│   ┌──────────┐    │ │    ┌──────────┐           │
│   │  SVG     │    │ │    │  SVG     │           │
│   │ content  │    │ │    │ content  │           │
│   └──────────┘    │ │    └──────────┘           │
│                    │ │                           │
├────────────────────┴─┴───────────────────────────┤
│  [−]  100%  [+]  [1:1]  [Fit]        Toolbar    │
└──────────────────────────────────────────────────┘
```

### Panels

- **Left panel**: Original SVG (HEAD version). Header: "Original" (or "Original (empty)" for new files)
- **Right panel**: Modified SVG (working copy). Header: "Modified"
- A 4px splitter handle separates the panels (hover highlights with accent color)
- Both panels are read-only — SVGs are not editable in-place

### Empty State

When no SVG files are open, the viewer shows the AC⚡DC watermark (8rem, 18% opacity), matching the diff viewer's empty state.

## File Tabs

Tab bar matching the diff viewer style:

- File name (basename only)
- Status badge: **N** (new file, cyan), **Δ** (changed, orange), **=** (identical, green)
- Close button (✕)
- Active tab has accent bottom border

### Status Detection

| Badge | Condition |
|-------|-----------|
| N (new) | File does not exist in HEAD |
| Δ (changed) | Original content differs from modified |
| = (same) | Original and modified are identical |

## Synchronized Pan/Zoom

Both panels use `svg-pan-zoom` with synchronized state:

| Feature | Detail |
|---------|--------|
| Mouse wheel | Zoom in/out |
| Click-drag | Pan |
| Double-click | Zoom in at point |
| Pinch gesture | Zoom (touch devices) |
| Min zoom | 0.1× |
| Max zoom | 40× |

### Synchronization

When the user interacts with either panel:
1. The source panel's zoom level and pan position are read
2. The other panel is updated to match
3. A guard flag (`_syncing`) prevents infinite callback loops
4. The toolbar zoom percentage label updates

### Shadow DOM Compatibility

`svg-pan-zoom` operates on SVG elements obtained via `shadowRoot.querySelector()`. Initialization is wrapped in a try/catch — if `svg-pan-zoom` fails (e.g., Shadow DOM isolation issues), the SVGs are still visible and scrollable, just without interactive pan/zoom.

## Toolbar

A bottom toolbar with zoom controls:

| Button | Action |
|--------|--------|
| − | Zoom out (propagates via sync callback) |
| % label | Current zoom percentage (read-only) |
| + | Zoom in |
| 1:1 | Reset to 100% zoom and center position |
| Fit | Fit SVG to panel dimensions |

## SVG Content Injection

SVG content cannot be rendered via Lit templates (Lit doesn't natively handle raw SVG string injection). Instead:

1. `render()` creates empty `.svg-left` and `.svg-right` container divs
2. `_injectSvgContent()` sets `innerHTML` on each container with the SVG string
3. After injection, SVG elements are normalized:
   - `width`/`height` attributes removed (so SVG fills container)
   - `style.width` and `style.height` set to `100%`
   - `viewBox` attribute added if missing (computed from the original `width` and `height` attributes before they are removed — e.g., `width="200" height="100"` becomes `viewBox="0 0 200 100"`)
4. `svg-pan-zoom` is initialized on the injected SVG elements via `requestAnimationFrame`

**Retry on next frame**: If the `.svg-left` / `.svg-right` containers are not yet in the shadow DOM when `_injectSvgContent()` runs (due to Lit render timing — the method may be called from `updated()` before the template has committed), it schedules a retry via `requestAnimationFrame`. This ensures injection succeeds even when called during the Lit update lifecycle before the DOM reflects the latest template.

## File Content Fetching

Content is fetched via the same RPC methods as the diff viewer:

| Version | RPC Call | Fallback |
|---------|----------|----------|
| HEAD (original) | `Repo.get_file_content(path, 'HEAD')` | Empty string (file is new) |
| Working copy (modified) | `Repo.get_file_content(path)` | Empty string (file deleted) |

Each call is wrapped in its own try/catch — a failure in one (e.g., file doesn't exist in HEAD) doesn't prevent the other from loading. The response is normalized to a string regardless of whether the RPC returns a string or `{content: string}` object.

## Public API

Mirrors the diff viewer's interface so the app shell can treat both uniformly:

| Method | Description |
|--------|-------------|
| `openFile(opts)` | Open or switch to an SVG file. Fetches content if not provided |
| `refreshOpenFiles()` | Re-fetch content for all open files (post-edit refresh) |
| `closeFile(path)` | Close a tab, dispose pan/zoom, update active index |
| `getDirtyFiles()` | Returns empty array (SVGs are read-only) |

### `openFile(opts)`

```pseudo
opts:
    path: string          // Required
    original: string?     // SVG content for left panel
    modified: string?     // SVG content for right panel
    is_new: boolean?      // Whether file is new (no HEAD version)
```

If `original` and `modified` are not provided, content is fetched via RPC. If the file is already open, its tab is activated without re-fetching.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+PageDown | Next tab |
| Ctrl+PageUp | Previous tab |
| Ctrl+W | Close active tab |

## Resize Handling

A `ResizeObserver` on the diff container calls `svg-pan-zoom.resize()` on both panels when the container dimensions change (e.g., dialog resize, browser window resize).

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `svg-pan-zoom` | ^3.6.1 | Native SVG viewBox pan/zoom with mouse, touch, and wheel support |

## Integration with Existing Systems

### App Shell

The app shell manages viewer visibility:
- Both `<ac-diff-viewer>` and `<ac-svg-viewer>` are children of `.diff-background`
- On `navigate-file`: check extension, toggle `viewer-visible`/`viewer-hidden` classes
- On `active-file-changed`: activate the correct viewer layer
- On `stream-complete` with `files_modified`: call `refreshOpenFiles()` on both viewers
- On `files-modified` (commit, reset): call `refreshOpenFiles()` on both viewers if they have open files

### File Picker

No changes needed. The file picker dispatches `navigate-file` events for all file types — the app shell handles routing.

### Search Tab

Search results for `.svg` files route through the same `navigate-file` → app shell → SVG viewer path.

### Edit Blocks

LLM edit blocks for `.svg` files are applied normally (text-based edits). After application, `refreshOpenFiles()` updates the SVG viewer's content if the file is open.

## Future Enhancements

### Visual Diff Overlay

A translucent overlay mode showing both SVGs superimposed with difference highlighting (pixel-diff or structural SVG diff).

### SVG Element Inspection

Click on an SVG element to see its attributes, path data, and position in the SVG DOM tree.

### Inline Editing

Allow editing the SVG source in a Monaco editor panel alongside the rendered view, with live preview updates.

### Export

Export the current view (zoomed/cropped) as PNG or PDF.