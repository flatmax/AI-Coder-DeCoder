// File-tree loader and downstream prop wiring.
//
// Extracted from index.js. The tree-load lifecycle is
// the longest single flow in the orchestrator — fetch
// tree + branch info, build status data, derive flat
// repo-files, run first-load auto-select, push to
// children. This module owns it.
//
// Cross-module dependencies:
//
//   - selection.js's `applySelection` for the
//     auto-select pass (called via host forwarder so
//     the modified-file pin and short-circuit run)
//   - exclusion.js's `applyExclusion` for the
//     state-loaded restore path
//
// Reactive state read here lives on the host:
// `_latestTree`, `_latestStatusData`,
// `_latestBranchInfo`, `_repoFiles`, `_treeLoaded`,
// `_initialAutoSelect`, `_childPropsPushed`,
// `_reviewState`, `_activePath`. Mutations to these
// fields go through plain assignment — every push to
// children happens via `pushChildProps` which calls
// `requestUpdate` on each.

import { applyExclusion } from './exclusion.js';
import { applySelection } from './selection.js';
import { EMPTY_TREE } from './constants.js';
import { flattenTreePaths } from './helpers.js';

/**
 * Walk a file tree and collect every file node's path
 * for which `is_binary === true`. Binary files can't
 * usefully participate in LLM context (the backend
 * silently trims them at sync time), so the picker
 * disables their checkboxes and excludes them from
 * select-all / deselect-all descendant math — without
 * that, root and directory checkboxes could never
 * reach the "fully selected" or "fully unselected"
 * state when binaries were present.
 */
function collectBinaryPaths(node) {
  const out = new Set();
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'file') {
      if (n.is_binary === true && typeof n.path === 'string') {
        out.add(n.path);
      }
      return;
    }
    for (const child of n.children || []) walk(child);
  }
  walk(node);
  return out;
}

/**
 * Fetch the file tree + branch info and update every
 * downstream consumer. Two RPCs in parallel; tree
 * failure is fatal for this load (nothing useful to
 * display), branch failure degrades to no-pill state.
 *
 * Builds:
 *   - `_latestTree` — root node for the picker
 *   - `_latestStatusData` — Sets / Map for O(1)
 *     per-row lookup during render
 *   - `_latestBranchInfo` — picker root-row pill
 *   - `_repoFiles` — flat list for chat-panel
 *     mention detection
 *
 * Then runs the first-load auto-select pass (one-shot,
 * gated by `_initialAutoSelect`) and pushes to
 * children.
 */
