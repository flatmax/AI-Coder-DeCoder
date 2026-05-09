// Diff-ready waiter + scroll-to-line / scroll-to-text
// helpers.
//
// Monaco's diff computation is async; for files with
// non-trivial diffs `onDidUpdateDiff` fires once after
// the first layout pass. For identical-content files
// the event never fires, so we race against a 2s
// timeout (specs4 recommendation). The wait happens
// twice: once to detect editor existence (openFile may
// not have constructed it yet when scrollToLine /
// scrollToSearchText is called), then once for the
// diff event itself.

import { monaco } from '../monaco-setup.js';

import {
  _DIFF_READY_TIMEOUT_MS,
  _HIGHLIGHT_DURATION_MS,
} from './constants.js';

/**
 * Resolve after Monaco's diff computation settles.
 * Polls across animation frames up to a 500ms ceiling
 * waiting for the editor to appear, THEN attaches the
 * diff-ready listener. If the ceiling is reached
 * without an editor, resolves so callers degrade
 * gracefully (the scroll just won't happen — same as
 * the pre-rewrite "no open file" path).
 */
export function waitForDiffReady(host) {
  return new Promise((resolve) => {
    const maxWaitMs = 500;
    const startedAt = performance.now();
    const waitForEditor = () => {
      if (host._editor) {
        attachDiffReadyListener();
        return;
      }
      if (performance.now() - startedAt >= maxWaitMs) {
        resolve();
        return;
      }
      requestAnimationFrame(waitForEditor);
    };
    const attachDiffReadyListener = () => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        requestAnimationFrame(resolve);
      };
      try {
        const disposable = host._editor.onDidUpdateDiff?.(() => {
          try { disposable?.dispose(); } catch (_) {}
          settle();
        });
        if (!disposable) {
          // Mock editor without the event — fall
          // through to timeout.
        }
      } catch (_) {
        // Same fallback.
      }
      setTimeout(settle, _DIFF_READY_TIMEOUT_MS);
    };
    waitForEditor();
  });
}

export function scrollToLine(host, line) {
  waitForDiffReady(host).then(() => {
    const modifiedEditor = host._getModifiedEditor();
    if (!modifiedEditor) return;
    try {
      modifiedEditor.revealLineInCenter?.(line);
      modifiedEditor.setPosition?.({ lineNumber: line, column: 1 });
    } catch (_) {}
  });
}

export function scrollToSearchText(host, text) {
  if (!text) return;
  waitForDiffReady(host).then(() => {
    const modifiedEditor = host._getModifiedEditor();
    if (!modifiedEditor) return;
    const model = modifiedEditor.getModel?.();
    if (!model) return;
    // Try progressively shorter prefixes to handle
    // whitespace drift between anchor text and file
    // content.
    const candidates = searchCandidates(text);
    for (const candidate of candidates) {
      try {
        const matches = model.findMatches?.(
          candidate,
          true, // searchOnlyEditableRange
          false, // isRegex
          false, // matchCase
          null, // wordSeparators
          false, // captureMatches
        );
        if (matches && matches.length > 0) {
          const range = matches[0].range;
          modifiedEditor.revealRangeInCenter?.(range);
          applyHighlight(host, modifiedEditor, range);
          return;
        }
      } catch (_) {
        // Mock findMatches — skip.
      }
    }
  });
}

export function searchCandidates(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [text];
  const candidates = [text];
  if (lines.length > 2) candidates.push(lines.slice(0, 2).join('\n'));
  if (lines.length > 1) candidates.push(lines[0]);
  return candidates;
}

export function applyHighlight(host, editor, range) {
  try {
    if (host._highlightTimer) {
      clearTimeout(host._highlightTimer);
      host._highlightTimer = null;
    }
    host._highlightDecorations =
      editor.deltaDecorations?.(
        host._highlightDecorations,
        [
          {
            range,
            options: {
              isWholeLine: true,
              className: 'highlight-decoration',
              overviewRuler: {
                color: '#4fc3f7',
                position: monaco.editor.OverviewRulerLane?.Full ?? 7,
              },
            },
          },
        ],
      ) || [];
    host._highlightTimer = setTimeout(() => {
      host._highlightTimer = null;
      try {
        host._highlightDecorations = editor.deltaDecorations?.(
          host._highlightDecorations,
          [],
        ) || [];
      } catch (_) {}
    }, _HIGHLIGHT_DURATION_MS);
  } catch (_) {}
}