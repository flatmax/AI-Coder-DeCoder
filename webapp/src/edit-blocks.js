// Frontend parser for LLM edit blocks.
//
// Matches the backend's delimiter bytes exactly (D3 in
// IMPLEMENTATION_NOTES.md) — three orange squares, three yellow,
// three green. Do not substitute ASCII or translate.
//
// Scope: segment an assistant response into prose and edit-block
// regions so the chat panel can render text through markdown and
// edit blocks as visual cards. The segmenter is deliberately
// tolerant of incomplete blocks — mid-stream an assistant response
// may terminate at any point inside a block, and the renderer
// needs to show a "pending" card rather than treating the partial
// block as prose.
//
// Deliberate divergence from the backend parser (specs3 docs it
// explicitly):
//   - Frontend is display-only. If we miss an extensionless
//     filename like `Makefile` the block still applies correctly
//     server-side; we just render it as text.
//   - No anchor matching, no validation, no application — just
//     "where are the block boundaries".
//
// Per-file occurrence counter for matching to backend results:
// the Nth edit block for file X in a response maps to the Nth
// entry for file X in `edit_results`. Callers are responsible
// for the counting — `segmentResponse` only emits segments in
// source order with their `filePath`.

/** Start marker — literal orange-orange-orange + space + EDIT. */
export const EDIT_MARK = '🟧🟧🟧 EDIT';
/** Separator marker — yellow-yellow-yellow + space + REPL. */
export const REPL_MARK = '🟨🟨🟨 REPL';
/** End marker — green-green-green + space + END. */
export const END_MARK = '🟩🟩🟩 END';

/**
 * Minimal extensionless filename whitelist.
 *
 * Backend's list is broader (`Makefile`, `Dockerfile`, `Gemfile`,
 * `Rakefile`, `Procfile`, `Brewfile`, `Justfile`, `Vagrantfile`).
 * The frontend only needs the common two for visual recognition
 * — a `Rakefile` edit still applies correctly on the backend
 * even if the frontend renders it as prose. The asymmetry is
 * deliberate (D-level decision in specs3 — not a bug).
 */
const EXTENSIONLESS_FILENAMES = new Set(['Makefile', 'Dockerfile']);

/**
 * Heuristic: is `line` plausibly a file path?
 *
 * Rules match the backend loosely (specs3/3-llm-engine/edit_protocol.md#file-path-detection):
 *   - Not empty, not excessively long
 *   - Not a comment (common prefixes: #, //, *, -, >, ```)
 *   - Contains `/` or `\` — path with separators (common case)
 *   - OR matches filename-with-extension regex
 *   - OR matches dotfile regex (.gitignore, .env.local)
 *   - OR is a known extensionless name (Makefile, Dockerfile)
 *
 * Returns true only if exactly one of the accept rules matches.
 *
 * @param {string} line
 * @returns {boolean}
 */
export function isFilePath(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 200) return false;

  // Comment prefixes — not paths.
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('-') ||
    trimmed.startsWith('>') ||
    trimmed.startsWith('```')
  ) {
    return false;
  }

  // Path with separators — covers src/foo.py, a\b\c.ts, etc.
  if (/[\/\\]/.test(trimmed)) return true;

  // Filename with extension (simple case: foo.js, .env.local).
  if (/^\.?[\w\-.]+\.\w+$/.test(trimmed)) return true;

  // Dotfile without extension (.gitignore, .dockerignore).
  if (/^\.\w[\w\-.]*$/.test(trimmed)) return true;

  // Extensionless whitelist.
  if (EXTENSIONLESS_FILENAMES.has(trimmed)) return true;

  return false;
}

/**
 * @typedef {Object} TextSegment
 * @property {'text'} type
 * @property {string} content — raw text, unparsed markdown
 *
 * @typedef {Object} EditSegment
 * @property {'edit'} type
 * @property {string} filePath — path as it appeared in the response
 * @property {string} oldText — content between EDIT and REPL markers
 * @property {string} newText — content between REPL and END markers
 * @property {boolean} isCreate — true when oldText is empty/whitespace
 *
 * @typedef {Object} EditPendingSegment
 * @property {'edit-pending'} type
 * @property {string} filePath
 * @property {'expect-edit'|'reading-old'|'reading-new'} phase
 * @property {string} oldText — what has been accumulated so far
 * @property {string} newText — what has been accumulated so far
 *
 * @typedef {TextSegment | EditSegment | EditPendingSegment} Segment
 */

/**
 * Segment an assistant response into prose and edit-block regions.
 *
 * The parser is a small state machine with four states. It walks
 * lines once, accumulating text or block content according to
 * state, and emits segments in source order.
 *
 * Incomplete blocks (stream ended mid-block) produce an
 * `edit-pending` segment with whatever was accumulated up to the
 * truncation point. The frontend renders these as "pending" cards
 * with a partial diff preview.
 *
 * Code fences wrapped around edit blocks (a common LLM formatting
 * quirk) are stripped — an opening fence immediately before a file
 * path, and a closing fence immediately after `END`, both
 * disappear from the emitted text segment. Fences not adjacent to
 * blocks pass through as text.
 *
 * @param {string} text — full assistant response (may be partial
 *   during streaming)
 * @returns {Segment[]}
 */
