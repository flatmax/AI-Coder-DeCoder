// Pure rendering helpers for edit-block cards.
//
// Separated from chat-panel.js so the rendering logic can be
// unit-tested without mounting a full Lit component. Each
// function returns a plain HTML string suitable for passing to
// Lit's `unsafeHTML` directive.
//
// Status → icon + CSS-class mapping centralised here so a future
// commit that adds localization or restyles the badges touches
// exactly one file.

import { diffLines, diffWords } from 'diff';

import { escapeHtml } from './markdown.js';

/**
 * Compute a line-level diff between two text buffers. Returns
 * a flat array of `{type, text}` objects where `type` is one
 * of `'context'`, `'add'`, `'remove'`.
 *
 * Empty inputs produce an empty array rather than a single
 * zero-length line — callers (renderEditBody) already handle
 * the empty-pane case separately so this stays small.
 *
 * Uses the `diff` package's Myers algorithm via `diffLines`.
 * We strip the trailing newline the library produces for
 * each chunk so our line model is one-record-per-line.
 */
export function _computeDiff(oldText, newText) {
  const a = typeof oldText === 'string' ? oldText : '';
  const b = typeof newText === 'string' ? newText : '';
  if (a === '' && b === '') return [];
  const changes = diffLines(a, b);
  const out = [];
  for (const change of changes) {
    const type = change.added
      ? 'add'
      : change.removed
        ? 'remove'
        : 'context';
    // `diffLines` returns a single `value` string containing
    // every line in the run, terminated by newlines. Split
    // per-line so downstream renderers can style each
    // individually. The final empty element after a trailing
    // newline is dropped — it's the "end of buffer" marker,
    // not an actual blank line.
    const raw = change.value;
    const parts = raw.split('\n');
    if (parts.length > 1 && parts[parts.length - 1] === '') {
      parts.pop();
    }
    for (const text of parts) {
      out.push({ type, text });
    }
  }
  return out;
}

/**
 * Compute a word-level diff between two single-line strings.
 * Used inside `renderEditBody` to highlight the specific
 * within-line changes when a `remove` run pairs cleanly with
 * an `add` run.
 *
 * Returns two parallel arrays of `{type, text}` segments:
 *   - `old` segments: `'equal'` or `'delete'`
 *   - `new` segments: `'equal'` or `'insert'`
 *
 * Consecutive same-type segments are merged so the rendered
 * output doesn't fragment on word boundaries. The `diff`
 * package's output can split on every word boundary which
 * produces visually noisy highlighting; merging adjacent
 * equals makes the rendered diff readable.
 */
export function _computeCharDiff(oldStr, newStr) {
  const a = typeof oldStr === 'string' ? oldStr : '';
  const b = typeof newStr === 'string' ? newStr : '';
  const changes = diffWords(a, b);
  const oldSegs = [];
  const newSegs = [];
  for (const change of changes) {
    if (change.added) {
      newSegs.push({ type: 'insert', text: change.value });
    } else if (change.removed) {
      oldSegs.push({ type: 'delete', text: change.value });
    } else {
      oldSegs.push({ type: 'equal', text: change.value });
      newSegs.push({ type: 'equal', text: change.value });
    }
  }
  return {
    old: _mergeAdjacent(oldSegs),
    new: _mergeAdjacent(newSegs),
  };
}

/**
 * Merge adjacent segments of the same `type` into one. The
 * `diff` package's word tokenizer can produce runs like
 * `[equal 'foo', equal ' ', equal 'bar']` which all collapse
 * to a single `equal 'foo bar'`. Shortens the output HTML
 * and avoids visual fragmentation.
 */
function _mergeAdjacent(segs) {
  const out = [];
  for (const seg of segs) {
    const last = out.length > 0 ? out[out.length - 1] : null;
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      out.push({ type: seg.type, text: seg.text });
    }
  }
  return out;
}

/**
 * Walk a line-level diff and pair adjacent remove/add runs
 * for character-level diffing. Returns an array parallel to
 * the input where each `add` or `remove` entry may carry a
 * `charDiff` field: `{old: [...], new: [...]}` for the
 * paired-line case, absent for unpaired runs.
 *
 * Pairing rule: N consecutive `remove` lines followed by N
 * consecutive `add` lines pair 1:1 in order. Asymmetric runs
 * (more removes than adds, or vice versa) leave the excess
 * unpaired — they get whole-line highlighting only, per
 * specs §Pairing.
 */
