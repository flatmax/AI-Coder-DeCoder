// Viewer routing — decide which viewer handles a given
// file path.
//
// Pure function, testable in isolation. Keeping the
// routing rule out of app-shell.js makes it easy to
// evolve later (e.g. image viewer for PNG/JPG, text
// viewer for huge files that Monaco can't handle) and
// lets us pin the contract with tests without mounting
// the shell.
//
// Current rule — SVG files go to the SVG viewer;
// everything else goes to the diff viewer. Matches
// specs4/5-webapp/shell.md#viewer-background.

/**
 * Return the viewer name for a given file path. Returns
 * null for paths that shouldn't be opened in any viewer
 * (empty string, malformed input).
 *
 * @param {string} path
 * @returns {'svg' | 'diff' | null}
 */
export function viewerForPath(path) {
  if (typeof path !== 'string' || !path) return null;
  // Case-insensitive extension match. Windows convention
  // is usually uppercase (.SVG) but repos with .SVG files
  // are rare; still, insensitive matching costs nothing.
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  return 'diff';
}