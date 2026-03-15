/**
 * Pure utility functions for the file picker.
 * Extracted for testability and reuse.
 */

/**
 * Fuzzy match — each char in query must appear in order in target.
 * Case-insensitive.
 */
export function fuzzyMatch(query, target) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Recursively check if a node or any descendant matches the filter.
 */
export function nodeMatchesFilter(node, query) {
  if (!query) return true;
  if (fuzzyMatch(query, node.path)) return true;
  if (node.type === 'dir' && node.children) {
    return node.children.some(c => nodeMatchesFilter(c, query));
  }
  return false;
}

/**
 * Strip the repo-name prefix from a tree path to get a relative path.
 * e.g. "my-repo/src/main.py" → "src/main.py"
 */
export function relPath(treePath, repoName) {
  if (treePath.startsWith(repoName + '/')) {
    return treePath.slice(repoName.length + 1);
  }
  return treePath;
}

/**
 * Line count color thresholds.
 */
export function lineColor(n) {
  if (n > 170) return 'var(--accent-red)';
  if (n > 130) return 'var(--accent-orange)';
  return 'var(--accent-green)';
}

/**
 * Sort tree children: directories first, then alphabetical.
 */
export function sortChildren(children) {
  return [...children].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}