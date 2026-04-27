# SVG Viewer
**Status:** stub
Side-by-side SVG diff viewer for SVG files. Replaces the Monaco diff editor when an SVG file is opened. Both panels use the same visual editor component — the left pane in read-only mode for reference navigation, the right pane editable. Pan and zoom act directly on the SVG viewBox and stay crisp at any zoom level. Both panels are synchronized: pan or zoom one and the other follows. Right panel supports visual editing (move, resize, vertex edit, inline text edit, multi-selection).
## Routing
The app shell inspects the file extension on every navigate-file event:
| Extension | Viewer |
|---|---|
| SVG | SVG viewer |
| All others | Diff viewer (Monaco) |
Both viewers live in the same background layer as absolutely positioned siblings. CSS classes toggle opacity and pointer events with a short transition. When either viewer dispatches active-file-changed, the app shell activates the correct layer based on the active file's extension.
## Layout
### Normal Layout (Select / Pan Mode)
- Two side-by-side SVG panels with a resizable splitter
- Left — original SVG (HEAD version), always read-only, pan/zoom navigation
- Right — modified SVG (working copy), editable in select mode, read-only navigation in pan mode
- Floating overlay buttons in corners — status LED, presentation mode toggle, fit button, text-diff toggle
### Presentation Layout
- Left panel and splitter hidden; right panel expands to full width
- Editor remains active — all editing operations continue to work
- Left panel's SVG content not injected and its pan/zoom instance not initialized (no wasted work on a hidden element)
- Toggled via button or keyboard shortcut
### Empty State
- Same watermark as diff viewer when no SVG files open
## File Tabs
Internal multi-file tracking without a visible tab bar, same pattern as diff viewer. Status LED communicates file state.
### Status Detection
| LED State | Condition |
|---|---|
| Dirty (orange pulsing) | Modified content differs from last saved content |
| New file (cyan) | File does not exist in HEAD |
| Clean (green) | No unsaved changes |
## Interaction Modes
Two modes switchable programmatically:
| Mode | Left panel | Right panel | Purpose |
|---|---|---|---|
| Select (default) | Read-only editor (navigation only) | Editable editor | Edit SVG elements by dragging, resizing, typing |
| Present | Hidden | Editable editor, full width | Full-width editor with left panel hidden |
- Both panels are instances of the same visual editor class — the left is constructed with a read-only flag that disables selection, handles, marquee, keyboard shortcuts, and double-click-to-edit. Only pan and zoom remain active on the left pane
- Mode switch captures current editor content, disposes active handlers, reinitializes for new mode. The viewer starts in select mode and stays there in practice
## Synchronized Pan/Zoom
Both panels maintain synchronized viewports.
| Input | Behavior |
|---|---|
| Mouse wheel | Zoom in/out centered on cursor |
| Middle-click drag | Pan (both panels) |
| Plain drag on empty space, left pane | Pan (read-only pane has no other use for plain drag) |
| Plain drag on empty space, right pane | Start marquee selection (editable pane) |
| Double-click on a text element, right pane | Enter inline text edit |
| Pinch gesture | Zoom (touch devices) |
| Min/max zoom | Constrained to sensible bounds |
### Synchronization
- Both panels are editor instances that manipulate their own viewBox
- Each editor fires an on-view-change callback after any viewBox write (from wheel zoom, pan, fit-content, or external set-view-box)
- The viewer wires each editor's on-view-change to call the other editor's set-view-box
- A mutex flag is held during the mirrored write so the callback on the receiving editor bails out without echoing back — breaks feedback loops
- Programmatic viewBox writes from the viewer (e.g., fit button resetting both panes) also set the mutex so neither side ping-pongs
### Shadow DOM Compatibility
- The editor operates on SVG elements obtained via shadow-root queries
- All coordinate math uses native browser APIs (get-screen-CTM, create-SVG-point, matrix transforms) which work uniformly inside shadow DOM
- No third-party pan/zoom library is involved, eliminating a class of shadow-DOM isolation failures that previous designs had to guard against
## SVG Editing (Select Mode)
Right panel uses the visual editor; left panel remains read-only for reference.
### Element Selection
- Click an SVG element to select; bounding box with handles appears around it
- Click empty space or press Escape to deselect
- Clicking a tspan resolves to its parent text element — tspan never selected independently
### Multi-Selection
Hold Shift and click or drag to multi-select:
| Interaction | Behavior |
|---|---|
| Shift+click on selected element | Immediately remove from multi-selection |
| Shift+click on unselected element | Immediately add to multi-selection, begin marquee tracking |
| Shift+click on empty space | Begin marquee selection |
| Shift+drag top-left to bottom-right (forward) | Containment mode — solid border, selects only elements fully inside |
| Shift+drag any other direction (reverse) | Crossing mode — dashed border, selects any elements that touch or intersect |
- Marquee hit testing checks direct children of the root SVG and one level of children inside groups; deeper nesting not scanned
- Shift+click toggles elements immediately without waiting for pointer-up
- Multi-selected elements can be dragged as a group
### Supported Operations
| Operation | Interaction | Supported elements |
|---|---|---|
| Move | Drag selected element | All visible elements |
| Resize | Drag corner/edge handles | Rectangles, circles, ellipses |
| Vertex edit | Drag individual vertex handles | Polylines, polygons, paths |
| Line endpoint edit | Drag endpoint handles | Lines |
| Inline text edit | Double-click a text element | Text elements |
| Copy | Ctrl+C | Any selected element |
| Paste | Ctrl+V | Pastes with slight offset |
| Duplicate | Ctrl+D | Selected element in place |
| Delete | Delete or Backspace | Any selected element |
| Zoom | Mouse wheel | Manipulates SVG viewBox directly |
| Pan | Drag on empty space | Translates SVG viewBox |
### Inline Text Editing
- Double-clicking a text element opens a foreign-object textarea overlay positioned at the text's bounding box
- Textarea matches the text's font size and color
- Enter confirms the edit (updating the text element's content), Escape cancels
- Only one text edit active at a time — starting a new edit commits the previous one
### Handles
Selection handles rendered as a dedicated SVG group overlaid on the selected element:
- Bounding box (dashed rectangle)
- Corner handles (resize for shape elements)
- Vertex handles (point editing for polylines, polygons)
- Path handles (circles at each command endpoint, dotted lines to control points for curves)
- Handle radius scales inversely with zoom level to maintain consistent screen size
- Handle positions account for ancestor group transforms so overlays align with visually-rendered element position regardless of nesting
### Coordinate Math
SVG editing requires translating between three coordinate systems:
1. Screen coordinates — raw pointer event coordinates
2. SVG root coordinates — the viewBox coordinate space of the root SVG
3. Element-local coordinates — the coordinate space inside an element's parent group transforms
- Screen-to-SVG — invert the composed screen CTM to convert pointer events into viewBox units
- Element-local-to-SVG-root — compose inverse of root CTM with element's CTM, so handles for elements inside transformed groups align with visual position
- Handle size constancy — handles should appear at a constant screen size regardless of zoom; handle radius in SVG units is computed inversely to the current zoom
### Hit-Test Exclusion
Handle elements and the marquee rectangle must be ignored when finding the SVG element under the pointer:
- All handle overlays marked with a class; handle group has a known id
- Hit test uses elements-from-point and skips handle-classed elements, the handle group, and the root SVG itself
- Tags that never participate in editing also filtered (defs, style, metadata, filter, gradients, clipPath, mask, marker, pattern, symbol)
Without this filtering, clicking a handle would re-hit-test to the underlying element and start a drag on that element instead.
### Interaction Model by Element
| Element | Drag behavior | Handle behavior |
|---|---|---|
| Rectangle | Translate position | Resize width/height |
| Circle | Translate center | Resize radius |
| Ellipse | Translate center | Resize radii |
| Line | Translate both endpoints | Move individual endpoints |
| Polyline, polygon | Translate all points | Move individual vertices |
| Path | Translate via transform | Move individual path points |
| Text | Translate via transform or position attribute (auto-detected) | Double-click to edit |
| Group | Translate via transform | — |
### Path Command Parsing
- Path editing parses the path data attribute into editable command objects
- Handles all path commands in absolute and relative forms
- Control point extraction tracks pen position, extracting draggable points per command type
- When a handle is dragged, the delta is applied to the original relative arg values so overall path shape is preserved
- Serialization rounds to reasonable precision and joins commands with spaces
### Preserve Aspect Ratio Override
- Both panels get an explicit "preserve aspect ratio: none" attribute on the root SVG after injection
- Without this override, the browser applies default fitting (letterboxing or pillarboxing) to make the viewBox fit the container while preserving aspect ratio — which means a screen pixel inside the SVG element's client rect does not map 1:1 to a viewBox unit along one axis
- The editor's cursor-to-viewBox conversion uses the SVG's screen CTM, which correctly accounts for that browser-applied fitting; so strict correctness doesn't require this override
- But disabling browser-side fitting makes the SVG viewBox the single source of truth for what's visible. The fit-content method is then responsible for ensuring the viewBox aspect ratio matches the container — by expanding the shorter axis — so content isn't stretched
- Applying the override uniformly to both panels keeps coordinate math and fit logic symmetric across left and right
### Marquee Visual Feedback
Marquee rectangle's appearance changes based on drag direction to signal the selection mode:
| Direction | Fill | Stroke | Dash | Meaning |
|---|---|---|---|---|
| Forward (left → right, top → bottom) | Light tint | Solid border | None | Containment — must be fully inside |
| Reverse (any other direction) | Light tint, different hue | Dashed border | Yes | Crossing — any intersection counts |
Stroke width and dash lengths scale inversely with zoom to maintain consistent screen-pixel appearance.
### Dirty Tracking and Undo
- Each edit marks the file as dirty (orange pulsing status LED)
- An undo stack captures SVG snapshots after each edit operation, up to a limit
- Ctrl+Z pops the stack and restores the previous state by re-injecting the SVG content and reinitializing the editor
### Save
- Ctrl+S or clicking the dirty status LED saves the modified SVG content to disk via the write-file RPC
- Editor's get-content method commits any active text edit, removes selection handles, serializes the SVG, then re-renders handles — ensuring saved content is clean
- A file-saved event is dispatched on success
## Controls
No persistent toolbar. The viewer uses floating overlay buttons and keyboard shortcuts for all actions.
### Floating Action Buttons
Bottom-right corner holds a vertical stack of small floating buttons:
| Button | Action |
|---|---|
| Presentation toggle | Toggle presentation mode (full-width editor). Highlighted when active |
| Fit | Fit content to view |
### Fit Button
- Fits both panels so SVG content is fully visible within available space
- Calls each editor's fit-content method; under the mutex so neither editor's on-view-change callback echoes into the other
- Fitting respects the SVG's authored viewBox when one exists — many SVGs (especially those with font glyphs or clip paths in defs) produce misleading bounding-box results that don't reflect the intended visible area; the authored viewBox is the correct viewport
- When no authored viewBox is present, falls back to computed bounding box with a small margin
- ViewBox expanded on the shorter axis to match the container's aspect ratio so content isn't stretched horizontally or vertically even when the container's aspect ratio differs from the content's
- Sanity check — if computed bounding-box area vastly exceeds the authored viewBox area (e.g., off-screen text from font glyph definitions), the authored viewBox is trusted instead
### Status LED
Small circular indicator in the top-right, same behavior as diff viewer.
### Zoom
- Mouse-wheel only; no toolbar buttons
- Smooth zoom centered on cursor position
- Zoom level tracked internally but not displayed
## SVG Content Injection
SVG content cannot be rendered via framework templates — framework doesn't natively handle raw SVG string injection. Instead:
1. Render creates empty container divs for left and right panels
2. Inject method sets inner HTML on each container with the SVG string
3. After injection, SVG elements are normalized:
   - Width/height attributes removed (so SVG fills container)
   - Width/height styles set to fill container
   - ViewBox attribute added if missing (computed from original width/height before they are removed)
   - Both panels get "preserve aspect ratio: none" so cursor-to-viewBox math is symmetric and the editor's fit-content output fully controls what's visible
4. A new editor instance is constructed and attached on each panel — left pane in read-only mode, right pane editable. Editors initialize their viewBox via fit-content
### Injection Deduplication
- A generation counter guards against duplicate injection
- Both lifecycle update and openFile can trigger injection for the same file
- Counter ensures only the latest invocation proceeds — earlier invocations still in-flight (waiting on animation frame) bail out when they see the counter has advanced
### Retry on Next Frame
- If container divs are not yet in the shadow DOM when injection runs (due to framework render timing), it schedules a retry via animation frame
- Ensures injection succeeds even when called during the framework update lifecycle before the DOM reflects the latest template
### Authored ViewBox Preservation
- Both panels prefer the authored viewBox attribute over a computed one
- Computed bounding-box results are polluted by glyphs, clip paths, and symbol definitions in defs that have very small or off-screen coordinate systems
- Authored viewBox trusted as correct viewport
- Computed bounding box only used as fallback when no viewBox attribute exists — a small margin added around the computed bounds
## Relative Image Resolution
SVG files produced by doc-convert reference sibling image files with relative paths. When injected into the webapp DOM, the browser resolves those paths against the webapp's origin URL — which does not serve repository files. Images silently fail to load.
After injection sets inner HTML on both panels, a resolve-image-hrefs method runs:
1. Finds all image elements in the injected SVG
2. Skips elements whose href is already a data URI or absolute URL
3. Resolves each relative path against the SVG file's directory
4. Fetches binary content via the base64 RPC, returning a data URI with correct MIME type
5. Rewrites the href (and xlink href) attribute in-place so the browser renders the image
Image resolution runs in parallel for all images in both panels. Non-blocking — SVG panels initialize and become interactive immediately; images appear as base64 fetches complete. Failed fetches log a warning but do not prevent the SVG from displaying.
## File Content Fetching
Content fetched via the same RPC methods as the diff viewer:
| Version | RPC call | Fallback |
|---|---|---|
| HEAD (original) | Content at HEAD | Empty string (file is new) |
| Working copy (modified) | Content at working copy | Empty string (file deleted) |
| Embedded images | Base64 content | Warning logged, image not shown |
Each call wrapped in its own error handler — a failure in one (e.g., file doesn't exist in HEAD) doesn't prevent the other from loading.
## Public API
Mirrors the diff viewer's interface so the app shell can treat both uniformly:
- Open file — open or switch to an SVG file; fetches content if not provided
- Refresh open files — re-fetch content for all open files (post-edit refresh)
- Close file — close a tab, dispose pan/zoom, update active index
- Get dirty files — returns list for save-all coordination
## Keyboard Shortcuts
All toolbar-level actions are accessible only via keyboard. Element-level shortcuts are handled by the visual editor internally and only apply in select mode when the editor has focus.
| Shortcut | Scope | Action |
|---|---|---|
| Ctrl+PageDown / PageUp | Viewer | Next / previous tab |
| Ctrl+W | Viewer | Close active tab |
| Ctrl+S | Viewer | Save modified SVG |
| Ctrl+Z | Viewer (select mode) | Undo last edit |
| Ctrl+Shift+C | Viewer | Copy SVG as PNG image to clipboard |
| F11 | Viewer | Toggle presentation mode |
| Escape | Viewer (present mode) | Exit presentation mode |
| Ctrl+C | Editor | Copy selected element(s) |
| Ctrl+V | Editor | Paste copied element(s) with offset |
| Ctrl+D | Editor | Duplicate selected element(s) in place |
| Delete / Backspace | Editor | Delete selected element(s) |
| Escape | Editor | Deselect / cancel text edit / cancel marquee |
## Resize Handling
- Resize observer on the diff container notifies both editors when container dimensions change (dialog resize, browser window resize)
- Each editor re-runs fit-content so the viewBox aspect ratio re-matches the new container aspect ratio; otherwise content would be stretched until the next explicit fit
## Integration with Existing Systems
### App Shell
- Both viewers are children of the background layer
- On navigate-file — check extension, toggle visibility classes
- On active-file-changed — activate the correct viewer layer
- On stream-complete with modified files — call refresh on both viewers
- On files-modified (commit, reset) — call refresh on both viewers if they have open files
### File Picker
- No changes needed — dispatches navigate-file events for all file types; app shell handles routing
### Search Tab
- Search results for SVG files route through the same navigate-file → app shell → SVG viewer path
### Edit Blocks
- LLM edit blocks for SVG files are applied normally (text-based edits)
- After application, refresh updates the SVG viewer's content if the file is open
## Context Menu
Right-clicking on the right (editable) panel opens a context menu with:
| Action | Shortcut | Description |
|---|---|---|
| Copy as PNG | Ctrl+Shift+C | Renders the current modified SVG to a canvas and copies as PNG to clipboard |
- Context menu positioned at click point relative to diff container
- Dismisses on clicking outside or on a subsequent right-click
- Dismiss listener uses click (not pointerdown) so menu buttons fire handlers before dismiss logic runs
## Copy as PNG
Copy as PNG renders the current SVG to a high-quality PNG image:
1. Parse dimensions — reads viewBox or width/height attributes to determine intrinsic size; defaults when unparseable
2. Scale for quality — scales up with an upper bound on longest side for crisp output; small SVGs use higher scale, larger SVGs use modest scale
3. Render to canvas — creates an offscreen canvas, draws white background (SVGs often have transparent backgrounds), renders the SVG via an image element loaded from a blob URL
4. Clipboard write — passes a promise-of-blob (not a resolved blob) to the clipboard item to preserve the user-gesture context across async operations
5. Download fallback — if clipboard write is unavailable or fails, downloads the PNG file via a synthesized download link; filename strips SVG extension and appends PNG
### User Feedback
Success and failure communicated via a toast event dispatched from the viewer. App shell catches and renders in the global toast system.
| Outcome | Message |
|---|---|
| Clipboard succeeded | Image copied to clipboard |
| Clipboard failed, download succeeded | Image downloaded as PNG |
| Both failed | Failure message |
Available via two paths:
- Context menu
- Keyboard shortcut
## SVG ↔ Text Diff Mode Toggle

SVG files can be viewed in either the visual SVG editor or the Monaco text diff editor. Two buttons enable bidirectional switching:

| Button | Location | Direction |
|---|---|---|
| Code toggle | SVG viewer floating actions | Visual → Text diff |
| Visual toggle | Diff viewer overlay buttons | Text diff → Visual |

### Toggle Mechanism

Both directions dispatch a toggle-svg-mode window event carrying:

- Path
- Target viewer (diff or visual)
- Latest content from the source viewer (optional)
- On-disk saved content for dirty tracking (optional)

### App Shell Handler

Orchestrates the switch:

**Visual → Text:**

1. Capture latest SVG content from the SVG editor
2. Read the file object from the SVG viewer's internal files list
3. Flip viewer visibility (show diff, hide SVG)
4. Close any existing diff tab for the path, then open fresh with the captured content
5. Set saved-content to the on-disk original so visual edits appear as dirty in the diff editor
6. Layout Monaco after the DOM settles

**Text → Visual:**

1. Read the file object from the SVG viewer's files list (before closing)
2. Flip viewer visibility (show SVG, hide diff)
3. Close and reopen the SVG viewer with the latest text content from the diff editor
4. Carry saved-content through so dirty state is preserved
5. Close the diff viewer's tab for the path

### Race Prevention

- An override flag is set on the app shell during the toggle to prevent the active-file-changed handler from interfering
- Flag is cleared in an animation-frame callback after the toggle completes
- Without this guard, the active-file-changed event from opening the new tab would trigger viewer visibility logic that conflicts with the toggle in progress

### Content Preservation

- Saved-content (the last on-disk content) is carried across mode toggles so:
  - Edits made in the SVG editor appear as dirty when switching to text mode
  - Edits made in the text editor appear as dirty when switching back to visual mode
  - Saving in either mode updates saved-content for both

## Invariants

- Only one viewer is visible at a time — the app shell enforces this via CSS class toggling
- Both panels are instances of the same editor class; the left pane is always constructed with the read-only flag set
- Handle elements are always excluded from hit-testing so clicking a handle never starts a drag on the underlying element
- Both panels have their browser-side aspect-ratio preservation disabled so the editor's viewBox is the single source of truth for what's visible
- Injection deduplication guarantees that rapid openFile calls for the same file never attach editors to stale content
- View sync never produces infinite feedback loops — a mutex flag held during the mirrored viewBox write prevents ping-pong
- The read-only editor never mutates any SVG element — only its own viewBox attribute for pan and zoom
- Save commits any active text edit and removes handles before serializing — saved content is always clean
- Mode-toggle race guard prevents active-file-changed events from disrupting an in-flight visual ↔ text switch
- Copy-as-PNG clipboard write uses a promise-of-blob, not a resolved blob, to preserve user-gesture context across async scaling