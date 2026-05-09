// Pure helpers for the FilePicker component.
//
// Extracted from file-picker.js so they can be tested in
// isolation and imported by the rendering / keyboard modules
// without dragging in the LitElement class.

import {
  SORT_MODES,
  SORT_MODE_MTIME,
  SORT_MODE_NAME,
  SORT_MODE_SIZE,
} from './constants.js';

/**
 * Fuzzy-match a path against a query.
 *
 * Returns true iff every character of the query appears in the path
 * in order, not necessarily consecutively. Case-insensitive.
 * Matches the spec: `edt` matches `edit_parser.py` and `sii`
 * matches `symbol_index/index.py`.
 *
 * An empty query matches every path — the filter is "show all"
 * when the input is blank.
 */
export function fuzzyMatch(path, query) {
  if (!query) return true;
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  for (const ch of p) {
    if (ch === q[i]) {
      i += 1;
      if (i === q.length) return true;
    }
  }
  return false;
}

/**
 * Walk a tree and return the set of directory paths that must be
 * expanded so that every file matching `query` is visible.
 *
 * A directory must be expanded if any descendant file matches.
 * Directory nodes themselves are not matched — filtering is always
 * by file path (what users actually search for).
 */
export function computeFilterExpansions(tree, query) {
  const expansions = new Set();
  if (!query || !tree) return expansions;

  function walk(node, ancestors) {
    if (node.type === 'file') {
      if (fuzzyMatch(node.path, query)) {
        for (const a of ancestors) expansions.add(a);
      }
      return;
    }
    const nextAncestors = node.path
      ? [...ancestors, node.path]
      : ancestors;
    for (const child of node.children || []) {
      walk(child, nextAncestors);
    }
  }
  walk(tree, []);
  return expansions;
}

/**
 * Filter a tree to only nodes whose paths (or descendant paths,
 * for directories) match `query`. Returns a new tree object —
 * never mutates the input.
 */
export function filterTree(tree, query) {
  if (!query || !tree) return tree;

  function visitDir(node) {
    const filteredChildren = [];
    for (const child of node.children || []) {
      if (child.type === 'file') {
        if (fuzzyMatch(child.path, query)) {
          filteredChildren.push(child);
        }
      } else {
        const kept = visitDir(child);
        if (kept) filteredChildren.push(kept);
      }
    }
    if (filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  }

  const visited = visitDir(tree);
  if (!visited) {
    return { ...tree, children: [] };
  }
  return visited;
}

/**
 * Sort a list of children: directories first, then files,
 * alphabetical by name within each group. Returns a new array.
 */
export function sortChildren(children) {
  return [...(children || [])].sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Sort a list of children with explicit mode and direction.
 *
 * Directories always sort alphabetically ascending regardless of
 * the requested mode or direction.
 *
 * Files sort by the chosen key (name / mtime / size) with direction
 * applied. Missing values fall back to 0 for numeric keys and empty
 * string for name — malformed tree nodes don't crash the sort.
 *
 * Directories precede files in the final order. Returns a new array.
 */
export function sortChildrenWithMode(children, mode, asc) {
  const safeMode = SORT_MODES.includes(mode) ? mode : SORT_MODE_NAME;
  const dirs = [];
  const files = [];
  for (const child of children || []) {
    if (!child) continue;
    if (child.type === 'dir') dirs.push(child);
    else files.push(child);
  }
  dirs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  files.sort((a, b) => {
    let result;
    if (safeMode === SORT_MODE_MTIME) {
      const am = typeof a.mtime === 'number' ? a.mtime : 0;
      const bm = typeof b.mtime === 'number' ? b.mtime : 0;
      result = am - bm;
    } else if (safeMode === SORT_MODE_SIZE) {
      const al = typeof a.lines === 'number' ? a.lines : 0;
      const bl = typeof b.lines === 'number' ? b.lines : 0;
      result = al - bl;
    } else {
      result = (a.name || '').localeCompare(b.name || '');
    }
    return asc ? result : -result;
  });
  return [...dirs, ...files];
}