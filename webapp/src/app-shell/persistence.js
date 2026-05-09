// AppShell — localStorage persistence helpers.
//
// Extracted from webapp/src/app-shell.js. Each function
// takes the AppShell instance (`host`) as its first
// argument and reads or writes properties on the host
// where the original methods used `this`.
//
// Behaviour is unchanged — these are pure mechanical
// extractions. Comments are preserved verbatim from the
// originals.

import {
  ACTIVE_TAB_KEY,
  DIALOG_MIN_KEY,
  DIALOG_MIN_HEIGHT,
  DIALOG_MIN_WIDTH,
  DIALOG_POS_KEY,
  DIALOG_VISIBLE_MARGIN,
  DIALOG_WIDTH_KEY,
  LAST_OPEN_FILE_KEY,
  repoKey,
} from './constants.js';

/**
 * Load the last active tab from localStorage. Returns 'files'
 * when no preference is stored or the stored value is an
 * unrecognised string — defending against a stale key written
 * by an older build that had additional tabs.
 *
 * A stale 'search' preference (from before file search was
 * integrated into the Files tab) migrates to 'files'. Matches
 * the spec's migration clause.
 */
export function loadActiveTab(_host) {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY);
    if (stored === 'search') return 'files';
    if (stored === 'files' || stored === 'context'
        || stored === 'settings'
        || stored === 'doc-convert') {
      return stored;
    }
  } catch (_) {}
  return 'files';
}

export function loadMinimized(_host) {
  try {
    return localStorage.getItem(DIALOG_MIN_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

export function loadDockedWidth(_host) {
  try {
    const raw = localStorage.getItem(DIALOG_WIDTH_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < DIALOG_MIN_WIDTH) return null;
    return n;
  } catch (_) {
    return null;
  }
}

/**
 * Load the undocked position and bounds-check it against the
 * current viewport. Returns null when:
 *   - no data stored
 *   - JSON parse fails
 *   - the rect would leave fewer than _DIALOG_VISIBLE_MARGIN
 *     pixels of the dialog inside the viewport (monitor
 *     disconnect / resolution change stranded it off-screen)
 *
 * Clamps valid-but-too-big rects to viewport size.
 */
export function loadUndockedPos(_host) {
  try {
    const raw = localStorage.getItem(DIALOG_POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { left, top, width, height } = parsed;
    if (![left, top, width, height].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )) {
      return null;
    }
    if (width < DIALOG_MIN_WIDTH) return null;
    if (height < DIALOG_MIN_HEIGHT) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Must leave a visible handle on both axes for
    // recovery when the viewport shrinks below the stored
    // position.
    if (left > vw - DIALOG_VISIBLE_MARGIN) return null;
    if (top > vh - DIALOG_VISIBLE_MARGIN) return null;
    if (left + width < DIALOG_VISIBLE_MARGIN) return null;
    if (top + height < DIALOG_VISIBLE_MARGIN) return null;
    return {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.min(width, vw),
      height: Math.min(height, vh),
    };
  } catch (_) {
    return null;
  }
}

export function saveMinimized(host) {
  try {
    localStorage.setItem(DIALOG_MIN_KEY, String(host._minimized));
  } catch (_) {}
}

export function saveDockedWidth(host) {
  try {
    if (host._dockedWidth == null) {
      localStorage.removeItem(DIALOG_WIDTH_KEY);
    } else {
      localStorage.setItem(
        DIALOG_WIDTH_KEY, String(host._dockedWidth),
      );
    }
  } catch (_) {}
}

export function saveUndockedPos(host) {
  try {
    if (host._undockedPos == null) {
      localStorage.removeItem(DIALOG_POS_KEY);
    } else {
      localStorage.setItem(
        DIALOG_POS_KEY, JSON.stringify(host._undockedPos),
      );
    }
  } catch (_) {}
}

/**
 * Save the last-opened file path to localStorage.
 * Called on every navigate-file event.
 */
export function saveLastOpenFile(host, path) {
  if (typeof path !== 'string' || !path) return;
  try {
    const key = repoKey(LAST_OPEN_FILE_KEY, host._repoName);
    localStorage.setItem(key, path);
  } catch (_) {}
}

/**
 * Read the last-opened file path from localStorage.
 */
export function loadLastOpenFile(host) {
  try {
    const key = repoKey(LAST_OPEN_FILE_KEY, host._repoName);
    return localStorage.getItem(key) || null;
  } catch (_) {
    return null;
  }
}