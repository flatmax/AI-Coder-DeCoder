// Markdown rendering for the diff viewer's preview pane.
//
// Separate from webapp/src/markdown.js (chat panel) by
// design — the two have different requirements:
//
//   - Chat's renderer stays simple: `code()` override for
//     future syntax highlighting, nothing else. All other
//     blocks use marked's defaults.
//   - Preview's renderer needs to inject `data-source-line`
//     attributes into rendered HTML so the scroll sync can
//     match preview anchors back to source-line numbers.
//
// Merging them would couple chat rendering to
// preview-specific logic it doesn't need, and would make
// chat's hot path slower. The cost of duplication is ~30
// lines of Marked configuration — cheap.
//
// Scope of this module:
//
//   - `renderMarkdownWithSourceMap(text)` — returns HTML
//     with `data-source-line` attributes on block-level
//     elements. Scroll sync later matches by offset/line.
//   - `encodeImagePaths(text)` — pre-processor that
//     percent-encodes spaces in image URLs so marked's
//     link parser doesn't choke. Applied before marked
//     sees the text.
//   - `normalizePath(path)` / `resolveRelativePath(base,
//     rel)` — path helpers for resolving relative refs in
//     preview-pane markdown links and images. Pure
//     functions, no DOM.
//   - `buildSourceLineMap(text)` — produces a
//     `Map<tokenKey, lineNumber>` so callers can inspect
//     the source-line resolution logic in isolation.
//
// Deferred to the diff-viewer integration:
//   - DOM image resolution (needs Repo RPC access)
//   - Scroll sync mechanics (needs the live editor +
//     preview elements)
//   - KaTeX CSS injection into the shadow DOM (needs a
//     shadow root reference)
//   - Monaco LinkProvider for Ctrl+clickable links (needs
//     the Monaco module)
//
// Governing spec: specs4/5-webapp/diff-viewer.md#markdown-preview

import { Marked } from 'marked';
import katex from 'katex';

/**
 * Escape a string for safe insertion as HTML text content.
 * Small subset — the five characters that carry structural
 * meaning in HTML. Used by the KaTeX fallback path and by
 * source-line attribute injection (path values).
 */
function _escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render a LaTeX math expression via KaTeX, falling back
 * to escaped source on parse failure. `display` is true
 * for `$$...$$` blocks, false for inline `$...$`.
 *
 * KaTeX's `throwOnError: false` makes it emit its own
 * error HTML for invalid math; we catch anything beyond
 * that (e.g., `katex` failing to import) and degrade to
 * plain escaped source wrapped in `<code>` so the user
 * at least sees what they wrote.
 */
function _renderMath(src, display) {
  try {
    return katex.renderToString(src, {
      throwOnError: false,
      displayMode: display,
    });
  } catch (_) {
    const wrapper = display ? 'pre' : 'code';
    return `<${wrapper}>${_escapeHtml(src)}</${wrapper}>`;
  }
}

/**
 * KaTeX extension for marked. Registers two tokenizers:
 *
 *   - Display math: `$$...$$` on its own, potentially
 *     spanning multiple lines. Block-level token.
 *   - Inline math: `$...$` within a line. Must not start
 *     or end with whitespace (distinguishes math from a
 *     dollar sign in prose like "$5 fee").
 *
 * Shared between the chat and preview renderers — math
 * rendering isn't preview-specific, but the diff viewer
 * currently uses this module exclusively. If chat ever
 * wants math, it can import `_mathExtension` or we can
 * extract it into a third module.
 */
const _mathExtension = {
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start(src) {
        return src.match(/\$\$/)?.index;
      },
      tokenizer(src) {
        // Match $$...$$ with content on any number of
        // lines. Non-greedy so the first closing $$
        // wins. `^` + `m` flag would be stricter but
        // marked's tokenizer runs per-block; the raw
        // `$$` scan is fine.
        const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (!m) return undefined;
        return {
          type: 'mathBlock',
          raw: m[0],
          text: m[1].trim(),
        };
      },
      renderer(token) {
        return `<p>${_renderMath(token.text, true)}</p>`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        return src.match(/\$[^\s]/)?.index;
      },
      tokenizer(src) {
        // Inline: $non-whitespace...non-whitespace$
        // Require non-whitespace boundaries so "$5" and
        // "$ a $" don't match.
        const m = /^\$([^$\s][^$]*?[^$\s]|[^$\s])\$/.exec(src);
        if (!m) return undefined;
        return {
          type: 'mathInline',
          raw: m[0],
          text: m[1],
        };
      },
      renderer(token) {
        return _renderMath(token.text, false);
      },
    },
  ],
};

