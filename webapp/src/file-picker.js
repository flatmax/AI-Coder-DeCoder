// FilePicker — tree view of repository files.
//
// Layer 5 Phase 2a — minimum viable picker.
//
// This is the visual component only. Data (the file tree) arrives
// via the `tree` property, and user actions (selection changes,
// file clicks) are dispatched as CustomEvents that bubble up to
// the files-tab orchestrator.
//
// Governing spec: specs4/5-webapp/file-picker.md
//
// Phase 2a scope:
//   - Renders a nested tree from the `tree` property
//   - Two-state checkboxes (index-only / selected). Three-state
//     exclusion lands in Phase 2d with the backend RPC.
//   - Expand/collapse directories (click toggle)
//   - Filter bar with fuzzy matching (character-subsequence)
//   - Sort children alphabetically, directories before files
//
// Deferred to later sub-phases:
//   - Git status badges (need status data plumbed through — 2c)
//   - Sort modes other than name (mtime / size — 2c)
//   - Keyboard navigation (2c)
//   - Context menu (2d)
//   - Three-state checkbox with exclusion (2d — needs backend)
//   - Middle-click path insertion (needs chat panel — 2d)
//   - Branch badge at root (needs RPC — 2c)
//   - Active-file highlight (needs viewer events — 2c)
//   - File search integration (swap tree to pruned results — 2e)
//
// The data model matches what Repo.get_file_tree() returns:
//
//   {
//     name: "repo-root",
//     path: "",
//     type: "dir",
//     lines: 0,
//     children: [
//       { name: "a.md", path: "a.md", type: "file", lines: 12, mtime: 0 },
//       { name: "src", path: "src", type: "dir", lines: 0, children: [...] },
//       ...
//     ]
//   }
//
// Leaf nodes are files (type === "file"), branches are directories
// (type === "dir"). The root node itself is always a directory with
// an empty path; its `name` is the repo name for display.