export function segmentResponse(text) {
  if (typeof text !== 'string' || text === '') return [];

  const lines = text.split('\n');
  /** @type {Segment[]} */
  const segments = [];
  /** @type {string[]} */
  let textBuffer = [];
  let state = 'scanning';
  /** @type {string | null} */
  let pendingPath = null;
  /** @type {string | null} */
  let currentPath = null;
  /** @type {string[]} */
  let oldLines = [];
  /** @type {string[]} */
  let newLines = [];

  const flushText = () => {
    if (textBuffer.length === 0) return;
    // Strip a trailing code-fence line if present — the fence is
    // the LLM wrapping the edit block and shouldn't appear as
    // prose. Only strip one line.
    if (
      textBuffer.length > 0 &&
      /^```/.test(textBuffer[textBuffer.length - 1].trim())
    ) {
      textBuffer.pop();
    }
    const content = textBuffer.join('\n');
    if (content !== '') {
      segments.push({ type: 'text', content });
    }
    textBuffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.trim();

    switch (state) {
      case 'scanning': {
        if (isFilePath(stripped)) {
          // Possible start of a block — hold the path, peek
          // next non-blank line for EDIT marker.
          pendingPath = stripped;
          state = 'expect-edit';
        } else {
          textBuffer.push(line);
        }
        break;
      }

      case 'expect-edit': {
        if (stripped === EDIT_MARK) {
          // Confirmed block — flush any accumulated text
          // (minus optional fence wrapper) and enter the
          // old-section.
          flushText();
          currentPath = pendingPath;
          pendingPath = null;
          oldLines = [];
          newLines = [];
          state = 'reading-old';
        } else if (stripped === '') {
          // Blank line between path and marker is tolerated.
          continue;
        } else if (isFilePath(stripped)) {
          // The "path" we held was actually a text line; the
          // real path candidate is this one. Push the old
          // pending path to the text buffer and try again.
          if (pendingPath !== null) textBuffer.push(pendingPath);
          pendingPath = stripped;
        } else {
          // Not a block — push the pending path back to text
          // and resume scanning with this line.
          if (pendingPath !== null) {
            textBuffer.push(pendingPath);
            pendingPath = null;
          }
          textBuffer.push(line);
          state = 'scanning';
        }
        break;
      }

      case 'reading-old': {
        if (stripped === REPL_MARK) {
          state = 'reading-new';
        } else {
          oldLines.push(line);
        }
        break;
      }

      case 'reading-new': {
        if (stripped === END_MARK) {
          const oldText = oldLines.join('\n');
          const newText = newLines.join('\n');
          segments.push({
            type: 'edit',
            filePath: currentPath,
            oldText,
            newText,
            isCreate: oldText.trim() === '',
          });
          currentPath = null;
          oldLines = [];
          newLines = [];
          state = 'scanning';
          // Look ahead — if the next line is a closing code
          // fence paired with the wrapper, skip it so it
          // doesn't appear as prose.
          if (
            i + 1 < lines.length &&
            /^```/.test(lines[i + 1].trim())
          ) {
            i += 1;
          }
        } else {
          newLines.push(line);
        }
        break;
      }

      default:
        // Unreachable, but defensive.
        state = 'scanning';
    }
  }

  // Handle truncation — stream ended mid-block.
  if (state === 'expect-edit' && pendingPath !== null) {
    // Saw a candidate path but no EDIT marker followed. Treat
    // as text so the user sees what the LLM typed.
    textBuffer.push(pendingPath);
    pendingPath = null;
  }

  if (state === 'reading-old' || state === 'reading-new') {
    // Flush accumulated text before the pending block.
    flushText();
    segments.push({
      type: 'edit-pending',
      filePath: currentPath,
      phase: state,
      oldText: oldLines.join('\n'),
      newText: newLines.join('\n'),
    });
    currentPath = null;
    oldLines = [];
    newLines = [];
  }

  flushText();
  return segments;
}

/**
 * Match edit segments to their corresponding backend results.
 *
 * The backend's `stream-complete.result.edit_results` is an
 * ordered array of `{file, status, message, error_type, ...}`
 * dicts. Segments from `segmentResponse` appear in source order
 * but may include multiple edits for the same file.
 *
 * Per specs3's "per-file index counter" pattern: the Nth edit
 * block for file X in the response maps to the Nth entry for
 * file X in `edit_results`. We track a cursor per file and
 * increment it as we match.
 *
 * Returns a parallel array aligned to `segments` where each
 * element is the matched result or `null` for non-edit or
 * unmatched segments.
 *
 * @param {Segment[]} segments
 * @param {Array<{file: string, status: string, message?: string,
 *   error_type?: string}>} editResults
 * @returns {Array<object|null>}
 */
export function matchSegmentsToResults(segments, editResults) {
  if (!Array.isArray(segments)) return [];
  if (!Array.isArray(editResults) || editResults.length === 0) {
    return segments.map(() => null);
  }
  // Group results by file, preserving order within each group.
  //
  // Backend key is `file_path` per
  // specs3/3-llm-engine/edit_protocol.md. Fall back to `file`
  // so tests using shortened fixture shape still work.
  /** @type {Map<string, Array<object>>} */
  const byFile = new Map();
  for (const result of editResults) {
    const file =
      result &&
      (typeof result.file_path === 'string'
        ? result.file_path
        : typeof result.file === 'string'
          ? result.file
          : null);
    if (typeof file !== 'string') continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(result);
  }
  // Cursor per file tracking how many results we've consumed.
  /** @type {Map<string, number>} */
  const cursor = new Map();
  return segments.map((seg) => {
    if (seg.type !== 'edit') return null;
    const file = seg.filePath;
    if (typeof file !== 'string') return null;
    const results = byFile.get(file);
    if (!results) return null;
    const idx = cursor.get(file) || 0;
    if (idx >= results.length) return null;
    cursor.set(file, idx + 1);
    return results[idx];
  });
}