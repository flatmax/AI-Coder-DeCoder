// File mention detection for rendered assistant HTML.
//
// Post-processes markdown-rendered HTML strings to wrap
// known repo file paths in clickable spans. A separate
// module so the core logic is testable without mounting
// a chat panel.
//
// Scope — detect and wrap. This module does NOT handle
// click events or dispatch file-mention-click — that's
// the chat panel's job once the wrapped HTML is in the DOM.
//
// Contract — takes a rendered-markdown HTML string (from
// marked.js) and a flat list of repo file paths. Returns
// a new HTML string with matching path substrings wrapped.
// Matches appear ONLY inside text content — never inside
// HTML tag attributes, never inside <pre>/<code> blocks
// (code fences are semantically content, not file
// references, and the LLM often quotes path-like strings
// inside them without meaning "navigate to this file").
//
// Why post-markdown rather than during segmentation —
// file mentions are cross-cutting. The segmenter produces
// prose vs edit-block splits; mentions can appear inside
// any prose segment and in any depth of rendered markup
// (paragraphs, list items, blockquotes, inline code
// excluded). Running detection on the fully-rendered HTML
// is simpler than threading it through every markdown
// rendering path.

/**
 * Characters considered "word boundaries" for mention
 * matching. A file path match is only accepted when the
 * character immediately before and after the match is a
 * boundary — prevents `src/foo.py` from matching inside
 * `src/foo.py.bak` or `my_src/foo.py`.
 *
 * Whitespace, HTML tag delimiters, quotes, and common
 * punctuation all qualify. Letters, digits, underscores,
 * hyphens, dots, and slashes are considered "inside a path"
 * so they don't terminate a match. The exact set matches
 * the characters that commonly appear inside repo paths.
 *
 * Note: dots ARE boundary characters at the trailing edge
 * (to allow matches at end of sentence — "see src/foo.py.")
 * but NOT at the leading edge (to prevent `.bak/foo` from
 * consuming the preceding path's final `.`). This is a
 * deliberate asymmetry; `_isBoundary` handles it via the
 * position parameter.
 *
 * @param {string} ch — single character, or '' for
 *   string boundary (position 0 or length)
 * @param {'before' | 'after'} position — whether we're
 *   checking the character BEFORE the match or AFTER
 * @returns {boolean}
 */
function _isBoundary(ch, position) {
  // String boundary (start or end of input) always counts.
  if (ch === '') return true;
  // Characters that can be inside a path — letters, digits,
  // underscore, hyphen, slash. These are NEVER boundaries.
  if (/[A-Za-z0-9_\-/]/.test(ch)) return false;
  // Dot is special — it's inside a path (extensions,
  // dotfiles) so it's NOT a boundary when BEFORE the match
  // (prevents `.env.local` from matching `env.local` when
  // the user's file list has just `env.local`). It IS a
  // boundary when AFTER the match (so `src/foo.py.` at end
  // of a sentence still matches `src/foo.py`).
  if (ch === '.') return position === 'after';
  // Everything else — whitespace, angle brackets, quotes,
  // backticks, parens, commas, semicolons, colons — are
  // boundaries on both sides.
  return true;
}

/**
 * Escape a string for safe insertion as an HTML attribute
 * value. The data-file attribute carries a repo-relative
 * path; paths can contain quotes or other characters that
 * would break out of the attribute. Escape the five
 * standard HTML-sensitive characters.
 *
 * @param {string} text
 * @returns {string}
 */
function _escapeAttr(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Walk an HTML string and produce a list of
 * {type, content} segments. Each segment is either a
 * text run ('text') or a span that should pass through
 * unchanged ('skip'). Skip segments cover:
 *
 *   - HTML tags themselves (`<p>`, `</div>`, etc.) —
 *     never touch the markup
 *   - Content inside `<pre>` or `<code>` blocks — code
 *     fences and inline code shouldn't grow mentions
 *   - HTML entities (`&amp;`, `&lt;`) treated atomically
 *     so a match doesn't split them
 *
 * The walker is a small state machine. The alternative
 * (parsing into a DOM tree with DOMParser and walking
 * text nodes) is semantically cleaner but requires
 * jsdom or a real browser; vitest tests would still need
 * to fake it. String-level walking is portable and the
 * logic is straightforward.
 *
 * @param {string} html
 * @returns {Array<{type: 'text' | 'skip', content: string}>}
 */
function _segmentHtml(html) {
  if (typeof html !== 'string' || html === '') return [];
  const segments = [];
  let i = 0;
  const n = html.length;
  let inSkipTag = null; // 'pre' | 'code' | null

  const pushText = (text) => {
    if (text === '') return;
    segments.push({ type: 'text', content: text });
  };
  const pushSkip = (text) => {
    if (text === '') return;
    segments.push({ type: 'skip', content: text });
  };

  let textBuffer = '';

  while (i < n) {
    const ch = html[i];
    if (ch === '<') {
      // Flush any accumulated text before the tag.
      if (!inSkipTag) {
        pushText(textBuffer);
        textBuffer = '';
      } else {
        // Inside a pre/code block — text is skip content.
        pushSkip(textBuffer);
        textBuffer = '';
      }
      // Find the matching '>' to capture the full tag.
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) {
        // Malformed — treat rest as skip so we don't
        // crash. The rendered HTML is from `marked` and
        // should be well-formed; this is defensive.
        pushSkip(html.slice(i));
        i = n;
        break;
      }
      const tag = html.slice(i, tagEnd + 1);
      pushSkip(tag);
      // Detect pre/code block open/close to toggle the
      // skip-mode. Match lowercase; marked emits lowercase
      // tag names.
      const openMatch = tag.match(/^<(pre|code)(\s|>)/);
      const closeMatch = tag.match(/^<\/(pre|code)\s*>/);
      if (openMatch && !inSkipTag) {
        inSkipTag = openMatch[1];
      } else if (closeMatch && closeMatch[1] === inSkipTag) {
        inSkipTag = null;
      }
      i = tagEnd + 1;
      continue;
    }
    if (ch === '&') {
      // HTML entity — capture up to the next ';' (or 8
      // chars, whichever comes first) as an atomic unit.
      // Entities inside text shouldn't be split by a
      // file-mention match.
      const entityEnd = html.indexOf(';', i);
      const maxEntityLen = 8;
      if (entityEnd !== -1 && entityEnd - i < maxEntityLen) {
        const entity = html.slice(i, entityEnd + 1);
        // Flush accumulated text, then the entity as its
        // own unit (but categorised as text/skip depending
        // on whether we're in a pre/code block).
        if (!inSkipTag) {
          pushText(textBuffer);
          textBuffer = '';
          // Entity within text — append to a fresh text
          // buffer so it can be inspected alongside the
          // rest of the text. Mention matching should
          // skip over entities but they live in text
          // content.
          textBuffer = entity;
        } else {
          pushSkip(textBuffer + entity);
          textBuffer = '';
        }
        i = entityEnd + 1;
        continue;
      }
      // Loose ampersand without terminator — treat as
      // plain char. Flows through to the default branch.
    }
    textBuffer += ch;
    i += 1;
  }
  // Flush trailing buffer.
  if (inSkipTag) {
    pushSkip(textBuffer);
  } else {
    pushText(textBuffer);
  }
  return segments;
}

