// Pure helper functions for the files-tab orchestrator.
//
// Extracted from files-tab.js. These are stateless
// utilities — localStorage hydration helpers and tree-
// shape transforms used by the orchestrator and exposed
// for unit tests.

import {
  _L0_EXCLUDE_PREF_ALWAYS,
  _L0_EXCLUDE_PREF_ASK,
  _L0_EXCLUDE_PREF_KEY,
  _L0_EXCLUDE_PREF_NEVER,
  _PICKER_COLLAPSED_KEY,
  _PICKER_DEFAULT_WIDTH,
  _PICKER_MIN_WIDTH,
  _PICKER_WIDTH_KEY,
} from './constants.js';

/**
 * Read the stored L0-exclude preference. Returns one of
 * 'ask' / 'always' / 'never'. Anything else (missing key,
 * malformed value) falls back to 'ask' so users see the
 * dialog by default — the prompt is the discoverable
 * surface for understanding the L0 trade-off.
 */
export function _loadL0ExcludePref() {
  try {
    const raw = localStorage.getItem(_L0_EXCLUDE_PREF_KEY);
    if (raw === _L0_EXCLUDE_PREF_ALWAYS) return _L0_EXCLUDE_PREF_ALWAYS;
    if (raw === _L0_EXCLUDE_PREF_NEVER) return _L0_EXCLUDE_PREF_NEVER;
  } catch (_) {}
  return _L0_EXCLUDE_PREF_ASK;
}

export function _saveL0ExcludePref(pref) {
  try {
    localStorage.setItem(_L0_EXCLUDE_PREF_KEY, pref);
  } catch (_) {}
}

/**
 * Read the persisted picker width from localStorage, falling
 * back to the default when storage is empty or the stored
 * value is malformed (non-numeric, below minimum). The value
 * is clamped to the minimum on load so a stored value that's
 * somehow below the current minimum doesn't propagate into
 * the first render.
 */
export function _loadPickerWidth() {
  try {
    const raw = localStorage.getItem(_PICKER_WIDTH_KEY);
    if (!raw) return _PICKER_DEFAULT_WIDTH;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < _PICKER_MIN_WIDTH) {
      return _PICKER_DEFAULT_WIDTH;
    }
    return n;
  } catch (_) {
    return _PICKER_DEFAULT_WIDTH;
  }
}

export function _loadPickerCollapsed() {
  try {
    return localStorage.getItem(_PICKER_COLLAPSED_KEY) === 'true';
  } catch (_) {
    return false;
  }
}

/**
 * Recursively flatten a file-tree node into a list of
 * repo-relative file paths. Used to produce the flat list
 * the chat panel needs for mention detection. Walks only
 * file-type leaves; directories contribute nothing to the
 * list themselves (their contents do).
 *
 * Defensive against malformed shapes — a node without a
 * `type` or with a non-array `children` field is treated
 * as empty. The file tree comes from `Repo.get_file_tree`
 * which produces well-formed output, but the extra
 * tolerance means a partial/missing tree doesn't crash
 * the orchestrator.
 *
 * @param {object | null | undefined} node
 * @returns {Array<string>}
 */
export function flattenTreePaths(node) {
  if (!node || typeof node !== 'object') return [];
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'file' && typeof n.path === 'string' && n.path) {
      out.push(n.path);
      return;
    }
    if (Array.isArray(n.children)) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return out;
}

/**
 * Build a pruned file tree from flat search results.
 *
 * Input shape (from chat panel's `file-search-changed`
 * event): `[{file: string, matches: [{...}, ...]}, ...]`.
 * Output is a tree node with the standard shape the
 * picker understands — root directory with nested
 * children, file leaves set to the match count in their
 * `lines` field (the picker renders this as a badge
 * identically, giving the user a visual sense of which
 * files have the most hits).
 *
 * Paths are split on `/` to build nested directories.
 * Files at the root of the repo appear as direct children
 * of the pruned root. Sorting within each directory
 * follows the picker's convention (dirs before files,
 * alphabetical within each).
 *
 * Empty input produces an empty root — the picker's
 * built-in "No matching files" placeholder handles the
 * rendering.
 *
 * @param {Array<{file: string, matches: Array}>} results
 * @returns {object} picker-compatible tree node
 */
export function buildPrunedTree(results) {
  const root = {
    name: '',
    path: '',
    type: 'dir',
    lines: 0,
    children: [],
  };
  if (!Array.isArray(results) || results.length === 0) return root;
  // Build a nested structure by walking each file path's
  // segments and creating directory nodes on demand. Map
  // indexing keeps lookup O(1) per segment so the overall
  // build is O(total segments), linear in path-length sum.
  const dirByPath = new Map();
  dirByPath.set('', root);
  for (const entry of results) {
    if (!entry || typeof entry.file !== 'string' || !entry.file) continue;
    const matches = Array.isArray(entry.matches) ? entry.matches : [];
    const segments = entry.file.split('/');
    const fileName = segments.pop();
    // Walk / create directory nodes.
    let parent = root;
    let accumPath = '';
    for (const seg of segments) {
      accumPath = accumPath ? `${accumPath}/${seg}` : seg;
      let dir = dirByPath.get(accumPath);
      if (!dir) {
        dir = {
          name: seg,
          path: accumPath,
          type: 'dir',
          lines: 0,
          children: [],
        };
        parent.children.push(dir);
        dirByPath.set(accumPath, dir);
      }
      parent = dir;
    }
    // Add the file leaf. `lines` is the match count — the
    // picker renders it as a badge so users see at a
    // glance which files have the most hits.
    parent.children.push({
      name: fileName,
      path: entry.file,
      type: 'file',
      lines: matches.length,
    });
  }
  // Sort children per directory — dirs before files,
  // alphabetical within each group. Matches the picker's
  // `sortChildren` behaviour.
  const sortNode = (node) => {
    if (!Array.isArray(node.children)) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const child of node.children) {
      if (child.type === 'dir') sortNode(child);
    }
  };
  sortNode(root);
  return root;
}