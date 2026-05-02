// TeX preview helpers — math rendering and scroll-sync
// anchor injection for make4ht HTML output.
//
// Separated from diff-viewer.js so the pure logic (math
// delimiter processing, TeX source scanning, HTML
// attribute injection) is unit-testable without mounting
// a Monaco editor. Mirrors the separation between
// markdown-preview.js and the diff viewer.
//
// Scope of this module:
//
//   - `renderTexMath(html)` — three-phase processing of
//     make4ht output: strip alt-text fallbacks, render
//     math delimiters via KaTeX, strip orphan plaintext
//     duplicates
//   - `extractTexAnchors(source)` — scan TeX source for
//     structural commands (sections, environments, items,
//     algorithmic commands, captions), return a list of
//     `{kind, line, text?}` entries in document order
//   - `injectSourceLines(html, anchors)` — match anchors
//     against HTML block elements by structural role +
//     document order, inject `data-source-line`
//     attributes, linearly interpolate for unmatched
//     elements
//   - Small utility exports (`cleanTexForKatex`,
//     `stripUnsupportedCommands`) for test coverage
//
// Design notes (pinned by specs4/5-webapp/tex-preview.md
// and specs-reference/5-webapp/diff-viewer.md §TeX Preview):
//
//   - **Math rendering is client-side.** make4ht emits
//     raw LaTeX delimiters (via the mathjax option in the
//     generated config). KaTeX in the browser renders
//     them. Serving pre-rendered HTML would require
//     bundling KaTeX's full CSS + fonts on the server,
//     which is wasteful when the browser already has the
//     renderer for markdown preview.
//
//   - **Three-phase math processing.** Phase 1 strips
//     `MathJax_Preview` spans make4ht emits as plain-text
//     fallbacks. Phase 2 processes delimiters in strict
//     priority order (display environments before
//     inline) and appends `<!--katex-end-->` sentinels
//     after each rendered block. Phase 3 uses the
//     sentinels as reliable anchors to strip any bare
//     text between a sentinel and the next HTML tag
//     (always a make4ht plain-text duplicate). Sentinels
//     then removed. This anchor-based cleanup avoids
//     fragile regex through KaTeX's complex output HTML.
//
//   - **HTML entity decoding in math regions.** make4ht
//     escapes math content (`&lt;` → `<` etc.). KaTeX
//     wants raw LaTeX. `cleanTexForKatex` reverses the
//     escaping.
//
//   - **Unsupported commands stripped.** `\label`,
//     `\tag`, `\nonumber`, `\notag` are rejected by
//     KaTeX but commonly appear in numbered equations.
//     Strip them before rendering.
//
//   - **Scroll sync via structural anchors, not text
//     matching.** KaTeX rendering destroys the original
//     text layout (fractions become nested divs,
//     superscripts get positioned). Text-based matching
//     is hopeless. Structural anchors (sections,
//     environments, items) survive rendering because
//     they're whitespace-level landmarks.
//
//   - **Back-to-front attribute injection.** Insertions
//     into an HTML string shift the positions of all
//     later offsets. Processing in reverse order
//     (rightmost insertion first) means earlier
//     insertions are unaffected. Simpler than tracking
//     running offset deltas.
//
//   - **Linear interpolation for unmatched elements.**
//     make4ht inserts wrapper divs that don't correspond
//     to any TeX command. These get a line number
//     between their matched neighbors (first/last
//     elements fall back to boundaries — line 1 and
//     total line count).

import katex from 'katex';

/**
 * TeX commands whose macro arguments should be ignored
 * by our scanner. Arguments can contain their own braces
 * that the scanner would otherwise misinterpret as
 * structural commands. Keep the list tight — only
 * commands that actually cause problems in practice.
 */
const _SKIP_ARG_COMMANDS = new Set([
  'label', 'ref', 'cite', 'pageref', 'bibitem',
]);

/**
 * Anchor kinds produced by extractTexAnchors. Used by
 * injectSourceLines to pick matching HTML elements.
 */
