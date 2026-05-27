// SvgEditor constants module.
//
// Pure constant declarations used across the SvgEditor
// implementation and its test suite. Underscore-prefixed
// exports are considered internal — they're exported only
// so the test suite can reference them by name without
// duplicating the values. Production code should treat
// them as implementation details.

/**
 * Handle visual size in screen pixels. Dragging a handle
 * starts when the pointer is within this radius of the
 * handle center.
 */
export const HANDLE_SCREEN_RADIUS = 6;

/**
 * Class applied to every handle overlay element so
 * `_hitTest` can skip them.
 */
export const HANDLE_CLASS = 'svg-editor-handle';

/**
 * ID of the `<g>` element containing all handle overlays.
 * Placed as a direct child of the root SVG so it renders
 * above the content.
 */
export const HANDLE_GROUP_ID = 'svg-editor-handles';

/**
 * Dataset key on individual resize handles identifying
 * which corner or edge they represent. Values are compass
 * directions: `nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`
 * for rects; `n`, `e`, `s`, `w` for circles and ellipses.
 *
 * Stored on the DOM element itself so the pointerdown
 * dispatch can read it without maintaining a separate
 * handle → metadata map.
 */
export const HANDLE_ROLE_ATTR = 'data-handle-role';

/**
 * ID of the marquee rectangle element while it's alive.
 * Placed inside the handle group so hit-test exclusion
 * finds it.
 */
export const MARQUEE_ID = 'svg-editor-marquee';

/**
 * Distance in screen pixels from the bbox top edge to
 * the rotate handle. The handle floats above the bbox
 * connected by a short tangent line, matching the
 * convention from Inkscape / Figma. Screen-space so the
 * gap stays visually constant across zoom levels.
 */
export const _ROTATE_HANDLE_OFFSET = 20;

/**
 * Snap increment (degrees) when Shift is held during
 * rotate. 5° gives finer control than the typical 15°
 * vector-editor default — useful for technical diagrams
 * where small angle adjustments matter.
 */
export const _ROTATE_SNAP_DEGREES = 5;

/**
 * Minimum dimension for resize operations. Dragging past
 * the opposite edge clamps dimensions to this value rather
 * than flipping the shape (which would require swapping
 * which handle is which mid-drag — complex and visually
 * confusing). Expressed in SVG units; a pixel-ish value
 * that won't render as visually zero at normal zoom.
 */
export const _MIN_RESIZE_DIMENSION = 1;

/**
 * Maximum undo stack depth. 50 entries per specs4. Oldest
 * entries are discarded when the stack exceeds this limit.
 */
export const _UNDO_MAX = 50;

/**
 * Positional offset (SVG units) applied to pasted elements
 * so they're visually distinguishable from the originals.
 * Applied to both x and y.
 */
export const _PASTE_OFFSET = 10;

/**
 * Minimum marquee drag distance (screen pixels) before
 * treating it as a deliberate marquee rather than a jittery
 * click. Below this, a shift+click+tiny-drag on empty space
 * is a no-op — same rule as the drag threshold for moves.
 */
export const _MARQUEE_MIN_SCREEN = 3;

/**
 * SVG element tags that should never be considered as
 * selection targets. Structural, definitional, or
 * non-visual content.
 */
export const _NON_SELECTABLE_TAGS = new Set([
  'defs',
  'style',
  'metadata',
  'title',
  'desc',
  'filter',
  'lineargradient',
  'radialgradient',
  'clippath',
  'mask',
  'marker',
  'pattern',
  'symbol',
]);

/**
 * Visible shape tags that are valid selection targets.
 * `<tspan>` is NOT in this set — tspan hits resolve to
 * their parent `<text>`.
 */
export const _SELECTABLE_TAGS = new Set([
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'g',
  'image',
  'use',
]);