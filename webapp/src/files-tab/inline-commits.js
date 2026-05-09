// Inline-input commit handlers.
//
// Four event handlers extracted from index.js. They
// fire when the user presses Enter on an inline input
// the picker rendered (rename, duplicate, new-file,
// new-directory). Each handler dispatches the
// appropriate backend RPC, refreshes the file tree,
// and toasts the user.
//
// The "begin" side of these flows lives in
// `./context-menu.js` (dispatchRename, dispatchDuplicate,
// dispatchNewFile, dispatchNewDirectory) — those open
// the inline input by calling picker.beginRename /
// beginDuplicate / beginCreateFile / beginCreateDirectory.
// The picker owns the inline-input lifecycle; this module
// only consumes the commit events.

import { isRestrictedError } from './context-menu.js';

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
 *
 * Inspects `_latestTree` to decide whether to call
 * `Repo.rename_file` or `Repo.rename_directory` —
 * the picker's beginRename is type-agnostic, so the
 * commit handler is where the discriminator lands.
 */
export async function onRenameCommitted(host, event) {
  const detail = event.detail || {};
  const sourcePath = detail.sourcePath;
  const targetName = detail.targetName;
  if (typeof sourcePath !== 'string' || !sourcePath) return;
  if (typeof targetName !== 'string' || !targetName) return;
  if (targetName.includes('/') || targetName.includes('\\')) {
    host._showToast(
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
  const sourceNode = findNodeByPath(host, sourcePath);
  const isDir = sourceNode?.type === 'dir';
  const rpcMethod = isDir ? 'Repo.rename_directory' : 'Repo.rename_file';
  try {
    const result = await host.rpcExtract(
      rpcMethod,
      sourcePath,
      targetPath,
    );
    if (isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    await host._loadFileTree();
    // Migrate selection and exclusion state to the
    // new path. For directory renames we migrate
    // every descendant path's prefix so nested
    // selections survive.
    if (isDir) {
      migrateSubtreeState(host, sourcePath, targetPath);
    } else {
      if (host._selectedFiles.has(sourcePath)) {
        const next = new Set(host._selectedFiles);
        next.delete(sourcePath);
        next.add(targetPath);
        host._applySelection(next, /* notifyServer */ true);
      }
      if (host._excludedFiles.has(sourcePath)) {
        const next = new Set(host._excludedFiles);
        next.delete(sourcePath);
        next.add(targetPath);
        host._applyExclusion(next, /* notifyServer */ true);
      }
    }
    host._showToast(
      `Renamed to ${targetName}`,
      'success',
    );
  } catch (err) {
    console.error('[files-tab] rename failed', err);
    host._showToast(
      `Failed to rename ${sourcePath}: ${err?.message || err}`,
      'error',
    );
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
export async function onDuplicateCommitted(host, event) {
  const detail = event.detail || {};
  const sourcePath = detail.sourcePath;
  const targetPath = detail.targetName;
  if (typeof sourcePath !== 'string' || !sourcePath) return;
  if (typeof targetPath !== 'string' || !targetPath) return;
  if (targetPath === sourcePath) return;
  try {
    // Read source content. The RPC envelope is
    // single-key; `rpcExtract` unwraps it.
    const content = await host.rpcExtract(
      'Repo.get_file_content',
      sourcePath,
    );
    // The RPC returns a plain string for text files.
    // Binary files raise a RepoError on the server
    // side, which surfaces here as a rejected
    // promise — caught by the outer try/catch.
    if (typeof content !== 'string') {
      host._showToast(
        `Cannot duplicate ${sourcePath}: unexpected content type`,
        'error',
      );
      return;
    }
    const result = await host.rpcExtract(
      'Repo.create_file',
      targetPath,
      content,
    );
    if (isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    await host._loadFileTree();
    host._showToast(
      `Duplicated to ${targetPath}`,
      'success',
    );
  } catch (err) {
    console.error('[files-tab] duplicate failed', err);
    host._showToast(
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
export async function onNewFileCommitted(host, event) {
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
    host._showToast(
      'File name cannot contain path separators.',
      'warning',
    );
    return;
  }
  const targetPath = parentPath ? `${parentPath}/${name}` : name;
  try {
    const result = await host.rpcExtract(
      'Repo.create_file',
      targetPath,
      '',
    );
    if (isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    await host._loadFileTree();
    host._showToast(`Created ${targetPath}`, 'success');
  } catch (err) {
    console.error('[files-tab] create_file failed', err);
    host._showToast(
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
export async function onNewDirectoryCommitted(host, event) {
  const detail = event.detail || {};
  const parentPath = detail.parentPath;
  const name = detail.name;
  if (typeof parentPath !== 'string') return;
  if (typeof name !== 'string' || !name) return;
  if (name.includes('/') || name.includes('\\')) {
    // Path separators rejected — see the equivalent
    // check in onNewFileCommitted.
    host._showToast(
      'Directory name cannot contain path separators.',
      'warning',
    );
    return;
  }
  const dirPath = parentPath ? `${parentPath}/${name}` : name;
  const keepPath = `${dirPath}/.gitkeep`;
  try {
    const result = await host.rpcExtract(
      'Repo.create_file',
      keepPath,
      '',
    );
    if (isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    await host._loadFileTree();
    host._showToast(`Created directory ${dirPath}`, 'success');
  } catch (err) {
    console.error(
      '[files-tab] create_file (gitkeep) failed',
      err,
    );
    host._showToast(
      `Failed to create ${dirPath}: ${err?.message || err}`,
      'error',
    );
  }
}

// ---------------------------------------------------------------
// Tree-walking helpers
// ---------------------------------------------------------------

/**
 * Locate any tree node (file OR directory) by path.
 * Used by rename commit to distinguish file vs dir
 * source so we can route to the correct RPC.
 * Returns null when not found.
 */
export function findNodeByPath(host, path) {
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
  return walk(host._latestTree);
}

/**
 * Migrate every selection and exclusion entry
 * whose path lives under `oldDir` to the
 * equivalent path under `newDir`. Called after a
 * successful directory rename so that per-file
 * state survives the move.
 */
export function migrateSubtreeState(host, oldDir, newDir) {
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
  const nextSelected = migrateSet(host._selectedFiles);
  if (nextSelected) {
    host._applySelection(nextSelected, /* notifyServer */ true);
  }
  const nextExcluded = migrateSet(host._excludedFiles);
  if (nextExcluded) {
    host._applyExclusion(nextExcluded, /* notifyServer */ true);
  }
}