import { LitElement, css, html } from 'lit';

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
function fuzzyMatch(path, query) {
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
 *
 * Returns a Set of path strings. Empty query returns an empty set
 * (no auto-expansion — user's existing expanded state wins).
 */
function computeFilterExpansions(tree, query) {
  const expansions = new Set();
  if (!query || !tree) return expansions;

  function walk(node, ancestors) {
    if (node.type === 'file') {
      if (fuzzyMatch(node.path, query)) {
        // Every ancestor directory becomes expanded.
        for (const a of ancestors) expansions.add(a);
      }
      return;
    }
    // Directory — recurse, tracking our own path as an ancestor
    // for descendant files.
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
 *
 * Unfiltered tree is returned verbatim when query is empty.
 */
function filterTree(tree, query) {
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

  // Root is always a directory; if it has no matching descendants,
  // the returned tree is an empty root (so the component can still
  // render its own frame and the "no matches" placeholder).
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
function sortChildren(children) {
  return [...(children || [])].sort((a, b) => {
    if (a.type !== b.type) {
      // Dirs before files.
      return a.type === 'dir' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

export class FilePicker extends LitElement {
  static properties = {
    /**
     * The file tree, shape: {name, path, type, lines, children}.
     * Defaults to a minimal empty root so the component renders
     * something sensible before the first load.
     */
    tree: { type: Object },
    /**
     * Selected file paths. Using a Set means membership checks
     * are O(1) during render; the parent maintains it as a Set
     * and assigns it through. Lit deep-compares with `===` so we
     * reassign a new Set for each change to trigger re-render.
     */
    selectedFiles: { type: Object },
    /**
     * Current filter query (fuzzy substring matching).
     */
    filterQuery: { type: String, state: true },
    /**
     * Set of directory paths currently expanded. Paths, not node
     * references, so expansion state survives tree reloads.
     */
    _expanded: { type: Object, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: rgba(13, 17, 23, 0.5);
      color: var(--text-primary, #c9d1d9);
      font-size: 0.875rem;
    }

    .filter-bar {
      flex-shrink: 0;
      padding: 0.5rem;
      border-bottom: 1px solid rgba(240, 246, 252, 0.1);
    }
    .filter-input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.35rem 0.5rem;
      background: rgba(13, 17, 23, 0.8);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 4px;
      color: var(--text-primary, #c9d1d9);
      font-size: 0.8125rem;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
    }

    .tree-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      padding: 0.25rem 0;
    }

    .empty-state {
      padding: 1rem;
      opacity: 0.5;
      font-style: italic;
      text-align: center;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.15rem 0.5rem 0.15rem 0;
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
    }
    .row:hover {
      background: rgba(240, 246, 252, 0.05);
    }
    .row.focused {
      background: rgba(88, 166, 255, 0.12);
    }

    .indent {
      display: inline-block;
      flex-shrink: 0;
    }

    .twisty {
      display: inline-flex;
      width: 0.9rem;
      justify-content: center;
      flex-shrink: 0;
      opacity: 0.7;
      font-size: 0.75rem;
    }
    .twisty.empty {
      visibility: hidden;
    }

    .checkbox {
      flex-shrink: 0;
      margin: 0;
    }

    .name {
      flex: 1;
      min-width: 0;
      text-overflow: ellipsis;
      overflow: hidden;
    }
    .row.is-dir .name {
      color: var(--text-primary, #c9d1d9);
      font-weight: 500;
    }
    .row.is-file .name {
      color: var(--text-secondary, #8b949e);
    }

    .lines-badge {
      flex-shrink: 0;
      font-size: 0.75rem;
      opacity: 0.6;
      margin-left: 0.5rem;
      font-variant-numeric: tabular-nums;
    }
  `;

  constructor() {
    super();
    // Default to an empty root — lets the component render before
    // the parent has provided real data.
    this.tree = {
      name: '',
      path: '',
      type: 'dir',
      lines: 0,
      children: [],
    };
    this.selectedFiles = new Set();
    this.filterQuery = '';
    this._expanded = new Set();
  }

  // ---------------------------------------------------------------
  // Public API (called by the files-tab orchestrator)
  // ---------------------------------------------------------------

  /**
   * Set the tree and trigger a re-render. The parent normally
   * assigns `this.tree = ...` directly (which also re-renders),
   * but providing a method lets the orchestrator pass a tree
   * imperatively from an RPC callback without worrying about
   * property propagation.
   */
  setTree(tree) {
    this.tree = tree;
    this.requestUpdate();
  }

  /**
   * Set the filter query programmatically. Used by the @-filter
   * bridge from the chat input in Phase 2c.
   */
  setFilter(query) {
    this.filterQuery = query || '';
  }

  /**
   * Expand every directory in the tree. Useful after an operation
   * that should reveal everything (e.g. file-search results).
   */
  expandAll() {
    const all = new Set();
    function walk(node) {
      if (node.type === 'dir' && node.path) {
        all.add(node.path);
      }
      for (const child of node.children || []) {
        walk(child);
      }
    }
    walk(this.tree);
    this._expanded = all;
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  /**
   * When the filter is non-empty, auto-expand directories
   * containing matching descendants. We merge the filter's
   * required expansions with the user's existing expanded set so
   * typing in the filter box never collapses a directory the user
   * deliberately expanded.
   */
  _effectiveExpanded() {
    if (!this.filterQuery) return this._expanded;
    const filterExpansions = computeFilterExpansions(
      this.tree,
      this.filterQuery,
    );
    return new Set([...this._expanded, ...filterExpansions]);
  }

  render() {
    const filtered = filterTree(this.tree, this.filterQuery);
    const effectiveExpanded = this._effectiveExpanded();

    return html`
      <div class="filter-bar">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter files (fuzzy match)…"
          .value=${this.filterQuery}
          @input=${this._onFilterInput}
          aria-label="Filter files"
        />
      </div>
      <div class="tree-scroll" role="tree">
        ${this._renderChildren(filtered, 0, effectiveExpanded)}
      </div>
    `;
  }

  _renderChildren(node, depth, expanded) {
    const children = sortChildren(node.children);
    if (children.length === 0 && depth === 0) {
      // Root with no visible children — only happens on an
      // empty tree or a filter query with zero matches.
      const placeholder = this.filterQuery
        ? 'No matching files'
        : 'No files to show';
      return html`<div class="empty-state">${placeholder}</div>`;
    }
    return children.map((child) => this._renderNode(child, depth, expanded));
  }

  _renderNode(node, depth, expanded) {
    if (node.type === 'dir') {
      return this._renderDir(node, depth, expanded);
    }
    return this._renderFile(node, depth);
  }

  _renderDir(node, depth, expanded) {
    const isOpen = expanded.has(node.path);
    const hasChildren = (node.children || []).length > 0;
    const indentPx = depth * 16;
    return html`
      <div
        class="row is-dir"
        style="padding-left: ${indentPx}px"
        @click=${(e) => this._onDirClick(e, node)}
        role="treeitem"
        aria-expanded=${isOpen}
      >
        <span class="indent"></span>
        <span class="twisty ${hasChildren ? '' : 'empty'}">
          ${isOpen ? '▼' : '▶'}
        </span>
        <input
          type="checkbox"
          class="checkbox"
          .checked=${this._allDescendantsSelected(node)}
          .indeterminate=${this._someDescendantsSelected(node)}
          @click=${(e) => this._onDirCheckbox(e, node)}
          aria-label="Select all files in ${node.name}"
        />
        <span class="name">${node.name || '(root)'}</span>
      </div>
      ${isOpen
        ? this._renderChildren(node, depth + 1, expanded)
        : ''}
    `;
  }

  _renderFile(node, depth) {
    const isSelected = this.selectedFiles.has(node.path);
    const indentPx = depth * 16;
    return html`
      <div
        class="row is-file"
        style="padding-left: ${indentPx}px"
        @click=${(e) => this._onFileClick(e, node)}
        role="treeitem"
      >
        <span class="indent"></span>
        <span class="twisty empty"></span>
        <input
          type="checkbox"
          class="checkbox"
          .checked=${isSelected}
          @click=${(e) => this._onFileCheckbox(e, node)}
          aria-label="Select ${node.name}"
        />
        <span class="name">${node.name}</span>
        ${typeof node.lines === 'number' && node.lines > 0
          ? html`<span class="lines-badge">${node.lines}</span>`
          : ''}
      </div>
    `;
  }

  // ---------------------------------------------------------------
  // Selection helpers
  // ---------------------------------------------------------------

  /**
   * Flatten a directory node to the list of file paths it contains
   * (recursively). Used when a user clicks a directory checkbox
   * to select or deselect the whole subtree.
   */
  _collectDescendantFiles(node) {
    const paths = [];
    function walk(n) {
      if (n.type === 'file') {
        paths.push(n.path);
        return;
      }
      for (const child of n.children || []) walk(child);
    }
    walk(node);
    return paths;
  }

  _allDescendantsSelected(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    return descendants.every((p) => this.selectedFiles.has(p));
  }

  _someDescendantsSelected(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    const selected = descendants.filter(
      (p) => this.selectedFiles.has(p),
    );
    return selected.length > 0 && selected.length < descendants.length;
  }

  // ---------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------

  _onFilterInput(e) {
    this.filterQuery = e.target.value;
  }

  _onDirClick(event, node) {
    // Clicking anywhere on a directory row (outside the checkbox)
    // toggles its expansion.
    if (event.target.classList.contains('checkbox')) return;
    this._toggleExpanded(node.path);
  }

  _toggleExpanded(path) {
    const next = new Set(this._expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._expanded = next;
  }

  _onDirCheckbox(event, node) {
    // Stop propagation so the row's click handler doesn't
    // simultaneously toggle expansion.
    event.stopPropagation();
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return;
    const allSelected = descendants.every((p) =>
      this.selectedFiles.has(p),
    );
    const next = new Set(this.selectedFiles);
    if (allSelected) {
      // Deselect everything in this subtree.
      for (const p of descendants) next.delete(p);
    } else {
      // Select everything missing.
      for (const p of descendants) next.add(p);
    }
    this._emitSelectionChanged(next);
  }

  _onFileClick(event, node) {
    // Clicking the name area (outside the checkbox) dispatches
    // a file-clicked event. Phase 2c wires the viewer to open
    // the file in response.
    if (event.target.classList.contains('checkbox')) return;
    this.dispatchEvent(
      new CustomEvent('file-clicked', {
        detail: { path: node.path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  _onFileCheckbox(event, node) {
    event.stopPropagation();
    const next = new Set(this.selectedFiles);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    this._emitSelectionChanged(next);
  }

  _emitSelectionChanged(newSet) {
    // Propagate so the orchestrator (files-tab, Phase 2c) can
    // update its own state and notify the server. We don't
    // update our own `selectedFiles` — the parent owns the
    // canonical set and will assign it back to us via
    // property propagation.
    this.dispatchEvent(
      new CustomEvent('selection-changed', {
        detail: { selectedFiles: Array.from(newSet) },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('ac-file-picker', FilePicker);

// Exported for unit tests.
export { fuzzyMatch, filterTree, sortChildren, computeFilterExpansions };