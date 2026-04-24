// Markdown link provider for Monaco editor.
//
// Phase 5.10 / 3.1e — completes Phase 3.1's editor
// surface by making `[text](relative-path)` links
// Ctrl+clickable inside the Monaco editor for markdown
// files. The preview pane's click-based navigation has
// worked since Phase 3.1b; this adds the editor-side
// equivalent so readers who stay in the source view
// don't need to toggle preview just to navigate.
//
// Two Monaco extension points are used:
//
//   1. LinkProvider — scans the document for link
//      patterns and returns `{range, url}` tuples.
//      Monaco then underlines them and handles the
//      Ctrl+click gesture.
//   2. LinkOpener — intercepts the `ac-navigate:` URI
//      scheme we emit for relative paths. Monaco's
//      default opener would route these to an external
//      browser and fail (no such scheme registered OS-
//      wide); the opener converts them back to
//      repo-relative paths and dispatches `navigate-file`
//      events for the app shell to handle.
//
// Scope cuts:
//
//   - **Only `[text](path)` syntax.** No reference-style
//     links (`[text][ref]` + `[ref]: path`), no image
//     refs in the editor. The preview's image pipeline
//     covers image display; editor image navigation
//     isn't spec'd.
//   - **No syntax-aware tokenization.** Simple regex on
//     raw text. Inline code fences (`` `[not a link](x)` ``)
//     would be false positives if the LLM happens to
//     put link syntax inside backticks. Real markdown
//     parsing per-keystroke is overkill for the cost of
//     a rare false positive that the user just ignores
//     (Ctrl+click fails cleanly if the path doesn't
//     resolve).
//   - **No fragment support.** Links with `#section`
//     strip the fragment before dispatching — the app
//     shell routes by path only, and scrolling-to-
//     heading in the destination is a future enhancement
//     (not blocking the core flow).
//
// Design decisions pinned by tests:
//
//   - **Link matching is line-by-line.** Monaco's
//     LinkProvider returns ranges in line/column
//     coordinates. Scanning line-by-line avoids multi-
//     line regex DOTALL complexity and gives natural
//     range construction.
//
//   - **ac-navigate URI format.** `ac-navigate:///{path}`
//     — three slashes for URI convention, then the
//     path verbatim. Path may contain slashes, which is
//     fine; Monaco treats the whole thing after the
//     scheme as an opaque string until our opener
//     intercepts it.
//
//   - **Absolute URLs skipped.** `http://`, `https://`,
//     `data:`, `blob:`, `mailto:`, `tel:` all pass
//     through without link annotation. Monaco's default
//     provider handles them; adding them would just
//     duplicate the underline.
//
//   - **Resolution happens at click time, not scan time.**
//     The LinkProvider emits relative paths verbatim in
//     the URI. The LinkOpener resolves against the
//     active file's directory when the user clicks.
//     Alternative (pre-resolving at scan time) would
//     require the provider to know the source path,
//     which changes with every file switch and would
//     force re-scans.

/**
 * Module-scoped set of monaco namespaces we've already
 * installed link providers on. Same pattern as
 * `lsp-providers.js`'s `_installedMonacos` WeakSet —
 * avoids property-probe failures on Vitest's auto-
 * mocked modules.
 */
const _installedMonacos = new WeakSet();

/**
 * URI scheme our opener listens for. Not a registered
 * standard scheme (and deliberately so — we never want
 * Monaco to hand these to the system browser).
 */
const _NAVIGATE_SCHEME = 'ac-navigate';

/**
 * Absolute-URL detection. Same set as the preview
 * pane's click handler (phase 3.1b).
 */
const _ABSOLUTE_URL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Inline markdown link pattern. Matches `[text](url)`
 * where `text` may contain any character except `]`
 * and `url` may contain any character except `)`.
 *
 * Deliberate simplifications:
 *   - No support for escaped brackets inside text
 *     (`[a\]b](x)`) — rare in practice, simpler regex
 *   - No support for balanced parens inside URL
 *     (`[x](foo(bar))`) — extremely rare
 *
 * The `/g` flag is load-bearing; exec() uses lastIndex
 * to find multiple matches per line.
 */