/**
 * Given a text segment and a list of paths (sorted
 * longest-first), wrap every substring match whose
 * boundaries are path-delimiters with
 * `<span class="file-mention" data-file="path">path</span>`.
 *
 * Non-overlapping matches only — once a character is
 * part of a match, it isn't considered for shorter
 * paths. Longest-first sorting ensures we claim the most
 * specific match first (so `src/foo/bar.py` wins over
 * `foo/bar.py` when both are in the list and the text
 * has the longer form).
 *
 * @param {string} text
 * @param {Array<string>} sortedPaths — longest first
 * @returns {string} — HTML with wrapped matches; other
 *   characters unchanged
 */
function _wrapMatchesInText(text, sortedPaths) {
  if (!text || sortedPaths.length === 0) return text;
  // Array of {start, end, path} for non-overlapping
  // matches found so far. Kept sorted by start.
  const matches = [];
  const occupied = (pos) =>
    matches.some((m) => pos >= m.start && pos < m.end);

  for (const path of sortedPaths) {
    if (!path) continue;
    let from = 0;
    while (from <= text.length - path.length) {
      const idx = text.indexOf(path, from);
      if (idx === -1) break;
      const endIdx = idx + path.length;
      // Check boundary before and after.
      const before = idx > 0 ? text[idx - 1] : '';
      const after = endIdx < text.length ? text[endIdx] : '';
      const validBoundaries =
        _isBoundary(before, 'before') && _isBoundary(after, 'after');
      // Check no overlap with a prior (longer) match.
      const overlaps = occupied(idx) || occupied(endIdx - 1);
      if (validBoundaries && !overlaps) {
        matches.push({ start: idx, end: endIdx, path });
      }
      from = idx + 1;
    }
  }

  if (matches.length === 0) return text;
  // Sort matches by start position for rebuild.
  matches.sort((a, b) => a.start - b.start);

  // Rebuild: walk text, inserting wrapper spans at match
  // boundaries.
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.start);
    const attr = _escapeAttr(m.path);
    out += `<span class="file-mention" data-file="${attr}">${attr}</span>`;
    cursor = m.end;
  }
  out += text.slice(cursor);
  return out;
}

/**
 * Scan an HTML string for substrings matching known repo
 * file paths and wrap each match in a clickable span.
 *
 * Matches only appear in ordinary text content —
 * skipping HTML tags, `<pre>` / `<code>` block interiors,
 * and HTML entities. Longest paths win over shorter ones
 * when both could match the same substring. Matches
 * require path-boundary characters on both sides to
 * prevent partial-path collisions.
 *
 * Returns the input unchanged when `repoFiles` is empty
 * or no matches are found — cheap no-op so the chat
 * panel can call unconditionally.
 *
 * @param {string} html — rendered-markdown HTML
 * @param {Array<string>} repoFiles — flat list of
 *   repo-relative paths
 * @returns {string}
 */
export function findFileMentions(html, repoFiles) {
  if (typeof html !== 'string' || html === '') return html || '';
  if (!Array.isArray(repoFiles) || repoFiles.length === 0) {
    return html;
  }
  // Pre-filter: only consider paths that actually appear
  // as a substring. Cheap — avoids per-segment scans for
  // the 99% of paths the LLM never mentions.
  const candidates = repoFiles.filter(
    (p) => typeof p === 'string' && p && html.includes(p),
  );
  if (candidates.length === 0) return html;
  // Sort longest-first so `src/foo/bar.py` claims before
  // `foo/bar.py`. Tie-break by lexicographic for
  // determinism across runs.
  const sorted = [...candidates].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.localeCompare(b);
  });

  const segments = _segmentHtml(html);
  const parts = segments.map((seg) => {
    if (seg.type === 'skip') return seg.content;
    return _wrapMatchesInText(seg.content, sorted);
  });
  return parts.join('');
}

// Exported for tests only. Production callers should use
// `findFileMentions`.
export { _isBoundary, _segmentHtml, _wrapMatchesInText };