const ANCHOR_KINDS = Object.freeze({
  HEADING: 'heading',
  ENV_START: 'env-start',
  LIST_ITEM: 'list-item',
  ALGORITHMIC: 'algorithmic',
  CAPTION: 'caption',
  TITLE: 'title',
});

// -------------------------------------------------------
// Math rendering (three-phase)
// -------------------------------------------------------

/**
 * Pre-cleanup applied to text inside math regions before
 * passing to KaTeX. make4ht HTML-escapes content inside
 * math regions even though KaTeX expects raw LaTeX. Also
 * strips commands KaTeX rejects but that are commonly
 * mixed into math content (`\label{...}`, `\tag{...}`,
 * `\nonumber`, `\notag`).
 *
 * @param {string} raw — content between math delimiters
 * @returns {string}
 */
export function cleanTexForKatex(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  let text = raw;
  // Entity decode — make4ht's escaped forms.
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace between a TeX macro name and its
  // following braced argument. make4ht emits math with a
  // space inserted between macros and arguments —
  // ``\mathbf {E}`` and ``\frac {a}{b}`` — which is
  // syntactically meaningful whitespace in LaTeX the
  // engine but which KaTeX's stricter parser rejects,
  // producing a ``katex-error`` span that renders as raw
  // red source. Collapsing the space restores the
  // canonical ``\mathbf{E}`` form KaTeX expects.
  //
  // The regex matches ``\name`` followed by one or more
  // spaces followed by ``{``. Using ``[a-zA-Z]+`` for
  // the name keeps it from affecting ``\\`` row
  // separators in align bodies (those have no letters
  // after the backslash).
  text = text.replace(/(\\[a-zA-Z]+)\s+\{/g, '$1{');
  // Same fix for script operators — ``_ 0`` and ``^ 2``
  // are emitted as space-separated by make4ht, KaTeX
  // needs them adjacent.
  text = text.replace(/([_^])\s+/g, '$1');
  // Strip unsupported commands. Order matters — commands
  // with braces first, then bare commands.
  text = stripUnsupportedCommands(text);
  return text;
}

/**
 * Strip KaTeX-unsupported commands from math content.
 * `\label{foo}` and `\tag{bar}` take a braced argument;
 * `\nonumber` and `\notag` are bare. Strip both forms.
 * Exported for test visibility.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripUnsupportedCommands(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  // Commands with braced argument — lazy {...} match.
  out = out.replace(/\\(label|tag)\{[^}]*\}/g, '');
  // Bare commands — word-boundary to avoid chopping
  // `\nonumbered` or similar longer names.
  out = out.replace(/\\(nonumber|notag)(?![a-zA-Z])/g, '');
  return out;
}

/**
 * Render a single math expression via KaTeX. Returns the
 * rendered HTML plus a trailing sentinel comment that
 * Phase 3 uses to locate and strip plain-text duplicates.
 *
 * Falls back to escaped plain text if KaTeX throws. The
 * `displayMode` flag maps to KaTeX's displayMode option.
 *
 * @param {string} raw — content between delimiters
 * @param {boolean} displayMode
 * @returns {string} HTML + sentinel
 */
function _renderMath(raw, displayMode) {
  const cleaned = cleanTexForKatex(raw);
  try {
    const rendered = katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    });
    return rendered + '<!--katex-end-->';
  } catch (_) {
    // KaTeX with throwOnError:false shouldn't actually
    // throw, but defensively escape on any failure.
    const escaped = cleaned
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const tag = displayMode ? 'pre' : 'code';
    return `<${tag}>${escaped}</${tag}><!--katex-end-->`;
  }
}

/**
 * Phase 1: Strip make4ht's plaintext fallback spans.
 * These appear alongside delimited math as a
 * `<span class="MathJax_Preview">...</span>` with
 * plain-text glyph content. KaTeX output replaces them,
 * so they become visible duplicates if not removed.
 *
 * Server-side cleanup already handles some of these but
 * we run a client pass for robustness.
 *
 * @param {string} html
 * @returns {string}
 */