const _LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * Whether a given path should be skipped as "not a
 * navigable relative path". Absolute URLs, fragment-
 * only refs, and root-anchored paths (/foo) all fall
 * through to Monaco's default opener.
 *
 * Exported for test visibility. Production callers use
 * this transitively via `findLinks`.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function shouldSkip(url) {
  if (typeof url !== 'string' || !url) return true;
  if (_ABSOLUTE_URL_RE.test(url)) return true;
  if (url.startsWith('#')) return true;
  if (url.startsWith('/')) return true;
  return false;
}

/**
 * Scan a single line of text for markdown inline links.
 * Returns an array of match objects with 1-indexed
 * column positions (Monaco's convention) for the
 * full link span — opening bracket through closing
 * paren.
 *
 * Exported for tests. `findLinks` wraps this across
 * multiple lines for the full provider contract.
 *
 * @param {string} line
 * @returns {Array<{url: string, startColumn: number, endColumn: number}>}
 */
export function findLinksInLine(line) {
  if (typeof line !== 'string' || !line) return [];
  const matches = [];
  _LINK_RE.lastIndex = 0;
  let m;
  while ((m = _LINK_RE.exec(line)) !== null) {
    const url = m[2];
    if (shouldSkip(url)) continue;
    // Monaco columns are 1-indexed. m.index is 0-indexed
    // offset into the line.
    const startColumn = m.index + 1;
    const endColumn = m.index + m[0].length + 1;
    matches.push({ url, startColumn, endColumn });
  }
  return matches;
}

/**
 * Find all markdown links in a text block, returning
 * Monaco-compatible link objects. Each link has `range`
 * (line/column 1-indexed) and `url` (an `ac-navigate:`
 * URI).
 *
 * Exported for tests and for the LinkProvider's
 * `provideLinks` implementation.
 *
 * @param {string} text
 * @returns {Array<{range: object, url: string, tooltip?: string}>}
 */
export function findLinks(text) {
  if (typeof text !== 'string' || !text) return [];
  const lines = text.split('\n');
  const results = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;
    for (const match of findLinksInLine(line)) {
      results.push({
        range: {
          startLineNumber: lineNumber,
          startColumn: match.startColumn,
          endLineNumber: lineNumber,
          endColumn: match.endColumn,
        },
        url: buildNavigateUri(match.url),
        tooltip: `Open ${match.url}`,
      });
    }
  }
  return results;
}

/**
 * Construct an `ac-navigate:` URI from a relative path.
 * Three slashes matches the URI conventional form for
 * hostless schemes.
 *
 * @param {string} path
 * @returns {string}
 */
export function buildNavigateUri(path) {
  return `${_NAVIGATE_SCHEME}:///${path}`;
}

/**
 * Parse an `ac-navigate:` URI back to its relative
 * path component. Returns null for any URI that
 * doesn't match our scheme — the link opener uses this
 * to decide whether to claim a click event.
 *
 * Handles both Monaco's Uri object form (with `scheme`
 * and `path` fields) and plain string form.
 *
 * @param {object | string} uri
 * @returns {string | null}
 */
export function parseNavigateUri(uri) {
  if (!uri) return null;
  // Monaco Uri object.
  if (typeof uri === 'object') {
    if (uri.scheme !== _NAVIGATE_SCHEME) return null;
    const path = typeof uri.path === 'string' ? uri.path : '';
    // Strip the leading slash that Monaco adds for
    // scheme-relative URIs.
    return path.startsWith('/') ? path.slice(1) : path;
  }
  // String form.
  if (typeof uri === 'string') {
    const prefix = `${_NAVIGATE_SCHEME}:///`;
    if (!uri.startsWith(prefix)) return null;
    return uri.slice(prefix.length);
  }
  return null;
}