export function _pairDiffLines(lines) {
  const out = lines.map((l) => ({ ...l }));
  let i = 0;
  while (i < out.length) {
    if (out[i].type !== 'remove') {
      i += 1;
      continue;
    }
    let removeEnd = i;
    while (removeEnd < out.length && out[removeEnd].type === 'remove') {
      removeEnd += 1;
    }
    let addEnd = removeEnd;
    while (addEnd < out.length && out[addEnd].type === 'add') {
      addEnd += 1;
    }
    const removes = removeEnd - i;
    const adds = addEnd - removeEnd;
    const paired = Math.min(removes, adds);
    for (let k = 0; k < paired; k += 1) {
      const oldIdx = i + k;
      const newIdx = removeEnd + k;
      const cd = _computeCharDiff(out[oldIdx].text, out[newIdx].text);
      out[oldIdx].charDiff = cd;
      out[newIdx].charDiff = cd;
    }
    i = addEnd;
  }
  return out;
}

/**
 * Map of backend `EditStatus` values to display metadata.
 *
 * Backend statuses come from specs4/3-llm/edit-protocol.md's
 * "Per-Block Results" table plus the `EditStatus` enum in
 * src/ac_dc/edit_protocol.py. Frontend-only synthetic statuses
 * (`pending`, `new`) extend the map — pending segments have no
 * backend result yet, and create blocks are distinguished from
 * modify blocks here rather than by walking the block body.
 *
 * `cssClass` is always `edit-status-{status}` so the stylesheet
 * can hook without the renderer needing to know about colours.
 */
const STATUS_META = {
  applied: { icon: '✅', label: 'Applied', cssClass: 'edit-status-applied' },
  already_applied: {
    icon: '✅',
    label: 'Already applied',
    cssClass: 'edit-status-applied',
  },
  validated: {
    icon: '☑',
    label: 'Validated',
    cssClass: 'edit-status-validated',
  },
  failed: { icon: '❌', label: 'Failed', cssClass: 'edit-status-failed' },
  skipped: { icon: '⚠️', label: 'Skipped', cssClass: 'edit-status-skipped' },
  not_in_context: {
    icon: '⚠️',
    label: 'Not in context',
    cssClass: 'edit-status-not-in-context',
  },
  // Frontend-only synthetic statuses.
  pending: {
    icon: '⏳',
    label: 'Pending',
    cssClass: 'edit-status-pending',
  },
  new: { icon: '🆕', label: 'New file', cssClass: 'edit-status-new' },
};

/**
 * Resolve a segment + optional backend result into a display
 * status string. The string is always a key of STATUS_META.
 *
 * Precedence:
 *   1. pending segments → `pending` (regardless of result —
 *      there shouldn't be one anyway, but defensive)
 *   2. segments with a backend result → result.status
 *   3. create-block edit segments with no result → `new`
 *      (visually distinct from a pending modify)
 *   4. modify-block edit segments with no result → `pending`
 *      (the stream is still in flight, or the backend didn't
 *      emit a result for this block — either way, "not yet
 *      settled" is the correct user-facing story)
 *
 * @param {Object} segment — from segmentResponse()
 * @param {Object | null} result — from matchSegmentsToResults()
 * @returns {string}
 */
export function resolveDisplayStatus(segment, result) {
  if (segment.type === 'edit-pending') return 'pending';
  if (result && typeof result.status === 'string') {
    // Accept any backend status; unknown ones fall through to
    // the default icon via STATUS_META lookup (null-coalesced
    // in renderStatusBadge).
    return result.status;
  }
  if (segment.type === 'edit' && segment.isCreate) return 'new';
  return 'pending';
}

/**
 * Render the status badge — icon + label. Returns an HTML
 * string safe to embed via `unsafeHTML`.
 *
 * Unknown statuses render with a generic clipboard icon so a
 * new backend status doesn't crash rendering; the label is the
 * raw status string so the user can see what came through.
 *
 * @param {string} status
 * @returns {string}
 */
