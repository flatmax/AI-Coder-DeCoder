// Context-menu action routing and dispatchers.
//
// Extracted from index.js. The entry point —
// `onContextMenuAction` — receives the picker's
// `context-menu-action` event and routes to one of
// fourteen dispatchers based on the action string and
// the row type (file / dir / root).
//
// Every dispatcher takes the host as its first arg.
// Some delegate to host helpers for cross-module
// concerns:
//
//   - host._applySelection / host._applyExclusion /
//     host._applyExclusionWithPrompt — selection +
//     exclusion paths still live on the host (stage 3
//     extracts them)
//   - host._loadFileTree — tree refresh after every
//     mutation
//   - host._showToast — user-facing feedback
//   - host._picker — DOM access for inline-input
//     dispatchers (rename, duplicate, new-file,
//     new-directory)
//
// Inline-commit handlers (rename-committed,
// duplicate-committed, new-file-committed,
// new-directory-committed) live in `./inline-commits.js`
// because they're a separate event surface — the
// `beginRename` / `beginCreateFile` calls here open the
// inline input; the corresponding commit events fire
// when the user presses Enter.

/**
 * Route a `context-menu-action` event from the picker
 * to the corresponding backend RPC. Detail shape (from
 * 8a): `{action, type, path, name, isExcluded}`. Stage
 * 8b handled stage / unstage / discard / delete; later
 * sub-commits added rename / duplicate / include /
 * exclude / load-in-panel / dir actions. Unrecognised
 * actions fall through to a debug log and wait for
 * their owning sub-commit.
 */
export function onContextMenuAction(host, event) {
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
    dispatchFileAction(host, action, path);
    return;
  }
  if (type === 'dir') {
    dispatchDirAction(host, action, path, detail.name);
    return;
  }
  if (type === 'root') {
    // Root-row actions reuse the directory-action
    // dispatcher — the action IDs (new-file /
    // new-directory) and their handlers are
    // identical; the only difference is that the
    // root's path is the empty string, which
    // dispatchNewFile / dispatchNewDirectory already
    // handle as "create at repo root".
    dispatchDirAction(host, action, path, detail.name);
    return;
  }
  // Unknown type — ignore. Either a future type or a
  // malformed event; neither should reach any handler.
}

/**
 * Route a file-row context menu action to the
 * appropriate dispatcher. Extracted from the main
 * handler for readability — 10 cases were starting
 * to crowd out the type-routing logic.
 */
