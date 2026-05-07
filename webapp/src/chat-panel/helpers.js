// Pure helpers extracted from chat-panel.js.
//
// Module-scoped utilities and constants that don't touch
// component state. Safe to import from anywhere; no
// circular-import risk.
//
// Contents:
//   - generateRequestId: backend-compatible request ID
//   - parseAgentTabId: tab ID → agent identifier
//   - deriveAgentTabLabel: tab strip label for an agent
//   - buildAmbiguousRetryPrompt
//   - buildInContextMismatchRetryPrompt
//   - buildNotInContextRetryPrompt
//   - localStorage helpers for persisted toggles
//   - Scroll thresholds
//   - _EXPERIMENTAL_ENABLED gate

/**
 * Generate a request ID matching the specs3 format so the
 * backend's correlation logic works unchanged. Format:
 * `{epoch_ms}-{6-char-alnum}`. Epoch gives monotonic ordering;
 * random suffix breaks ties on the same-millisecond case.
 */
export function generateRequestId() {
  const epoch = Date.now();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${epoch}-${suffix}`;
}

/** Maximum visible width of an agent tab label, in chars. */
export const _AGENT_LABEL_MAX_LENGTH = 40;

/**
 * Map a tab id to its backend agent identifier.
 *
 * Agent identity is the LLM-chosen id from the
 * ``🟧🟧🟧 AGENT`` block (e.g., ``"frontend-trivial"``).
 * Tab ids for agent tabs ARE that id directly; the
 * literal string ``"main"`` denotes the main
 * conversation.
 *
 * Returns the agent id (a non-empty string) for agent
 * tabs, or ``null`` for the main tab and for malformed
 * inputs. ``null`` tells the caller to omit the
 * ``agent_tag`` argument entirely (untagged call =
 * main conversation).
 *
 * @param {string} tabId — the tab's identifier
 * @returns {string | null}
 */
export function parseAgentTabId(tabId) {
  if (typeof tabId !== 'string' || !tabId) return null;
  if (tabId === 'main') return null;
  return tabId;
}

/**
 * Derive a tab-strip label for a spawned agent.
 *
 * Format: `Agent NN` for empty / whitespace tasks, or
 * `Agent NN: {first line of task}` for a populated task
 * — truncated to `_AGENT_LABEL_MAX_LENGTH` chars with a
 * trailing `…` when the task text doesn't fit.
 *
 * @param {number} agentIdx — zero-based agent index
 * @param {string | undefined | null} task — the agent's
 *   task text from the spawn block
 * @returns {string}
 */
export function deriveAgentTabLabel(agentIdx, task) {
  let idx = Number(agentIdx);
  if (!Number.isFinite(idx)) idx = 0;
  idx = Math.max(0, Math.floor(idx));
  const paddedIdx = String(idx).padStart(2, '0');
  const prefix = `Agent ${paddedIdx}`;

  if (typeof task !== 'string') return prefix;
  const firstLine = task
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return prefix;

  const full = `${prefix}: ${firstLine}`;
  if (full.length <= _AGENT_LABEL_MAX_LENGTH) return full;

  const keep = _AGENT_LABEL_MAX_LENGTH - 1;
  return `${full.slice(0, keep)}…`;
}

/**
 * Build a retry prompt for ambiguous-anchor edit failures.
 *
 * @param {Array} editResults — from stream-complete result
 * @returns {string | null}
 */
export function buildAmbiguousRetryPrompt(editResults) {
  const ambiguous = editResults.filter(
    (r) => r && r.error_type === 'ambiguous_anchor',
  );
  if (ambiguous.length === 0) return null;
  const lines = [
    'Some edits failed because the old text matched multiple',
    'locations in the file. Please retry with more surrounding',
    'context lines to make the match unique:',
    '',
  ];
  for (const r of ambiguous) {
    const file = r.file_path || r.file || '(unknown file)';
    const msg = r.message || 'Ambiguous match';
    lines.push(`- ${file}: ${msg}`);
  }
  return lines.join('\n');
}

/**
 * Build a retry prompt for anchor-not-found failures on files
 * that ARE currently in the active context.
 *
 * @param {Array} editResults — from stream-complete result
 * @param {Array<string>} selectedFiles — active file selection
 * @returns {string | null}
 */
export function buildInContextMismatchRetryPrompt(
  editResults,
  selectedFiles,
) {
  const selectedSet = new Set(selectedFiles);
  const mismatches = editResults.filter((r) => {
    if (!r || r.error_type !== 'anchor_not_found') return false;
    const path = r.file_path || r.file;
    return typeof path === 'string' && selectedSet.has(path);
  });
  if (mismatches.length === 0) return null;
  const lines = [
    'The following edit(s) failed because the old text didn\'t',
    'match the actual file content. The file(s) are already in',
    'your context — please re-read them carefully and retry',
    'with the correct text:',
    '',
  ];
  for (const r of mismatches) {
    const file = r.file_path || r.file || '(unknown file)';
    const msg = r.message || 'Old text not found';
    lines.push(`- ${file}: ${msg}`);
  }
  return lines.join('\n');
}

/**
 * Build a retry prompt for not-in-context auto-adds.
 *
 * @param {Array<string>} filesAutoAdded — from stream-complete
 * @returns {string | null}
 */
export function buildNotInContextRetryPrompt(filesAutoAdded) {
  if (!Array.isArray(filesAutoAdded) || filesAutoAdded.length === 0) {
    return null;
  }
  const files = filesAutoAdded.filter(
    (f) => typeof f === 'string' && f,
  );
  if (files.length === 0) return null;
  const isSingle = files.length === 1;
  const subject = isSingle
    ? `The file ${files[0]}`
    : `The files ${files.join(', ')}`;
  const verb = isSingle ? 'has' : 'have';
  const target = isSingle ? 'the edit' : 'the edits';
  return (
    `${subject} ${verb} been added to context. ` +
    `Please retry ${target} for: ${files.join(', ')}`
  );
}

/**
 * Read the `?experimental=1` URL parameter set by the
 * Python launcher when started with `--experimental`.
 * Cached at module load so every chat-panel instance
 * sees the same value without re-parsing.
 */
export const _EXPERIMENTAL_ENABLED = (() => {
  try {
    const raw = new URLSearchParams(window.location.search).get(
      'experimental',
    );
    if (!raw) return false;
    return ['1', 'true', 'yes'].includes(raw.toLowerCase());
  } catch (_err) {
    return false;
  }
})();

/** localStorage key for the snippet drawer's open/closed state. */
export const _DRAWER_STORAGE_KEY = 'ac-dc-snippet-drawer';

/** localStorage key for the reasoning / extended-thinking toggle. */
export const _REASONING_STORAGE_KEY = 'ac-dc-reasoning-enabled';

export function _loadReasoningEnabled() {
  try {
    return localStorage.getItem(_REASONING_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

export function _saveReasoningEnabled(enabled) {
  try {
    localStorage.setItem(
      _REASONING_STORAGE_KEY,
      enabled ? 'true' : 'false',
    );
  } catch (_) {
    // Best-effort persistence.
  }
}

export function _loadDrawerOpen() {
  try {
    return localStorage.getItem(_DRAWER_STORAGE_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

export function _saveDrawerOpen(open) {
  try {
    localStorage.setItem(_DRAWER_STORAGE_KEY, open ? 'true' : 'false');
  } catch (_) {
    // Best-effort.
  }
}

/** Search toggle keys, kept compatible with specs3 history. */
export const _SEARCH_IGNORE_CASE_KEY = 'ac-dc-search-ignore-case';
export const _SEARCH_REGEX_KEY = 'ac-dc-search-regex';
export const _SEARCH_WHOLE_WORD_KEY = 'ac-dc-search-whole-word';

export function _loadSearchToggle(key, defaultValue) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

export function _saveSearchToggle(key, value) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch (_) {
    // Best-effort.
  }
}

/**
 * How close to the bottom counts as "still at the bottom".
 */
export const AUTO_SCROLL_TOLERANCE_PX = 40;

/**
 * How far the user must scroll UP from the bottom to disengage
 * auto-scroll.
 */
export const AUTO_SCROLL_DISENGAGE_PX = 100;