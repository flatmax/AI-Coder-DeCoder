// Message search — pure helpers for matching user query against
// the chat message list.
//
// Layer 5 Phase 2e — message search (part 1 of search).
//
// Separated from the chat panel so the match logic is testable
// without mounting a Lit component. The chat panel imports
// `findMessageMatches` and wraps it with UI state (query,
// toggles, current-match index, scroll handling).
//
// Scope: match semantics only. UI rendering, keyboard
// navigation, scroll behaviour, and persistence live in the
// chat panel.
//
// Match semantics match specs4/5-webapp/search.md:
//   - Case-insensitive by default (togglable)
//   - Literal substring by default (regex togglable)
//   - Whole-word togglable
//   - Empty query returns empty matches
//   - Invalid regex returns empty matches (silent degradation)
//
// Input is the messages array in its raw form — same shape the
// chat panel holds in `this.messages`. Supports both string
// content and multimodal array content (the session-loaded
// form with image blocks). For multimodal, matching applies
// to extracted text blocks joined by newlines, matching the
// chat panel's display.

/**
 * Escape a string for use as a literal regex pattern.
 *
 * Characters with meta meaning in regex (`.`, `*`, `?`, etc.)
 * are backslash-escaped so the resulting pattern matches them
 * literally. Used when the user has `.*` (regex) toggled OFF
 * but we still want to build a regex internally (for
 * whole-word matching, which needs `\b` anchors).
 *
 * @param {string} text
 * @returns {string}
 */
function _escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the searchable text from a single message.
 *
 * Handles three content shapes:
 *   - Plain string — returned as-is
 *   - Multimodal array (session-loaded images) — text blocks
 *     joined with newlines; non-text blocks (images) skipped
 *     since the user searches what they can see, and images
 *     don't produce text content
 *   - Anything else — empty string (defensive)
 *
 * @param {object} message — a chat message dict
 * @returns {string}
 */
function _extractSearchText(message) {
  if (!message) return '';
  const raw = message.content;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = [];
    for (const block of raw) {
      if (
        block &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        parts.push(block.text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Build the regex pattern used for matching.
 *
 * Combines the three toggle states:
 *   - regex ON: use the user's query verbatim
 *   - regex OFF: escape the query so meta-chars match literally
 *   - wholeWord ON: wrap with `\b...\b` boundaries
 *   - ignoreCase ON: set the `i` flag
 *
 * Always uses the `g` flag so `RegExp.prototype.exec` can
 * iterate multiple matches within a single message. The `g`
 * flag doesn't affect whether a match is found for our test
 * use (we only care "any match?"), but pinning it now lets
 * a future enhancement highlight per-match ranges without
 * refactoring the pattern construction.
 *
 * Returns null on invalid regex so the caller can degrade
 * to "no matches" rather than throwing.
 *
 * @param {string} query
 * @param {{regex?: boolean, wholeWord?: boolean, ignoreCase?: boolean}} opts
 * @returns {RegExp | null}
 */
function _buildPattern(query, opts) {
  const regex = !!opts?.regex;
  const wholeWord = !!opts?.wholeWord;
  const ignoreCase = opts?.ignoreCase !== false; // default on

  let source = regex ? query : _escapeRegex(query);
  if (wholeWord) {
    // `\b` is a word boundary — a position between a word
    // character and a non-word character (or start/end of
    // input). Works correctly for ASCII; Unicode word
    // boundaries require the `u` flag and explicit
    // property escapes, which is more than we need here.
    source = `\\b(?:${source})\\b`;
  }
  const flags = ignoreCase ? 'gi' : 'g';
  try {
    return new RegExp(source, flags);
  } catch (err) {
    // Invalid regex — common when the user is mid-type
    // ("[a" before closing the bracket). Silent
    // degradation: no matches, no crash.
    return null;
  }
}

/**
 * Find indices of messages whose content matches the query.
 *
 * @param {Array<object>} messages — chat message dicts, in
 *   display order
 * @param {string} query — user's search text
 * @param {{regex?: boolean, wholeWord?: boolean, ignoreCase?: boolean}} [opts]
 * @returns {Array<number>} — indices into `messages` where
 *   content matched, preserving display order. Empty when
 *   query is empty/whitespace or regex is invalid.
 */
export function findMessageMatches(messages, query, opts = {}) {
  if (!Array.isArray(messages)) return [];
  if (typeof query !== 'string' || query.trim() === '') return [];
  const pattern = _buildPattern(query, opts);
  if (pattern === null) return [];
  const out = [];
  for (let i = 0; i < messages.length; i += 1) {
    const text = _extractSearchText(messages[i]);
    if (!text) continue;
    // RegExp state resets between messages (we create
    // fresh `lastIndex` semantics per `.test()` call via
    // the new regex each time — actually, with the `g`
    // flag, `.test()` maintains state across calls on the
    // SAME instance. Setting `pattern.lastIndex = 0`
    // before each test ensures we always start at
    // position 0, making the check idempotent across
    // messages.
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      out.push(i);
    }
  }
  return out;
}

// Exported for tests only.
export { _buildPattern, _escapeRegex, _extractSearchText };