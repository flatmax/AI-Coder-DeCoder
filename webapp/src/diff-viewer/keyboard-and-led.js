// Keyboard shortcuts, status LED helpers, panel labels,
// active-file event dispatch.
//
// In the single-file no-cache model the only shortcuts
// are Ctrl+F (Monaco find widget) and Ctrl+S (save).
// Ctrl+W / Ctrl+PageUp / Ctrl+PageDown are gone — there's
// no tab concept to cycle through.

import { isDirty, saveFile } from './editor.js';

// ---------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------

export function onKeyDown(host, event) {
  if (!host.isConnected) return;
  if (host._file === null && host._virtualComparison === null) {
    return;
  }
  const ctrl = event.ctrlKey || event.metaKey;
  if (!ctrl) return;
  if (event.key === 'f' || event.key === 'F') {
    if (eventTargetInsideUs(host, event)) {
      event.preventDefault();
      triggerFindWidget(host);
    }
    return;
  }
  if (event.key === 's' || event.key === 'S') {
    if (
      activeInEditorRoot(host, event.target) ||
      eventTargetInsideUs(host, event)
    ) {
      event.preventDefault();
      if (host._file !== null) saveFile(host, host._file.path);
    }
    return;
  }
}

export function activeInEditorRoot(host, target) {
  return eventTargetInsideUs(host, { target });
}

export function eventTargetInsideUs(host, event) {
  const path = event.composedPath ? event.composedPath() : [];
  return path.includes(host);
}

/**
 * Open Monaco's find widget in the modified (right)
 * editor. The find widget is a built-in Monaco
 * contribution; triggering it via the 'actions.find'
 * command is the public API.
 */
export function triggerFindWidget(host) {
  const modifiedEditor = host._getModifiedEditor();
  if (!modifiedEditor) return;
  try {
    modifiedEditor.focus?.();
    modifiedEditor.trigger?.('keyboard', 'actions.find', null);
  } catch (err) {
    console.debug('[diff-viewer] find widget trigger failed', err);
  }
}

export function dispatchActiveFileChanged(host) {
  // For virtual comparisons, path is null — the viewer
  // is showing ad-hoc content, not a file.
  const path = host._file !== null ? host._file.path : null;
  host.dispatchEvent(
    new CustomEvent('active-file-changed', {
      detail: { path },
      bubbles: true,
      composed: true,
    }),
  );
}

// ---------------------------------------------------------------
// Status LED
// ---------------------------------------------------------------

export function statusLedClass(host) {
  if (host._file === null) return '';
  if (isDirty(host._file)) return 'dirty';
  if (host._file.isNew) return 'new-file';
  return 'clean';
}

export function statusLedTitle(host) {
  if (host._file === null) return '';
  const klass = statusLedClass(host);
  if (klass === 'dirty') {
    return `${host._file.path} — unsaved (click to save and reveal in picker)`;
  }
  if (klass === 'new-file') {
    return `${host._file.path} — new file (click to reveal in picker)`;
  }
  return `${host._file.path} (click to reveal in picker)`;
}

export function onStatusLedClick(host) {
  if (host._file === null) return;
  // Save first if dirty — primary reason for clicking.
  // Reveal happens regardless so a single click does
  // both (save + locate).
  if (isDirty(host._file)) {
    saveFile(host, host._file.path);
  }
  // Virtual files (loadPanel content) aren't in the
  // picker tree, so skip the dispatch for those.
  if (!host._file.isVirtual) {
    host.dispatchEvent(
      new CustomEvent('reveal-file-in-picker', {
        detail: { path: host._file.path },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

// ---------------------------------------------------------------
// Panel labels (loadPanel virtual-comparison mode)
// ---------------------------------------------------------------

export function currentPanelLabels(host) {
  if (host._virtualComparison === null) return {};
  return {
    left: host._virtualComparison.leftLabel || '',
    right: host._virtualComparison.rightLabel || '',
  };
}