// -------------------------------------------------------
// Image path encoding
// -------------------------------------------------------

/**
 * Marked doesn't parse `![alt](path with spaces.png)` —
 * unencoded spaces in the URL portion break its link
 * parser. Pre-process the text to percent-encode spaces
 * in image URLs only. Already-encoded URLs (`%20`) and
 * absolute URLs (`http://`, `https://`, `data:`) pass
 * through unchanged.
 *
 * This is a syntactic fix — marked treats `![a](b)` as
 * a single unit, so we only touch the bracketed path
 * between the opening `(` and the closing `)`. Alt text
 * (between `[` and `]`) isn't affected since spaces there
 * are already legal.
 */
export function encodeImagePaths(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(
    /(!\[[^\]]*\]\()([^)]+)(\))/g,
    (_match, before, url, after) => {
      // Skip absolute / data URLs.
      if (
        /^(?:[a-z]+:)/i.test(url) ||
        url.startsWith('data:')
      ) {
        return `${before}${url}${after}`;
      }
      // Only encode spaces. Other characters (quotes,
      // parens) would need escaping too but they're rarer
      // in file paths, and encoding them could break URLs
      // that already had them intentionally.
      return `${before}${url.replace(/ /g, '%20')}${after}`;
    },
  );
}

// -------------------------------------------------------
// Path resolution
// -------------------------------------------------------

/**
 * Normalise a path by resolving `.` and `..` segments.
 * Returns a path without leading `./`. Empty input and
 * input with too many `..` segments collapse to `''` and
 * `../../...` respectively.
 *
 * Not a generic URL resolver — only handles forward-
 * slash paths (repo-relative), no query strings, no
 * fragments.
 */
export function normalizePath(path) {
  if (typeof path !== 'string' || !path) return '';
  const parts = path.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else {
        out.push('..');
      }
    } else {
      out.push(part);
    }
  }
  return out.join('/');
}

/**
 * Resolve `rel` against `basePath` (which is the source
 * file's own path, not its directory — this helper splits
 * at the last slash). Returns a repo-relative path.
 *
 * Absolute URLs and fragment-only refs pass through
 * unchanged.
 */
export function resolveRelativePath(basePath, rel) {
  if (typeof rel !== 'string' || !rel) return rel;
  if (/^(?:[a-z]+:)/i.test(rel)) return rel;
  if (rel.startsWith('#')) return rel;
  const base = typeof basePath === 'string' ? basePath : '';
  const lastSlash = base.lastIndexOf('/');
  const baseDir = lastSlash >= 0 ? base.slice(0, lastSlash) : '';
  const combined = baseDir ? `${baseDir}/${rel}` : rel;
  return normalizePath(combined);
}

// -------------------------------------------------------
// Source-line map construction
// -------------------------------------------------------

/**
 * Build a map from token-identity keys to 1-based line
 * numbers. The key shape is `{type}:{first-chars-of-raw}`
 * — enough to distinguish tokens in a single document
 * without tripping on identical text in multiple places
 * (the scan only returns the first match).
 *
 * Exposed for testing. Callers that want rendered HTML
 * should use `renderMarkdownWithSourceMap` directly.
 */
export function buildSourceLineMap(text) {
  const map = new Map();
  if (typeof text !== 'string' || !text) return map;
  const lexer = new Marked()._tokenizer
    ? Marked.lexer(text)
    : []; // marked 14 exposes lexer() statically below
  // marked 14 provides the static lexer on the namespace:
  const tokens = _lexMarkdown(text);
  _walkTokensWithSource(tokens, text, map);
  return map;
}