export function renderStatusBadge(status) {
  const meta = STATUS_META[status] || {
    icon: '📋',
    label: status,
    cssClass: 'edit-status-unknown',
  };
  return (
    `<span class="edit-status-badge ${meta.cssClass}">` +
    `<span class="edit-status-icon">${meta.icon}</span>` +
    `<span class="edit-status-label">${escapeHtml(meta.label)}</span>` +
    `</span>`
  );
}

/**
 * Render the file-path line. The path is escaped — paths can
 * contain characters that would otherwise inject markup
 * (backticks in tests, angle brackets in pathological cases).
 *
 * When `oldText` is non-empty, a `data-edit-anchor` attribute
 * carries its first non-blank line. The chat panel's
 * delegated click handler picks this up and dispatches
 * `navigate-file` with `{path, searchText}` — the diff
 * viewer's existing `_scrollToSearchText` logic then lands
 * the user at the edit location in the opened file.
 *
 * Create blocks (empty oldText) get a path with no anchor;
 * clicking just opens the new file without scrolling.
 *
 * @param {string} filePath
 * @param {string} [oldText] — edit block's old-text buffer,
 *   used to derive the scroll anchor
 * @returns {string}
 */
export function renderFilePath(filePath, oldText) {
  const safe = typeof filePath === 'string' ? filePath : '';
  const anchor = _firstNonBlankLine(oldText);
  const anchorAttr = anchor
    ? ` data-edit-anchor="${escapeHtml(anchor)}"`
    : '';
  return (
    `<span class="edit-file-path" ` +
    `data-edit-path="${escapeHtml(safe)}"` +
    `${anchorAttr} ` +
    `role="button" tabindex="0" ` +
    `title="Open ${escapeHtml(safe)} in diff viewer">` +
    escapeHtml(safe) +
    `</span>`
  );
}

/**
 * Extract the first non-blank line from a buffer. Trims and
 * caps at 200 chars so excessively long lines don't produce
 * huge attribute values. Returns an empty string for empty
 * or all-whitespace input — the caller uses the empty string
 * to suppress the `data-edit-anchor` attribute entirely.
 */
function _firstNonBlankLine(text) {
  if (typeof text !== 'string' || text === '') return '';
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
    }
  }
  return '';
}

/**
 * Render a single diff line as a `<span class="diff-line
 * {type}">` element. A non-selectable prefix (`+`/`-`/` `)
 * marks the line type so copy-paste round-trips produce
 * unified-diff-shaped output, matching common editor
 * conventions.
 *
 * Lines with a `charDiff` wrap changed segments in
 * `<span class="diff-change">` so word-level changes stand
 * out inside the line-level coloured background. Context
 * lines and unpaired add/remove lines (where word-level
 * diffing doesn't apply) render as flat escaped text.
 */
function _renderDiffLine(line, side) {
  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
  let content;
  if (line.charDiff) {
    const segs = side === 'old' ? line.charDiff.old : line.charDiff.new;
    const wantType = side === 'old' ? 'delete' : 'insert';
    const renderedSegs = segs
      .map((seg) => {
        const escaped = escapeHtml(seg.text);
        if (seg.type === 'equal') return escaped;
        if (seg.type === wantType) {
          return `<span class="diff-change">${escaped}</span>`;
        }
        // Shouldn't happen — old-side segments are
        // equal/delete, new-side are equal/insert. Defensive
        // passthrough.
        return escaped;
      })
      .join('');
    content = renderedSegs;
  } else {
    content = escapeHtml(line.text);
  }
  return (
    `<span class="diff-line ${line.type}">` +
    `<span class="diff-prefix" aria-hidden="true">${prefix}</span>` +
    `<span class="diff-text">${content}</span>` +
    `</span>`
  );
}