export async function loadFileTree(host) {
  let tree;
  let branchResult;
  try {
    const [treeValue, branchValue] = await Promise.allSettled([
      host.rpcExtract('Repo.get_file_tree'),
      host.rpcExtract('Repo.get_current_branch'),
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
    host._showToast(
      `Failed to load file tree: ${err?.message || err}`,
      'error',
    );
    return;
  }
  // The repo returns the full shape documented in
  // src/ac_dc/repo.py — `tree` is the nested node plus
  // sibling arrays (modified, staged, etc.).
  //
  // Direct-update pattern (see class docstring) — we
  // write `picker.tree` directly inside pushChildProps
  // and flip `_treeLoaded` AFTER, so our own re-render
  // can't clobber the assignment. The template binds
  // `.tree` via a getter that reads from `_latestTree`,
  // which we update here.
  host._latestTree = tree?.tree || EMPTY_TREE;
  // Build status data from the RPC's sibling arrays.
  // Repo.get_file_tree returns `modified`, `staged`,
  // `untracked`, `deleted` as path-string arrays and
  // `diff_stats` as `{path: {added, removed}}`. Convert
  // to Sets / Map here so the picker's per-row render
  // stays O(1) per lookup rather than O(N) scans.
  // Defensive — any missing / malformed field falls
  // back to an empty collection so a partial response
  // doesn't crash the picker.
  host._latestStatusData = {
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
    typeof host._latestTree?.name === 'string'
      ? host._latestTree.name
      : '';
  host._latestBranchInfo = {
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
  // Derive the flat file list and push to the chat
  // panel so file mentions in assistant output get
  // wrapped. The chat panel's `repoFiles` prop short-
  // circuits on empty input, so before the first load
  // the cost is zero.
  host._repoFiles = flattenTreePaths(host._latestTree);
  // Collect binary paths so the picker can disable
  // their checkboxes and exclude them from select-all
  // descendant math. Without this, root checkbox
  // could never reach all/none state when binaries
  // are present.
  host._binaryFiles = collectBinaryPaths(host._latestTree);
  // First-load auto-select — picks up every file with
  // pending changes so the user doesn't have to
  // re-tick what they were just working on. Runs
  // exactly once per component lifetime; subsequent
  // reloads do nothing here. The flag flip happens
  // synchronously so a re-entrant reload during the
  // RPC that got us here can't trigger double-auto-
  // select.
  if (host._initialAutoSelect) {
    host._initialAutoSelect = false;
    applyInitialAutoSelect(host);
  }
  // Reset the push flag — a fresh tree load means the
  // children need fresh props, even if a previous load
  // already pushed once. `updated()` will retry if the
  // call below is too early in the lifecycle.
  host._childPropsPushed = false;
  pushChildProps(host);
  host._treeLoaded = true;
}

/**
 * Apply the first-load auto-selection rule: union
 * every changed file (modified ∪ staged ∪ untracked
 * ∪ deleted) with the existing selection, then expand
 * the ancestor directories of every selected file so
 * the user can see them in the tree.
 *
 * Union semantics (not replace) preserve any
 * selection the server broadcast during startup —
 * e.g., a prior session's state restored by
 * `_restore_last_session` on the backend, or a collab
 * host's selection received via `files-changed`
 * before our first tree load.
 *
 * Called exactly once per component lifetime, by
 * `loadFileTree` after status data is built. The
 * subsequent `pushChildProps` call picks up the
 * mutations and pushes them to the picker in a single
 * render cycle.
 */
export function applyInitialAutoSelect(host) {
  const changed = new Set();
  const sd = host._latestStatusData;
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
    // `applySelection` short-circuit path isn't
    // involved in the common "clean working tree"
    // case.
    return;
  }
  // Union with existing selection. If the union is
  // strictly a superset of what we already have,
  // applySelection sends the new selection to the
  // server; if it's equal (every changed file was
  // already selected), the set-equality short-circuit
  // inside applySelection makes this a no-op.
  const union = new Set(host._selectedFiles);
  for (const p of changed) union.add(p);
  applySelection(host, union, /* notifyServer */ true);
  // Expand ancestor directories of every selected
  // file so they're visible in the tree. The picker
  // doesn't auto-expand on selection normally —
  // selection state is independent of expansion — so
  // we have to do it here.
  expandAncestorsOf(host, union);
}

/**
 * Mark every ancestor directory of every path in
 * `paths` as expanded in the picker. Mutates the
 * picker's `_expanded` Set directly. Called from
 * `applyInitialAutoSelect`; safe to call before the
 * first `pushChildProps` because it updates an
 * internal-state Set that the picker consults on its
 * next render.
 */
export function expandAncestorsOf(host, paths) {
  const picker = host._picker();
  if (!picker) {
    // Picker not mounted yet — defer. The first
    // `pushChildProps` retry through `updated()` will
    // bring the picker into view, but the expansion
    // state won't be re-derived there. Fall through
    // to directly mutating the set we track pre-mount.
    // The picker's default `_expanded` starts empty;
    // we can't reach into it until it mounts, so in
    // the rare mount-order case (picker not yet
    // visible when auto-select runs) we just skip
    // the expansion — the user can still reach the
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
 * Push tree-derived state to picker and chat-panel
 * children.
 *
 * Called both from `loadFileTree` (first-time
 * populate) and from `updated` after the initial
 * render (retry path for the race where RPC-ready
 * fires before the template has committed and
 * `host._chat()` returns null). The retry is guarded
 * by `_childPropsPushed` so a successful push isn't
 * redone on every subsequent update.
 *
 * Returns true when both children were reachable and
 * received their props — the caller uses this to mark
 * the push complete.
 */
export function pushChildProps(host) {
  const picker = host._picker();
  const chat = host._chat();
  if (!picker || !chat) {
    // One or both children not mounted yet.
    // `updated()` will retry after the first render
    // commits.
    return false;
  }
  picker.tree = host._latestTree;
  picker.statusData = host._latestStatusData;
  picker.branchInfo = host._latestBranchInfo;
  picker.excludedFiles = new Set(host._excludedFiles);
  picker.pinnedFiles = computePinnedFiles(host);
  picker.binaryFiles = host._binaryFiles
    ? new Set(host._binaryFiles)
    : new Set();
  picker.activePath = host._activePath;
  picker.reviewState = host._reviewState;
  picker.requestUpdate();
  chat.repoFiles = host._repoFiles;
  chat.requestUpdate();
  host._childPropsPushed = true;
  return true;
}

/**
 * Build the set of paths that should be pinned to
 * selection — files with working-tree or staged
 * modifications. The picker uses this to suppress the
 * native checkbox toggle on attempted deselection so
 * Lit's reactive binding stays the source of truth.
 * Untracked and deleted files are excluded — see the
 * comment in `applySelection` for the rationale.
 */
export function computePinnedFiles(host) {
  const pinned = new Set();
  const sd = host._latestStatusData;
  if (!sd) return pinned;
  if (sd.modified instanceof Set) {
    for (const p of sd.modified) pinned.add(p);
  }
  if (sd.staged instanceof Set) {
    for (const p of sd.staged) pinned.add(p);
  }
  return pinned;
}

/**
 * `files-modified` window event — fires after commit /
 * reset / any server-side file-tree mutation. Phase 2d
 * extends per-file invalidation; for now a full reload
 * is fine.
 */
export function onFilesModified(host) {
  loadFileTree(host);
}

/**
 * `state-loaded` window event from AppShell — fires
 * after every successful `get_current_state()` fetch
 * (initial connect and reconnects). Restore the
 * server's authoritative selection / exclusion sets so
 * a browser refresh preserves what the user had ticked,
 * even when the working tree is clean (and thus
 * `applyInitialAutoSelect` wouldn't otherwise seed
 * anything).
 *
 * Do NOT suppress the first-load auto-select. Per
 * specs4/5-webapp/file-picker.md § Auto-Selection, the
 * git-changed union must "merge with any server-
 * provided selection … rather than replacing" it. The
 * state-loaded snapshot typically arrives before the
 * tree loads (AppShell's `_fetchCurrentState` fires on
 * `setupDone`, before this component's `onRpcReady`
 * microtask defers the tree RPC), so when
 * `applyInitialAutoSelect` runs on tree load it sees
 * the server's selection already installed in
 * `_selectedFiles` and unions the git-changed files on
 * top.
 *
 * Also restores review state so the picker's amber
 * banner reappears after a browser refresh during an
 * active review. Without this, the post-refresh UI
 * looks identical to non-review mode even though git
 * HEAD is detached at the merge-base — confusing,
 * because the user has no affordance to exit review
 * and recover their original branch.
 */
export function onStateLoaded(host, event) {
  const state = event?.detail;
  if (!state || typeof state !== 'object') return;
  const selected = state.selected_files;
  if (Array.isArray(selected)) {
    applySelection(
      host, new Set(selected), /* notifyServer */ false,
    );
  }
  const excluded = state.excluded_index_files;
  if (Array.isArray(excluded)) {
    applyExclusion(
      host, new Set(excluded), /* notifyServer */ false,
    );
  }
  const review =
    state.review_state && typeof state.review_state === 'object'
      ? state.review_state
      : null;
  if (review && review.active) {
    host._reviewState = review;
    const picker = host._picker();
    if (picker) {
      picker.reviewState = review;
      picker.requestUpdate();
    }
  }
}