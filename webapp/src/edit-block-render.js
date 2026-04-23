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

import { escapeHtml } from './markdown.js';

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
 * @param {string} filePath
 * @returns {string}
 */
export function renderFilePath(filePath) {
  const safe = typeof filePath === 'string' ? filePath : '';
  return `<span class="edit-file-path">${escapeHtml(safe)}</span>`;
}

/**
 * Render the body of an edit card — two fenced blocks labelled
 * OLD and NEW, each with the content escaped.
 *
 * Create blocks (empty old text) render only the NEW block.
 * Pending segments render whatever they have accumulated so
 * far, preserving streaming visibility. The `<pre>` elements
 * get role-specific classes so a later commit can layer a
 * character-level diff without changing the DOM shape.
 *
 * @param {Object} segment
 * @returns {string}
 */
export function renderEditBody(segment) {
  const oldText = typeof segment.oldText === 'string' ? segment.oldText : '';
  const newText = typeof segment.newText === 'string' ? segment.newText : '';
  const parts = [];
  // Show OLD only when it has content. Create blocks and
  // pending-in-old-phase blocks with empty buffers both skip
  // this pane.
  if (oldText !== '') {
    parts.push(
      `<div class="edit-pane edit-pane-old">` +
        `<div class="edit-pane-label">OLD</div>` +
        `<pre class="edit-pane-content">${escapeHtml(oldText)}</pre>` +
        `</div>`,
    );
  }
  // NEW pane — always render, even empty, so the card has
  // predictable layout. An empty NEW pane with an empty OLD
  // pane (edit-pending in reading-old phase with no content
  // yet) still produces the cursor / placeholder layout; the
  // user sees "something is incoming" rather than a blank card.
  parts.push(
    `<div class="edit-pane edit-pane-new">` +
      `<div class="edit-pane-label">NEW</div>` +
      `<pre class="edit-pane-content">${escapeHtml(newText)}</pre>` +
      `</div>`,
  );
  return `<div class="edit-body">${parts.join('')}</div>`;
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
    renderFilePath(segment.filePath || '(unknown path)'),
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