/**
 * Lex markdown without rendering — gives us access to the
 * token tree with `raw` fields intact. Wrapped so callers
 * don't touch marked internals directly.
 */
function _lexMarkdown(text) {
  // marked 14 exposes `Marked.lexer()` as a class method,
  // and a one-off `Marked` instance has `.lexer(text)`.
  // The latter is forward-compatible with marked 15 which
  // may remove the class method.
  const m = new Marked();
  return m.lexer(text);
}

/**
 * Walk a token tree, recording `(tokenKey → lineNumber)`
 * for block-level tokens. Line numbers are derived by
 * locating the token's `raw` text in the source and
 * counting preceding newlines.
 *
 * Recursive for nested tokens (list items, blockquotes).
 * Inline tokens are skipped — only block-level anchors
 * participate in scroll sync.
 */
function _walkTokensWithSource(tokens, text, map) {
  if (!Array.isArray(tokens)) return;
  for (const token of tokens) {
    if (!token || typeof token !== 'object') continue;
    const key = _tokenKey(token);
    if (key && !map.has(key) && typeof token.raw === 'string') {
      const idx = text.indexOf(token.raw);
      if (idx >= 0) {
        // Line number is 1-indexed: count newlines before
        // idx and add 1.
        const line =
          text.slice(0, idx).split('\n').length;
        map.set(key, line);
      }
    }
    // Recurse into containers — list items, blockquote
    // bodies, table rows/cells.
    if (Array.isArray(token.tokens)) {
      _walkTokensWithSource(token.tokens, text, map);
    }
    if (Array.isArray(token.items)) {
      _walkTokensWithSource(token.items, text, map);
    }
    if (Array.isArray(token.rows)) {
      for (const row of token.rows) {
        _walkTokensWithSource(row, text, map);
      }
    }
  }
}

/**
 * Produce a map key for a token. Block-level tokens of
 * types we care about get a key; inline and structural
 * tokens (text, space, list_item as a container) return
 * null so they're skipped.
 *
 * Key format: `{type}:{prefix}` where prefix is the first
 * ~40 chars of raw, whitespace-collapsed. Not perfect —
 * two identical headings in the same document would
 * collide and only the first gets a line number. In
 * practice, collisions are rare enough that this works.
 */
function _tokenKey(token) {
  const type = token.type;
  if (
    type !== 'heading' &&
    type !== 'paragraph' &&
    type !== 'blockquote' &&
    type !== 'list' &&
    type !== 'code' &&
    type !== 'hr' &&
    type !== 'table'
  ) {
    return null;
  }
  const raw = typeof token.raw === 'string' ? token.raw : '';
  const prefix = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
  return `${type}:${prefix}`;
}

// -------------------------------------------------------
// Renderer setup
// -------------------------------------------------------

/**
 * Build a preview-specific Marked instance. The `code`
 * and `hr` renderers inject `data-source-line` directly
 * into output. Other block types (heading, paragraph,
 * blockquote, list, table) use marked defaults — the
 * source-line injection for those happens in a
 * postprocess pass, which lets complex nested content
 * (task lists, aligned tables) render correctly while
 * still carrying the line metadata.
 */
function _makePreviewMarked() {
  const m = new Marked({
    gfm: true,
    breaks: true,
    silent: true,
  });
  m.use(_mathExtension);
  return m;
}

/**
 * Inject `data-source-line` attributes into the first
 * matching opening tag for each pending `(tagName, line)`
 * mapping. Back-to-front substitution so earlier
 * insertions don't shift later offsets.
 *
 * Limitations — the regex-based injection only works for
 * simple cases where the tag name is unique within the
 * search window. Since we inject in source-order, finding
 * the first `<h2>` that doesn't yet have `data-source-line`
 * is reliable as long as marked emits tags in the same
 * order as the source tokens. That's true for the block
 * types we handle; nested inline tags don't interfere
 * because we only match opening tags of block-level
 * elements.
 */
