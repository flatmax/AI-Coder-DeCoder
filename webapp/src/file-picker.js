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

// Context-menu action identifiers. Reuses the action-id
// string on both the menu-item definition and the
// dispatched `context-menu-action` event detail so tests
// can pin the routing without needing to know menu
// position or item labels.
//
// 8a covers file-row context menus. Directory-row menus
// land with a later sub-commit (different item set:
// stage-all / rename / new-file / new-dir / exclude).
// Separating the two lets us ship the feature in smaller
// slices without prematurely designing a two-mode menu
// renderer.
const CTX_ACTION_STAGE = 'stage';
const CTX_ACTION_UNSTAGE = 'unstage';
const CTX_ACTION_DISCARD = 'discard';
const CTX_ACTION_RENAME = 'rename';
const CTX_ACTION_DUPLICATE = 'duplicate';
const CTX_ACTION_LOAD_LEFT = 'load-left';
const CTX_ACTION_LOAD_RIGHT = 'load-right';
const CTX_ACTION_EXCLUDE = 'exclude';
const CTX_ACTION_INCLUDE = 'include';
const CTX_ACTION_DELETE = 'delete';

// Menu items for file rows. Rendered in declaration
// order; groups separated by null entries which render
// as horizontal rules. The `showWhen` function gates
// conditional items (include vs exclude shown based on
// current state).
//
// 8a wires the shell with stubbed handlers; 8b–8d
// replace the stubs with real RPC dispatches.
const _CONTEXT_MENU_FILE_ITEMS = [
  { action: CTX_ACTION_STAGE, label: 'Stage', icon: '➕' },
  { action: CTX_ACTION_UNSTAGE, label: 'Unstage', icon: '➖' },
  {
    action: CTX_ACTION_DISCARD,
    label: 'Discard changes…',
    icon: '↻',
  },
  null,
  { action: CTX_ACTION_RENAME, label: 'Rename…', icon: '✎' },
  { action: CTX_ACTION_DUPLICATE, label: 'Duplicate…', icon: '⎘' },
  null,
  {
    action: CTX_ACTION_LOAD_LEFT,
    label: 'Load in left panel',
    icon: '◧',
  },
  {
    action: CTX_ACTION_LOAD_RIGHT,
    label: 'Load in right panel',
    icon: '◨',
  },
  null,
  {
    action: CTX_ACTION_EXCLUDE,
    label: 'Exclude from index',
    icon: '✕',
    showWhen: (ctx) => !ctx.isExcluded,
  },
  {
    action: CTX_ACTION_INCLUDE,
    label: 'Include in index',
    icon: '✓',
    showWhen: (ctx) => ctx.isExcluded,
  },
  null,
  {
    action: CTX_ACTION_DELETE,
    label: 'Delete…',
    icon: '🗑',
    destructive: true,
  },
];

// Directory-row action identifiers. Distinct from the
// file-row action IDs so a stale menu open on one node
// type can't accidentally dispatch to a handler
// expecting the other. Files-tab dispatches on
// `{action, type}` so the `type: 'dir'` discriminator
// also guards against wire-level mismatches.
const CTX_ACTION_STAGE_ALL = 'stage-all';
const CTX_ACTION_UNSTAGE_ALL = 'unstage-all';
const CTX_ACTION_RENAME_DIR = 'rename-dir';
const CTX_ACTION_NEW_FILE = 'new-file';
const CTX_ACTION_NEW_DIR = 'new-directory';
const CTX_ACTION_EXCLUDE_ALL = 'exclude-all';
const CTX_ACTION_INCLUDE_ALL = 'include-all';

// Inline-input mode identifiers. Rename and duplicate
// already use this mode discriminator via `_renaming` /
// `_duplicating` path fields; new-file and new-directory
// add a third state (`_creating`) that carries both the
// mode string AND the parent-dir path because the input
// is about creating a NEW entry inside a target directory
// rather than operating on an existing file.
const INLINE_MODE_RENAME = 'rename';
const INLINE_MODE_DUPLICATE = 'duplicate';
const INLINE_MODE_NEW_FILE = 'new-file';
const INLINE_MODE_NEW_DIR = 'new-directory';

// Menu items for directory rows. The exclude-all /
// include-all gate via `showWhen` reading the context
// object's `allExcluded` / `someExcluded` flags —
// computed at menu-open time by `_onDirContextMenu`.
// A partially-excluded dir (some descendants excluded,
// others not) shows BOTH items so the user picks
// which direction they want; a fully-excluded dir
// shows only Include-all; a fully-included dir shows
// only Exclude-all.
//
// New-file and new-directory items trigger the
// picker's inline-input flow, parallel to rename /
// duplicate for file rows. Part 2 of Increment 9
// wires these.
const _CONTEXT_MENU_DIR_ITEMS = [
  {
    action: CTX_ACTION_STAGE_ALL,
    label: 'Stage all',
    icon: '➕',
  },
  {
    action: CTX_ACTION_UNSTAGE_ALL,
    label: 'Unstage all',
    icon: '➖',
  },
  null,
  {
    action: CTX_ACTION_RENAME_DIR,
    label: 'Rename…',
    icon: '✎',
  },
  null,
  {
    action: CTX_ACTION_NEW_FILE,
    label: 'New file…',
    icon: '📄',
  },
  {
    action: CTX_ACTION_NEW_DIR,
    label: 'New directory…',
    icon: '📁',
  },
  null,
  {
    action: CTX_ACTION_EXCLUDE_ALL,
    label: 'Exclude all from index',
    icon: '✕',
    showWhen: (ctx) => !ctx.allExcluded,
  },
  {
    action: CTX_ACTION_INCLUDE_ALL,
    label: 'Include all in index',
    icon: '✓',
    showWhen: (ctx) => ctx.someExcluded,
  },
];

// Menu items for the root row. The root is the
// repository itself — no rename, stage-all, or
// exclude affordances make sense there (the user
// would be operating on the whole repo, which is
// always out-of-scope for the picker's per-file
// model). Only the "create new entry at repo root"
// actions are exposed, reusing the same dispatch
// path and action IDs as the directory menu so
// files-tab routes them through the existing
// new-file / new-directory handlers.
const _CONTEXT_MENU_ROOT_ITEMS = [
  {
    action: CTX_ACTION_NEW_FILE,
    label: 'New file…',
    icon: '📄',
  },
  {
    action: CTX_ACTION_NEW_DIR,
    label: 'New directory…',
    icon: '📁',
  },
];

