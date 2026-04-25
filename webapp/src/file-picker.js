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

// Sort mode identifiers. Module-level constants match the
// convention used elsewhere in the webapp — minimal shape,
// tree-shake-friendly.
const SORT_MODE_NAME = 'name';
const SORT_MODE_MTIME = 'mtime';
const SORT_MODE_SIZE = 'size';
const SORT_MODES = [SORT_MODE_NAME, SORT_MODE_MTIME, SORT_MODE_SIZE];

// localStorage keys for persisting sort preferences.
const _SORT_MODE_KEY = 'ac-dc-sort-mode';
const _SORT_ASC_KEY = 'ac-dc-sort-asc';

/**
 * Sort a list of children with explicit mode and direction.
 *
 * Directories always sort alphabetically ascending regardless of
 * the requested mode or direction — users expect a stable directory
 * layout, and mtime/size are rarely meaningful for directory nodes
 * (directories don't carry mtime in the file-tree schema, and their
 * `lines` field is always 0).
 *
 * Files sort by the chosen key (name / mtime / size) with direction
 * applied. Missing values fall back to 0 for numeric keys and empty
 * string for name — malformed tree nodes don't crash the sort.
 *
 * Directories precede files in the final order. Returns a new array.
 */
function sortChildrenWithMode(children, mode, asc) {
  const safeMode = SORT_MODES.includes(mode) ? mode : SORT_MODE_NAME;
  const dirs = [];
  const files = [];
  for (const child of children || []) {
    if (!child) continue;
    if (child.type === 'dir') dirs.push(child);
    else files.push(child);
  }
  // Dirs always alphabetical ascending.
  dirs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // Files sort by selected key, flip on descending.
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

export class FilePicker extends LitElement {
  static properties = {
    /**
     * The file tree, shape: {name, path, type, lines, children}.
     * Defaults to a minimal empty root so the component renders
     * something sensible before the first load.
     */
    tree: { type: Object },
    /**
     * Git status data for the current tree. Shape:
     * `{modified: Set, staged: Set, untracked: Set, deleted: Set,
     *   diffStats: Map<path, {added, removed}>}`.
     *
     * Drives M/S/U/D badges and `+N -N` diff stats on file
     * rows. Sets / Map for O(1) lookup inside render loops —
     * large repos can have thousands of files per pass.
     *
     * Optional — the picker degrades gracefully if undefined
     * or missing fields (no badges, no diff stats). Defaults
     * to empty collections so renders never NPE.
     */
    statusData: { type: Object },
    /**
     * Branch info for the current repo. Shape:
     * `{branch: string|null, detached: bool, sha: string|null,
     *   repoName: string}`.
     *
     * Drives the `⎇ name` pill on the root row. Detached HEAD
     * renders the short SHA in orange to signal the non-branch
     * state. Empty / unset → no pill (renders as an empty repo
     * or pre-first-load state).
     */
    branchInfo: { type: Object },
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
    /**
     * Path of the focused file row — used during file search
     * to highlight which file the match overlay is currently
     * scrolled to. The files-tab orchestrator updates this as
     * the match overlay scrolls. Null when not in use.
     */
    _focusedPath: { type: String, state: true },
    /**
     * Current sort mode for file rows. One of 'name', 'mtime',
     * 'size'. Directories always sort alphabetically ascending
     * regardless. Persisted to localStorage.
     */
    _sortMode: { type: String, state: true },
    /**
     * Sort direction — true for ascending, false for descending.
     * Persisted to localStorage as '1' / '0'. Name mode ascending
     * means A → Z; mtime ascending means oldest first; size
     * ascending means smallest first.
     */
    _sortAsc: { type: Boolean, state: true },
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
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
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

    .sort-buttons {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
    .sort-buttons .label {
      font-size: 0.6875rem;
      opacity: 0.55;
      margin-right: 0.15rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .sort-btn {
      flex: 0 0 auto;
      padding: 0.2rem 0.45rem;
      background: rgba(13, 17, 23, 0.6);
      border: 1px solid rgba(240, 246, 252, 0.12);
      border-radius: 3px;
      color: var(--text-secondary, #8b949e);
      font-size: 0.75rem;
      font-family: inherit;
      cursor: pointer;
      user-select: none;
      line-height: 1;
    }
    .sort-btn:hover {
      background: rgba(240, 246, 252, 0.05);
      color: var(--text-primary, #c9d1d9);
    }
    .sort-btn.active {
      background: rgba(88, 166, 255, 0.12);
      border-color: var(--accent-primary, #58a6ff);
      color: var(--accent-primary, #58a6ff);
      font-weight: 600;
    }
    .sort-btn .dir {
      margin-left: 0.15rem;
      opacity: 0.8;
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
    /* Line-count color thresholds: files over ~170 lines are
     * painful to review / fit in a prompt, 130-170 is getting
     * long. Green means comfortable, orange is a warning,
     * red is "consider splitting". */
    .lines-badge.lines-green {
      color: #3fb950;
      opacity: 0.8;
    }
    .lines-badge.lines-orange {
      color: #d29922;
      opacity: 0.9;
    }
    .lines-badge.lines-red {
      color: #f85149;
      opacity: 0.95;
    }

    /* Git status badge — single letter M/S/U/D per file.
     * Only the highest-priority state shows (deleted wins
     * over staged wins over modified wins over untracked),
     * so each file gets at most one. */
    .status-badge {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      font-size: 0.7rem;
      font-weight: 600;
      border-radius: 2px;
      margin-left: 0.25rem;
      font-variant-numeric: tabular-nums;
      user-select: none;
    }
    .status-badge.status-modified {
      color: #d29922;
      background: rgba(210, 153, 34, 0.15);
    }
    .status-badge.status-staged {
      color: #3fb950;
      background: rgba(63, 185, 80, 0.15);
    }
    .status-badge.status-untracked {
      color: #58a6ff;
      background: rgba(88, 166, 255, 0.15);
    }
    .status-badge.status-deleted {
      color: #f85149;
      background: rgba(248, 81, 73, 0.15);
      text-decoration: line-through;
    }

    /* Diff stats (+N -N) shown between the status badge and
     * the line-count badge. Only rendered when a file has a
     * non-zero diff. */
    .diff-stats {
      flex-shrink: 0;
      font-size: 0.7rem;
      font-variant-numeric: tabular-nums;
      margin-left: 0.35rem;
      display: inline-flex;
      gap: 0.25rem;
    }
    .diff-stats .added {
      color: #3fb950;
    }
    .diff-stats .removed {
      color: #f85149;
    }

    /* Root row — repo name + branch pill. Non-interactive
     * (no click handler, no checkbox, no twisty), sits
     * above the rest of the tree as a stable header. */
    .row.is-root {
      cursor: default;
      font-weight: 600;
      padding: 0.25rem 0.5rem 0.25rem 0.25rem;
    }
    .row.is-root:hover {
      background: transparent;
    }
    .row.is-root .name {
      font-weight: 600;
      color: var(--text-primary, #c9d1d9);
    }

    /* Branch pill on the root row. The ⎇ glyph is U+26A7
     * (male with stroke) — not a standard git glyph but
     * visually suggests a branching fork at text sizes.
     * The more obvious alternative (⤴) renders poorly in
     * many monospace fonts; ⎇ has good coverage. */
    .branch-pill {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.5rem;
      background: rgba(110, 118, 129, 0.2);
      color: var(--text-secondary, #8b949e);
      font-variant-numeric: tabular-nums;
    }
    .branch-pill.detached {
      /* Orange background + text signals the non-branch
       * state. Users see "oh right, I'm on a SHA" at a
       * glance rather than thinking the short SHA is a
       * branch named "abc1234". */
      background: rgba(210, 153, 34, 0.2);
      color: #d29922;
    }
    .branch-pill .glyph {
      opacity: 0.7;
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
    this.statusData = {
      modified: new Set(),
      staged: new Set(),
      untracked: new Set(),
      deleted: new Set(),
      diffStats: new Map(),
    };
    this.branchInfo = {
      branch: null,
      detached: false,
      sha: null,
      repoName: '',
    };
    this.selectedFiles = new Set();
    this.filterQuery = '';
    this._expanded = new Set();
    this._focusedPath = null;
    // Snapshot of the expanded set before the most recent
    // `setTree` call that replaced a real tree with a pruned
    // one. Used by `restoreExpandedState` when file search
    // exits so the user's full-tree expansion state returns.
    // Non-reactive — purely a restore buffer.
    this._expandedSnapshot = null;
    // Sort preferences — read persisted values with safe
    // defaults. A malformed localStorage entry (unknown mode,
    // non-'0'/'1' direction) falls back to defaults rather
    // than propagating into the sort comparator.
    const [loadedMode, loadedAsc] = this._loadSortPrefs();
    this._sortMode = loadedMode;
    this._sortAsc = loadedAsc;
  }

  /**
   * Read sort mode and direction from localStorage with safe
   * defaults. Returns [mode, asc] tuple.
   *
   * Defaults: name, ascending. Unknown mode values (including
   * null from missing key) fall back to name. Direction is
   * stored as '1' / '0' string; anything else falls back to
   * ascending. Wrapped in try/catch because localStorage can
   * throw in private-browsing or disabled-storage contexts.
   */
  _loadSortPrefs() {
    let mode = SORT_MODE_NAME;
    let asc = true;
    try {
      const savedMode = localStorage.getItem(_SORT_MODE_KEY);
      if (SORT_MODES.includes(savedMode)) mode = savedMode;
      const savedAsc = localStorage.getItem(_SORT_ASC_KEY);
      if (savedAsc === '0') asc = false;
      else if (savedAsc === '1') asc = true;
    } catch (_err) {
      // Ignore — defaults stay in place.
    }
    return [mode, asc];
  }

  /**
   * Persist current sort preferences to localStorage. Called
   * on every toggle. Wrapped in try/catch for the same reason
   * as the load path — a disabled-storage context shouldn't
   * break sort behaviour, just silently skip persistence.
   */
  _saveSortPrefs() {
    try {
      localStorage.setItem(_SORT_MODE_KEY, this._sortMode);
      localStorage.setItem(_SORT_ASC_KEY, this._sortAsc ? '1' : '0');
    } catch (_err) {
      // Ignore.
    }
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
   *
   * Used by the file search flow to swap the full tree for a
   * pruned one containing only matching files. The first call
   * after a real tree load snapshots the current expanded set
   * so `restoreExpandedState` can bring it back on exit.
   * Subsequent calls (search refinements) don't re-snapshot —
   * the original full-tree state stays preserved regardless of
   * how many pruned-tree updates arrive.
   */
  setTree(tree) {
    if (this._expandedSnapshot === null) {
      this._expandedSnapshot = new Set(this._expanded);
    }
    this.tree = tree;
    // Reset focus — a path from the previous tree may not
    // exist in the new one.
    this._focusedPath = null;
    this.requestUpdate();
  }

  /**
   * Restore the expanded set to its state before the first
   * `setTree` call in the current swap. Called by the files-tab
   * orchestrator when file search exits, before it re-loads the
   * full tree via `loadTree` (its own method, not exposed on
   * the picker). Clears the snapshot so the next search cycle
   * starts fresh.
   *
   * If no snapshot exists (e.g., `setTree` was never called,
   * or `restoreExpandedState` was called twice in a row), this
   * is a no-op.
   */
  restoreExpandedState() {
    if (this._expandedSnapshot === null) return;
    this._expanded = this._expandedSnapshot;
    this._expandedSnapshot = null;
    this._focusedPath = null;
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
        ${this._renderSortButtons()}
      </div>
      <div class="tree-scroll" role="tree">
        ${this._renderRoot()}
        ${this._renderChildren(filtered, 0, effectiveExpanded)}
      </div>
    `;
  }

  /**
   * Render the repo-root row at the top of the tree. Shows
   * the repo name and an optional branch pill. Non-
   * interactive — this isn't a directory the user can
   * collapse, and selecting "all files" via a checkbox at
   * the root is too broad to be useful. Hidden when both
   * `tree.name` and `branchInfo.repoName` are empty (pre-
   * first-load state).
   */
  _renderRoot() {
    const repoName =
      (this.tree && this.tree.name) ||
      (this.branchInfo && this.branchInfo.repoName) ||
      '';
    const pill = this._renderBranchPill();
    if (!repoName && !pill) return '';
    return html`
      <div
        class="row is-root"
        role="treeitem"
        title=${repoName || 'repository'}
      >
        <span class="name">${repoName || 'repository'}</span>
        ${pill}
      </div>
    `;
  }

  /**
   * Render the branch pill segment of the root row.
   * Returns an empty string when no branch info is
   * available — detached with no SHA, empty repo, or
   * pre-load state.
   */
  _renderBranchPill() {
    const info = this.branchInfo;
    if (!info) return '';
    if (info.detached) {
      const short =
        typeof info.sha === 'string' && info.sha
          ? info.sha.slice(0, 7)
          : '';
      if (!short) return '';
      return html`
        <span
          class="branch-pill detached"
          title="Detached HEAD at ${info.sha}"
          aria-label="Detached HEAD at ${info.sha}"
        >
          <span class="glyph">⎇</span>
          <span class="ref">${short}</span>
        </span>
      `;
    }
    if (typeof info.branch === 'string' && info.branch) {
      return html`
        <span
          class="branch-pill"
          title="On branch ${info.branch}"
          aria-label="On branch ${info.branch}"
        >
          <span class="glyph">⎇</span>
          <span class="ref">${info.branch}</span>
        </span>
      `;
    }
    return '';
  }

  _renderSortButtons() {
    const dir = this._sortAsc ? '↑' : '↓';
    const button = (mode, glyph, tooltip) => {
      const isActive = this._sortMode === mode;
      return html`
        <button
          type="button"
          class="sort-btn ${isActive ? 'active' : ''}"
          data-sort-mode=${mode}
          title=${tooltip}
          aria-pressed=${isActive}
          @click=${() => this._onSortButtonClick(mode)}
        >
          ${glyph}${isActive
            ? html`<span class="dir">${dir}</span>`
            : ''}
        </button>
      `;
    };
    return html`
      <div class="sort-buttons">
        <span class="label">Sort</span>
        ${button(
          SORT_MODE_NAME,
          'A',
          'Sort by name (click again to reverse)',
        )}
        ${button(
          SORT_MODE_MTIME,
          '🕐',
          'Sort by modification time (click again to reverse)',
        )}
        ${button(
          SORT_MODE_SIZE,
          '#',
          'Sort by size (click again to reverse)',
        )}
      </div>
    `;
  }

  _renderChildren(node, depth, expanded) {
    const children = sortChildrenWithMode(
      node.children,
      this._sortMode,
      this._sortAsc,
    );
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
    const tooltip = this._tooltipFor(node);
    return html`
      <div
        class="row is-dir"
        style="padding-left: ${indentPx}px"
        @click=${(e) => this._onDirClick(e, node)}
        role="treeitem"
        aria-expanded=${isOpen}
        title=${tooltip}
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
    const isFocused = node.path === this._focusedPath;
    const status = this._statusFor(node.path);
    const diff = this._diffStatsFor(node.path);
    const tooltip = this._tooltipFor(node);
    return html`
      <div
        class="row is-file ${isFocused ? 'focused' : ''}"
        style="padding-left: ${indentPx}px"
        @click=${(e) => this._onFileClick(e, node)}
        role="treeitem"
        aria-current=${isFocused ? 'true' : 'false'}
        title=${tooltip}
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
        ${status
          ? html`<span
              class="status-badge status-${status.kind}"
              title=${status.tooltip}
              aria-label=${status.tooltip}
              >${status.letter}</span
            >`
          : ''}
        ${diff
          ? html`<span class="diff-stats" title="Lines changed">
              ${diff.added > 0
                ? html`<span class="added">+${diff.added}</span>`
                : ''}
              ${diff.removed > 0
                ? html`<span class="removed">-${diff.removed}</span>`
                : ''}
            </span>`
          : ''}
        ${typeof node.lines === 'number' && node.lines > 0
          ? html`<span
              class="lines-badge ${this._linesColorClass(node.lines)}"
              >${node.lines}</span
            >`
          : ''}
      </div>
    `;
  }

  /**
   * Resolve the git status for a file path. Returns null when
   * the file has no tracked state, otherwise an object with
   * the badge letter, semantic kind (for CSS), and a tooltip.
   *
   * Priority order (when a file appears in multiple arrays):
   * deleted > staged > modified > untracked. Matches `git
   * status` short-form behaviour — a file that's both staged
   * and modified in the working tree shows `S` (the staged
   * action is the more recent user intent).
   */
  _statusFor(path) {
    const sd = this.statusData;
    if (!sd || !path) return null;
    if (sd.deleted?.has?.(path)) {
      return { letter: 'D', kind: 'deleted', tooltip: 'Deleted' };
    }
    if (sd.staged?.has?.(path)) {
      return { letter: 'S', kind: 'staged', tooltip: 'Staged' };
    }
    if (sd.modified?.has?.(path)) {
      return {
        letter: 'M',
        kind: 'modified',
        tooltip: 'Modified',
      };
    }
    if (sd.untracked?.has?.(path)) {
      return {
        letter: 'U',
        kind: 'untracked',
        tooltip: 'Untracked',
      };
    }
    return null;
  }

  /**
   * Look up diff stats for a file. Returns null when there
   * are no stats OR the entry has zero added + zero removed
   * (nothing worth rendering). Shape: `{added, removed}`.
   */
  _diffStatsFor(path) {
    const map = this.statusData?.diffStats;
    if (!map || typeof map.get !== 'function' || !path) return null;
    const entry = map.get(path);
    if (!entry || typeof entry !== 'object') return null;
    const added = typeof entry.added === 'number' ? entry.added : 0;
    const removed =
      typeof entry.removed === 'number' ? entry.removed : 0;
    if (added === 0 && removed === 0) return null;
    return { added, removed };
  }

  /**
   * Classify a line count into a color bucket. Thresholds
   * picked for readability / prompt-fitting rather than any
   * hard language rule — green files are comfortable, orange
   * is getting long, red is "consider splitting". Defined as
   * constants rather than inline so future tuning is local.
   */
  _linesColorClass(lines) {
    if (lines > 170) return 'lines-red';
    if (lines >= 130) return 'lines-orange';
    return 'lines-green';
  }

  /**
   * Build the hover tooltip for a file / directory row.
   * Shape: `"{full/path} — {name}"` when the path differs
   * from the name (i.e. the file is not at the repo root).
   * Root-level files and directories show just the name
   * since the path is identical to it.
   *
   * The full path is what the user came for when they
   * hover; the trailing name repeats what's visible in
   * the row as a readability anchor — useful when the
   * name column is truncated by ellipsis on narrow
   * layouts. Em-dash rather than a colon since a
   * Windows-style path `C:/…` with a colon separator
   * reads ambiguously.
   */
  _tooltipFor(node) {
    if (!node || typeof node !== 'object') return '';
    const name = typeof node.name === 'string' ? node.name : '';
    const path = typeof node.path === 'string' ? node.path : '';
    if (!name && !path) return '';
    if (!path || path === name) return name;
    return `${path} — ${name}`;
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

  /**
   * Handle a click on one of the three sort buttons.
   *
   * Clicking the currently-active mode toggles direction.
   * Clicking a different mode switches to it and resets to
   * ascending — users expect a fresh sort to start at a
   * familiar anchor (A-Z, oldest-first, smallest-first).
   * Persisted on every change.
   */
  _onSortButtonClick(mode) {
    if (!SORT_MODES.includes(mode)) return;
    if (this._sortMode === mode) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortMode = mode;
      this._sortAsc = true;
    }
    this._saveSortPrefs();
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
export {
  fuzzyMatch,
  filterTree,
  sortChildren,
  sortChildrenWithMode,
  computeFilterExpansions,
  SORT_MODE_NAME,
  SORT_MODE_MTIME,
  SORT_MODE_SIZE,
};