/**
 * Render the body of an edit card as a unified diff — one
 * column of lines, each prefixed `-` / `+` / ` ` for
 * remove / add / context. Paired remove/add runs get
 * word-level highlights inside the line-level coloured
 * background via `_computeCharDiff`.
 *
 * Per specs3/5-webapp/chat_interface.md §Two-Level Diff
 * Highlighting — the visual model is unified-diff style
 * (one column), not side-by-side. Side-by-side OLD/NEW
 * panes make short edits look like huge blocks and waste
 * horizontal space on tall cards.
 *
 * Create blocks (empty OLD buffer) still render correctly
 * — every line is `+`/add with no remove counterpart.
 * Pending segments mid-stream work too; the diff library
 * handles partial input gracefully.
 *
 * @param {Object} segment
 * @returns {string}
 */
export function renderEditBody(segment) {
  const oldText = typeof segment.oldText === 'string' ? segment.oldText : '';
  const newText = typeof segment.newText === 'string' ? segment.newText : '';
  const rawLines = _computeDiff(oldText, newText);
  const lines = _pairDiffLines(rawLines);
  // Render every line in a single column. For a paired
  // remove/add pair, the remove line picks the `old` side
  // of the char-diff and the add line picks the `new` side.
  // The overall visual order comes straight from
  // `_computeDiff` — the diff library already orders
  // remove-then-add for each changed run, which matches
  // the unified-diff convention.
  //
  // Join with `\n` between lines and wrap in a `<div>`
  // (not `<pre>`) so that:
  //   - `textContent` of the container includes the
  //     newlines — tests and clipboard round-trips see
  //     line breaks between diff lines, not
  //     concatenated runs
  //   - visually the `\n` text nodes between `.diff-line`
  //     block elements collapse (the outer container has
  //     default `white-space: normal`, and whitespace
  //     between adjacent blocks is ignored by block
  //     layout) — so no visible blank rows
  //   - intra-line whitespace is still preserved because
  //     `.diff-line` itself carries `white-space: pre`
  //     in its CSS
  const body = lines
    .map((l) => {
      const side = l.type === 'add' ? 'new' : 'old';
      return _renderDiffLine(l, side);
    })
    .join('\n');
  return (
    `<div class="edit-body">` +
      `<div class="edit-pane-content">${body}</div>` +
    `</div>`
  );
}

/**
 * Render the optional error message for failed edits.
 *
 * Only renders when the backend result carries a non-empty
 * message AND the status is one where the message is
 * informational (`failed`, `skipped`, `not_in_context`). For
 * `applied` / `validated` the message is often empty or noisy;
 * suppressing keeps the happy-path card compact.
 *
 * @param {Object | null} result
 * @returns {string} — empty string when nothing to render
 */
export function renderErrorMessage(result) {
  if (!result) return '';
  const status = typeof result.status === 'string' ? result.status : '';
  if (!['failed', 'skipped', 'not_in_context'].includes(status)) {
    return '';
  }
  const message = typeof result.message === 'string' ? result.message : '';
  if (!message) return '';
  return (
    `<div class="edit-error-message">${escapeHtml(message)}</div>`
  );
}

/**
 * Render a full edit card — the composition of the pieces
 * above plus outer container structure.
 *
 * The returned HTML is a single `<div class="edit-block-card">`
 * suitable for embedding in a message card via `unsafeHTML`.
 * Classes are driven from `resolveDisplayStatus` so a CSS rule
 * like `.edit-block-card.edit-status-failed` can style the
 * whole card according to outcome without the renderer
 * needing to know colours.
 *
 * @param {Object} segment — edit or edit-pending from
 *   segmentResponse()
 * @param {Object | null} result — paired result from
 *   matchSegmentsToResults(), or null
 * @returns {string}
 */
export function renderEditCard(segment, result) {
  const status = resolveDisplayStatus(segment, result);
  const meta = STATUS_META[status] || STATUS_META.pending;
  const parts = [
    `<div class="edit-block-card ${meta.cssClass}">`,
    `<div class="edit-card-header">`,
    renderFilePath(segment.filePath || '(unknown path)', segment.oldText),
    renderStatusBadge(status),
    `</div>`,
    renderEditBody(segment),
    renderErrorMessage(result),
    `</div>`,
  ];
  return parts.join('');
}

// Re-exported for tests that want to inspect the mapping
// directly. The component code should use the public
// `resolveDisplayStatus` / `renderStatusBadge` API.
export { STATUS_META };