function _stripMathAltText(html) {
  if (typeof html !== 'string') return '';
  let out = html;
  // MathJax preview spans.
  out = out.replace(
    /<span[^>]*class="[^"]*MathJax_Preview[^"]*"[^>]*>[\s\S]*?<\/span>/g,
    '',
  );
  // make4ht also emits scripts typed as math/tex as a
  // fallback mechanism. Strip those too.
  out = out.replace(
    /<script[^>]*type="math\/tex[^"]*"[^>]*>[\s\S]*?<\/script>/g,
    '',
  );
  return out;
}

/**
 * Phase 2: Render math delimiters in priority order.
 * Display environments win over `\[...\]` which wins
 * over `$$...$$` which wins over inline `\(...\)` which
 * wins over `$...$`. Each render appends a sentinel
 * comment that Phase 3 uses for orphan cleanup.
 *
 * Display environments handled: equation, equation*,
 * align, align*, gather, gather*, multline, multline*,
 * eqnarray, eqnarray*. The star variants are unnumbered
 * but render identically as far as KaTeX cares.
 *
 * @param {string} html
 * @returns {string}
 */
function _renderMathDelimiters(html) {
  let out = html;
  // 1. Display environments. Non-greedy match with
  //    [\s\S] to span newlines. Environment name groups
  //    handle star variants.
  out = out.replace(
    /\\begin\{(equation|align|gather|multline|eqnarray)\*?\}([\s\S]*?)\\end\{\1\*?\}/g,
    (_m, _env, body) => _renderMath(body, true),
  );
  // 2. \[ ... \] — display.
  out = out.replace(
    /\\\[([\s\S]*?)\\\]/g,
    (_m, body) => _renderMath(body, true),
  );
  // 3. $$ ... $$ — display. Greedy anti-$$ class inside.
  //    [^$] avoids crossing $$ boundaries.
  out = out.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_m, body) => _renderMath(body, true),
  );
  // 4. \( ... \) — inline.
  out = out.replace(
    /\\\(([\s\S]*?)\\\)/g,
    (_m, body) => _renderMath(body, false),
  );
  // 5. $ ... $ — inline. Must not start or end with $ or
  //    whitespace. Avoids matching stray dollar signs and
  //    dollar-amount references in prose.
  out = out.replace(
    /\$([^$\s][^$\n]*?[^$\s]|[^$\s])\$/g,
    (_m, body) => _renderMath(body, false),
  );
  return out;
}

/**
 * Phase 3: Remove the sentinel comments we inserted in
 * Phase 2 so they don't leak into the final DOM.
 *
 * The original design intended this phase to ALSO strip
 * plaintext duplicates that appear between a rendered
 * KaTeX block and the next HTML tag. In practice that
 * approach is too aggressive — it strips legitimate
 * prose after inline math ("the equation $x$ shows..."
 * would eat " shows..."). make4ht's known plaintext-
 * duplicate patterns (MathJax_Preview spans, math/tex
 * script tags) are already handled by Phase 1, which
 * catches them at structural boundaries without needing
 * post-KaTeX content inspection.
 *
 * If a future make4ht version emits duplicates in a form
 * Phase 1 doesn't catch, we'll see them as visible text
 * duplicates in the rendered output — which is
 * diagnosable and fixable, unlike the previous silent-
 * prose-loss behaviour.
 *
 * @param {string} html
 * @returns {string}
 */
function _stripOrphanAltText(html) {
  return html.replace(/<!--katex-end-->/g, '');
}

/**
 * Three-phase math rendering of make4ht HTML output.
 * Idempotent — applying twice is safe because Phase 1's
 * alt-text strip is unconditional, Phase 2's delimiters
 * are consumed on the first pass, and Phase 3 only
 * strips content adjacent to sentinels that Phase 2
 * produced.
 *
 * @param {string} html
 * @returns {string}
 */
export function renderTexMath(html) {
  if (typeof html !== 'string' || !html) return '';
  try {
    let out = _stripMathAltText(html);
    out = _renderMathDelimiters(out);
    out = _stripOrphanAltText(out);
    return out;
  } catch (err) {
    console.warn('[tex-preview] math render failed', err);
    return html;
  }
}