/**
 * Build a Monaco LinkProvider for markdown files. The
 * `getText` callback returns the current document
 * content — we pass this rather than reading `model.
 * getValue()` directly so tests can inject content
 * without mounting a model.
 *
 * @param {() => string} getText
 * @returns {{provideLinks: Function}}
 */
export function buildMarkdownLinkProvider(getText) {
  return {
    provideLinks(model) {
      const text =
        typeof getText === 'function'
          ? getText(model)
          : model?.getValue?.() || '';
      return { links: findLinks(text) };
    },
  };
}

/**
 * Build a LinkOpener that handles `ac-navigate:` URIs.
 * The `onNavigate` callback receives the extracted
 * relative path; production usage dispatches a
 * `navigate-file` window event from there.
 *
 * Monaco calls `open(resource)` when the user Ctrl+
 * clicks a link. Returning true claims the event (no
 * further opener consulted). Returning false lets
 * Monaco fall through to the next opener in the chain
 * (default browser-based external-link handler).
 *
 * @param {(path: string) => void} onNavigate
 * @returns {{open: Function}}
 */
export function buildMarkdownLinkOpener(onNavigate) {
  return {
    open(resource) {
      const path = parseNavigateUri(resource);
      if (path === null) return false;
      // Strip fragment — app shell navigates by path
      // only. Future enhancement: forward the fragment
      // so the destination viewer can scroll to the
      // heading.
      const hashIdx = path.indexOf('#');
      const cleanPath = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
      if (!cleanPath) return false;
      try {
        onNavigate(cleanPath);
      } catch (err) {
        // Surfaces as a debug log rather than propagating
        // — a broken onNavigate callback shouldn't crash
        // Monaco's opener chain.
        console.debug(
          '[markdown-link-provider] onNavigate threw',
          err,
        );
      }
      return true;
    },
  };
}

/**
 * Install the link provider and link opener. Idempotent
 * per-monaco-instance. Returns the disposables from
 * registration so tests can inspect.
 *
 * The provider is registered for the `markdown` language
 * only — other languages never see it. Monaco's built-in
 * providers for plain text / source code already handle
 * absolute-URL autolinks in comments.
 *
 * @param {object} monaco
 * @param {() => string} getActivePath — not used here
 *   but accepted for symmetry with other installers
 * @param {(path: string) => void} onNavigate
 * @returns {Array<{dispose: Function}>}
 */
export function installMarkdownLinkProvider(
  monaco,
  getActivePath,
  onNavigate,
) {
  if (!monaco || !monaco.languages) return [];
  if (_installedMonacos.has(monaco)) return [];
  _installedMonacos.add(monaco);
  const disposables = [];
  // LinkProvider scans the document for links. Content
  // comes from the model's getValue() at scan time —
  // Monaco re-invokes the provider when the document
  // changes.
  try {
    const provider = buildMarkdownLinkProvider((model) =>
      model?.getValue?.() || '',
    );
    disposables.push(
      monaco.languages.registerLinkProvider('markdown', provider),
    );
  } catch (err) {
    console.debug(
      '[markdown-link-provider] registerLinkProvider failed',
      err,
    );
  }
  // LinkOpener intercepts clicks on ac-navigate URIs.
  // Monaco's opener chain tries each registered opener;
  // ours returns true for ac-navigate, false for
  // everything else (falling through to the default).
  try {
    const opener = buildMarkdownLinkOpener(onNavigate);
    // registerEditorOpener is the public API for
    // intercepting link clicks. Some Monaco versions
    // also expose registerOpener; probe for both.
    const register =
      monaco.editor?.registerEditorOpener ||
      monaco.editor?.registerOpener;
    if (register) {
      disposables.push(register.call(monaco.editor, opener));
    }
  } catch (err) {
    console.debug(
      '[markdown-link-provider] registerEditorOpener failed',
      err,
    );
  }
  return disposables;
}

/**
 * Test-only reset hook. Production code never calls
 * this.
 */
export function _resetInstallGuard(monaco) {
  if (monaco) _installedMonacos.delete(monaco);
}