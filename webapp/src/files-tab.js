// FilesTab — orchestration hub for the file picker + chat panel.
//
// Layer 5 Phase 2c — wires picker and chat together, holds the
// authoritative selected-files state, drives file-tree loading
// from the Repo RPC, and routes events between the two child
// components and the AppShell.
//
// Responsibilities:
//
//   1. Load the repository file tree from `Repo.get_file_tree`
//      on RPC-ready and on `files-modified` events. The tree
//      is handed to the picker via direct property assignment
//      (not template propagation — specs4/5-webapp/file-picker.md
//      is explicit about why).
//   2. Hold `selectedFiles` as a Set. Listen for the picker's
//      `selection-changed` event, update the server via
//      `LLMService.set_selected_files`, update the picker's
//      `selectedFiles` prop directly.
//   3. Listen for `files-changed` (server broadcast) so
//      selection changes from the server (auto-add for
//      not-in-context edits, collab broadcasts) update the
//      picker without round-tripping through user action.
//   4. Route `file-clicked` from the picker to a `navigate-file`
//      window event. Phase 3 wires a viewer to consume it; for
//      now it's a no-op at the consumer side.
//
// Deferred to Phase 2d (explicit boundaries):
//
//   - @-filter bridge — picker's `setFilter` call is public,
//     but the chat panel needs an input handler that detects
//     `@foo` in the textarea and dispatches a filter event
//   - Middle-click path insertion — picker emits `insert-path`
//     on middle-click (2a); chat panel needs a paste-suppression
//     handler to consume it
//   - Context menu on picker rows
//   - Git status badges (M/S/U/D) — picker rendering update
//   - Branch badge at the root node
//
// Deferred to Phase 3:
//
//   - Active-file highlight in the picker (needs viewer's
//     `active-file-changed` event)
//   - File navigation grid integration
//
// ---------------------------------------------------------------
//
// Architectural contract — DIRECT-UPDATE PATTERN (load-bearing):
//
// When selection changes, this component updates both the
// picker's `selectedFiles` and the chat panel's `selectedFiles`
// **directly** (by assignment + requestUpdate()), NOT by
// relying on Lit's reactive property propagation through its
// own re-render.
//
// Why it matters: changing a property on a parent LitElement
// triggers a full re-render of its template, which reassigns
// child component properties. For the chat panel, that would
// reset scroll position and disrupt in-flight streaming. For
// the picker, it would collapse interaction state (context
// menus, inline inputs, focus). Specs4 documents this in
// file-picker.md#direct-update-pattern-architectural.
//
// The pattern, used for every selection-changing operation:
//   1. Update our own `_selectedFiles` Set (source of truth)
//   2. Assign `picker.selectedFiles = new Set(...)` + requestUpdate
//   3. Assign `chatPanel.selectedFiles = [...]` + requestUpdate
//   4. Notify server via RPC
//
// The chat panel in Phase 2b doesn't yet consume
// `selectedFiles` (it will in 2d for file mentions), but we
// preserve the assignment so 2d just works without a refactor.

import { LitElement, css, html } from 'lit';