// -------------------------------------------------------
// TeX source anchor extraction
// -------------------------------------------------------

/**
 * Scan TeX source for structural commands. Returns
 * anchors in document order with their 1-based line
 * numbers and optional text content (used for
 * verification during matching, though current
 * matching is order-based).
 *
 * Commands scanned:
 *   - `\section{...}`, `\subsection{...}`, etc. →
 *     heading (depth encoded in kind is not needed;
 *     matching uses whichever heading tag the HTML
 *     produces)
 *   - `\begin{env}` (env != document) → env-start
 *   - `\item` → list-item
 *   - `\STATE`, `\REQUIRE`, `\IF`, `\WHILE`, `\FOR`,
 *     `\ENSURE`, `\RETURN`, `\COMMENT` → algorithmic
 *   - `\caption{...}` → caption
 *   - `\maketitle` → title
 *
 * `\end{env}` is deliberately NOT emitted — it has no
 * corresponding HTML element (environments close as
 * their container element ends).
 *
 * @param {string} source — TeX source
 * @returns {Array<{kind: string, line: number, text?: string}>}
 */
export function extractTexAnchors(source) {
  if (typeof source !== 'string' || !source) return [];
  const anchors = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNum = i + 1;
    // Line comments — strip % to end of line unless %
    // is escaped. Simple heuristic; full comment parsing
    // would require tracking \% escape state.
    const stripped = _stripLineComment(line);
    if (!stripped.trim()) continue;
    // Heading commands. `\section`, `\section*`,
    // `\subsection`, `\subsection*`, etc.
    const headingMatch = stripped.match(
      /\\(section|subsection|subsubsection|paragraph|subparagraph|chapter|part)\*?\s*\{/,
    );
    if (headingMatch) {
      const text = _extractBracedArg(stripped, headingMatch.index);
      anchors.push({
        kind: ANCHOR_KINDS.HEADING,
        line: lineNum,
        text: text || '',
      });
      continue;
    }
    // Environment start. Skip `document` — it wraps the
    // whole output and isn't a meaningful visual anchor.
    const beginMatch = stripped.match(/\\begin\{([^}]+)\}/);
    if (beginMatch) {
      const env = beginMatch[1];
      if (env !== 'document') {
        anchors.push({
          kind: ANCHOR_KINDS.ENV_START,
          line: lineNum,
          text: env,
        });
      }
      continue;
    }
    // List items.
    if (/\\item\b/.test(stripped)) {
      anchors.push({
        kind: ANCHOR_KINDS.LIST_ITEM,
        line: lineNum,
      });
      continue;
    }
    // Algorithmic commands — from algorithm / algpseudo-
    // code packages. Add more as needed; the listed set
    // covers the common cases.
    if (
      /\\(STATE|REQUIRE|ENSURE|IF|ELSIF|ELSE|ENDIF|WHILE|ENDWHILE|FOR|ENDFOR|REPEAT|UNTIL|RETURN|COMMENT)\b/.test(
        stripped,
      )
    ) {
      anchors.push({
        kind: ANCHOR_KINDS.ALGORITHMIC,
        line: lineNum,
      });
      continue;
    }
    // Caption.
    const captionMatch = stripped.match(/\\caption\s*\{/);
    if (captionMatch) {
      const text = _extractBracedArg(stripped, captionMatch.index);
      anchors.push({
        kind: ANCHOR_KINDS.CAPTION,
        line: lineNum,
        text: text || '',
      });
      continue;
    }
    // Title.
    if (/\\maketitle\b/.test(stripped)) {
      anchors.push({
        kind: ANCHOR_KINDS.TITLE,
        line: lineNum,
      });
    }
  }
  return anchors;
}

/**
 * Strip a TeX line comment. `%` starts a comment unless
 * escaped as `\%`. Returns the line up to (but not
 * including) the first unescaped `%`, or the whole line
 * if none found.
 */
function _stripLineComment(line) {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '\\') {
      // Skip the backslash and the next character
      // (escape sequence).
      i += 2;
      continue;
    }
    if (ch === '%') return line.slice(0, i);
    i += 1;
  }
  return line;
}