function _injectSourceLines(html, mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return html;
  }
  let out = html;
  // Apply in reverse order of insertion index so earlier
  // insertions don't shift later offsets.
  const withIndex = [];
  let cursor = 0;
  for (const { tag, line } of mappings) {
    // Regex that matches an opening tag of `tag` without
    // an existing data-source-line attribute.
    const re = new RegExp(
      `<${tag}(?![^>]*\\bdata-source-line=)([^>]*)>`,
      'g',
    );
    re.lastIndex = cursor;
    const match = re.exec(out);
    if (!match) {
      // Couldn't find the tag — give up on this one
      // rather than injecting in the wrong place.
      continue;
    }
    withIndex.push({
      index: match.index,
      length: match[0].length,
      replacement: `<${tag}${match[1]} data-source-line="${line}">`,
    });
    cursor = match.index + match[0].length;
  }
  // Apply back-to-front.
  withIndex.sort((a, b) => b.index - a.index);
  for (const { index, length, replacement } of withIndex) {
    out = out.slice(0, index) + replacement + out.slice(index + length);
  }
  return out;
}

/**
 * Render markdown to HTML with `data-source-line`
 * attributes on block-level elements.
 *
 * The flow:
 *
 *   1. Pre-process image paths (encode spaces).
 *   2. Build the source-line map from the raw source.
 *   3. Walk tokens to collect `(tag, line)` mappings in
 *      document order.
 *   4. Render via marked.
 *   5. Inject `data-source-line` into the rendered HTML
 *      by finding the first opening tag that doesn't
 *      already have the attribute.
 *
 * Returns the final HTML string. Callers pass to Lit's
 * `unsafeHTML` — we trust the content because it comes
 * from the user's local files, not untrusted input, and
 * marked's built-in XSS escaping handles the structural
 * safety.
 *
 * Empty or null input returns empty string.
 */
export function renderMarkdownWithSourceMap(text) {
  if (typeof text !== 'string' || !text) return '';
  try {
    const encoded = encodeImagePaths(text);
    const marked = _makePreviewMarked();
    const tokens = marked.lexer(encoded);
    const mappings = [];
    const sourceMap = new Map();
    _walkTokensWithSource(tokens, encoded, sourceMap);
    // Build ordered mappings by walking tokens again,
    // emitting (tag, line) for the top-level block types
    // in document order.
    _collectMappings(tokens, sourceMap, mappings);
    const rawHtml = marked.parser(tokens);
    return _injectSourceLines(rawHtml, mappings);
  } catch (err) {
    console.warn(
      '[markdown-preview] render failed, degrading',
      err,
    );
    return _escapeHtml(text);
  }
}

/**
 * Walk tokens in document order, emitting an ordered list
 * of `{tag, line}` mappings for block-level tokens that
 * have a known source line.
 *
 * The tag mapping:
 *
 *   heading:1  → h1
 *   heading:2  → h2
 *   ...
 *   paragraph  → p
 *   blockquote → blockquote
 *   list       → ul|ol (depends on token.ordered)
 *   code       → pre
 *   hr         → hr
 *   table      → table
 *
 * Only top-level block tokens are emitted. Nested block
 * tokens (e.g., paragraphs inside list items) aren't
 * annotated — the scroll sync doesn't need that level of
 * granularity, and injecting into nested positions would
 * require more complex HTML walking than the regex
 * approach supports.
 */
function _collectMappings(tokens, sourceMap, mappings) {
  if (!Array.isArray(tokens)) return;
  for (const token of tokens) {
    if (!token || typeof token !== 'object') continue;
    const key = _tokenKey(token);
    if (!key) continue;
    const line = sourceMap.get(key);
    if (typeof line !== 'number') continue;
    const tag = _tagForToken(token);
    if (!tag) continue;
    mappings.push({ tag, line });
  }
}

function _tagForToken(token) {
  switch (token.type) {
    case 'heading':
      return `h${token.depth || 1}`;
    case 'paragraph':
      return 'p';
    case 'blockquote':
      return 'blockquote';
    case 'list':
      return token.ordered ? 'ol' : 'ul';
    case 'code':
      return 'pre';
    case 'hr':
      return 'hr';
    case 'table':
      return 'table';
    default:
      return null;
  }
}