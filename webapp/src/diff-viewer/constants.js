// Module-private constants and small pure helpers
// shared across diff-viewer modules.
//
// Extracted from the original single-file diff-viewer.js
// during the modular split; behaviour preserved exactly.

// KaTeX CSS — imported as a raw string via Vite's ?raw
// loader. Injected into the shadow root (not document
// head) because Monaco's style-cloning loop only sees
// styles in document.head, and this one isn't. Without
// this, math in preview renders unstyled (fractions flat,
// superscripts inline).
//
// In environments where the ?raw import doesn't resolve
// to a string (vitest under some resolver configurations,
// or stripped-down bundles), we fall back to a minimal
// sentinel stylesheet. The injection mechanism still runs
// so test coverage and shadow-DOM integration work
// identically; math just renders unstyled in those
// environments, matching the no-CSS fallback the guard
// used to produce.
import _rawKatexCss from 'katex/dist/katex.min.css?raw';

export const katexCssText =
  typeof _rawKatexCss === 'string' && _rawKatexCss
    ? _rawKatexCss
    : '/* ac-dc KaTeX CSS placeholder — raw import unavailable */';

/**
 * Virtual path prefix. Files with this prefix are
 * content-addressed (content passed via openFile's
 * virtualContent option) and are always read-only.
 */
export const _VIRTUAL_PREFIX = 'virtual://';

/**
 * Escape HTML-significant characters. Used when building
 * TeX preview error messages so error text containing
 * `<`, `>`, `&` doesn't inject into the DOM.
 */
export function _escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * How long to wait for Monaco's async diff computation
 * before giving up on viewport restoration. Identical
 * content never fires onDidUpdateDiff, so the timeout
 * prevents the restore from hanging forever. Matches
 * specs4's 2 second recommendation.
 */
export const _DIFF_READY_TIMEOUT_MS = 2000;

/**
 * How long to show the scroll-to-edit highlight decoration
 * after a search-text match is found.
 */
export const _HIGHLIGHT_DURATION_MS = 3000;

/**
 * Dataset marker for shadow-DOM-cloned styles. Lets us
 * find and remove prior clones without touching styles
 * from other shadow-DOM consumers.
 */
export const _CLONED_STYLE_MARKER = 'acDcMonacoClone';

/**
 * Dataset marker for the KaTeX stylesheet injected into
 * the shadow root when preview mode activates. Separate
 * from the Monaco-clone marker so the style-sync loop
 * doesn't touch it.
 */
export const _KATEX_CSS_MARKER = 'acDcKatexCss';

/**
 * How long the scroll-sync lock stays held after one
 * side initiates a scroll. During this window the other
 * side's scroll handler skips (prevents feedback loops).
 * Long enough to cover Monaco's smooth-scroll animation,
 * short enough that genuine user scrolling isn't
 * suppressed.
 */
export const _SCROLL_LOCK_MS = 120;

/**
 * Whether a URL string should be treated as absolute and
 * left untouched by the path-resolution helpers. Same
 * predicate used by both link interception and image
 * resolution.
 */
export function isAbsoluteUrl(url) {
  if (typeof url !== 'string') return false;
  return (
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('http://') ||
    url.startsWith('https://')
  );
}