/**
 * Extract the content of a braced argument starting at
 * `startIdx` in `text`. Handles nested braces. Returns
 * empty string if the brace structure is malformed.
 *
 * `startIdx` can point anywhere at or before the opening
 * `{` — the scanner searches forward for the first brace.
 */
function _extractBracedArg(text, startIdx) {
  const openIdx = text.indexOf('{', startIdx);
  if (openIdx < 0) return '';
  let depth = 1;
  let i = openIdx + 1;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    if (ch === '\\') {
      // Skip escape.
      i += 2;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
    i += 1;
  }
  return '';
}

// -------------------------------------------------------
// HTML block-element walking + anchor matching
// -------------------------------------------------------

/**
 * Block-level tag names we annotate with
 * `data-source-line`. Walked in document order. Order in
 * the array doesn't matter — the walker treats the set
 * as unordered.
 */
const _BLOCK_TAGS = Object.freeze([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'div', 'table', 'ol', 'ul', 'li', 'pre',
  'blockquote', 'section', 'article', 'figure',
]);

/**
 * Roles each anchor kind can match. The matcher walks
 * HTML elements in document order and tries to associate
 * each anchor with the next element whose role list
 * includes the anchor's kind. A small lookahead window
 * tolerates make4ht wrapper divs.
 */
const _KIND_ROLES = Object.freeze({
  [ANCHOR_KINDS.HEADING]: new Set([
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section',
  ]),
  [ANCHOR_KINDS.ENV_START]: new Set([
    'div', 'table', 'ol', 'ul', 'pre', 'figure', 'blockquote',
  ]),
  [ANCHOR_KINDS.LIST_ITEM]: new Set(['li', 'p', 'div']),
  [ANCHOR_KINDS.ALGORITHMIC]: new Set(['li', 'p', 'div']),
  [ANCHOR_KINDS.CAPTION]: new Set(['div', 'p', 'figcaption']),
  [ANCHOR_KINDS.TITLE]: new Set(['div', 'h1', 'header']),
});

/**
 * Lookahead window when matching an anchor to an HTML
 * element. Tolerates a small number of make4ht wrapper
 * divs between the anchor's natural position and the
 * target element. Twelve has been enough in practice;
 * bumping doesn't hurt correctness.
 */
const _MATCH_LOOKAHEAD = 12;

/**
 * Scan `html` for block-element opening tags, returning
 * `[{index, length, tag}]` in document order. `index`
 * points at the `<` of the opening tag; `length` is the
 * full tag length through `>`. Self-closing tags (`<br/>`)
 * are ignored since they're not block-level.
 *
 * Exported for test visibility.
 *
 * @param {string} html
 * @returns {Array<{index: number, length: number, tag: string}>}
 */
export function collectBlockElements(html) {
  if (typeof html !== 'string' || !html) return [];
  const results = [];
  // Tag name + optional attributes + closing >.
  const re = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    if (!_BLOCK_TAGS.includes(tag)) continue;
    results.push({
      index: match.index,
      length: match[0].length,
      tag,
    });
  }
  return results;
}

/**
 * Match anchors to HTML block elements. Returns a map
 * from element array index to line number. Unmatched
 * elements get linearly-interpolated line numbers
 * between their nearest anchored neighbors; boundary
 * elements fall back to 1 and totalLines.
 *
 * Walks anchors in order. For each anchor, searches
 * elements[searchFrom..searchFrom+lookahead] for the
 * first unassigned one whose tag matches the anchor's
 * kind. If no match within the window, the anchor is
 * dropped (better than force-matching to the wrong
 * element). searchFrom advances past the matched
 * element so subsequent anchors don't go backward.
 *
 * @param {Array} anchors — from extractTexAnchors
 * @param {Array} elements — from collectBlockElements
 * @param {number} totalLines — total TeX source lines
 * @returns {Map<number, number>} element idx → line
 */
