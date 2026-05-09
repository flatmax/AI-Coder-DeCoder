// Mention / chip click handlers + middle-click path
// insertion.
//
// Three small handlers extracted from index.js. They share
// a theme (chat-panel-originated events that mutate
// selection or the chat textarea) so they live together
// even though there's no internal coupling between them.
//
// All three rely on `applySelection` from selection.js for
// state mutation; for stage 1 we keep those calls as
// host-method calls (`host._applySelection(...)`) so the
// extraction is independent of the selection-module split.
// Stage 3 will re-route them to direct module imports.

/**
 * Handle the picker's `insert-path` event — fired on
 * middle-click of a file or directory row. Inserts
 * the path into the chat panel's textarea at the
 * current cursor position, padded with spaces so it
 * doesn't jam against surrounding prose.
 *
 * On Linux, middle-click triggers the selection-
 * buffer paste AFTER focus() is called. We set the
 * chat panel's `_suppressNextPaste` flag BEFORE
 * focus to pre-empt that paste — the flag is
 * one-shot and clears in the paste handler, so a
 * later intentional paste still works.
 *
 * Path padding:
 *   - If cursor is preceded by non-whitespace, prepend a space
 *   - If cursor is followed by non-whitespace, append a space
 *
 * Matches the pattern used by `_insertSnippet` on
 * the chat panel side for snippet insertion.
 */
export function onInsertPath(host, event) {
  const path = event.detail?.path;
  if (typeof path !== 'string' || !path) return;
  const chat = host._chat();
  if (!chat) return;
  // Find the textarea inside the chat panel's shadow
  // DOM. Querying via the chat panel's shadowRoot
  // respects encapsulation.
  const ta = chat.shadowRoot?.querySelector('.input-textarea');
  if (!ta) return;
  // Compute surround-padding from the textarea's
  // current state (not from any reactive property),
  // so the insertion reflects exactly what the user
  // sees.
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  const prefix =
    before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const suffix =
    after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefix}${path}${suffix}`;
  const next = `${before}${insertion}${after}`;
  // Push through the chat panel's reactive state so
  // the send-button enablement and auto-resize
  // respond to the change. Direct textarea value
  // assignment keeps cursor positioning accurate;
  // Lit's next render reflects the reactive value.
  chat._input = next;
  ta.value = next;
  const cursor = before.length + insertion.length;
  ta.setSelectionRange(cursor, cursor);
  // Set the suppression flag BEFORE focus — on Linux
  // the focus() call triggers the selection-buffer
  // auto-paste, which we need to swallow.
  chat._suppressNextPaste = true;
  ta.focus();
  // Fire an input event so the auto-resize logic
  // runs. The chat panel's _onInputChange handles
  // this via the native input event.
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Chat panel emits `file-mention-click` when the user
 * clicks a `.file-mention` span inside a rendered
 * assistant message. The event bubbles up through the
 * shadow DOM boundary (composed: true) and reaches us
 * via the `@file-mention-click` binding on `<ac-chat-panel>`
 * in the template.
 *
 * Per specs4/5-webapp/file-picker.md "File Mention
 * Selection": toggle the file's selection state AND
 * navigate to it in the viewer. The two actions are
 * independent — a user clicking a mention wants to see
 * the file AND make it part of the next LLM request's
 * context, regardless of whether they'd previously
 * selected or deselected it.
 */
export function onFileMentionClick(host, event) {
  const path = event.detail?.path;
  if (typeof path !== 'string' || !path) return;
  // Toggle — add if absent, remove if present. Goes
  // through the same `_applySelection` path as a picker
  // checkbox click, so the server is notified and the
  // picker's prop is updated via the direct-update
  // pattern.
  const next = new Set(host._selectedFiles);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  host._applySelection(next, /* notifyServer */ true);
  // Navigation is independent of selection state. Both
  // add and remove cases open the file in the viewer —
  // the user clicked the mention, they want to see it.
  window.dispatchEvent(
    new CustomEvent('navigate-file', {
      detail: { path },
      bubbles: false,
    }),
  );
}

/**
 * Chat panel emits `file-chip-click` when the user
 * clicks a chip in the "Files Referenced" summary
 * section at the bottom of an assistant message. The
 * chips toggle selection state but do NOT navigate —
 * per specs4/5-webapp/chat.md, summary chips are for
 * context management, distinct from inline prose
 * mentions which also navigate. A user scanning the
 * chip list to curate context shouldn't be yanked
 * into the viewer on every click.
 *
 * The `navigate: false` field on the event detail is
 * always set to false by the chat panel, but we
 * preserve the check so a future dispatcher that
 * wants navigation can flip the flag without changing
 * the handler shape.
 */
export function onFileChipClick(host, event) {
  const path = event.detail?.path;
  if (typeof path !== 'string' || !path) return;
  const next = new Set(host._selectedFiles);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  host._applySelection(next, /* notifyServer */ true);
  // Navigate only when the dispatcher explicitly asks
  // for it. Summary chips always pass navigate:false;
  // this branch is here for symmetry and future use.
  if (event.detail?.navigate === true) {
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path },
        bubbles: false,
      }),
    );
  }
}

/**
 * Chat panel emits `file-chips-add-all` with a paths
 * array when the user clicks "+ Add All (N)" in the
 * file summary header. The chat panel has already
 * filtered to unselected paths only, so we just add
 * them all to the selection in one batch — a single
 * `set_selected_files` RPC round-trip instead of N.
 *
 * Idempotent — if any of the paths are somehow
 * already selected (race between render and click,
 * unlikely but defensive), the Set add is a no-op
 * for those entries.
 */
export function onFileChipsAddAll(host, event) {
  const paths = event.detail?.paths;
  if (!Array.isArray(paths) || paths.length === 0) return;
  const next = new Set(host._selectedFiles);
  for (const path of paths) {
    if (typeof path === 'string' && path) next.add(path);
  }
  host._applySelection(next, /* notifyServer */ true);
}