// Markdown preview export — self-contained HTML file or
// clipboard `text/html`. Triggered from the preview-pane
// "more actions" menu in diff-viewer/index.js.
//
// The live preview pane already has math rendered (KaTeX
// run by markdown-preview.js) and images resolved to data
// URIs (resolvePreviewImages in preview.js). Export reuses
// that DOM: clone it, await any pending image resolution,
// inline KaTeX CSS + a minimal stylesheet, and serialize.
//
// Scope: Markdown only. TeX preview's pipeline (make4ht
// output, source-line anchors) differs enough that it gets
// its own export path if/when needed.
//
// Governing spec:
//   specs4/5-webapp/diff-viewer.md#exporting-the-preview
//   specs-reference/5-webapp/diff-viewer.md (byte formats)

import { katexCssText } from './constants.js';
import { isMarkdownFile } from './editor.js';
import { resolvePreviewImages } from './preview.js';

/**
 * Minimal stylesheet for exported markdown HTML. Hand-
 * written rather than shipping a full GitHub-style CSS
 * because the goal is "looks reasonable on the
 * recipient's machine," not "byte-identical to the
 * preview pane." System font stack so it works without
 * webfonts; light theme by default since most recipients
 * read in light mode.
 */
const _MINIMAL_CSS = `
:root {
  color-scheme: light;
}
body {
  margin: 0 auto;
  padding: 2rem 1.5rem;
  max-width: 48rem;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue",
    sans-serif;
  font-size: 16px;
  line-height: 1.55;
  color: #1f2328;
  background: #ffffff;
}
h1, h2, h3, h4, h5, h6 {
  margin-top: 1.75em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.25;
}
h1 { font-size: 2em; border-bottom: 1px solid #d0d7de;
  padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de;
  padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
p { margin: 0.75em 0; }
a { color: #0969da; text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Consolas,
    "Liberation Mono", Menlo, monospace;
  font-size: 0.875em;
  background: rgba(175, 184, 193, 0.2);
  padding: 0.15em 0.35em;
  border-radius: 4px;
}
pre {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 1em;
  overflow-x: auto;
  line-height: 1.45;
}
pre code {
  background: transparent;
  padding: 0;
  font-size: 0.85em;
}
blockquote {
  margin: 1em 0;
  padding: 0 1em;
  color: #59636e;
  border-left: 0.25em solid #d0d7de;
}
ul, ol { padding-left: 2em; margin: 0.75em 0; }
li { margin: 0.25em 0; }
table {
  border-collapse: collapse;
  margin: 1em 0;
}
th, td {
  border: 1px solid #d0d7de;
  padding: 0.4em 0.75em;
}
th {
  background: #f6f8fa;
  font-weight: 600;
}
hr {
  border: 0;
  border-top: 1px solid #d0d7de;
  margin: 2em 0;
}
img {
  max-width: 100%;
  height: auto;
}
`.trim();

/**
 * Default filename for the active markdown file, with
 * `.html` substituted for the markdown extension. Falls
 * back to `preview.html` when no path is available.
 */
function _defaultFilename(host) {
  const path = host?._file?.path || '';
  if (!path) return 'preview.html';
  // Strip directories — filename only.
  const base = path.split('/').pop() || 'preview';
  // Replace the extension. Markdown extensions are
  // .md / .markdown; case-insensitive replacement.
  const stripped = base.replace(/\.(md|markdown)$/i, '');
  return `${stripped || 'preview'}.html`;
}

/**
 * Build the full self-contained HTML document for the
 * active preview. Returns the HTML string. The caller
 * decides what to do with it (download / clipboard).
 *
 * Order of operations:
 *   1. Trigger a fresh image-resolution pass and await
 *      its current generation. resolvePreviewImages
 *      mutates the live DOM, so when it settles every
 *      <img> that can be a data URI is one.
 *   2. Clone the preview pane.
 *   3. Walk the clone for unresolved relative <img>
 *      sources and report them so the caller can warn.
 *   4. Wrap the clone's innerHTML in a full HTML doc
 *      with KaTeX CSS + minimal stylesheet inlined.
 *
 * Returns { html, unresolvedImages } where
 * unresolvedImages is an array of src strings that
 * were neither absolute URLs nor data URIs. Empty when
 * everything resolved cleanly.
 */