// Viewport margin — the menu is kept this many pixels
// from every window edge. Enough to show the box-shadow
// glow without clipping on high-DPI displays.
const _CONTEXT_MENU_VIEWPORT_MARGIN = 8;

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
     * Excluded file paths — the third state in the three-state
     * checkbox model. An excluded file has no content, no index
     * block, and no tracker item in the LLM context. The
     * checkbox visually distinguishes excluded files with
     * strikethrough + dimmed + a ✕ badge. Set for O(1) lookup
     * during render (the picker iterates over many files). The
     * parent (files-tab) owns the canonical set and assigns it
     * via the direct-update pattern after each server response.
     */
    excludedFiles: { type: Object },
    /**
     * Path of the file currently open in a viewer, or null
     * when no file is open. The row matching this path gets
     * a distinct background and left-border accent — an
     * "active in viewer" highlight — independent of selection
     * or exclusion state. Updated from the viewer's
     * `active-file-changed` event via the files-tab
     * orchestrator (direct-update pattern).
     *
     * Distinct from `_focusedPath` (file-search match focus)
     * so a viewer-active file and a search-focused file can
     * coexist without visual collision. The CSS overrides
     * both states with distinct styling.
     */
    activePath: { type: String },
    /**
     * Review mode state object, or null when not in
     * review. Shape matches the backend's
     * `get_review_state()` response:
     *   {
     *     active: bool,
     *     branch: string,
     *     base_commit: string,
     *     branch_tip: string,
     *     original_branch: string,
     *     commits: [{sha, short_sha, message, author, date}, ...],
     *     changed_files: [{path, added, removed, status}, ...],
     *     stats: {files_changed, insertions, deletions}
     *   }
     *
     * When non-null and `active: true`, the picker renders
     * a banner above the filter bar showing the review
     * summary. Pushed via direct-update from the files-tab
     * orchestrator in response to `review-started` /
     * `review-ended` window events. Clicking the banner's
     * exit button dispatches `exit-review` which bubbles
     * to the files-tab.
     */
    reviewState: { type: Object },
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
    /**
     * Context menu state. When non-null, a menu is open at
     * the recorded viewport coordinates and targets the
     * given file row. Shape:
     *   {path, name, isExcluded, x, y}
     * Always null when no menu is visible. State is reset
     * on any action click, outside click, Escape key, or
     * host disconnect.
     *
     * 8a covers file-row menus only. Directory menus will
     * add a `type: 'dir'` discriminator when they ship.
     */
    _contextMenu: { type: Object, state: true },
    /**
     * Git action disable flags. Tracked locally by
     * listening to the same window events the app-shell
     * uses (stream-chunk, stream-complete, commit-result,
     * review-started, review-ended). Drives the disabled
     * state on the three git buttons rendered in the sort
     * row. The shell still owns the authoritative RPC
     * dispatch; the picker fires a `git-action` window
     * event on click and the shell handles.
     */
    _committing: { type: Boolean, state: true },
    _reviewActive: { type: Boolean, state: true },
    _streaming: { type: Boolean, state: true },
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

    /* Git actions — appear on the right side of the sort
     * row. Auto-left margin pushes them against the right
     * edge so they sit opposite the sort buttons without a
     * wrapping flex item in between. Red tint on the
     * destructive reset button matches the convention used
     * elsewhere in the app. */
    .picker-git-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      margin-left: auto;
    }
    .picker-git-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-primary, #c9d1d9);
      padding: 0.2rem 0.4rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 120ms ease, background 120ms ease;
    }
    .picker-git-btn:hover:not([disabled]) {
      opacity: 1;
      background: rgba(240, 246, 252, 0.08);
    }
    .picker-git-btn.danger:hover:not([disabled]) {
      background: rgba(248, 81, 73, 0.15);
      border-color: rgba(248, 81, 73, 0.3);
    }
    .picker-git-btn.in-flight {
      opacity: 1;
      background: rgba(88, 166, 255, 0.12);
      border-color: rgba(88, 166, 255, 0.3);
    }
    .picker-git-btn[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .tree-scroll {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      padding: 0.25rem 0;
      outline: none;
    }
    .tree-scroll:focus-visible {
      /* Subtle in-container focus indicator so keyboard
       * users see they've landed in the tree. Native
       * :focus outline is suppressed above because it
       * clips under the scrollbar on some platforms. */
      box-shadow: inset 0 0 0 2px var(--accent-primary, #58a6ff);
    }

    /* Review mode banner — sits above the filter bar when
     * reviewState.active is true. Orange/amber colour
     * scheme signals "not normal editing mode" — the
     * same hue family the detached-HEAD branch pill
     * uses, distinct from the default muted grey of the
     * filter bar. Users browsing review-mode files see
     * this persistent banner and know the working tree
     * is pointed at a pre-change state. */
    .review-banner {
      flex-shrink: 0;
      padding: 0.5rem 0.6rem;
      background: rgba(210, 153, 34, 0.12);
      border-bottom: 1px solid rgba(210, 153, 34, 0.3);
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.8125rem;
    }
    .review-banner-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .review-banner-icon {
      font-size: 1rem;
    }
    .review-banner-title {
      font-weight: 600;
      color: #d29922;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .review-banner-exit {
      background: rgba(210, 153, 34, 0.2);
      border: 1px solid rgba(210, 153, 34, 0.4);
      color: #d29922;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
      font-weight: 500;
      flex-shrink: 0;
    }
    .review-banner-exit:hover {
      background: rgba(210, 153, 34, 0.3);
      border-color: rgba(210, 153, 34, 0.6);
    }
    .review-banner-view-graph {
      background: transparent;
      border: 1px solid rgba(210, 153, 34, 0.3);
      color: #d29922;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      font-family: inherit;
      font-weight: 500;
      flex-shrink: 0;
    }
    .review-banner-view-graph:hover {
      background: rgba(210, 153, 34, 0.15);
      border-color: rgba(210, 153, 34, 0.5);
    }
    .review-banner-stats {
      display: flex;
      gap: 0.75rem;
      font-size: 0.75rem;
      color: var(--text-secondary, #8b949e);
      font-variant-numeric: tabular-nums;
    }
    .review-banner-stats .stat-added {
      color: #3fb950;
    }
    .review-banner-stats .stat-removed {
      color: #f85149;
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
      padding: 0.15rem 0.5rem 0.15rem calc(var(--row-indent, 0px) + 0.9rem);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      position: relative;
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
    /* Variant rendered to the LEFT of the checkbox —
     * absolutely positioned so it floats in a dedicated
     * gutter reserved at the row's left edge (inside
     * the depth indent, just before the twisty). The
     * checkbox stays in the same flex column regardless
     * of whether a given row has diff stats, so siblings
     * remain aligned. Width of the gutter is reserved
     * by the row's padding-left; the stats right-align
     * within it so numbers hug the checkbox side. */
    .diff-stats.diff-stats-pre {
      position: absolute;
      right: auto;
      left: calc(var(--row-indent, 0px) - 1.6rem);
      width: 2.4rem;
      justify-content: flex-end;
      margin: 0;
      pointer-events: none;
      font-size: 0.65rem;
    }
    .diff-stats .added {
      color: #3fb950;
    }
    .diff-stats .removed {
      color: #f85149;
    }

    /* Excluded file visual treatment (third state in the
     * three-state checkbox model). Strikethrough + reduced
     * opacity on the name, dimmed checkbox, ✕ badge. Signals
     * "not indexed, not in context" — distinct from both
     * selected (ticked) and index-only (default unticked). */
    .row.is-file.is-excluded .name {
      text-decoration: line-through;
      opacity: 0.45;
    }
    .row.is-file.is-excluded .checkbox {
      opacity: 0.5;
    }
    /* Directory exclusion treatment — mirrors the file
     * rules for "all descendants excluded", plus a softer
     * partial state that shows a dimmed badge but leaves
     * the name intact. Users scanning a collapsed tree
     * can tell at a glance whether a subtree is fully,
     * partially, or not excluded. Also applies to the
     * root row, which aggregates over the entire repo. */
    .row.is-dir.all-excluded .name,
    .row.is-root.all-excluded .name {
      text-decoration: line-through;
      opacity: 0.45;
    }
    .row.is-dir.all-excluded .checkbox,
    .row.is-root.all-excluded .checkbox {
      opacity: 0.5;
    }
    .row.is-dir.some-excluded .excluded-badge,
    .row.is-root.some-excluded .excluded-badge {
      opacity: 0.5;
    }
    .excluded-badge {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1rem;
      height: 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: #f85149;
      opacity: 0.8;
      margin-left: 0.25rem;
      user-select: none;
      /* Match the status-badge visual weight so the ✕ sits
       * in the row alongside M/S/U/D badges without looking
       * out of place. */
    }

    /* Active-in-viewer highlight — the row matching
     * activePath gets a distinct accented background and
     * a left-border stripe so the user can find it at a
     * glance. Distinct from .focused (file-search match
     * focus) and from the selection checkbox — a file can
     * be selected, excluded, focused, AND active; each
     * state contributes its own styling without collision.
     *
     * The border-left absorbs some of the row's left
     * padding via a transparent outer margin — not pretty,
     * but using box-shadow inset keeps the handle from
     * shifting other content. */
    .row.is-file.active-in-viewer {
      background: rgba(88, 166, 255, 0.08);
      box-shadow: inset 3px 0 0 var(--accent-primary, #58a6ff);
    }
    .row.is-file.active-in-viewer .name {
      color: var(--accent-primary, #58a6ff);
    }

    /* Reveal flash — applied briefly when the diff
     * viewer's status LED is clicked. A quick pulse of
     * accented background + outline draws the eye to
     * the row without permanently altering appearance.
     * The class is added via revealFile() and auto-
     * removed after the animation completes. */
    @keyframes picker-reveal-flash {
      0% {
        background: rgba(88, 166, 255, 0.45);
        box-shadow: inset 0 0 0 2px var(--accent-primary, #58a6ff);
      }
      100% {
        background: transparent;
        box-shadow: inset 0 0 0 2px transparent;
      }
    }
    .row.reveal-flash {
      animation: picker-reveal-flash 1.2s ease-out;
    }

    /* Inline-input rows — for rename and duplicate.
     * Match the file-row layout so the input lines up
     * with the filename column. The textbox uses the
     * same minimal dark styling as the filter input
     * but sized to fit tightly alongside the twisty
     * and checkbox placeholders. */
    .row.is-inline {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.1rem 0.5rem 0.1rem var(--row-indent, 0px);
      background: rgba(88, 166, 255, 0.06);
    }
    .row.is-inline .inline-input {
      flex: 1;
      min-width: 0;
      padding: 0.2rem 0.35rem;
      background: rgba(13, 17, 23, 0.9);
      border: 1px solid var(--accent-primary, #58a6ff);
      border-radius: 3px;
      color: var(--text-primary, #c9d1d9);
      font-family: inherit;
      font-size: 0.8125rem;
    }
    .row.is-inline .inline-input:focus {
      outline: none;
      border-color: var(--accent-primary, #58a6ff);
      box-shadow: 0 0 0 1px var(--accent-primary, #58a6ff);
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

    /* Context menu — position: fixed so it escapes the
     * picker's scroll containers. z-index above the
     * tree but below any app-shell modal that might
     * float over it (toasts, history browser). The
     * dialog-surface design language (backdrop-blur,
     * muted panel background) matches the app's other
     * floating surfaces. */
    .context-menu {
      position: fixed;
      z-index: 1000;
      min-width: 200px;
      padding: 0.25rem 0;
      background: rgba(22, 27, 34, 0.96);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(240, 246, 252, 0.15);
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      font-size: 0.8125rem;
      user-select: none;
    }
    .context-menu .menu-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.75rem;
      cursor: pointer;
      color: var(--text-primary, #c9d1d9);
    }
    .context-menu .menu-item:hover {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent-primary, #58a6ff);
    }
    .context-menu .menu-item.destructive {
      color: #f85149;
    }
    .context-menu .menu-item.destructive:hover {
      background: rgba(248, 81, 73, 0.15);
      color: #ff6b6b;
    }
    .context-menu .menu-item .icon {
      display: inline-flex;
      width: 1rem;
      justify-content: center;
      opacity: 0.85;
      font-size: 0.85rem;
    }
    .context-menu .menu-item .label {
      flex: 1;
    }
    .context-menu .menu-separator {
      height: 1px;
      margin: 0.25rem 0.4rem;
      background: rgba(240, 246, 252, 0.1);
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
    // Empty-but-shaped default so `_renderFile`'s Set.has()
    // calls don't need guard clauses before the first tree
    // load. Orchestrator replaces this whole object on each
    // load; per-field mutation isn't used.
    this.statusData = {
      modified: new Set(),
      staged: new Set(),
      untracked: new Set(),
      deleted: new Set(),
      diffStats: {},
    };
    // Excluded files — the third state. Default empty Set so
    // `Set.has()` during render works before the first server
    // response. Parent assigns via direct-update pattern.
    this.excludedFiles = new Set();
    // No file open in a viewer yet. Remains null until the
    // orchestrator pushes the first viewer event.
    this.activePath = null;
    // No review active yet. Pushed by the files-tab when
    // the `review-started` window event fires.
    this.reviewState = null;
    this.filterQuery = '';
    this._expanded = new Set();
    this._focusedPath = null;
    // Inline-input state — null when no rename or
    // duplicate is active. Mutually exclusive (only one
    // can be active at a time); the orchestrator enforces
    // this by clearing the other when setting one.
    this._renaming = null;
    this._duplicating = null;
    // New-entry creation state. Shape when active:
    //   {mode: 'new-file' | 'new-directory',
    //    parentPath: string}
    // Null when no creation is in progress. Distinct from
    // `_renaming` / `_duplicating` because the input is
    // not operating on an existing file — it's creating
    // a new one inside `parentPath`. Mutually exclusive
    // with rename and duplicate (only one inline input
    // can be active at a time).
    this._creating = null;
    // Snapshot of the expanded set before the most recent
    // `setTree` call that replaced a real tree with a pruned
    // one. Used by `restoreExpandedState` when file search
    // exits so the user's full-tree expansion state returns.
    // Non-reactive — purely a restore buffer.
    this._expandedSnapshot = null;
    // Context menu state — null when closed, populated
    // shape when open. See reactive properties above for
    // the field list. Reset on disconnect so a picker
    // that's unmounted mid-menu doesn't leak document
    // listeners or leave a stale menu in the DOM after
    // reinsertion.
    this._contextMenu = null;
    // Bound handlers for document-level listeners —
    // identical references for addEventListener and
    // removeEventListener so the teardown path matches
    // the setup path. Document listeners only attach
    // while a menu is open so background click/key
    // handling stays cheap in the common case.
    this._onDocumentClickForMenu = this._onDocumentClickForMenu.bind(this);
    this._onDocumentKeyDownForMenu =
      this._onDocumentKeyDownForMenu.bind(this);
    // Git action flags — updated from window events.
    this._committing = false;
    this._reviewActive = false;
    this._streaming = false;
    this._onStreamChunkGit = () => {
      if (!this._streaming) this._streaming = true;
    };
    this._onStreamCompleteGit = () => {
      this._streaming = false;
    };
    this._onCommitResultGit = () => {
      this._committing = false;
    };
    this._onReviewStartedGit = () => {
      this._reviewActive = true;
    };
    this._onReviewEndedGit = () => {
      this._reviewActive = false;
    };
    // Sort preferences — read persisted values with safe
    // defaults. A malformed localStorage entry (unknown mode,
    // non-'0'/'1' direction) falls back to defaults rather
    // than propagating into the sort comparator.
    const [loadedMode, loadedAsc] = this._loadSortPrefs();
    this._sortMode = loadedMode;
    this._sortAsc = loadedAsc;
  }

  connectedCallback() {
    super.connectedCallback();
    // Mirror the shell's git-action gating so the buttons
    // disable during commits, review mode, and streaming
    // without needing a props pipeline through files-tab.
    window.addEventListener('stream-chunk', this._onStreamChunkGit);
    window.addEventListener(
      'stream-complete', this._onStreamCompleteGit,
    );
    window.addEventListener(
      'commit-result', this._onCommitResultGit,
    );
    window.addEventListener(
      'review-started', this._onReviewStartedGit,
    );
    window.addEventListener(
      'review-ended', this._onReviewEndedGit,
    );
  }

  // Tear down any open menu when the host detaches. Catches
  // mid-menu unmounts from tab switches and parent re-renders
  // so document listeners don't leak.
  disconnectedCallback() {
    this._closeContextMenu();
    window.removeEventListener(
      'stream-chunk', this._onStreamChunkGit,
    );
    window.removeEventListener(
      'stream-complete', this._onStreamCompleteGit,
    );
    window.removeEventListener(
      'commit-result', this._onCommitResultGit,
    );
    window.removeEventListener(
      'review-started', this._onReviewStartedGit,
    );
    window.removeEventListener(
      'review-ended', this._onReviewEndedGit,
    );
    super.disconnectedCallback();
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

  /**
   * Reveal a file in the tree — expand its ancestor
   * directories so the row exists in the DOM, clear any
   * filter that would hide it, scroll it into the
   * centre of the viewport, and briefly flash it with
   * an accent highlight so the user's eye can find it.
   *
   * Called by the files-tab orchestrator in response to
   * a `reveal-file-in-picker` event dispatched from the
   * diff viewer's status LED. The common case: the
   * user has scrolled the picker away from the active
   * file, clicks the LED to get back to it.
   *
   * Safe no-op when `path` is empty, non-string, or
   * doesn't exist in the current tree. The filter is
   * cleared unconditionally — a file that matched the
   * filter still gets revealed, but a file that didn't
   * wouldn't otherwise appear, so clearing is the
   * predictable behaviour.
   */
  revealFile(path) {
    if (typeof path !== 'string' || !path) return;
    // Clear filter so the row isn't filtered out.
    // Preserving the filter would mean "reveal" is a
    // silent no-op for non-matching paths — confusing.
    if (this.filterQuery) {
      this.filterQuery = '';
    }
    // Expand every ancestor directory so the row lands
    // in the DOM. Same logic as the files-tab's
    // _expandAncestorsOf but kept local here so the
    // public API doesn't require orchestrator
    // coordination.
    const parts = path.split('/');
    if (parts.length > 1) {
      const next = new Set(this._expanded);
      let acc = '';
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        next.add(acc);
      }
      this._expanded = next;
    }
    // Set focus so the accent background highlights
    // the row in addition to the flash animation.
    // Having both states makes the location stick in
    // the user's attention after the flash fades.
    this._focusedPath = path;
    // Defer scroll + flash until Lit commits the
    // expansion and filter changes — the row needs to
    // be in the DOM before scrollIntoView can target
    // it.
    this.updateComplete.then(() => {
      const row = this._findRowElementForPath(path);
      if (!row) return;
      if (typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      // Remove any prior flash class on this row (the
      // user may have clicked the LED twice quickly)
      // then re-add so the animation restarts.
      row.classList.remove('reveal-flash');
      // Force a reflow so the restart takes effect.
      // Reading offsetWidth is the canonical browser
      // idiom for this; the value is discarded.
      void row.offsetWidth;
      row.classList.add('reveal-flash');
      // Clean up the class after the animation
      // completes so a subsequent class add triggers
      // a fresh animation rather than a no-op.
      setTimeout(() => {
        row.classList.remove('reveal-flash');
      }, 1300);
    });
  }

  /**
   * Begin renaming a file. Public API for the orchestrator
   * to call after the user picks "Rename" from the context
   * menu. Clears any active duplicate or creation state —
   * only one inline input can be active at a time.
   *
   * No-op when path is empty or the file doesn't exist in
   * the tree. Callers should validate upstream; this is
   * defensive against stale menu state.
   */
  beginRename(path) {
    if (typeof path !== 'string' || !path) return;
    this._duplicating = null;
    this._creating = null;
    this._renaming = path;
  }


  /**
   * Begin duplicating a file. Inline input appears as a
   * new row below the source, pre-filled with the source
   * path so the user can edit the target location.
   */
  beginDuplicate(path) {
    if (typeof path !== 'string' || !path) return;
    this._renaming = null;
    this._creating = null;
    this._duplicating = path;
  }

  /**
   * Begin creating a new file inside the given parent
   * directory. Inline input appears as a new row at the
   * top of that directory's children, pre-filled empty
   * so the user types the filename from scratch. The
   * parent directory is auto-expanded so the input is
   * visible.
   *
   * Empty-string `parentPath` IS legal — that's the
   * repo root. The auto-expand branch skips it because
   * the root isn't a collapsible node.
   */
  beginCreateFile(parentPath) {
    if (typeof parentPath !== 'string') return;
    this._renaming = null;
    this._duplicating = null;
    this._creating = { mode: INLINE_MODE_NEW_FILE, parentPath };
    if (parentPath && !this._expanded.has(parentPath)) {
      const next = new Set(this._expanded);
      next.add(parentPath);
      this._expanded = next;
    }
  }

  /**
   * Begin creating a new directory inside the given
   * parent. Same input pattern as new-file; on commit,
   * the orchestrator creates the directory by writing
   * a `.gitkeep` placeholder inside it (git doesn't
   * track empty directories).
   */
  beginCreateDirectory(parentPath) {
    if (typeof parentPath !== 'string') return;
    this._renaming = null;
    this._duplicating = null;
    this._creating = { mode: INLINE_MODE_NEW_DIR, parentPath };
    if (parentPath && !this._expanded.has(parentPath)) {
      const next = new Set(this._expanded);
      next.add(parentPath);
      this._expanded = next;
    }
  }

  /**
   * Lifecycle — fires after every render. Auto-focus and
   * pre-select the stem (part before the final dot) of
   * any newly-mounted inline input so the user can start
   * typing immediately.
   */
  updated(changedProps) {
    super.updated?.(changedProps);
    if (
      !changedProps.has('_renaming')
      && !changedProps.has('_duplicating')
      && !changedProps.has('_creating')
    ) {
      return;
    }
    const input = this.shadowRoot?.querySelector('.inline-input');
    if (!input) return;
    // Only focus if we're not already focused there —
    // avoids re-selecting text every time an unrelated
    // property changes while the input is open.
    if (this.shadowRoot.activeElement === input) return;
    input.focus();
    const value = input.value || '';
    // Select the stem (portion before the last '.') so
    // users typing replace the name but keep the
    // extension. For paths, the "stem" is everything
    // before the final '.' in the final segment.
    const lastSlash = value.lastIndexOf('/');
    const finalSeg = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
    const lastDot = finalSeg.lastIndexOf('.');
    if (lastDot > 0) {
      // Select from the start up to the start of the
      // extension. For paths, that's lastSlash + 1 up to
      // lastSlash + 1 + lastDot.
      const selStart = lastSlash + 1;
      const selEnd = selStart + lastDot;
      input.setSelectionRange(selStart, selEnd);
    } else {
      input.select();
    }
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
      ${this._renderReviewBanner()}
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
      <div
        class="tree-scroll"
        role="tree"
        tabindex="0"
        @keydown=${this._onTreeKeyDown}
      >
        ${this._renderRoot()}
        ${this._creating && this._creating.parentPath === ''
          ? this._renderInlineInput({
              mode: this._creating.mode,
              sourcePath: '',
              sourceName: '',
              depth: 0,
            })
          : ''}
        ${this._renderChildren(filtered, 0, effectiveExpanded)}
      </div>
      ${this._renderContextMenu()}
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
    // Compute aggregate selection/exclusion state the same
    // way directory rows do — the root is effectively the
    // directory containing every file in the repo.
    const allExcluded = this._allDescendantsExcluded(this.tree);
    const someExcluded =
      !allExcluded && this._someDescendantsExcluded(this.tree);
    const allSelected = this._allDescendantsSelected(this.tree);
    const someSelected =
      !allSelected && this._someDescendantsSelected(this.tree);
    const rowClasses = [
      'row',
      'is-root',
      allExcluded ? 'all-excluded' : '',
      someExcluded ? 'some-excluded' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const badgeTitle = 'Some files excluded from index';
    const checkboxTitle =
      'Click to select all files, shift+click to exclude all from index.';
    return html`
      <div
        class=${rowClasses}
        role="treeitem"
        title=${repoName || 'repository'}
        @contextmenu=${this._onRootContextMenu}
      >
        <input
          type="checkbox"
          class="checkbox"
          .checked=${allSelected}
          .indeterminate=${someSelected}
          @click=${this._onRootCheckbox}
          aria-label="Select all files in repository"
          title=${checkboxTitle}
        />
        <span class="name">${repoName || 'repository'}</span>
        ${someExcluded
          ? html`<span
              class="excluded-badge"
              title=${badgeTitle}
              aria-label=${badgeTitle}
              >✕</span
            >`
          : ''}
        ${pill}
      </div>
    `;
  }

  /**
   * Root-row checkbox handler. Mirrors `_onDirCheckbox`
   * but targets every file in the repo via `this.tree`.
   * Regular click toggles select-all (and un-excludes
   * any excluded files so the selection isn't silently
   * partial). Shift+click toggles exclude-all (and
   * deselects any that were selected, since excluded
   * and selected are mutually exclusive).
   */
  _onRootCheckbox(event) {
    event.stopPropagation();
    const descendants = this._collectDescendantFiles(this.tree);
    if (descendants.length === 0) return;
    if (event.shiftKey) {
      event.preventDefault();
      const allExcluded = descendants.every((p) =>
        this.excludedFiles.has(p),
      );
      const nextExcluded = new Set(this.excludedFiles);
      if (allExcluded) {
        for (const p of descendants) nextExcluded.delete(p);
      } else {
        for (const p of descendants) nextExcluded.add(p);
      }
      this._emitExclusionChanged(nextExcluded);
      if (!allExcluded) {
        const nextSelected = new Set(this.selectedFiles);
        let selectionChanged = false;
        for (const p of descendants) {
          if (nextSelected.has(p)) {
            nextSelected.delete(p);
            selectionChanged = true;
          }
        }
        if (selectionChanged) this._emitSelectionChanged(nextSelected);
      }
      return;
    }
    const anyExcluded = descendants.some((p) =>
      this.excludedFiles.has(p),
    );
    if (anyExcluded) {
      const nextExcluded = new Set(this.excludedFiles);
      for (const p of descendants) nextExcluded.delete(p);
      this._emitExclusionChanged(nextExcluded);
    }
    const allSelected = descendants.every((p) =>
      this.selectedFiles.has(p),
    );
    const next = new Set(this.selectedFiles);
    if (allSelected) {
      for (const p of descendants) next.delete(p);
    } else {
      for (const p of descendants) next.add(p);
    }
    this._emitSelectionChanged(next);
  }

  /**
   * Open the root-row context menu. Parallel to
   * `_onDirContextMenu` / `_onFileContextMenu` but uses
   * `type: 'root'` so the renderer picks the
   * repo-specific item catalog. Targets the empty-string
   * parent path — the same convention `beginCreateFile`
   * already uses for root-level creation, and the same
   * string `files-tab._dispatchNewFile` forwards.
   */
  _onRootContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    this._contextMenu = {
      type: 'root',
      path: '',
      name: (this.tree && this.tree.name) || '',
      x: event.clientX,
      y: event.clientY,
    };
    document.addEventListener(
      'click',
      this._onDocumentClickForMenu,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
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
        ${this._renderGitActions()}
      </div>
    `;
  }

  /**
   * Render the three git action buttons — copy-diff,
   * commit, reset-to-head — on the right side of the sort
   * row. Each button dispatches a bubbling `git-action`
   * window event that the app-shell catches and routes to
   * the existing RPC handlers. Local state flags
   * (_committing, _streaming, _reviewActive) drive the
   * disabled states; the shell remains the single source
   * of truth for the actual work.
   */
  _renderGitActions() {
    const commitDisabled =
      this._committing || this._reviewActive || this._streaming;
    const resetDisabled = this._committing || this._streaming;
    const commitTitle = this._reviewActive
      ? 'Commit disabled during review'
      : this._streaming
        ? 'Commit disabled while AI is responding'
        : this._committing
          ? 'Committing…'
          : 'Stage all changes and commit with an auto-generated message';
    const resetTitle = this._streaming
      ? 'Reset disabled while AI is responding'
      : 'Reset to HEAD (discard all uncommitted changes)';
    // Review button — only visible when not already in
    // review mode. The picker's own review banner
    // handles the exit affordance when review is active,
    // so showing a "Review…" button alongside would be
    // redundant and confusing. Disabled during streaming
    // / commit to prevent racing a mid-flight mutation.
    const reviewActive = !!(
      this.reviewState && this.reviewState.active
    );
    const reviewDisabled =
      this._committing || this._streaming || reviewActive;
    const reviewTitle = reviewActive
      ? 'Already in review mode'
      : this._streaming
        ? 'Review disabled while AI is responding'
        : this._committing
          ? 'Review disabled during commit'
          : 'Start a code review of a branch';
    return html`
      <div
        class="picker-git-actions"
        role="group"
        aria-label="Git actions"
      >
        <span class="label">Git</span>
        <button
          class="picker-git-btn"
          title="Copy working-tree diff to clipboard"
          aria-label="Copy diff"
          @click=${() => this._dispatchGitAction('copy-diff')}
        >📋</button>
        <button
          class="picker-git-btn ${this._committing ? 'in-flight' : ''}"
          ?disabled=${commitDisabled}
          title=${commitTitle}
          aria-label="Commit all changes"
          @click=${() => this._dispatchGitAction('commit')}
        >${this._committing ? '⏳' : '💾'}</button>
        <button
          class="picker-git-btn danger"
          ?disabled=${resetDisabled}
          title=${resetTitle}
          aria-label="Reset to HEAD"
          @click=${() => this._dispatchGitAction('reset')}
        >⚠️</button>
        ${reviewActive ? '' : html`
          <button
            class="picker-git-btn"
            ?disabled=${reviewDisabled}
            title=${reviewTitle}
            aria-label="Start code review"
            @click=${this._onReviewButtonClick}
          >🔍</button>
        `}
      </div>
    `;
  }

  /**
   * Handle the Review button click. Dispatches a
   * bubbling+composed `open-review-selector` event
   * that the files-tab orchestrator catches to open
   * the branch-selection modal. The picker doesn't
   * know about RPCs or modals — it just fires the
   * intent event, matching the pattern used by
   * `exit-review`.
   */
  _onReviewButtonClick() {
    this.dispatchEvent(
      new CustomEvent('open-review-selector', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  _dispatchGitAction(action) {
    this.dispatchEvent(new CustomEvent('git-action', {
      detail: { action },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Render the review banner when review mode is active.
   * Shows the branch name, commit count, and file/line
   * stats as a summary, with an exit button to end
   * review and return to normal mode.
   *
   * Returns an empty result when `reviewState` is null or
   * not active — the banner only appears during an active
   * review. Defensive against malformed shapes (missing
   * commits array, missing stats object) so a partial
   * server response doesn't crash the render.
   */
  _renderReviewBanner() {
    const state = this.reviewState;
    if (!state || typeof state !== 'object') return '';
    if (!state.active) return '';
    const branch = typeof state.branch === 'string' ? state.branch : '';
    const commits = Array.isArray(state.commits) ? state.commits : [];
    const commitCount = commits.length;
    const stats =
      state.stats && typeof state.stats === 'object'
        ? state.stats
        : {};
    const filesChanged = Number(stats.files_changed) || 0;
    const added = Number(stats.additions) || 0;
    const removed = Number(stats.deletions) || 0;
    // Title — branch name plus commit count. Users see
    // what's under review at a glance.
    const title = branch
      ? `Reviewing ${branch}`
      : 'Reviewing branch';
    const commitLabel =
      commitCount === 1 ? '1 commit' : `${commitCount} commits`;
    return html`
      <div class="review-banner" role="status"
        aria-label="Review mode active">
        <div class="review-banner-header">
          <span class="review-banner-icon" aria-hidden="true">🔍</span>
          <span class="review-banner-title" title=${title}>
            ${title}
          </span>
          <button
            class="review-banner-view-graph"
            @click=${this._onViewGraphClick}
            title="View the full commit graph with the review base and branch tip highlighted"
            aria-label="View review history graph"
          >
            View graph
          </button>
          <button
            class="review-banner-exit"
            @click=${this._onExitReviewClick}
            title="Exit review mode and return to the working branch"
            aria-label="Exit review mode"
          >
            Exit
          </button>
        </div>
        <div class="review-banner-stats">
          <span>${commitLabel}</span>
          <span>${filesChanged} file${filesChanged === 1 ? '' : 's'}</span>
          ${added > 0
            ? html`<span class="stat-added">+${added}</span>`
            : ''}
          ${removed > 0
            ? html`<span class="stat-removed">-${removed}</span>`
            : ''}
        </div>
      </div>
    `;
  }

  /**
   * Handle the exit button click. Dispatches
   * `exit-review` as a bubbling+composed event so the
   * files-tab can catch it and fire the corresponding
   * `LLMService.end_review` RPC. The picker doesn't
   * know about the RPC directly — event-based
   * coordination keeps the files-tab as the single
   * place that owns review-state transitions.
   */
  _onExitReviewClick() {
    this.dispatchEvent(
      new CustomEvent('exit-review', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Handle the "View graph" button click. Dispatches
   * `open-review-graph` so the files-tab can open the
   * review-history modal (a read-only commit-graph
   * with the review's merge-base and branch tip
   * highlighted). Same event pattern as
   * `open-review-selector` — the picker fires the
   * intent, the orchestrator handles the modal.
   */
  _onViewGraphClick() {
    this.dispatchEvent(
      new CustomEvent('open-review-graph', {
        bubbles: true,
        composed: true,
      }),
    );
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
    const allExcluded = this._allDescendantsExcluded(node);
    const someExcluded =
      !allExcluded && this._someDescendantsExcluded(node);
    const tooltip = this._tooltipForDir(node, {
      allExcluded,
      someExcluded,
    });
    const rowClasses = [
      'row',
      'is-dir',
      allExcluded ? 'all-excluded' : '',
      someExcluded ? 'some-excluded' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const badgeTitle = 'Some files excluded from index';
    return html`
      <div
        class=${rowClasses}
        style="--row-indent: ${indentPx}px"
        data-row-path=${node.path}
        @click=${(e) => this._onDirClick(e, node)}
        @auxclick=${(e) => this._onDirAuxClick(e, node)}
        @contextmenu=${(e) => this._onDirContextMenu(e, node)}
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
        ${someExcluded
          ? html`<span
              class="excluded-badge"
              title=${badgeTitle}
              aria-label=${badgeTitle}
              >✕</span
            >`
          : ''}
      </div>
      ${isOpen
        ? html`
            ${this._creating &&
            this._creating.parentPath === node.path
              ? this._renderInlineInput({
                  mode: this._creating.mode,
                  sourcePath: node.path,
                  sourceName: '',
                  depth: depth + 1,
                })
              : ''}
            ${this._renderChildren(node, depth + 1, expanded)}
          `
        : ''}
    `;
  }

  _renderFile(node, depth) {
    // Inline-input branches — rename replaces the row,
    // duplicate appends a new input row below the
    // source. Rendering the source row while renaming
    // would confuse the user (two text affordances
    // showing the same thing); rendering it for
    // duplicate is correct because the source file
    // still exists and the input is specifying the
    // target.
    if (this._renaming === node.path) {
      return this._renderInlineInput({
        mode: 'rename',
        sourcePath: node.path,
        sourceName: node.name,
        depth,
      });
    }
    const isSelected = this.selectedFiles.has(node.path);
    const isExcluded = this.excludedFiles.has(node.path);
    const indentPx = depth * 16;
    const isFocused = node.path === this._focusedPath;
    const isActive = node.path === this.activePath;
    const status = this._statusFor(node.path);
    const diff = this._diffStatsFor(node.path);
    const tooltip = this._tooltipFor(node, isExcluded);
    // Checkbox tooltip adapts so shift+click guidance
    // surfaces on hover. Users discover the exclusion
    // gesture without needing to read docs.
    const checkboxTitle = isExcluded
      ? 'Excluded from index. Click to include and select, or shift+click to return to index-only.'
      : 'Click to select, shift+click to exclude from index.';
    return html`
      <div
        class="row is-file ${isFocused ? 'focused' : ''} ${isExcluded ? 'is-excluded' : ''} ${isActive ? 'active-in-viewer' : ''}"
        style="--row-indent: ${indentPx}px"
        data-row-path=${node.path}
        @click=${(e) => this._onFileClick(e, node)}
        @auxclick=${(e) => this._onFileAuxClick(e, node)}
        @contextmenu=${(e) => this._onFileContextMenu(e, node)}
        role="treeitem"
        aria-current=${isFocused ? 'true' : 'false'}
        title=${tooltip}
      >
        <span class="indent"></span>
        <span class="twisty empty"></span>
        ${diff
          ? html`<span class="diff-stats diff-stats-pre" title="Lines changed">
              ${diff.added > 0
                ? html`<span class="added">+${diff.added}</span>`
                : ''}
              ${diff.removed > 0
                ? html`<span class="removed">-${diff.removed}</span>`
                : ''}
            </span>`
          : ''}
        <input
          type="checkbox"
          class="checkbox"
          .checked=${isSelected}
          @click=${(e) => this._onFileCheckbox(e, node)}
          aria-label="Select ${node.name}"
          title=${checkboxTitle}
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
        ${isExcluded
          ? html`<span
              class="excluded-badge"
              title="Excluded from index"
              aria-label="Excluded from index"
              >✕</span
            >`
          : ''}
        ${typeof node.lines === 'number' && node.lines > 0
          ? html`<span class="lines-badge">${node.lines}</span>`
          : ''}
      </div>
      ${this._duplicating === node.path
        ? this._renderInlineInput({
            mode: 'duplicate',
            sourcePath: node.path,
            sourceName: node.name,
            depth,
          })
        : ''}
    `;
  }

  /**
   * Render the inline text input row for rename,
   * duplicate, new-file, or new-directory. Same
   * indentation pattern as file rows so the input lines
   * up visually with the filename column. Pre-fill and
   * aria-label are mode-specific:
   *
   *   - rename: current filename (edit in place).
   *   - duplicate: source path (edit directory and/or
   *     filename for the target location).
   *   - new-file / new-directory: empty (user types the
   *     new name from scratch).
   *
   * Focus and selection happen in `updated()` after the
   * input lands in the DOM. For rename and duplicate we
   * select only the stem (everything before the last
   * `.`) so typing replaces the filename but leaves the
   * extension intact. For new-file and new-directory
   * the initial value is empty, so selection is a no-op
   * and the user starts at a blank input.
   *
   * For create modes, `sourcePath` is the PARENT directory
   * path (not a source file path); it's passed through
   * to the keydown / blur handlers so they can target
   * the right state field on commit or cancel.
   */
  _renderInlineInput({ mode, sourcePath, sourceName, depth }) {
    const indentPx = depth * 16;
    // Pre-fill by mode. Rename starts at the basename;
    // duplicate starts at the full path; create modes
    // start empty.
    let initial = '';
    if (mode === INLINE_MODE_RENAME) initial = sourceName;
    else if (mode === INLINE_MODE_DUPLICATE) initial = sourcePath;
    // Aria-label tuned for accessibility — screen readers
    // announce what the input is for.
    let ariaLabel;
    if (mode === INLINE_MODE_RENAME) {
      ariaLabel = `Rename ${sourceName}`;
    } else if (mode === INLINE_MODE_DUPLICATE) {
      ariaLabel = `Duplicate ${sourceName} — enter new path`;
    } else if (mode === INLINE_MODE_NEW_FILE) {
      ariaLabel = sourcePath
        ? `New file in ${sourcePath}`
        : 'New file at repository root';
    } else if (mode === INLINE_MODE_NEW_DIR) {
      ariaLabel = sourcePath
        ? `New directory in ${sourcePath}`
        : 'New directory at repository root';
    } else {
      ariaLabel = 'Inline input';
    }
    // Placeholder hint for empty inputs so the user sees
    // what's expected. Rename / duplicate have pre-filled
    // values so placeholder isn't shown; create modes
    // surface the hint.
    let placeholder = '';
    if (mode === INLINE_MODE_NEW_FILE) placeholder = 'filename.md';
    else if (mode === INLINE_MODE_NEW_DIR) placeholder = 'dirname';
    return html`
      <div
        class="row is-inline"
        style="--row-indent: ${indentPx}px"
        role="treeitem"
      >
        <span class="indent"></span>
        <span class="twisty empty"></span>
        <input
          type="text"
          class="inline-input"
          data-inline-mode=${mode}
          data-source-path=${sourcePath}
          placeholder=${placeholder}
          .value=${initial}
          @keydown=${(e) => this._onInlineKeyDown(e, mode, sourcePath)}
          @blur=${(e) => this._onInlineBlur(e, mode, sourcePath)}
          aria-label=${ariaLabel}
        />
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
   *
   * The backend (`Repo.get_file_tree`) emits per-file diff
   * stats under the keys `additions` and `deletions`
   * (matching `git diff --numstat`). The files-tab
   * orchestrator wraps that dict in a Map unchanged, so
   * we read those keys here. We also accept `added` /
   * `removed` as fallbacks — earlier drafts used the
   * shorter form and a future refactor of the orchestrator
   * might convert on its side rather than ours.
   */
  _diffStatsFor(path) {
    const map = this.statusData?.diffStats;
    if (!map || typeof map.get !== 'function' || !path) return null;
    const entry = map.get(path);
    if (!entry || typeof entry !== 'object') return null;
    const addedRaw =
      typeof entry.additions === 'number'
        ? entry.additions
        : typeof entry.added === 'number'
          ? entry.added
          : 0;
    const removedRaw =
      typeof entry.deletions === 'number'
        ? entry.deletions
        : typeof entry.removed === 'number'
          ? entry.removed
          : 0;
    if (addedRaw === 0 && removedRaw === 0) return null;
    return { added: addedRaw, removed: removedRaw };
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
   *
   * Excluded files get an extra "(excluded)" marker so
   * the state is visible on hover without needing to
   * squint at the row's strikethrough styling.
   */
  _tooltipFor(node, isExcluded = false) {
    if (!node || typeof node !== 'object') return '';
    const name = typeof node.name === 'string' ? node.name : '';
    const path = typeof node.path === 'string' ? node.path : '';
    if (!name && !path) return '';
    const base = !path || path === name ? name : `${path} — ${name}`;
    return isExcluded ? `${base} (excluded)` : base;
  }

  /**
   * Tooltip for directory rows. Same base format as
   * `_tooltipFor` but with distinct suffixes for the
   * three exclusion states — none (no suffix), some,
   * all. Users hovering a collapsed folder can see
   * the aggregate state without expanding it.
   */
  _tooltipForDir(node, { allExcluded = false, someExcluded = false } = {}) {
    const base = this._tooltipFor(node);
    if (!base) return '';
    if (allExcluded) {
      return `${base} — all files excluded from index, Shift+click to re-include all`;
    }
    if (someExcluded) {
      return `${base} — some files excluded from index`;
    }
    return base;
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

  /**
   * True when every file under `node` is excluded AND
   * there is at least one file (empty directories are
   * "not excluded" by definition — there's nothing there
   * to exclude).
   */
  _allDescendantsExcluded(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    return descendants.every((p) => this.excludedFiles.has(p));
  }

  /**
   * True when at least one but not all descendants are
   * excluded — the directory is in a partial-exclusion
   * state. Mirrors `_someDescendantsSelected` so the
   * all/some/none pattern is symmetric for both
   * selection and exclusion.
   */
  _someDescendantsExcluded(node) {
    const descendants = this._collectDescendantFiles(node);
    if (descendants.length === 0) return false;
    const excluded = descendants.filter((p) =>
      this.excludedFiles.has(p),
    );
    return excluded.length > 0 && excluded.length < descendants.length;
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
    // Shift+click on a directory toggles exclusion for
    // every descendant file. If ALL descendants are
    // currently excluded, un-exclude them all; otherwise
    // exclude them all (including those already excluded
    // — idempotent). Mirrors the file-level shift+click
    // semantics.
    if (event.shiftKey) {
      event.preventDefault();
      const allExcluded = descendants.every((p) =>
        this.excludedFiles.has(p),
      );
      const nextExcluded = new Set(this.excludedFiles);
      if (allExcluded) {
        for (const p of descendants) nextExcluded.delete(p);
      } else {
        for (const p of descendants) nextExcluded.add(p);
      }
      this._emitExclusionChanged(nextExcluded);
      // Excluding descendants also deselects any that
      // were previously selected — the states are
      // mutually exclusive. Un-excluding doesn't re-add
      // to selection (matches the file-level behaviour
      // where shift+click from excluded returns to
      // index-only, not to selected).
      if (!allExcluded) {
        const nextSelected = new Set(this.selectedFiles);
        let selectionChanged = false;
        for (const p of descendants) {
          if (nextSelected.has(p)) {
            nextSelected.delete(p);
            selectionChanged = true;
          }
        }
        if (selectionChanged) this._emitSelectionChanged(nextSelected);
      }
      return;
    }
    // Regular click. If any descendants are excluded,
    // un-exclude them as a side effect — a user ticking
    // a parent directory wants its children in context,
    // not hidden. Specs4: "Regular click to select
    // directory children — un-excludes any excluded
    // children."
    const anyExcluded = descendants.some((p) =>
      this.excludedFiles.has(p),
    );
    if (anyExcluded) {
      const nextExcluded = new Set(this.excludedFiles);
      for (const p of descendants) nextExcluded.delete(p);
      this._emitExclusionChanged(nextExcluded);
    }
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
    // the file in response. Excluded files still open in the
    // viewer on name click — the exclusion is about LLM
    // context, not about preventing the user from reading
    // the file in the editor.
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
    // The three-state checkbox dispatches depending on
    // modifier and current state:
    //
    //   shift+click from normal  → excluded
    //   shift+click from selected → excluded (and deselected)
    //   shift+click from excluded → normal (re-include)
    //   regular click from normal → selected
    //   regular click from selected → normal
    //   regular click from excluded → selected (un-exclude
    //     and tick)
    //
    // Shift+click always calls preventDefault on the native
    // checkbox event to suppress the browser's own toggle —
    // otherwise the checkbox flips visually, then our state
    // change flips it back, producing a one-frame glitch.
    // Regular click lets the native toggle fire because the
    // new state matches it (or else we override via the
    // reactive .checked binding on the next render).
    event.stopPropagation();
    if (event.shiftKey) {
      event.preventDefault();
      this._toggleExclusion(node.path);
      return;
    }
    // Regular click. If the file is currently excluded,
    // this un-excludes AND selects in one step — matches
    // the "un-excludes and selects" rule from specs4.
    // Otherwise, toggles between index-only and selected.
    if (this.excludedFiles.has(node.path)) {
      const nextExcluded = new Set(this.excludedFiles);
      nextExcluded.delete(node.path);
      const nextSelected = new Set(this.selectedFiles);
      nextSelected.add(node.path);
      this._emitExclusionChanged(nextExcluded);
      this._emitSelectionChanged(nextSelected);
      return;
    }
    const next = new Set(this.selectedFiles);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
    }
    this._emitSelectionChanged(next);
  }

  /**
   * Inline-input keydown handler for rename / duplicate.
   * Enter commits (dispatches the corresponding event to
   * the orchestrator), Escape cancels (clears picker
   * state without dispatch).
   *
   * Other keys flow through to the default textbox
   * behaviour — no interception.
   */
  _onInlineKeyDown(event, mode, sourcePath) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this._commitInlineInput(event.target, mode, sourcePath);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this._cancelInlineInput(mode);
    }
  }

  /**
   * Blur handler — treated as cancel. Users clicking
   * elsewhere expect the pending edit to disappear;
   * auto-committing on blur is surprising and hard to
   * undo. Enter is the explicit commit path.
   *
   * A complication: if the user presses Enter to commit,
   * the commit handler clears `_renaming` / `_duplicating`
   * which triggers a re-render, which removes the input
   * from the DOM, which fires a blur. We guard against
   * double-cancel by only clearing state when the
   * relevant field still matches the source path — after
   * a commit, it's already been cleared.
   */
  _onInlineBlur(event, mode, sourcePath) {
    this._cancelInlineInput(mode, sourcePath);
  }

  /**
   * Commit an inline input. Reads the target value,
   * dispatches the commit event if the value is non-empty
   * and changed, and clears picker state. The orchestrator
   * listens for these events and fires the corresponding
   * RPC.
   *
   * When the user commits with an unchanged value (e.g.
   * opened rename, pressed Enter immediately), the commit
   * is treated as a no-op — no event dispatched, state
   * cleared. Same for empty input.
   *
   * For create modes, `sourcePath` carries the parent
   * directory path. The dispatched event's detail shape
   * is `{parentPath, name}` rather than the rename /
   * duplicate form (`{sourcePath, targetName}`) because
   * the orchestrator needs to distinguish "operate on an
   * existing path" from "create a new entry under a
   * parent".
   */
  _commitInlineInput(inputEl, mode, sourcePath) {
    const raw = inputEl?.value || '';
    const target = raw.trim();
    // Clear state first so the blur firing after re-render
    // doesn't re-enter this path via _onInlineBlur's
    // guard. Dispatch on the correct field based on mode.
    if (mode === INLINE_MODE_RENAME) {
      this._renaming = null;
    } else if (mode === INLINE_MODE_DUPLICATE) {
      this._duplicating = null;
    } else if (
      mode === INLINE_MODE_NEW_FILE ||
      mode === INLINE_MODE_NEW_DIR
    ) {
      this._creating = null;
    }
    if (!target) return;
    // Rename no-op: target equals current name.
    if (mode === INLINE_MODE_RENAME) {
      const currentName = sourcePath.includes('/')
        ? sourcePath.slice(sourcePath.lastIndexOf('/') + 1)
        : sourcePath;
      if (target === currentName) return;
    }
    // Duplicate no-op: target equals source path.
    if (mode === INLINE_MODE_DUPLICATE && target === sourcePath) {
      return;
    }
    // Create modes: dispatch with {parentPath, name}.
    if (
      mode === INLINE_MODE_NEW_FILE ||
      mode === INLINE_MODE_NEW_DIR
    ) {
      const eventName =
        mode === INLINE_MODE_NEW_FILE
          ? 'new-file-committed'
          : 'new-directory-committed';
      this.dispatchEvent(
        new CustomEvent(eventName, {
          detail: { parentPath: sourcePath, name: target },
          bubbles: true,
          composed: true,
        }),
      );
      return;
    }
    // Rename / duplicate: dispatch with {sourcePath,
    // targetName}.
    const eventName =
      mode === INLINE_MODE_RENAME
        ? 'rename-committed'
        : 'duplicate-committed';
    this.dispatchEvent(
      new CustomEvent(eventName, {
        detail: { sourcePath, targetName: target },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Cancel an inline input. If sourcePath is given, only
   * cancel when the current state matches — this prevents
   * a blur firing after a successful commit from
   * triggering a second cancel on a different mode.
   *
   * For create modes, `sourcePath` is the parent-dir
   * path. The guard checks `_creating.parentPath` against
   * it to avoid double-cancel on the blur-after-commit
   * race (commit clears `_creating` before re-render,
   * blur fires, we arrive here with stale sourcePath).
   */
  _cancelInlineInput(mode, sourcePath) {
    if (mode === INLINE_MODE_RENAME) {
      if (sourcePath && this._renaming !== sourcePath) return;
      this._renaming = null;
    } else if (mode === INLINE_MODE_DUPLICATE) {
      if (sourcePath && this._duplicating !== sourcePath) return;
      this._duplicating = null;
    } else if (
      mode === INLINE_MODE_NEW_FILE ||
      mode === INLINE_MODE_NEW_DIR
    ) {
      if (
        sourcePath !== undefined &&
        (!this._creating || this._creating.parentPath !== sourcePath)
      ) {
        return;
      }
      this._creating = null;
    }
  }

  /**
   * Toggle a single file's exclusion state. Transitions
   * from excluded → normal OR from not-excluded → excluded.
   *
   * Excluding a selected file also deselects it — the two
   * states are mutually exclusive. A file can be in
   * exactly one of: selected, excluded, or neither
   * (the default index-only state).
   */
  _toggleExclusion(path) {
    const nextExcluded = new Set(this.excludedFiles);
    if (nextExcluded.has(path)) {
      nextExcluded.delete(path);
      this._emitExclusionChanged(nextExcluded);
      return;
    }
    nextExcluded.add(path);
    this._emitExclusionChanged(nextExcluded);
    // If the file was selected, also deselect — excluded
    // and selected can't coexist.
    if (this.selectedFiles.has(path)) {
      const nextSelected = new Set(this.selectedFiles);
      nextSelected.delete(path);
      this._emitSelectionChanged(nextSelected);
    }
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

  /**
   * Propagate the new excluded set to the orchestrator.
   * Parallel to `_emitSelectionChanged` — the files-tab
   * catches this, updates server-side state via
   * `LLMService.set_excluded_index_files`, and pushes
   * the canonical set back via the `excludedFiles`
   * property.
   */
  _emitExclusionChanged(newSet) {
    this.dispatchEvent(
      new CustomEvent('exclusion-changed', {
        detail: { excludedFiles: Array.from(newSet) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ---------------------------------------------------------------
  // Context menu (Increment 8a — shell, file rows only)
  // ---------------------------------------------------------------

  /**
   * Open the file-row context menu at the click coordinates.
   * Native `contextmenu` browser handler is suppressed so
   * users never see two menus stacked.
   *
   * Position stored as viewport coordinates (clientX/Y
   * from the MouseEvent). Viewport-edge clamping happens
   * at render time via `_clampMenuPosition` rather than
   * here, so a window resize while the menu is open would
   * self-correct on next render — though in practice the
   * outside-click dismiss covers that case too.
   */
  _onFileContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();
    // Close any stale menu first so the document
    // listener attach/detach stays balanced.
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    this._contextMenu = {
      type: 'file',
      path: node.path,
      name: node.name,
      isExcluded: this.excludedFiles.has(node.path),
      x: event.clientX,
      y: event.clientY,
    };
    // Attach document listeners for outside-click and
    // Escape dismissal. Only active while a menu is
    // open — keeps the idle cost zero.
    document.addEventListener('click', this._onDocumentClickForMenu, true);
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  /**
   * Handle middle-click on a file row. Dispatches
   * `insert-path` with `{path}` so the orchestrator
   * can insert the path into the chat textarea.
   * Called via `@auxclick` which fires for non-primary
   * button clicks in modern browsers (middle click is
   * `button === 1`).
   *
   * `preventDefault()` is important — middle-click
   * typically triggers the browser's selection-buffer
   * paste (Linux) or autoscroll (Windows/macOS).
   * Neither belongs here.
   */
  _onFileAuxClick(event, node) {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path: node.path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Middle-click on a directory row. Same contract as
   * file rows — useful for inserting a subtree
   * reference into the chat (e.g., "look at
   * src/utils/").
   */
  _onDirAuxClick(event, node) {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('insert-path', {
        detail: { path: node.path },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Open the directory-row context menu at the click
   * coordinates. Parallel to `_onFileContextMenu` but
   * with dir-specific context fields — `allExcluded`
   * and `someExcluded` gate the exclude-all /
   * include-all items' visibility.
   *
   * Empty directories (no descendant files) produce
   * `allExcluded=false` and `someExcluded=false` so
   * only the Exclude-all item shows. Dispatching it
   * with no descendants is a no-op in the files-tab
   * handler — defensive but not user-reachable in
   * practice since empty directories are rare.
   */
  _onDirContextMenu(event, node) {
    event.preventDefault();
    event.stopPropagation();
    if (this._contextMenu !== null) {
      this._closeContextMenu();
    }
    const descendants = this._collectDescendantFiles(node);
    const excludedCount = descendants.filter((p) =>
      this.excludedFiles.has(p),
    ).length;
    this._contextMenu = {
      type: 'dir',
      path: node.path,
      name: node.name,
      allExcluded:
        descendants.length > 0 && excludedCount === descendants.length,
      someExcluded: excludedCount > 0,
      x: event.clientX,
      y: event.clientY,
    };
    document.addEventListener(
      'click',
      this._onDocumentClickForMenu,
      true,
    );
    document.addEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  /**
   * Close the menu and release document listeners. Safe
   * to call when no menu is open (idempotent). Called
   * from every action dispatch path, from outside-click,
   * from Escape-key, and from `disconnectedCallback`.
   */
  _closeContextMenu() {
    if (this._contextMenu === null) return;
    this._contextMenu = null;
    document.removeEventListener(
      'click',
      this._onDocumentClickForMenu,
      true,
    );
    document.removeEventListener(
      'keydown',
      this._onDocumentKeyDownForMenu,
      true,
    );
  }

  /**
   * Document-level click handler. Fires in capture phase
   * so we see the click before any downstream handler
   * that might call stopPropagation. Walks `composedPath`
   * to see whether the click landed inside the menu — if
   * so, let the menu's own click handlers run. Otherwise
   * close.
   *
   * Capture-phase + composedPath is needed because the
   * menu lives in our shadow DOM; a bubbling-phase
   * document listener sees the shadow host as the event
   * target, not the menu contents.
   */
  _onDocumentClickForMenu(event) {
    if (this._contextMenu === null) return;
    const path = event.composedPath
      ? event.composedPath()
      : [event.target];
    const insideMenu = path.some(
      (el) =>
        el &&
        el.classList &&
        el.classList.contains('context-menu'),
    );
    if (!insideMenu) {
      this._closeContextMenu();
    }
  }

  /**
   * Document-level keydown handler — Escape dismisses.
   * Capture phase so we beat any other Escape handler
   * that might be up the tree (app shell's overlay
   * dismiss, modal close, etc.). We only consume the
   * event when a menu is actually open.
   */
  _onDocumentKeyDownForMenu(event) {
    if (this._contextMenu === null) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this._closeContextMenu();
    }
  }

  /**
   * Render the context menu when state is non-null.
   * Returns empty string otherwise so the menu simply
   * doesn't appear in the DOM.
   *
   * Position clamped inside the viewport margins —
   * menus opened near a screen edge slide inward to
   * stay fully visible.
   */
  _renderContextMenu() {
    if (this._contextMenu === null) return '';
    const ctx = this._contextMenu;
    const { x, y } = this._clampMenuPosition(ctx);
    return html`
      <div
        class="context-menu"
        style="left: ${x}px; top: ${y}px"
        role="menu"
        aria-label="File actions"
      >
        ${this._renderMenuItems(ctx)}
      </div>
    `;
  }

  _renderMenuItems(ctx) {
    const catalog =
      ctx.type === 'root'
        ? _CONTEXT_MENU_ROOT_ITEMS
        : ctx.type === 'dir'
          ? _CONTEXT_MENU_DIR_ITEMS
          : _CONTEXT_MENU_FILE_ITEMS;
    const items = [];
    for (const entry of catalog) {
      if (entry === null) {
        items.push(html`<div class="menu-separator"></div>`);
        continue;
      }
      if (typeof entry.showWhen === 'function' && !entry.showWhen(ctx)) {
        continue;
      }
      const classes = ['menu-item'];
      if (entry.destructive) classes.push('destructive');
      items.push(html`
        <div
          class=${classes.join(' ')}
          role="menuitem"
          data-action=${entry.action}
          @click=${(e) => this._onContextMenuAction(e, entry.action)}
        >
          <span class="icon">${entry.icon}</span>
          <span class="label">${entry.label}</span>
        </div>
      `);
    }
    return items;
  }

  /**
   * Clamp a click-coord position so the rendered menu
   * stays inside the viewport. We can't know the menu's
   * rendered size before it's drawn, so we use a generous
   * conservative estimate (240×320) that covers the
   * worst case (all file-menu items visible). If the
   * estimate undershoots, the menu still renders —
   * just potentially with part of a border off-screen,
   * which is a graceful failure mode.
   */
  _clampMenuPosition({ x, y }) {
    const margin = _CONTEXT_MENU_VIEWPORT_MARGIN;
    const estimatedWidth = 240;
    const estimatedHeight = 320;
    const maxX = window.innerWidth - estimatedWidth - margin;
    const maxY = window.innerHeight - estimatedHeight - margin;
    return {
      x: Math.max(margin, Math.min(x, maxX)),
      y: Math.max(margin, Math.min(y, maxY)),
    };
  }

  /**
   * Handle a menu item click. Dispatches a
   * `context-menu-action` event carrying the action ID
   * and the target context (path, name, etc.) so the
   * files-tab orchestrator can route to the appropriate
   * RPC. Always closes the menu after dispatch — even
   * for actions that open a follow-up prompt (rename),
   * since the prompt is handled at the orchestrator
   * layer and has its own lifecycle.
   *
   * 8a scope: every action dispatches the event. The
   * orchestrator-side handlers for stage / unstage /
   * discard / rename / etc. land in 8b–8d.
   */
  _onContextMenuAction(event, action) {
    event.preventDefault();
    event.stopPropagation();
    const ctx = this._contextMenu;
    if (ctx === null) return;
    this.dispatchEvent(
      new CustomEvent('context-menu-action', {
        detail: {
          action,
          type: ctx.type,
          path: ctx.path,
          name: ctx.name,
          isExcluded: ctx.isExcluded,
        },
        bubbles: true,
        composed: true,
      }),
    );
    this._closeContextMenu();
  }

  // ---------------------------------------------------------------
  // Keyboard navigation (Increment 7)
  // ---------------------------------------------------------------

  /**
   * Handle keydown events on the tree container. Only
   * responds when focus is inside the tree (the filter
   * input and sort buttons are siblings, so their key
   * events never reach here thanks to the scoped listener).
   *
   * Uses `_focusedPath` as the shared focus state — the
   * same state file-search uses to highlight its current
   * match. Merging them keeps exactly one highlighted
   * row at all times: if the user kbd-navigates during
   * file-search, their arrow keys implicitly drive the
   * focus forward.
   *
   * All actions are scoped to the currently-visible row
   * set (the tree after filter + effective expansion).
   * Collapsed directories hide their children; the
   * navigation order matches what the user sees.
   */
  _onTreeKeyDown(event) {
    const rows = this._collectVisibleRows();
    if (rows.length === 0) return;
    // Establish a focused row. First-ever key press with
    // no focus lands on the first row. Subsequent presses
    // use the stored _focusedPath unless it's no longer
    // visible (filter changed, dir collapsed) — in which
    // case we treat it as "no focus" and start at the
    // first row.
    let currentIdx = rows.findIndex(
      (n) => n.path === this._focusedPath,
    );
    if (currentIdx < 0) currentIdx = -1;
    const current = currentIdx >= 0 ? rows[currentIdx] : null;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const nextIdx =
          currentIdx < 0
            ? 0
            : Math.min(currentIdx + 1, rows.length - 1);
        this._setFocusedAndScroll(rows[nextIdx].path);
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prevIdx =
          currentIdx < 0
            ? 0
            : Math.max(currentIdx - 1, 0);
        this._setFocusedAndScroll(rows[prevIdx].path);
        return;
      }
      case 'ArrowRight': {
        if (!current) return;
        event.preventDefault();
        if (current.type === 'dir') {
          const expanded = this._effectiveExpanded();
          if (!expanded.has(current.path)) {
            // Closed dir → expand.
            this._toggleExpanded(current.path);
          } else {
            // Open dir → move to first child. Use the
            // fresh row list after expansion; for already-
            // open dirs, the next row in `rows` IS the
            // first child (rows is a flat traversal).
            const nextIdx = currentIdx + 1;
            if (nextIdx < rows.length) {
              this._setFocusedAndScroll(rows[nextIdx].path);
            }
          }
        }
        // Files: no-op. Nothing sensible to do for Right
        // on a file (it has no children). The spec's
        // wording "no-op" is honoured by the absence of
        // any action here.
        return;
      }
      case 'ArrowLeft': {
        if (!current) return;
        event.preventDefault();
        const expanded = this._effectiveExpanded();
        if (current.type === 'dir' && expanded.has(current.path)) {
          // Open dir → collapse.
          this._toggleExpanded(current.path);
          return;
        }
        // Otherwise move focus to parent dir. A path's
        // parent is derived by dropping the last segment;
        // if there's no parent (root-level node), no-op.
        const parentPath = this._parentPathOf(current.path);
        if (parentPath === null) return;
        // The parent may not be in the visible row set if
        // it's the synthetic root (empty path). Skip to
        // the first visible ancestor instead.
        const parentRow = rows.find((n) => n.path === parentPath);
        if (parentRow) {
          this._setFocusedAndScroll(parentPath);
        }
        return;
      }
      case 'Enter':
      case ' ': {
        // Space is the document scroll key by default;
        // preventDefault stops the page from jumping.
        if (!current) return;
        event.preventDefault();
        if (current.type === 'dir') {
          this._toggleExpanded(current.path);
        } else {
          // File: toggle selection via the same path
          // the checkbox click uses. We don't route
          // through the event target because the
          // checkbox isn't the active element.
          const next = new Set(this.selectedFiles);
          if (next.has(current.path)) {
            next.delete(current.path);
          } else {
            next.add(current.path);
          }
          this._emitSelectionChanged(next);
        }
        return;
      }
      case 'Home': {
        event.preventDefault();
        this._setFocusedAndScroll(rows[0].path);
        return;
      }
      case 'End': {
        event.preventDefault();
        this._setFocusedAndScroll(rows[rows.length - 1].path);
        return;
      }
      default:
        return;
    }
  }

  /**
   * Flatten the visible portion of the tree into an
   * ordered list of nodes. Walks the filtered tree in
   * render order; only descends into directories that
   * are effectively expanded (user-expanded OR filter-
   * expanded via `_effectiveExpanded`). The synthetic
   * root node is NOT included — the root row is non-
   * interactive.
   *
   * Result order matches the visual row order in the
   * rendered picker, so arrow-key movement stays in
   * sync with what the user sees.
   */
  _collectVisibleRows() {
    const tree = filterTree(this.tree, this.filterQuery);
    const expanded = this._effectiveExpanded();
    const out = [];
    const walk = (node) => {
      const children = sortChildrenWithMode(
        node.children,
        this._sortMode,
        this._sortAsc,
      );
      for (const child of children) {
        out.push(child);
        if (child.type === 'dir' && expanded.has(child.path)) {
          walk(child);
        }
      }
    };
    if (tree) walk(tree);
    return out;
  }

  /**
   * Return the parent directory path for a given path,
   * or null when the path is at the repo root (no
   * parent within the tree).
   */
  _parentPathOf(path) {
    if (typeof path !== 'string' || !path) return null;
    const idx = path.lastIndexOf('/');
    if (idx < 0) return null;
    return path.slice(0, idx);
  }

  /**
   * Update `_focusedPath` and scroll the matching row
   * into view with minimal motion. Called from every
   * arrow-key / Home / End handler. Falls back to a
   * deferred scroll when the DOM hasn't committed the
   * latest render yet (focused path changed in the
   * same tick as e.g. an expand toggle).
   */
  _setFocusedAndScroll(path) {
    this._focusedPath = path;
    // Defer scroll until after Lit commits the update,
    // so the row's final position reflects any layout
    // changes from the same keystroke (e.g., expanding
    // a dir that pushes later rows downward).
    this.updateComplete.then(() => {
      const row = this._findRowElementForPath(path);
      if (row && typeof row.scrollIntoView === 'function') {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  /**
   * Find the DOM row element matching a given path.
   * Uses a data attribute on each rendered row so the
   * lookup is O(1) rather than scanning all rows.
   */
  _findRowElementForPath(path) {
    if (!this.shadowRoot) return null;
    return this.shadowRoot.querySelector(
      `[data-row-path="${this._cssEscape(path)}"]`,
    );
  }

  /**
   * CSS attribute-selector escaping — same subset the
   * chat panel uses. Escapes characters that would
   * otherwise terminate the selector or be treated as
   * combinators. Backticks, forward slashes, dots, and
   * hyphens all need escaping in attribute values.
   */
  _cssEscape(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    // jsdom tests don't expose CSS.escape; fall back to
    // a best-effort regex replacement that covers the
    // characters real-world paths contain.
    return String(value).replace(
      /[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g,
      '\\$&',
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
  CTX_ACTION_STAGE,
  CTX_ACTION_UNSTAGE,
  CTX_ACTION_DISCARD,
  CTX_ACTION_RENAME,
  CTX_ACTION_DUPLICATE,
  CTX_ACTION_LOAD_LEFT,
  CTX_ACTION_LOAD_RIGHT,
  CTX_ACTION_EXCLUDE,
  CTX_ACTION_INCLUDE,
  CTX_ACTION_DELETE,
  CTX_ACTION_STAGE_ALL,
  CTX_ACTION_UNSTAGE_ALL,
  CTX_ACTION_RENAME_DIR,
  CTX_ACTION_NEW_FILE,
  CTX_ACTION_NEW_DIR,
  CTX_ACTION_EXCLUDE_ALL,
  CTX_ACTION_INCLUDE_ALL,
};