export function dispatchFileAction(host, action, path) {
  switch (action) {
    case 'stage':
      dispatchStage(host, path);
      return;
    case 'unstage':
      dispatchUnstage(host, path);
      return;
    case 'discard':
      dispatchDiscard(host, path);
      return;
    case 'delete':
      dispatchDelete(host, path);
      return;
    case 'rename':
      dispatchRename(host, path);
      return;
    case 'duplicate':
      dispatchDuplicate(host, path);
      return;
    case 'include':
      dispatchInclude(host, path);
      return;
    case 'exclude':
      dispatchExclude(host, path);
      return;
    case 'load-left':
      dispatchLoadInPanel(host, path, 'left');
      return;
    case 'load-right':
      dispatchLoadInPanel(host, path, 'right');
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
export function dispatchDirAction(host, action, path, name) {
  switch (action) {
    case 'stage-all':
      dispatchStageAll(host, path);
      return;
    case 'unstage-all':
      dispatchUnstageAll(host, path);
      return;
    case 'rename-dir':
      dispatchRenameDir(host, path, name);
      return;
    case 'new-file':
      dispatchNewFile(host, path);
      return;
    case 'new-directory':
      dispatchNewDirectory(host, path);
      return;
    case 'exclude-all':
      dispatchExcludeAll(host, path);
      return;
    case 'include-all':
      dispatchIncludeAll(host, path);
      return;
    default:
      // Unknown actions silently drop. A future menu
      // addition that forgets to wire a handler will
      // end up here and produce a no-op rather than
      // a crash.
      return;
  }
}

// ---------------------------------------------------------------
// File-row dispatchers
// ---------------------------------------------------------------

/**
 * Stage a single file. `Repo.stage_files` accepts an
 * array so we wrap the path.
 */
export async function dispatchStage(host, path) {
  try {
    const result = await host.rpcExtract(
      'Repo.stage_files',
      [path],
    );
    if (isRestrictedError(result)) {
      host._showToast(result.reason || 'Restricted operation', 'warning');
      return;
    }
    await host._loadFileTree();
    host._showToast(`Staged ${path}`, 'success');
  } catch (err) {
    console.error('[files-tab] stage_files failed', err);
    host._showToast(
      `Failed to stage ${path}: ${err?.message || err}`,
      'error',
    );
  }
}

/**
 * Unstage a single file. Symmetric to stage.
 */
export async function dispatchUnstage(host, path) {
  try {
    const result = await host.rpcExtract(
      'Repo.unstage_files',
      [path],
    );
    if (isRestrictedError(result)) {
      host._showToast(result.reason || 'Restricted operation', 'warning');
      return;
    }
    await host._loadFileTree();
    host._showToast(`Unstaged ${path}`, 'success');
  } catch (err) {
    console.error('[files-tab] unstage_files failed', err);
    host._showToast(
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
export async function dispatchDiscard(host, path) {
  const confirmed = host._confirm(
    `Discard changes to ${path}? This cannot be undone.`,
  );
  if (!confirmed) return;
  try {
    const result = await host.rpcExtract(
      'Repo.discard_changes',
      [path],
    );
    if (isRestrictedError(result)) {
      host._showToast(result.reason || 'Restricted operation', 'warning');
      return;
    }
    await host._loadFileTree();
    // Notify the app shell that working-tree content
    // has reverted. The shell's _onFilesReverted
    // handler calls refreshOpenFiles on the diff /
    // SVG viewers so any open editor showing this
    // path picks up the new on-disk content instead
    // of the stale modified buffer. Without this,
    // "Discard Changes" silently succeeds on the
    // backend but the editor keeps the user's edits
    // visible — confusing, because the next save
    // round-trips them right back.
    window.dispatchEvent(
      new CustomEvent('files-reverted', {
        detail: { paths: [path] },
        bubbles: false,
      }),
    );
    host._showToast(`Discarded changes to ${path}`, 'success');
  } catch (err) {
    console.error('[files-tab] discard_changes failed', err);
    host._showToast(
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
export async function dispatchDelete(host, path) {
  const confirmed = host._confirm(
    `Delete ${path}? The file will be removed from the working tree.`,
  );
  if (!confirmed) return;
  try {
    const result = await host.rpcExtract(
      'Repo.delete_file',
      path,
    );
    if (isRestrictedError(result)) {
      host._showToast(result.reason || 'Restricted operation', 'warning');
      return;
    }
    await host._loadFileTree();
    // Deleted files are also removed from selection /
    // exclusion if they were there. Server's broadcast
    // via `filesChanged` will adjust selection; we
    // clear exclusion locally since there's no
    // broadcast for that today.
    if (host._excludedFiles.has(path)) {
      const next = new Set(host._excludedFiles);
      next.delete(path);
      host._applyExclusion(next, /* notifyServer */ true);
    }
    host._showToast(`Deleted ${path}`, 'success');
  } catch (err) {
    console.error('[files-tab] delete_file failed', err);
    host._showToast(
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
export function dispatchRename(host, path) {
  const picker = host._picker();
  if (!picker) return;
  picker.beginRename(path);
}

/**
 * Kick off an inline duplicate. Same pattern as
 * rename — picker shows an input pre-filled with the
 * source path so the user can edit the target
 * location. Commit fires `duplicate-committed`.
 */
export function dispatchDuplicate(host, path) {
  const picker = host._picker();
  if (!picker) return;
  picker.beginDuplicate(path);
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
 * `_toggleExclusion` path. Routes through the
 * L0-invalidation prompt — same pref logic as
 * shift+click.
 */
export function dispatchExclude(host, path) {
  if (host._excludedFiles.has(path)) return;
  const nextExcluded = new Set(host._excludedFiles);
  nextExcluded.add(path);
  host._applyExclusionWithPrompt(nextExcluded);
  // Deselect if currently selected — excluded and
  // selected can't coexist. Selection clear does
  // NOT route through the L0 prompt because it's a
  // selection change, not an exclusion change.
  if (host._selectedFiles.has(path)) {
    const nextSelected = new Set(host._selectedFiles);
    nextSelected.delete(path);
    host._applySelection(nextSelected, /* notifyServer */ true);
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
 *
 * Inclusion always invalidates L0 — the user wants
 * the file's structural block back in the aggregate
 * map immediately. No prompt, no preference check.
 */
export function dispatchInclude(host, path) {
  if (!host._excludedFiles.has(path)) return;
  const next = new Set(host._excludedFiles);
  next.delete(path);
  host._applyExclusion(
    next, /* notifyServer */ true, /* invalidateL0 */ true,
  );
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
 * dispatchFileAction only calls us with known values.
 *
 * Failures (binary file, missing file, RPC error)
 * surface as error toasts. Non-string content (e.g.,
 * if the backend changes shape) guards with a
 * defensive type check, mirroring duplicate's
 * content validation.
 */
export async function dispatchLoadInPanel(host, path, panel) {
  if (panel !== 'left' && panel !== 'right') return;
  try {
    const content = await host.rpcExtract(
      'Repo.get_file_content',
      path,
    );
    if (typeof content !== 'string') {
      host._showToast(
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
    // SVG files route to the SVG viewer's panel slots so
    // the user gets a rendered visual comparison rather
    // than raw XML text in the diff viewer. The SVG
    // viewer's loadPanel method takes the same
    // (content, panel, label) shape; the shell decides
    // which viewer the event targets based on event name.
    const isSvg = /\.svg$/i.test(basename);
    const eventName = isSvg ? 'load-svg-panel' : 'load-diff-panel';
    window.dispatchEvent(
      new CustomEvent(eventName, {
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
    host._showToast(
      `Failed to load ${path}: ${err?.message || err}`,
      'error',
    );
  }
}

// ---------------------------------------------------------------
// Directory-row dispatchers
// ---------------------------------------------------------------

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
export function collectDescendantFilesFromPath(host, dirPath) {
  if (typeof dirPath !== 'string') return [];
  const root = host._latestTree;
  if (!root || typeof root !== 'object') return [];
  // Special case — repo root has empty path. Collect
  // from the root itself without walking to find it.
  if (dirPath === '') {
    return collectDescendantsOfNode(root);
  }
  // Walk to the target directory.
  const target = findDirNode(root, dirPath);
  if (!target) return [];
  return collectDescendantsOfNode(target);
}

/**
 * Recursive helper — depth-first walk collecting
 * file paths. Directories contribute nothing of
 * their own; their descendants' file paths flow up.
 */
export function collectDescendantsOfNode(node) {
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
export function findDirNode(root, dirPath) {
  if (!root || typeof root !== 'object') return null;
  if (root.type === 'dir' && root.path === dirPath) return root;
  if (!Array.isArray(root.children)) return null;
  for (const child of root.children) {
    const found = findDirNode(child, dirPath);
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
export async function dispatchStageAll(host, dirPath) {
  const files = collectDescendantFilesFromPath(host, dirPath);
  if (files.length === 0) return;
  try {
    const result = await host.rpcExtract(
      'Repo.stage_files',
      files,
    );
    if (isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    await host._loadFileTree();
    const label = dirPath || 'repository';
    host._showToast(
      `Staged ${files.length} file${files.length === 1 ? '' : 's'} in ${label}`,
      'success',
    );
  } catch (err) {
    console.error('[files-tab] stage_files (batch) failed', err);
    host._showToast(
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
export async function dispatchUnstageAll(host, dirPath) {
  const files = collectDescendantFilesFromPath(host, dirPath);
  if (files.length === 0) return;
  try {
    const result = await host.rpcExtract(
      'Repo.unstage_files',
      files,
    );
    if (isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    await host._loadFileTree();
    const label = dirPath || 'repository';
    host._showToast(
      `Unstaged ${files.length} file${files.length === 1 ? '' : 's'} in ${label}`,
      'success',
    );
  } catch (err) {
    console.error('[files-tab] unstage_files (batch) failed', err);
    host._showToast(
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
 * The dir-case branch is in `onRenameCommitted`
 * (see ./inline-commits.js) — it inspects
 * `_latestTree` to decide which RPC to call.
 */
export function dispatchRenameDir(host, path, _name) {
  const picker = host._picker();
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
 * which `onNewFileCommitted` (in ./inline-commits.js)
 * catches.
 *
 * parentPath may be the empty string (repo root).
 */
export function dispatchNewFile(host, parentPath) {
  const picker = host._picker();
  if (!picker) return;
  picker.beginCreateFile(parentPath);
}

/**
 * Open the new-directory inline input inside
 * `parentPath`. Parallel to dispatchNewFile.
 * Commit fires `new-directory-committed`; the
 * orchestrator creates the directory by writing a
 * `.gitkeep` file inside it (git doesn't track
 * empty directories, so a placeholder file is
 * needed for the directory to exist in the next
 * commit).
 */
export function dispatchNewDirectory(host, parentPath) {
  const picker = host._picker();
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
 *
 * Routes through the L0-invalidation prompt — the
 * dialog body adapts to show the directory name
 * and file count when more than one file is being
 * excluded.
 */
export function dispatchExcludeAll(host, dirPath) {
  const files = collectDescendantFilesFromPath(host, dirPath);
  if (files.length === 0) return;
  const nextExcluded = new Set(host._excludedFiles);
  for (const p of files) nextExcluded.add(p);
  host._applyExclusionWithPrompt(nextExcluded);
  // Deselect any that were selected. Same rationale
  // as `dispatchExclude` — selection changes don't
  // route through the L0 prompt.
  const hadSelected = files.some((p) => host._selectedFiles.has(p));
  if (hadSelected) {
    const nextSelected = new Set(host._selectedFiles);
    for (const p of files) nextSelected.delete(p);
    host._applySelection(nextSelected, /* notifyServer */ true);
  }
}

/**
 * Remove every descendant file from the excluded
 * set. Returns them to the default index-only
 * state — does NOT auto-select, matching the
 * file-level Include behaviour. Always invalidates
 * L0 (no prompt) — same rationale as
 * dispatchInclude.
 */
export function dispatchIncludeAll(host, dirPath) {
  const files = collectDescendantFilesFromPath(host, dirPath);
  if (files.length === 0) return;
  const next = new Set(host._excludedFiles);
  for (const p of files) next.delete(p);
  host._applyExclusion(
    next, /* notifyServer */ true, /* invalidateL0 */ true,
  );
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/**
 * Check the result of an RPC call against the
 * restricted-caller shape. Used by every dispatcher
 * that calls a write RPC, since the same shape can
 * come back from any of them on a non-localhost
 * collab session.
 */
export function isRestrictedError(result) {
  return (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    result.error === 'restricted'
  );
}