export async function buildExportHtml(host) {
  if (!host || !host._file || !isMarkdownFile(host._file)) {
    throw new Error(
      'export only available for markdown preview',
    );
  }
  const pane = host._previewPane ||
    host.shadowRoot?.querySelector('.preview-pane');
  if (!pane) {
    throw new Error('preview pane not mounted');
  }

  // Trigger a fresh resolution pass and wait for it.
  // resolvePreviewImages bumps _imageResolveGeneration
  // and awaits all per-image fetches via Promise.all
  // internally; awaiting it gives us a settled DOM.
  host._imageResolveGeneration += 1;
  await resolvePreviewImages(host, host._imageResolveGeneration);

  // Clone the live DOM. Use cloneNode(true) so we get a
  // detached copy we can serialize without disturbing
  // the live preview.
  const clone = pane.cloneNode(true);

  // Walk for unresolved relative images. Absolute URLs
  // (http://, https://, data:, blob:) are fine — the
  // recipient's browser will fetch them. Anything else
  // is a relative path we couldn't resolve to a data URI.
  const unresolvedImages = [];
  const imgs = clone.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!src) continue;
    if (
      src.startsWith('data:') ||
      src.startsWith('blob:') ||
      /^https?:\/\//i.test(src)
    ) {
      continue;
    }
    unresolvedImages.push(src);
  }

  const title = _escapeHtml(host._file.path || 'Preview');
  const body = clone.innerHTML;
  const html = _wrapDocument({
    title,
    body,
    css: `${katexCssText}\n\n${_MINIMAL_CSS}`,
  });
  return { html, unresolvedImages };
}

/**
 * Export the active markdown preview as a downloaded
 * HTML file. Resolves to { ok: true, filename } on
 * success or { ok: false, error } on failure.
 *
 * Failure modes:
 *   - No active markdown file (e.g., called outside
 *     preview mode) → "no markdown preview to export".
 *   - Browser blocks the download → caller decides.
 *   - Image resolution failures don't block the export;
 *     they surface in the unresolvedImages return.
 */
export async function exportPreviewAsHtml(host) {
  let html;
  let unresolvedImages = [];
  try {
    const result = await buildExportHtml(host);
    html = result.html;
    unresolvedImages = result.unresolvedImages;
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'export failed',
    };
  }
  const filename = _defaultFilename(host);
  try {
    const blob = new Blob([html], {
      type: 'text/html;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // Detached anchor click — don't append to the DOM,
    // some browsers require it but most don't, and
    // appending pollutes the host page.
    a.click();
    // Defer revocation so Safari has time to start the
    // download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'download failed',
    };
  }
  return { ok: true, filename, unresolvedImages };
}

/**
 * Copy the rendered preview to the clipboard as
 * `text/html`. Recipient pastes into Gmail, Notion,
 * Slack, etc., and gets formatted output instead of
 * raw HTML source. Falls back to plain-text copy of
 * the HTML source if `ClipboardItem` is unavailable
 * (older browsers, non-secure contexts).
 */
export async function copyPreviewAsHtml(host) {
  let html;
  let unresolvedImages = [];
  try {
    const result = await buildExportHtml(host);
    html = result.html;
    unresolvedImages = result.unresolvedImages;
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'export failed',
    };
  }
  // Prefer ClipboardItem with text/html so paste targets
  // get formatted output. The text/plain fallback gives
  // recipients in plain-text editors something usable.
  if (
    typeof ClipboardItem !== 'undefined' &&
    navigator.clipboard?.write
  ) {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const plain = new Blob([html], { type: 'text/plain' });
      const item = new ClipboardItem({
        'text/html': blob,
        'text/plain': plain,
      });
      await navigator.clipboard.write([item]);
      return { ok: true, mode: 'rich', unresolvedImages };
    } catch (err) {
      // Fall through to plain-text path.
      console.debug(
        '[diff-viewer] rich clipboard failed, falling back',
        err,
      );
    }
  }
  // Plain-text fallback. Better than nothing — recipient
  // pastes the raw HTML source.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(html);
      return { ok: true, mode: 'plain', unresolvedImages };
    } catch (err) {
      return {
        ok: false,
        error: err?.message || 'clipboard write failed',
      };
    }
  }
  return {
    ok: false,
    error: 'clipboard API unavailable',
  };
}

// ---------------------------------------------------------------
// Internals
// ---------------------------------------------------------------

function _wrapDocument({ title, body, css }) {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" ',
    'content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    '<style>',
    css,
    '</style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

function _escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}