import { RpcMixin } from './rpc-mixin.js';
import './file-picker.js';
import './chat-panel.js';

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
function flattenTreePaths(node) {
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
function buildPrunedTree(results) {
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

/**
 * Default tree stub used before the first RPC load. Lets the
 * picker render empty rather than showing a spinner while the
 * tree is en route — the picker's empty-state placeholder
 * handles the "no files yet" case gracefully.
 */
const EMPTY_TREE = {
  name: '',
  path: '',
  type: 'dir',
  lines: 0,
  children: [],
};

export class FilesTab extends RpcMixin(LitElement) {
  static properties = {
    /**
     * Left-panel width as a ratio (0 = all picker, 1 = all
     * chat). Defaulted so each pane has a reasonable share of
     * the tab. Persistent drag-resize lands in Phase 3.
     */
    _pickerWidthPx: { type: Number, state: true },
    /**
     * Reflects the last-seen tree so the picker's initial
     * render has something to work with. We use a reactive
     * property here (not just an internal field) so we can
     * reflect load status in the template for tests.
     */
    _treeLoaded: { type: Boolean, state: true },
  };

  static styles = css`
    :host {
      display: flex;
      flex-direction: row;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }

    .picker-pane {
      flex-shrink: 0;
      min-width: 180px;
      max-width: 50%;
      border-right: 1px solid rgba(240, 246, 252, 0.1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .chat-pane {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    ac-file-picker {
      flex: 1;
      min-height: 0;
    }

    ac-chat-panel {
      flex: 1;
      min-height: 0;
    }
  `;

  constructor() {
    super();
    // Authoritative selection state. Held as a Set for O(1)
    // membership checks; the picker consumes a Set prop
    // directly.
    this._selectedFiles = new Set();
    // Authoritative exclusion state — the third position in
    // the picker's three-state checkbox model. Parallel to
    // `_selectedFiles`: orchestrator owns the Set, picker
    // receives a copy via direct-update pattern, server is
    // notified via `LLMService.set_excluded_index_files` on
    // every change.
    this._excludedFiles = new Set();
    // Path of the file currently active in a viewer, or
    // null. Updated from viewer `active-file-changed`
    // events (they bubble + compose out to the window),
    // pushed to the picker via direct-update so the
    // matching row gets the `.active-in-viewer` highlight.
    this._activePath = null;
    // Default picker width. Phase 3 wires a draggable handle
    // and localStorage persistence.
    this._pickerWidthPx = 280;
    this._treeLoaded = false;
    // True once `_pushChildProps` has successfully reached
    // both children. Guards the `updated()` retry path
    // against re-pushing on every subsequent Lit update.
    // Reset never happens — once pushed, future tree loads
    // just update `_latestTree` / `_repoFiles` and push
    // again via the same helper.
    this._childPropsPushed = false;
    // Latest loaded file tree. Kept as a non-reactive field
    // so the template's `.tree=${this._latestTree}` bind
    // carries the most recent value across re-renders rather
    // than clobbering back to EMPTY_TREE.
    this._latestTree = EMPTY_TREE;
    // Latest status data from the file tree RPC. Shape:
    // `{modified: Set<string>, staged: Set<string>,
    //   untracked: Set<string>, deleted: Set<string>,
    //   diffStats: Map<string, {added: number, removed: number}>}`.
    // Pushed to the picker via direct property assignment
    // so it can render M/S/U/D badges and `+N -N` diff
    // stats next to file rows. Sets / Maps for O(1) lookup
    // during render (the picker iterates over many files).
    this._latestStatusData = {
      modified: new Set(),
      staged: new Set(),
      untracked: new Set(),
      deleted: new Set(),
      diffStats: new Map(),
    };
    // Latest branch info from `Repo.get_current_branch`.
    // Shape: `{branch: string|null, detached: bool,
    //         sha: string|null, repoName: string}`.
    // Pushed to the picker so the root row can render a
    // branch pill. Empty / unfetched state — picker's
    // render degrades gracefully when `branch` is null.
    this._latestBranchInfo = {
      branch: null,
      detached: false,
      sha: null,
      repoName: '',
    };
    // Flat list of repo-relative file paths — derived from
    // the loaded tree and pushed to the chat panel so it can
    // detect file mentions in assistant output. Non-reactive
    // because we push directly to the chat panel via property
    // assignment (same pattern as `_selectedFiles`) rather
    // than through Lit's template propagation, which would
    // trigger full re-renders and reset scroll / streaming
    // state in the chat panel.
    this._repoFiles = [];
    // File search state — tracks whether the chat panel is
    // currently in file-search mode. When active, picker
    // file-clicked events route to the chat panel's
    // scrollFileSearchToFile rather than opening the file
    // in the viewer. Non-reactive; read inside event
    // handlers only.
    this._fileSearchActive = false;
    // First-load auto-selection flag. The files-tab auto-
    // selects every file with pending changes (modified,
    // staged, untracked, deleted) on the FIRST successful
    // tree load so the user doesn't have to re-tick what
    // they were clearly just working on. Unions with any
    // existing selection (server may have echoed a prior
    // session's state during startup). Flag flips to false
    // after the first load runs and never resets —
    // subsequent reloads (files-modified after commit,
    // explicit refresh) do not re-trigger auto-select.
    this._initialAutoSelect = true;

    // Bound event handlers — same binding used for add and
    // remove so cleanup matches.
    this._onFilesChanged = this._onFilesChanged.bind(this);
    this._onFilesModified = this._onFilesModified.bind(this);
    this._onFileMentionClick = this._onFileMentionClick.bind(this);
    this._onActiveFileChanged =
      this._onActiveFileChanged.bind(this);
    // Context-menu action handler — bubbles up from the
    // picker via `bubbles: true, composed: true`. 8b
    // wires stage / unstage / discard / delete; 8c
    // wires rename / duplicate; later sub-commits wire
    // include / exclude / load-in-panel.
    this._onContextMenuAction = this._onContextMenuAction.bind(this);
    // Rename and duplicate commit handlers — fire when
    // the picker's inline input is confirmed with
    // Enter. Bind so the `@rename-committed` /
    // `@duplicate-committed` template bindings see a
    // stable reference.
    this._onRenameCommitted = this._onRenameCommitted.bind(this);
    this._onDuplicateCommitted =
      this._onDuplicateCommitted.bind(this);
    // Middle-click path insertion. Picker dispatches
    // `insert-path` with `{path}` on middle-click of
    // any row; we insert the path into the chat
    // panel's textarea at the current cursor.
    this._onInsertPath = this._onInsertPath.bind(this);
    // New-file and new-directory commit handlers —
    // fired when the picker's inline input is
    // confirmed with Enter. Same bind pattern as
    // rename / duplicate.
    this._onNewFileCommitted = this._onNewFileCommitted.bind(this);
    this._onNewDirectoryCommitted =
      this._onNewDirectoryCommitted.bind(this);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('files-changed', this._onFilesChanged);
    window.addEventListener('files-modified', this._onFilesModified);
    // Viewer-dispatched `active-file-changed` bubbles and
    // composes out to the window naturally — the event
    // fires from inside the viewer's shadow root, passes
    // through the app-shell's own handler (which flips
    // _activeViewer), then continues bubbling to the
    // window because the shell doesn't call
    // stopPropagation. We listen here so the picker
    // highlight updates without the shell needing to
    // explicitly re-dispatch.
    window.addEventListener(
      'active-file-changed',
      this._onActiveFileChanged,
    );
  }

  disconnectedCallback() {
    window.removeEventListener('files-changed', this._onFilesChanged);
    window.removeEventListener(
      'files-modified',
      this._onFilesModified,
    );
    window.removeEventListener(
      'active-file-changed',
      this._onActiveFileChanged,
    );
    super.disconnectedCallback();
  }

  onRpcReady() {
    // Fetch the initial file tree. RpcMixin's microtask
    // deferral means every sibling component has already
    // received the proxy by the time this fires.
    this._loadFileTree();
  }

  // ---------------------------------------------------------------
  // File tree loading
  // ---------------------------------------------------------------

  async _loadFileTree() {
    // Two RPCs in parallel — tree and branch info. Both
    // live on Repo. A branch-info failure doesn't block
    // the tree from rendering (the picker degrades to no
    // branch pill); a tree failure is fatal for this load
    // because nothing useful is left to display.
    let tree;
    let branchResult;
    try {
      const [treeValue, branchValue] = await Promise.allSettled([
        this.rpcExtract('Repo.get_file_tree'),
        this.rpcExtract('Repo.get_current_branch'),
      ]);
      if (treeValue.status === 'rejected') throw treeValue.reason;
      tree = treeValue.value;
      branchResult =
        branchValue.status === 'fulfilled' ? branchValue.value : null;
      if (branchValue.status === 'rejected') {
        // Log but don't toast — a missing branch pill is
        // a minor regression compared to a broken tree.
        console.warn(
          '[files-tab] get_current_branch failed',
          branchValue.reason,
        );
      }
    } catch (err) {
      console.error('[files-tab] get_file_tree failed', err);
      this._showToast(
        `Failed to load file tree: ${err?.message || err}`,
        'error',
      );
      return;
    }
    // The repo returns the full shape documented in
    // src/ac_dc/repo.py — `tree` is the nested node plus
    // sibling arrays (modified, staged, etc.). Phase 2c uses
    // only the `tree` field; Phase 2d will consume the status
    // arrays for git badges.
    //
    // Direct-update pattern (see class docstring) — we write
    // `picker.tree` directly and flip `_treeLoaded` AFTER, so
    // our own re-render can't clobber the assignment. The
    // template below binds `.tree` via a getter that reads
    // from `_latestTree`, which we update here.
    this._latestTree = tree?.tree || EMPTY_TREE;
    // Build status data from the RPC's sibling arrays.
    // Repo.get_file_tree returns `modified`, `staged`,
    // `untracked`, `deleted` as path-string arrays and
    // `diff_stats` as `{path: {added, removed}}`. We
    // convert to Sets / Map here so the picker's per-row
    // render stays O(1) per lookup rather than O(N) scans.
    // Defensive — any missing / malformed field falls back
    // to an empty collection so a partial response doesn't
    // crash the picker.
    this._latestStatusData = {
      modified: new Set(
        Array.isArray(tree?.modified) ? tree.modified : [],
      ),
      staged: new Set(
        Array.isArray(tree?.staged) ? tree.staged : [],
      ),
      untracked: new Set(
        Array.isArray(tree?.untracked) ? tree.untracked : [],
      ),
      deleted: new Set(
        Array.isArray(tree?.deleted) ? tree.deleted : [],
      ),
      diffStats: new Map(
        tree?.diff_stats && typeof tree.diff_stats === 'object'
          ? Object.entries(tree.diff_stats)
          : [],
      ),
    };
    // Build branch info from the second RPC. Defensive —
    // a null `branchResult` (RPC rejected or returned
    // nothing) degrades to the "no branch pill" state.
    // The tree's root node carries the repo name as
    // `name`, so we thread that through for the root
    // row's tooltip even when branch info isn't
    // available.
    const repoName =
      typeof this._latestTree?.name === 'string'
        ? this._latestTree.name
        : '';
    this._latestBranchInfo = {
      branch:
        typeof branchResult?.branch === 'string'
          ? branchResult.branch
          : null,
      detached: branchResult?.detached === true,
      sha:
        typeof branchResult?.sha === 'string'
          ? branchResult.sha
          : null,
      repoName,
    };
    // Derive the flat file list and push to the chat panel
    // so file mentions in assistant output get wrapped. The
    // chat panel's `repoFiles` prop short-circuits on empty
    // input, so before the first load the cost is zero.
    this._repoFiles = flattenTreePaths(this._latestTree);
    // First-load auto-select — picks up every file with
    // pending changes so the user doesn't have to re-tick
    // what they were just working on. Runs exactly once
    // per component lifetime; subsequent reloads do
    // nothing here. The flag flip happens synchronously
    // so a re-entrant reload during the RPC that got us
    // here can't trigger double-auto-select.
    if (this._initialAutoSelect) {
      this._initialAutoSelect = false;
      this._applyInitialAutoSelect();
    }
    // Reset the push flag — a fresh tree load means the
    // children need fresh props, even if a previous load
    // already pushed once. `updated()` will retry if the
    // call below is too early in the lifecycle.
    this._childPropsPushed = false;
    this._pushChildProps();
    this._treeLoaded = true;
  }

  /**
   * Apply the first-load auto-selection rule: union every
   * changed file (modified ∪ staged ∪ untracked ∪ deleted)
   * with the existing selection, then expand the ancestor
   * directories of every selected file so the user can
   * see them in the tree.
   *
   * Union semantics (not replace) preserve any selection
   * the server broadcast during startup — e.g., a prior
   * session's state restored by `_restore_last_session`
   * on the backend, or a collab host's selection received
   * via `files-changed` before our first tree load.
   *
   * Called exactly once per component lifetime, by
   * `_loadFileTree` after status data is built. The
   * subsequent `_pushChildProps` call picks up the
   * mutations and pushes them to the picker in a single
   * render cycle.
   */
  _applyInitialAutoSelect() {
    const changed = new Set();
    const sd = this._latestStatusData;
    if (sd) {
      if (sd.modified instanceof Set) {
        for (const p of sd.modified) changed.add(p);
      }
      if (sd.staged instanceof Set) {
        for (const p of sd.staged) changed.add(p);
      }
      if (sd.untracked instanceof Set) {
        for (const p of sd.untracked) changed.add(p);
      }
      if (sd.deleted instanceof Set) {
        for (const p of sd.deleted) changed.add(p);
      }
    }
    if (changed.size === 0) {
      // Nothing changed — no selection to union, no
      // ancestors to expand. Skip entirely so the
      // `_applySelection` short-circuit path isn't
      // involved in the common "clean working tree"
      // case.
      return;
    }
    // Union with existing selection. If the union is
    // strictly a superset of what we already have,
    // _applySelection sends the new selection to the
    // server; if it's equal (every changed file was
    // already selected), the set-equality short-circuit
    // inside _applySelection makes this a no-op.
    const union = new Set(this._selectedFiles);
    for (const p of changed) union.add(p);
    this._applySelection(union, /* notifyServer */ true);
    // Expand ancestor directories of every selected
    // file so they're visible in the tree. The picker
    // doesn't auto-expand on selection normally —
    // selection state is independent of expansion — so
    // we have to do it here.
    this._expandAncestorsOf(union);
  }

  /**
   * Mark every ancestor directory of every path in
   * `paths` as expanded in the picker. Mutates the
   * picker's `_expanded` Set directly (same pattern as
   * the file-search scroll handler). Called from
   * `_applyInitialAutoSelect`; safe to call before the
   * first `_pushChildProps` because it updates an
   * internal-state Set that the picker consults on its
   * next render.
   */
  _expandAncestorsOf(paths) {
    const picker = this._picker();
    if (!picker) {
      // Picker not mounted yet — defer. The first
      // `_pushChildProps` retry through `updated()`
      // will bring the picker into view, but the
      // expansion state won't be re-derived there.
      // Fall through to directly mutating the set we
      // track pre-mount. The picker's default
      // `_expanded` starts empty; we can't reach
      // into it until it mounts, so in the rare
      // mount-order case (picker not yet visible
      // when auto-select runs) we just skip the
      // expansion — the user can still reach the
      // auto-selected files manually.
      return;
    }
    const next = new Set(picker._expanded);
    for (const path of paths) {
      if (typeof path !== 'string' || !path) continue;
      const parts = path.split('/');
      let acc = '';
      // Stop before the last part — that's the file
      // itself, not a directory to expand.
      for (let i = 0; i < parts.length - 1; i += 1) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        next.add(acc);
      }
    }
    picker._expanded = next;
  }

  /**
   * Push `tree` and `repoFiles` to child components.
   *
   * Called both from `_loadFileTree` (first-time populate)
   * and from `updated` after the initial render (retry path
   * for the race where RPC-ready fires before the template
   * has committed and `this._chat()` returns null). The
   * retry is guarded by `_childPropsPushed` so a successful
   * push isn't redone on every subsequent update.
   *
   * Returns true when both children were reachable and
   * received their props — the caller uses this to mark
   * the push complete.
   */
  _pushChildProps() {
    const picker = this._picker();
    const chat = this._chat();
    if (!picker || !chat) {
      // One or both children not mounted yet. `updated()`
      // will retry after the first render commits.
      return false;
    }
    picker.tree = this._latestTree;
    picker.statusData = this._latestStatusData;
    picker.branchInfo = this._latestBranchInfo;
    picker.excludedFiles = new Set(this._excludedFiles);
    picker.activePath = this._activePath;
    picker.requestUpdate();
    chat.repoFiles = this._repoFiles;
    chat.requestUpdate();
    this._childPropsPushed = true;
    return true;
  }

  /**
   * Retry the child-props push after the first render.
   *
   * The RPC-ready microtask hook can fire before Lit's
   * first `updateComplete` resolves, meaning
   * `this._chat()` inside `_loadFileTree` returns null
   * and the assignments are silently lost. The Phase 2c
   * original code had this failure mode but it was
   * masked because `repoFiles` was optional and nothing
   * in the chat panel consumed it.
   *
   * Phase 2d's file summary section DOES consume
   * `repoFiles`, so the silent drop became visible. The
   * fix is to retry once the first render has happened
   * — `updated()` always runs after commit, so by then
   * `this._chat()` returns a real element.
   */
  updated(changedProps) {
    super.updated?.(changedProps);
    if (
      !this._childPropsPushed &&
      this._treeLoaded &&
      Array.isArray(this._repoFiles)
    ) {
      this._pushChildProps();
    }
  }

  // ---------------------------------------------------------------
  // Selection sync
  // ---------------------------------------------------------------

  _onSelectionChanged(event) {
    // Picker emits this when the user toggles a checkbox or
    // clicks a directory checkbox.
    const incoming = event.detail?.selectedFiles;
    if (!Array.isArray(incoming)) return;
    this._applySelection(new Set(incoming), /* notifyServer */ true);
  }

  _onFilesChanged(event) {
    // Server broadcast — happens on another client's
    // `set_selected_files`, on auto-add for not-in-context
    // edits, and on our own `set_selected_files` call (the
    // server echoes back). We treat the broadcast as
    // authoritative: even for our own send, applying the
    // echo is idempotent because `_applySelection` only
    // mutates when the set actually changes.
    const incoming = event.detail?.selectedFiles;
    if (!Array.isArray(incoming)) return;
    this._applySelection(
      new Set(incoming),
      /* notifyServer */ false,
    );
  }

  _onFilesModified(_event) {
    // Fires after commit / reset / any server-side file-tree
    // mutation. Phase 2d will extend this for per-file
    // invalidation when edit blocks land; for Phase 2c a full
    // reload is fine.
    this._loadFileTree();
  }

  _onActiveFileChanged(event) {
    // Viewer event — `{path: string | null}`. When a file
    // opens or becomes the active tab, this fires with the
    // path. When the last file closes, it fires with null.
    // Either way, push the update to the picker so the
    // `.active-in-viewer` highlight follows.
    const detail = event.detail || {};
    const nextPath = typeof detail.path === 'string' && detail.path
      ? detail.path
      : null;
    if (nextPath === this._activePath) return;
    this._activePath = nextPath;
    const picker = this._picker();
    if (picker) {
      picker.activePath = nextPath;
      picker.requestUpdate();
    }
  }

  _applySelection(newSelection, notifyServer) {
    // Fast-path no-op when the set hasn't actually changed.
    // Prevents loopback from the server broadcast doing
    // another round-trip for our own update.
    if (this._setsEqual(this._selectedFiles, newSelection)) return;
    this._selectedFiles = newSelection;

    // Direct-update pattern (load-bearing — see class
    // docstring). Assign to child props then requestUpdate.
    const picker = this._picker();
    if (picker) {
      picker.selectedFiles = new Set(newSelection);
      picker.requestUpdate();
    }
    const chat = this._chat();
    if (chat) {
      // Chat panel in Phase 2b doesn't yet consume this
      // prop; assigning now so Phase 2d's file-mention work
      // sees a populated field without a refactor.
      chat.selectedFiles = Array.from(newSelection);
      chat.requestUpdate();
    }

    if (notifyServer) {
      this._sendSelectionToServer(Array.from(newSelection));
    }
  }

  async _sendSelectionToServer(files) {
    try {
      const result = await this.rpcExtract(
        'LLMService.set_selected_files',
        files,
      );
      // The server returns either an array of paths (success)
      // or `{error: "restricted", reason: ...}` for
      // non-localhost callers in collab mode. Surface the
      // restricted case via toast; the picker's optimistic
      // state has already been applied. In collab mode the
      // server will follow up with a `filesChanged` broadcast
      // that restores the authoritative state.
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        if (result.error === 'restricted') {
          this._showToast(
            result.reason || 'Restricted operation',
            'warning',
          );
        }
      }
    } catch (err) {
      console.error('[files-tab] set_selected_files failed', err);
      this._showToast(
        `Failed to update selection: ${err?.message || err}`,
        'error',
      );
    }
  }

  _onExclusionChanged(event) {
    // Picker emits this when the user shift+clicks a file
    // checkbox or a directory checkbox (the latter applies
    // to every descendant file). The event carries an array
    // of excluded paths; we update our authoritative state,
    // push to the picker via direct-update, and notify the
    // server.
    const incoming = event.detail?.excludedFiles;
    if (!Array.isArray(incoming)) return;
    this._applyExclusion(new Set(incoming), /* notifyServer */ true);
  }

  _applyExclusion(newExcluded, notifyServer) {
    // Fast-path no-op when the set hasn't actually changed.
    // Prevents loopback from the server broadcast (when
    // collab mode lands this for real) doing another
    // round-trip for our own update.
    if (this._setsEqual(this._excludedFiles, newExcluded)) return;
    this._excludedFiles = newExcluded;
    // Direct-update pattern (load-bearing — see class
    // docstring). Assign to picker prop then requestUpdate.
    const picker = this._picker();
    if (picker) {
      picker.excludedFiles = new Set(newExcluded);
      picker.requestUpdate();
    }
    if (notifyServer) {
      this._sendExclusionToServer(Array.from(newExcluded));
    }
  }

  async _sendExclusionToServer(files) {
    try {
      const result = await this.rpcExtract(
        'LLMService.set_excluded_index_files',
        files,
      );
      // Same shape as set_selected_files — array on success,
      // restricted-error dict for non-localhost callers in
      // collab mode.
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        if (result.error === 'restricted') {
          this._showToast(
            result.reason || 'Restricted operation',
            'warning',
          );
        }
      }
    } catch (err) {
      console.error(
        '[files-tab] set_excluded_index_files failed',
        err,
      );
      this._showToast(
        `Failed to update exclusion: ${err?.message || err}`,
        'error',
      );
    }
  }

  // ---------------------------------------------------------------
  // File clicks
  // ---------------------------------------------------------------

  _onFileClicked(event) {
    // Picker emits `file-clicked` when the user clicks a
    // file's name (not its checkbox). Normally this
    // translates to a `navigate-file` window event so the
    // viewer (Phase 3) opens the file.
    //
    // During file search, the picker shows a pruned tree
    // of matching files and clicking a file should scroll
    // the match overlay to that file rather than opening
    // it. We route to the chat panel's
    // scrollFileSearchToFile method instead.
    const path = event.detail?.path;
    if (!path) return;
    if (this._fileSearchActive) {
      event.stopPropagation();
      const chat = this._chat();
      if (chat && typeof chat.scrollFileSearchToFile === 'function') {
        chat.scrollFileSearchToFile(path);
      }
      return;
    }
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path },
        bubbles: false,
      }),
    );
  }

  /**
   * Chat panel dispatched `file-search-changed` — mode
   * entered, results updated, or mode exited. Swap the
   * picker tree to a pruned view containing only files
   * that have matches; on exit, restore the full tree and
   * the user's previous expand state.
   */
  _onFileSearchChanged(event) {
    const active = !!event.detail?.active;
    const results = Array.isArray(event.detail?.results)
      ? event.detail.results
      : [];
    const prev = this._fileSearchActive;
    this._fileSearchActive = active;
    const picker = this._picker();
    if (!picker) return;
    if (!active) {
      // Exiting file search mode. Restore picker state:
      // first the expand-state snapshot (so the user's
      // pre-search expansions come back), then the full
      // tree. `setTree` during the pruned phase snapshotted;
      // `restoreExpandedState` now installs the snapshot.
      if (prev) {
        picker.restoreExpandedState();
        picker.tree = this._latestTree;
        picker.selectedFiles = new Set(this._selectedFiles);
        picker.requestUpdate();
      }
      return;
    }
    // Entering file search mode (or results refreshed).
    // Build a pruned tree from the results. Empty results
    // produce an empty root; the picker renders its empty-
    // state placeholder.
    const pruned = buildPrunedTree(results);
    picker.setTree(pruned);
    picker.expandAll();
    picker.requestUpdate();
  }

  /**
   * Chat panel dispatched `file-search-scroll` — the match
   * overlay scrolled, and we should update the picker's
   * focused-path highlight to show which file section is
   * currently at the top of the visible area.
   */
  _onFileSearchScroll(event) {
    if (!this._fileSearchActive) return;
    const filePath = event.detail?.filePath;
    if (typeof filePath !== 'string' || !filePath) return;
    const picker = this._picker();
    if (!picker) return;
    picker._focusedPath = filePath;
    // Also ensure ancestor directories are expanded so the
    // highlighted row is visible. The pruned tree was
    // `expandAll()`d on entry so this is usually a no-op,
    // but if the user collapsed a directory manually the
    // focused row might be hidden.
    const parts = filePath.split('/');
    const next = new Set(picker._expanded);
    let acc = '';
    for (let i = 0; i < parts.length - 1; i += 1) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      next.add(acc);
    }
    picker._expanded = next;
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
  _onFileMentionClick(event) {
    const path = event.detail?.path;
    if (typeof path !== 'string' || !path) return;
    // Toggle — add if absent, remove if present. Goes
    // through the same `_applySelection` path as a picker
    // checkbox click, so the server is notified and the
    // picker's prop is updated via the direct-update
    // pattern.
    const next = new Set(this._selectedFiles);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._applySelection(next, /* notifyServer */ true);
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
  _onFileChipClick(event) {
    const path = event.detail?.path;
    if (typeof path !== 'string' || !path) return;
    const next = new Set(this._selectedFiles);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    this._applySelection(next, /* notifyServer */ true);
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
  _onFileChipsAddAll(event) {
    const paths = event.detail?.paths;
    if (!Array.isArray(paths) || paths.length === 0) return;
    const next = new Set(this._selectedFiles);
    for (const path of paths) {
      if (typeof path === 'string' && path) next.add(path);
    }
    this._applySelection(next, /* notifyServer */ true);
  }

  // ---------------------------------------------------------------
  // Context-menu action routing (Increment 8b — simple RPCs)
  // ---------------------------------------------------------------

  /**
   * Route a `context-menu-action` event from the picker
   * to the corresponding backend RPC. Detail shape (from
   * 8a): `{action, type, path, name, isExcluded}`. 8b
   * handles stage / unstage / discard / delete. Later
   * sub-commits add rename / duplicate / include /
   * exclude / load-in-panel; unrecognised actions fall
   * through to a debug log and wait for their owning
   * sub-commit.
   */
  _onContextMenuAction(event) {
    const detail = event.detail;
    if (!detail || typeof detail.action !== 'string') return;
    const { action, type, path } = detail;
    if (typeof path !== 'string') return;
    // Empty string paths ARE legal for the repo root
    // directory (its `path` is the empty string). File
    // actions require a non-empty path, dir actions
    // tolerate the empty string.
    if (type === 'file') {
      if (!path) return;
      this._dispatchFileAction(action, path);
      return;
    }
    if (type === 'dir') {
      this._dispatchDirAction(action, path, detail.name);
      return;
    }
    // Unknown type — ignore. Either a future type or a
    // malformed event; neither should reach any
    // handler.
  }

  /**
   * Route a file-row context menu action to the
   * appropriate dispatcher. Extracted from the main
   * handler for readability — 10 cases were starting
   * to crowd out the type-routing logic.
   */
  _dispatchFileAction(action, path) {
    switch (action) {
      case 'stage':
        this._dispatchStage(path);
        return;
      case 'unstage':
        this._dispatchUnstage(path);
        return;
      case 'discard':
        this._dispatchDiscard(path);
        return;
      case 'delete':
        this._dispatchDelete(path);
        return;
      case 'rename':
        this._dispatchRename(path);
        return;
      case 'duplicate':
        this._dispatchDuplicate(path);
        return;
      case 'include':
        this._dispatchInclude(path);
        return;
      case 'exclude':
        this._dispatchExclude(path);
        return;
      case 'load-left':
        this._dispatchLoadInPanel(path, 'left');
        return;
      case 'load-right':
        this._dispatchLoadInPanel(path, 'right');
        return;
      default:
        // No remaining unwired file actions. A
        // defensive default keeps the switch from
        // throwing on a future refactor that adds a
        // new menu item without wiring it here.
        return;
    }
  }

  /**
   * Route a directory-row context menu action. All
   * seven dir-menu actions are wired here — the
   * new-file / new-directory actions open an inline
   * input via the picker rather than calling an RPC
   * directly; the RPC fires on the commit event.
   */
  _dispatchDirAction(action, path, name) {
    switch (action) {
      case 'stage-all':
        this._dispatchStageAll(path);
        return;
      case 'unstage-all':
        this._dispatchUnstageAll(path);
        return;
      case 'rename-dir':
        this._dispatchRenameDir(path, name);
        return;
      case 'new-file':
        this._dispatchNewFile(path);
        return;
      case 'new-directory':
        this._dispatchNewDirectory(path);
        return;
      case 'exclude-all':
        this._dispatchExcludeAll(path);
        return;
      case 'include-all':
        this._dispatchIncludeAll(path);
        return;
      default:
        // Unknown actions silently drop. A future menu
        // addition that forgets to wire a handler will
        // end up here and produce a no-op rather than
        // a crash.
        return;
    }
  }

  /**
   * Stage a single file. `Repo.stage_files` accepts an
   * array so we wrap the path.
   */
  async _dispatchStage(path) {
    try {
      const result = await this.rpcExtract(
        'Repo.stage_files',
        [path],
      );
      if (this._isRestrictedError(result)) {
        this._showToast(result.reason || 'Restricted operation', 'warning');
        return;
      }
      await this._loadFileTree();
      this._showToast(`Staged ${path}`, 'success');
    } catch (err) {
      console.error('[files-tab] stage_files failed', err);
      this._showToast(
        `Failed to stage ${path}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Unstage a single file. Symmetric to stage.
   */
  async _dispatchUnstage(path) {
    try {
      const result = await this.rpcExtract(
        'Repo.unstage_files',
        [path],
      );
      if (this._isRestrictedError(result)) {
        this._showToast(result.reason || 'Restricted operation', 'warning');
        return;
      }
      await this._loadFileTree();
      this._showToast(`Unstaged ${path}`, 'success');
    } catch (err) {
      console.error('[files-tab] unstage_files failed', err);
      this._showToast(
        `Failed to unstage ${path}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Discard changes to a file — tracked files revert
   * to HEAD; untracked files are deleted. Confirm
   * dialog because both outcomes are destructive.
   *
   * Using `window.confirm` is the simplest accessible
   * option. A future pass could swap in a Lit modal
   * that matches the app's styling, but the user-
   * facing contract (a blocking yes/no before the
   * action runs) stays the same.
   */
  async _dispatchDiscard(path) {
    const confirmed = this._confirm(
      `Discard changes to ${path}? This cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const result = await this.rpcExtract(
        'Repo.discard_changes',
        [path],
      );
      if (this._isRestrictedError(result)) {
        this._showToast(result.reason || 'Restricted operation', 'warning');
        return;
      }
      await this._loadFileTree();
      this._showToast(`Discarded changes to ${path}`, 'success');
    } catch (err) {
      console.error('[files-tab] discard_changes failed', err);
      this._showToast(
        `Failed to discard ${path}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Delete a file from the working tree. Confirm with
   * a strongly-worded prompt since this is permanent
   * from the picker's perspective (git history still
   * has the file, but from the current branch tip
   * forward it's gone).
   */
  async _dispatchDelete(path) {
    const confirmed = this._confirm(
      `Delete ${path}? The file will be removed from the working tree.`,
    );
    if (!confirmed) return;
    try {
      const result = await this.rpcExtract(
        'Repo.delete_file',
        path,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(result.reason || 'Restricted operation', 'warning');
        return;
      }
      await this._loadFileTree();
      // Deleted files are also removed from selection /
      // exclusion if they were there. Server's broadcast
      // via `filesChanged` will adjust selection; we
      // clear exclusion locally since there's no
      // broadcast for that today.
      if (this._excludedFiles.has(path)) {
        const next = new Set(this._excludedFiles);
        next.delete(path);
        this._applyExclusion(next, /* notifyServer */ true);
      }
      this._showToast(`Deleted ${path}`, 'success');
    } catch (err) {
      console.error('[files-tab] delete_file failed', err);
      this._showToast(
        `Failed to delete ${path}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Kick off an inline rename. The picker renders an
   * input in place of the file row; Enter dispatches
   * `rename-committed` back to us, Escape dispatches
   * nothing (the user bailed). Pure delegation — the
   * picker owns the inline-input lifecycle.
   */
  _dispatchRename(path) {
    const picker = this._picker();
    if (!picker) return;
    picker.beginRename(path);
  }

  /**
   * Kick off an inline duplicate. Same pattern as
   * rename — picker shows an input pre-filled with the
   * source path so the user can edit the target
   * location. Commit fires `duplicate-committed`.
   */
  _dispatchDuplicate(path) {
    const picker = this._picker();
    if (!picker) return;
    picker.beginDuplicate(path);
  }

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
  _onInsertPath(event) {
    const path = event.detail?.path;
    if (typeof path !== 'string' || !path) return;
    const chat = this._chat();
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
   * Handle the picker's `rename-committed` event. Event
   * detail: `{sourcePath, targetName}` where
   * `targetName` is just the filename (not the full
   * path) — the picker's input pre-filled with the
   * current name, so the user edited a name, not a
   * path. We rebuild the full target path by
   * preserving the source's parent directory.
   *
   * Rejects target names with path separators — users
   * who want to move a file to a different directory
   * should use duplicate (or a future "move" action)
   * rather than sneaking in through rename. A slash in
   * the target would also collide with git's rename-
   * detection heuristics in confusing ways.
   */
  async _onRenameCommitted(event) {
    const detail = event.detail || {};
    const sourcePath = detail.sourcePath;
    const targetName = detail.targetName;
    if (typeof sourcePath !== 'string' || !sourcePath) return;
    if (typeof targetName !== 'string' || !targetName) return;
    if (targetName.includes('/') || targetName.includes('\\')) {
      this._showToast(
        'Rename target cannot contain path separators. Use duplicate to move files.',
        'warning',
      );
      return;
    }
    // Rebuild full target path from source's parent dir.
    const lastSlash = sourcePath.lastIndexOf('/');
    const targetPath =
      lastSlash >= 0
        ? `${sourcePath.slice(0, lastSlash)}/${targetName}`
        : targetName;
    // Same-path no-op — the picker's commit handler
    // already short-circuits on unchanged names, but
    // defensive in case a future refactor loosens that.
    if (targetPath === sourcePath) return;
    // Inspect the tree to see whether the source is a
    // file or a directory. The picker's beginRename
    // doesn't carry that discriminator — it operates on
    // a path — so we determine the correct RPC here.
    // Missing nodes (e.g., deleted between menu open
    // and Enter press) default to file rename since the
    // RPC surfaces a clean error anyway.
    const sourceNode = this._findNodeByPath(sourcePath);
    const isDir = sourceNode?.type === 'dir';
    const rpcMethod = isDir ? 'Repo.rename_directory' : 'Repo.rename_file';
    try {
      const result = await this.rpcExtract(
        rpcMethod,
        sourcePath,
        targetPath,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      await this._loadFileTree();
      // Migrate selection and exclusion state to the
      // new path. For directory renames we migrate
      // every descendant path's prefix so nested
      // selections survive.
      if (isDir) {
        this._migrateSubtreeState(sourcePath, targetPath);
      } else {
        if (this._selectedFiles.has(sourcePath)) {
          const next = new Set(this._selectedFiles);
          next.delete(sourcePath);
          next.add(targetPath);
          this._applySelection(next, /* notifyServer */ true);
        }
        if (this._excludedFiles.has(sourcePath)) {
          const next = new Set(this._excludedFiles);
          next.delete(sourcePath);
          next.add(targetPath);
          this._applyExclusion(next, /* notifyServer */ true);
        }
      }
      this._showToast(
        `Renamed to ${targetName}`,
        'success',
      );
    } catch (err) {
      console.error('[files-tab] rename failed', err);
      this._showToast(
        `Failed to rename ${sourcePath}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Locate any tree node (file OR directory) by path.
   * Used by rename commit to distinguish file vs dir
   * source so we can route to the correct RPC.
   * Returns null when not found.
   */
  _findNodeByPath(path) {
    const walk = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (node.path === path) return node;
      if (!Array.isArray(node.children)) return null;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this._latestTree);
  }

  /**
   * Migrate every selection and exclusion entry
   * whose path lives under `oldDir` to the
   * equivalent path under `newDir`. Called after a
   * successful directory rename so that per-file
   * state survives the move.
   */
  _migrateSubtreeState(oldDir, newDir) {
    const oldPrefix = `${oldDir}/`;
    const migrateSet = (set) => {
      let mutated = false;
      const next = new Set(set);
      for (const p of set) {
        if (p === oldDir || p.startsWith(oldPrefix)) {
          next.delete(p);
          const rewritten =
            p === oldDir ? newDir : `${newDir}/${p.slice(oldPrefix.length)}`;
          next.add(rewritten);
          mutated = true;
        }
      }
      return mutated ? next : null;
    };
    const nextSelected = migrateSet(this._selectedFiles);
    if (nextSelected) {
      this._applySelection(nextSelected, /* notifyServer */ true);
    }
    const nextExcluded = migrateSet(this._excludedFiles);
    if (nextExcluded) {
      this._applyExclusion(nextExcluded, /* notifyServer */ true);
    }
  }

  /**
   * Handle the picker's `duplicate-committed` event.
   * Event detail: `{sourcePath, targetName}` where
   * `targetName` is the FULL target path (the picker's
   * input pre-filled with the source path, so the user
   * edited a path). Read source content via
   * `Repo.get_file_content`, then create the target
   * via `Repo.create_file`. No backend
   * `copy_file` RPC exists, so the client-side
   * read-then-write is the canonical flow.
   *
   * Failure at either step aborts cleanly — if the
   * read succeeds but the write fails (e.g. target
   * already exists, per `Repo.create_file`'s semantics),
   * nothing's created and the toast explains the
   * failure.
   */
  async _onDuplicateCommitted(event) {
    const detail = event.detail || {};
    const sourcePath = detail.sourcePath;
    const targetPath = detail.targetName;
    if (typeof sourcePath !== 'string' || !sourcePath) return;
    if (typeof targetPath !== 'string' || !targetPath) return;
    if (targetPath === sourcePath) return;
    try {
      // Read source content. The RPC envelope is
      // single-key; `rpcExtract` unwraps it.
      const content = await this.rpcExtract(
        'Repo.get_file_content',
        sourcePath,
      );
      // The RPC returns a plain string for text files.
      // Binary files raise a RepoError on the server
      // side, which surfaces here as a rejected
      // promise — caught by the outer try/catch.
      if (typeof content !== 'string') {
        this._showToast(
          `Cannot duplicate ${sourcePath}: unexpected content type`,
          'error',
        );
        return;
      }
      const result = await this.rpcExtract(
        'Repo.create_file',
        targetPath,
        content,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      await this._loadFileTree();
      this._showToast(
        `Duplicated to ${targetPath}`,
        'success',
      );
    } catch (err) {
      console.error('[files-tab] duplicate failed', err);
      this._showToast(
        `Failed to duplicate ${sourcePath}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Handle the picker's `new-file-committed` event.
   * Event detail: `{parentPath, name}` where `name` is
   * the basename typed by the user. Combine with
   * `parentPath` to produce the full repo-relative path
   * and call `Repo.create_file(path, '')`.
   *
   * Path separators in `name` are rejected — users who
   * want to create a nested file path should create the
   * directories separately. This matches the rename
   * path's behaviour and keeps the interaction
   * predictable.
   *
   * Empty `parentPath` (repo root) is valid — the
   * resulting target path is just `name`.
   */
  async _onNewFileCommitted(event) {
    const detail = event.detail || {};
    const parentPath = detail.parentPath;
    const name = detail.name;
    if (typeof parentPath !== 'string') return;
    if (typeof name !== 'string' || !name) return;
    if (name.includes('/') || name.includes('\\')) {
      // Path separators rejected — nested paths
      // should be built step-by-step rather than
      // sneaking in through a single create. Matches
      // the rename-committed rejection rule.
      this._showToast(
        'File name cannot contain path separators.',
        'warning',
      );
      return;
    }
    if (name.includes('/') || name.includes('\\')) {
      this._showToast(
        'File name cannot contain path separators.',
        'warning',
      );
      return;
    }
    const targetPath = parentPath ? `${parentPath}/${name}` : name;
    try {
      const result = await this.rpcExtract(
        'Repo.create_file',
        targetPath,
        '',
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      await this._loadFileTree();
      this._showToast(`Created ${targetPath}`, 'success');
    } catch (err) {
      console.error('[files-tab] create_file failed', err);
      this._showToast(
        `Failed to create ${targetPath}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Handle the picker's `new-directory-committed`
   * event. Event detail: `{parentPath, name}`. Git
   * doesn't track directories directly — only files
   * with content — so we create the new directory by
   * writing a `.gitkeep` file inside it. `.gitkeep` is
   * a community convention (not a git feature); the
   * name self-documents the purpose and users who see
   * it in diffs immediately know what it's for.
   *
   * After the user adds real files to the directory,
   * they can delete `.gitkeep` or leave it.
   *
   * Same path-separator validation as new-file.
   */
  async _onNewDirectoryCommitted(event) {
    const detail = event.detail || {};
    const parentPath = detail.parentPath;
    const name = detail.name;
    if (typeof parentPath !== 'string') return;
    if (typeof name !== 'string' || !name) return;
    if (name.includes('/') || name.includes('\\')) {
      // Path separators rejected — see the equivalent
      // check in _onNewFileCommitted.
      this._showToast(
        'Directory name cannot contain path separators.',
        'warning',
      );
      return;
    }
    if (name.includes('/') || name.includes('\\')) {
      this._showToast(
        'Directory name cannot contain path separators.',
        'warning',
      );
      return;
    }
    const dirPath = parentPath ? `${parentPath}/${name}` : name;
    const keepPath = `${dirPath}/.gitkeep`;
    try {
      const result = await this.rpcExtract(
        'Repo.create_file',
        keepPath,
        '',
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      await this._loadFileTree();
      this._showToast(`Created directory ${dirPath}`, 'success');
    } catch (err) {
      console.error(
        '[files-tab] create_file (gitkeep) failed',
        err,
      );
      this._showToast(
        `Failed to create ${dirPath}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Add `path` to the excluded set via the standard
   * exclusion path. Idempotent — a file already
   * excluded produces a set-equality short-circuit
   * inside `_applyExclusion`, and the user sees no
   * server round-trip.
   *
   * Excluding a selected file also deselects it —
   * the two states are mutually exclusive. Mirrors
   * the shift+click behaviour in the picker's
   * `_toggleExclusion` path.
   */
  _dispatchExclude(path) {
    if (this._excludedFiles.has(path)) return;
    const nextExcluded = new Set(this._excludedFiles);
    nextExcluded.add(path);
    this._applyExclusion(nextExcluded, /* notifyServer */ true);
    // Deselect if currently selected — excluded and
    // selected can't coexist.
    if (this._selectedFiles.has(path)) {
      const nextSelected = new Set(this._selectedFiles);
      nextSelected.delete(path);
      this._applySelection(nextSelected, /* notifyServer */ true);
    }
  }

  /**
   * Remove `path` from the excluded set. Returns the
   * file to the default index-only state — NOT to
   * selected. Matches the shift+click-from-excluded
   * semantics in the picker (the "Include in index"
   * menu item is the non-selecting path; users who
   * want to select it can tick the checkbox after).
   *
   * Idempotent — a file not currently excluded
   * short-circuits via set-equality.
   */
  _dispatchInclude(path) {
    if (!this._excludedFiles.has(path)) return;
    const next = new Set(this._excludedFiles);
    next.delete(path);
    this._applyExclusion(next, /* notifyServer */ true);
  }

  /**
   * Fetch the file's content via `Repo.get_file_content`
   * and dispatch a `load-diff-panel` event carrying the
   * content, target panel, and a label (the file's
   * basename). The app shell catches the event and
   * routes to the diff viewer's `loadPanel(content,
   * panel, label)` — same pathway the history browser's
   * "Load in Left/Right Panel" context menu uses.
   *
   * The panel parameter is 'left' or 'right'. Invalid
   * panels are rejected silently — the switch in
   * `_onContextMenuAction` only calls us with known
   * values.
   *
   * Failures (binary file, missing file, RPC error)
   * surface as error toasts. Non-string content (e.g.,
   * if the backend changes shape) guards with a
   * defensive type check, mirroring duplicate's
   * content validation.
   */
  async _dispatchLoadInPanel(path, panel) {
    if (panel !== 'left' && panel !== 'right') return;
    try {
      const content = await this.rpcExtract(
        'Repo.get_file_content',
        path,
      );
      if (typeof content !== 'string') {
        this._showToast(
          `Cannot load ${path}: unexpected content type`,
          'error',
        );
        return;
      }
      // Derive the label from the basename. The diff
      // viewer's floating panel label shows this to
      // disambiguate panels when the user has loaded
      // content from multiple sources.
      const lastSlash = path.lastIndexOf('/');
      const basename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
      window.dispatchEvent(
        new CustomEvent('load-diff-panel', {
          detail: {
            content,
            panel,
            label: basename,
          },
          bubbles: false,
        }),
      );
    } catch (err) {
      console.error('[files-tab] load-in-panel failed', err);
      this._showToast(
        `Failed to load ${path}: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Walk `_latestTree` to find the directory at `path`
   * and return an array of all repo-relative file
   * paths beneath it. Empty array when the path
   * isn't found or the target isn't a directory.
   *
   * Used by every directory-level dispatcher — batch-
   * operations naturally want the full descendant set
   * so the RPC round-trip count is O(1) regardless of
   * directory size.
   */
  _collectDescendantFilesFromPath(dirPath) {
    if (typeof dirPath !== 'string') return [];
    const root = this._latestTree;
    if (!root || typeof root !== 'object') return [];
    // Special case — repo root has empty path. Collect
    // from the root itself without walking to find it.
    if (dirPath === '') {
      return this._collectDescendantsOfNode(root);
    }
    // Walk to the target directory.
    const target = this._findDirNode(root, dirPath);
    if (!target) return [];
    return this._collectDescendantsOfNode(target);
  }

  /**
   * Recursive helper — depth-first walk collecting
   * file paths. Directories contribute nothing of
   * their own; their descendants' file paths flow up.
   */
  _collectDescendantsOfNode(node) {
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
   * Locate a directory node by path within the tree.
   * Returns null when not found. Simple DFS — tree
   * sizes are small enough that a path-indexed lookup
   * wouldn't justify the cache-invalidation
   * complexity.
   */
  _findDirNode(root, dirPath) {
    if (!root || typeof root !== 'object') return null;
    if (root.type === 'dir' && root.path === dirPath) return root;
    if (!Array.isArray(root.children)) return null;
    for (const child of root.children) {
      const found = this._findDirNode(child, dirPath);
      if (found) return found;
    }
    return null;
  }

  /**
   * Stage every file under the given directory.
   * Single RPC round-trip for the whole subtree.
   * Empty directories (no descendants) short-circuit
   * silently — no server call, no toast.
   */
  async _dispatchStageAll(dirPath) {
    const files = this._collectDescendantFilesFromPath(dirPath);
    if (files.length === 0) return;
    try {
      const result = await this.rpcExtract(
        'Repo.stage_files',
        files,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      await this._loadFileTree();
      const label = dirPath || 'repository';
      this._showToast(
        `Staged ${files.length} file${files.length === 1 ? '' : 's'} in ${label}`,
        'success',
      );
    } catch (err) {
      console.error('[files-tab] stage_files (batch) failed', err);
      this._showToast(
        `Failed to stage files: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Symmetric to stage-all. A file that isn't
   * currently staged contributes nothing to the
   * unstage but doesn't break the batch — git
   * silently skips unstaged paths.
   */
  async _dispatchUnstageAll(dirPath) {
    const files = this._collectDescendantFilesFromPath(dirPath);
    if (files.length === 0) return;
    try {
      const result = await this.rpcExtract(
        'Repo.unstage_files',
        files,
      );
      if (this._isRestrictedError(result)) {
        this._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
        return;
      }
      await this._loadFileTree();
      const label = dirPath || 'repository';
      this._showToast(
        `Unstaged ${files.length} file${files.length === 1 ? '' : 's'} in ${label}`,
        'success',
      );
    } catch (err) {
      console.error('[files-tab] unstage_files (batch) failed', err);
      this._showToast(
        `Failed to unstage files: ${err?.message || err}`,
        'error',
      );
    }
  }

  /**
   * Rename a directory. Delegates to the picker's
   * inline-input flow via `beginRename` — the picker
   * doesn't currently distinguish file vs directory
   * rename at the input level (both want an inline
   * input prefilled with the current name), but the
   * commit event carries the path unchanged and our
   * file rename handler rebuilds the target. The
   * DIRECTORY rename needs a separate commit handler
   * (`rename-dir-committed`) because the backend RPC
   * is different: `Repo.rename_directory` vs
   * `Repo.rename_file`.
   *
   * For simplicity we reuse the picker's existing
   * rename flow — `beginRename` sets `_renaming` to
   * the node's path regardless of type, and the
   * `rename-committed` event fires on Enter. We
   * differentiate at the commit-handler level by
   * checking whether the source path exists as a
   * file or a directory in the tree. Alternative
   * would be to add a parallel `beginRenameDir` but
   * it duplicates the input rendering for no UX
   * benefit.
   *
   * The dir-case branch is in `_onRenameCommitted`
   * — it inspects `_latestTree` to decide which RPC
   * to call.
   */
  _dispatchRenameDir(path, name) {
    const picker = this._picker();
    if (!picker) return;
    // Reuse the file rename input — same pre-filled
    // name pattern.
    picker.beginRename(path);
  }

  /**
   * Open the new-file inline input inside `parentPath`.
   * Picker renders an empty input at the top of that
   * directory's children and auto-expands the parent
   * so the input is visible. On Enter, the picker
   * fires `new-file-committed` with `{parentPath, name}`
   * which `_onNewFileCommitted` catches.
   *
   * parentPath may be the empty string (repo root).
   */
  _dispatchNewFile(parentPath) {
    const picker = this._picker();
    if (!picker) return;
    picker.beginCreateFile(parentPath);
  }

  /**
   * Open the new-directory inline input inside
   * `parentPath`. Parallel to `_dispatchNewFile`.
   * Commit fires `new-directory-committed`; the
   * orchestrator creates the directory by writing a
   * `.gitkeep` file inside it (git doesn't track
   * empty directories, so a placeholder file is
   * needed for the directory to exist in the next
   * commit).
   */
  _dispatchNewDirectory(parentPath) {
    const picker = this._picker();
    if (!picker) return;
    picker.beginCreateDirectory(parentPath);
  }

  /**
   * Add every descendant file to the excluded set.
   * Skips the server round-trip when the union is
   * already the current state (every descendant
   * already excluded). Deselects any descendants
   * that were selected, matching the mutual-
   * exclusion rule between selection and exclusion.
   */
  _dispatchExcludeAll(dirPath) {
    const files = this._collectDescendantFilesFromPath(dirPath);
    if (files.length === 0) return;
    const nextExcluded = new Set(this._excludedFiles);
    for (const p of files) nextExcluded.add(p);
    this._applyExclusion(nextExcluded, /* notifyServer */ true);
    // Deselect any that were selected.
    const hadSelected = files.some((p) => this._selectedFiles.has(p));
    if (hadSelected) {
      const nextSelected = new Set(this._selectedFiles);
      for (const p of files) nextSelected.delete(p);
      this._applySelection(nextSelected, /* notifyServer */ true);
    }
  }

  /**
   * Remove every descendant file from the excluded
   * set. Returns them to the default index-only
   * state — does NOT auto-select, matching the
   * file-level Include behaviour.
   */
  _dispatchIncludeAll(dirPath) {
    const files = this._collectDescendantFilesFromPath(dirPath);
    if (files.length === 0) return;
    const next = new Set(this._excludedFiles);
    for (const p of files) next.delete(p);
    this._applyExclusion(next, /* notifyServer */ true);
  }

  /**
   * Wrap `window.confirm` so tests can stub it cleanly.
   * The real implementation delegates directly; tests
   * mock this method to drive the confirm / cancel
   * branches deterministically.
   */
  _confirm(message) {
    return typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(message)
      : false;
  }

  /**
   * Check the result of an RPC call against the
   * restricted-caller shape. Matches the helper inline-
   * defined in `_sendSelectionToServer` and
   * `_sendExclusionToServer` — extracted here so the
   * four context-menu dispatchers don't duplicate the
   * shape check. Older sites haven't been migrated;
   * they're stable code paths that don't touch 8b's
   * changes.
   */
  _isRestrictedError(result) {
    return (
      result &&
      typeof result === 'object' &&
      !Array.isArray(result) &&
      result.error === 'restricted'
    );
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  _picker() {
    return this.shadowRoot?.querySelector('ac-file-picker') || null;
  }

  _chat() {
    return this.shadowRoot?.querySelector('ac-chat-panel') || null;
  }

  _setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const item of a) {
      if (!b.has(item)) return false;
    }
    return true;
  }

  _showToast(message, type = 'info') {
    // AppShell listens for `ac-toast` window events and
    // renders them in the global toast layer. Components
    // dispatch rather than reach through the DOM.
    window.dispatchEvent(
      new CustomEvent('ac-toast', {
        detail: { message, type },
      }),
    );
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  render() {
    return html`
      <div
        class="picker-pane"
        style="width: ${this._pickerWidthPx}px"
      >
        <ac-file-picker
          .tree=${this._latestTree}
          .statusData=${this._latestStatusData}
          .branchInfo=${this._latestBranchInfo}
          .selectedFiles=${this._selectedFiles}
          .excludedFiles=${this._excludedFiles}
          @selection-changed=${this._onSelectionChanged}
          @exclusion-changed=${this._onExclusionChanged}
          @file-clicked=${this._onFileClicked}
          @context-menu-action=${this._onContextMenuAction}
          @rename-committed=${this._onRenameCommitted}
          @duplicate-committed=${this._onDuplicateCommitted}
          @insert-path=${this._onInsertPath}
          @new-file-committed=${this._onNewFileCommitted}
          @new-directory-committed=${this._onNewDirectoryCommitted}
        ></ac-file-picker>
      </div>
      <div class="chat-pane">
        <ac-chat-panel
          @file-mention-click=${this._onFileMentionClick}
          @file-chip-click=${this._onFileChipClick}
          @file-chips-add-all=${this._onFileChipsAddAll}
          @file-search-changed=${this._onFileSearchChanged}
          @file-search-scroll=${this._onFileSearchScroll}
        ></ac-chat-panel>
      </div>
    `;
  }
}

customElements.define('ac-files-tab', FilesTab);

// Exported for unit tests. Production callers don't need
// the helpers — they run internally during tree load and
// file search result handling.
export { flattenTreePaths, buildPrunedTree };