export function matchAnchorsToElements(
  anchors,
  elements,
  totalLines,
) {
  const assigned = new Map();
  let searchFrom = 0;
  for (const anchor of anchors) {
    const roles = _KIND_ROLES[anchor.kind];
    if (!roles) continue;
    const windowEnd = Math.min(
      searchFrom + _MATCH_LOOKAHEAD,
      elements.length,
    );
    let matchIdx = -1;
    for (let i = searchFrom; i < windowEnd; i += 1) {
      if (assigned.has(i)) continue;
      if (roles.has(elements[i].tag)) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx < 0) continue;
    assigned.set(matchIdx, anchor.line);
    searchFrom = matchIdx + 1;
  }
  // Linear interpolation for unmatched elements.
  if (elements.length === 0) return assigned;
  // First element — boundary fallback to line 1.
  if (!assigned.has(0)) assigned.set(0, 1);
  // Last element — boundary fallback to totalLines.
  const lastIdx = elements.length - 1;
  if (!assigned.has(lastIdx)) {
    assigned.set(lastIdx, Math.max(totalLines, 1));
  }
  // Interpolate between anchored neighbors.
  let i = 0;
  while (i < elements.length) {
    if (assigned.has(i)) {
      i += 1;
      continue;
    }
    // Find next anchored index.
    let j = i + 1;
    while (j < elements.length && !assigned.has(j)) j += 1;
    if (j >= elements.length) {
      // Shouldn't happen — last element was assigned
      // above.
      break;
    }
    const startLine = assigned.get(i - 1);
    const endLine = assigned.get(j);
    const span = j - (i - 1);
    for (let k = i; k < j; k += 1) {
      const frac = (k - (i - 1)) / span;
      const interp = Math.round(
        startLine + frac * (endLine - startLine),
      );
      assigned.set(k, Math.max(1, interp));
    }
    i = j;
  }
  return assigned;
}

/**
 * Splice `data-source-line` attributes into the HTML
 * string. Processes insertions back-to-front so earlier
 * insertions don't shift later offsets.
 *
 * If an element already has a `data-source-line`
 * attribute, it's replaced — this keeps injection
 * idempotent.
 *
 * @param {string} html
 * @param {Array} elements — from collectBlockElements
 * @param {Map<number, number>} assignments — idx → line
 * @returns {string}
 */
export function injectAttributes(html, elements, assignments) {
  if (!elements.length) return html;
  // Sort element indices in reverse order of their
  // position in the HTML string.
  const indices = [...assignments.keys()].sort(
    (a, b) => elements[b].index - elements[a].index,
  );
  let out = html;
  for (const idx of indices) {
    const el = elements[idx];
    const line = assignments.get(idx);
    if (line == null) continue;
    const tagStart = el.index;
    const tagEnd = el.index + el.length;
    const originalTag = out.slice(tagStart, tagEnd);
    // Remove any existing data-source-line so we don't
    // duplicate.
    let stripped = originalTag.replace(
      /\s+data-source-line="[^"]*"/,
      '',
    );
    // Insert new attribute right before the closing `>`.
    // Handle self-closing `/>` form defensively though
    // block elements don't produce one.
    const newTag = stripped.replace(
      /(\/?>)$/,
      ` data-source-line="${line}"$1`,
    );
    out = out.slice(0, tagStart) + newTag + out.slice(tagEnd);
  }
  return out;
}

/**
 * Annotate make4ht HTML output with `data-source-line`
 * attributes mapped to TeX source lines. Convenience
 * wrapper around collectBlockElements,
 * matchAnchorsToElements, and injectAttributes.
 *
 * @param {string} html — make4ht output (post math render)
 * @param {Array} anchors — from extractTexAnchors
 * @param {number} totalLines — total TeX source lines
 * @returns {string}
 */
export function injectSourceLines(html, anchors, totalLines) {
  if (typeof html !== 'string' || !html) return html;
  const elements = collectBlockElements(html);
  if (elements.length === 0) return html;
  const assignments = matchAnchorsToElements(
    anchors,
    elements,
    totalLines,
  );
  return injectAttributes(html, elements, assignments);
}

// Exported constants for test visibility.
export { ANCHOR_KINDS };