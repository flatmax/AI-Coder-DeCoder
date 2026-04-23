// Markdown rendering for chat messages.
//
// Thin wrapper around the `marked` library with chat-specific
// configuration. Lives in its own module so:
//
//   1. The chat panel doesn't need to know about marked's API
//      directly.
//   2. Later sub-phases can swap in a richer renderer (syntax
//      highlighting via highlight.js, math via katex) without
//      touching every call site.
//   3. Tests can exercise the renderer in isolation.
//
// Phase 2b scope — basic markdown only:
//   - Fenced code blocks (```lang ... ```)
//   - Inline code (`x`)
//   - Paragraphs, headings, bold, italic
//   - Links (but the chat panel sandboxes them)
//   - Line breaks within paragraphs (breaks: true)
//
// Deferred:
//   - Syntax highlighting on code blocks (Phase 2d)
//   - KaTeX math (later — when someone needs it)
//   - Custom renderer for edit blocks (Phase 2d — uses a
//     separate segmenter before marked sees the content)
//   - Source-line attributes for preview scroll sync (Phase 3,
//     only for the diff viewer's markdown preview)

import { Marked } from 'marked';

// Configure a shared Marked instance. The `breaks` option makes
// single newlines render as <br>, which matches how users
// mentally compose chat messages (a return press means "new
// line" even when they didn't leave a blank line).
//
// GFM enables GitHub-flavored markdown: tables, task lists,
// strikethrough, autolinks. All useful for technical chat.
const marked = new Marked({
  breaks: true,
  gfm: true,
  // Silently degrade on bad input rather than throwing. A
  // streaming response mid-construction can easily be invalid
  // markdown; we render what we can and move on.
  silent: true,
});

/**
 * Render a markdown string to an HTML string.
 *
 * Returns an HTML string, not a DOM node. Callers that need to
 * insert it into a Lit template should use `unsafeHTML` from
 * `lit/directives/unsafe-html.js` — we trust the content
 * because it comes from the LLM, not from user-crafted input
 * that could inject scripts. (The LLM can in principle output
 * HTML tags, but `marked` escapes them by default unless they
 * appear inside a code fence, and the code-fence case renders
 * as literal text via <code>.)
 *
 * Empty or null input returns the empty string — callers don't
 * need to guard against these cases.
 */
export function renderMarkdown(text) {
  if (!text) return '';
  try {
    return marked.parse(text);
  } catch (err) {
    // `marked` with `silent: true` shouldn't throw, but if it
    // does (malformed input, internal bug) we fall back to an
    // escaped plain-text rendering rather than showing a raw
    // Error object or crashing the chat.
    console.warn('[markdown] parse failed, falling back to plain', err);
    return escapeHtml(text);
  }
}

/**
 * Escape HTML special characters in a string.
 *
 * Used for the fallback path when markdown rendering fails, and
 * exported so the chat panel can render raw user input safely
 * (user messages are shown verbatim, not markdown-rendered, per
 * specs4 — users typed what they typed, we shouldn't
 * reinterpret it).
 */
export function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}