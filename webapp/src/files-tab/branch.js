// Branch menu + branch switching handlers.
//
// Two handlers extracted from index.js:
//
//   - `branchMenuRequested` — picker dispatched
//     `branch-menu-requested` when the user clicked
//     the branch pill. Fetches the full branch list
//     and hands it back to the picker via
//     `populateBranchMenu`.
//
//   - `branchSwitchRequested` — picker dispatched
//     `branch-switch-requested` after the user picked
//     a branch from the popover. Runs a clean-tree
//     check, then calls `Repo.checkout_branch`. On
//     success, reloads the file tree so the picker
//     reflects the new branch.
//
// Both functions take the host (FilesTab instance) as
// their first arg. The host's `_isRestrictedError`,
// `_showToast`, `_loadFileTree`, and `_picker`
// helpers stay on the class — extracting them too
// would be churn for no readability gain.

/**
 * Picker dispatched `branch-menu-requested` — the
 * user clicked the branch pill. Fetch the full
 * branch list (local + remote) and hand it back to
 * the picker via `populateBranchMenu`. Errors
 * surface as toasts but don't close the menu — the
 * picker's "Loading…" state falls through to
 * "No branches" which is still informative.
 */
export async function onBranchMenuRequested(host) {
  if (!host.rpcConnected) return;
  try {
    const branches = await host.rpcExtract(
      'Repo.list_all_branches',
    );
    const picker = host._picker();
    if (picker) {
      picker.populateBranchMenu(
        Array.isArray(branches) ? branches : [],
      );
    }
  } catch (err) {
    console.error('[files-tab] list_all_branches failed', err);
    host._showToast(
      `Failed to load branches: ${err?.message || err}`,
      'error',
    );
    const picker = host._picker();
    if (picker) picker.populateBranchMenu([]);
  }
}

/**
 * Picker dispatched `branch-switch-requested` —
 * the user picked a branch from the popover.
 * Detail: `{name, is_remote}`. Dirty-tree check
 * runs before the RPC so users get a precise
 * toast rather than a generic git error, even
 * though the backend also refuses dirty trees
 * (belt-and-braces).
 *
 * On success we reload the file tree so the
 * picker reflects the new branch. The backend's
 * post-write callback fires `filesChanged`-adjacent
 * behaviour via LLMService refreshes, but the tree
 * RPC is cheap and a fresh call keeps the UI
 * authoritative.
 */
export async function onBranchSwitchRequested(host, event) {
  const name = event.detail?.name;
  if (typeof name !== 'string' || !name) return;
  if (!host.rpcConnected) return;
  // Clean-tree gate. The backend also checks, but
  // this produces a clearer toast with no RPC
  // round-trip for the common dirty-tree case.
  try {
    const clean = await host.rpcExtract('Repo.is_clean');
    if (!clean) {
      host._showToast(
        'Working tree has uncommitted changes. ' +
          'Commit, stash, or discard them before ' +
          'switching branches.',
        'warning',
      );
      return;
    }
  } catch (err) {
    // If the probe fails, defer to the backend's
    // own check — don't block the switch on a
    // probe failure.
    console.warn('[files-tab] is_clean probe failed', err);
  }
  try {
    const result = await host.rpcExtract(
      'Repo.checkout_branch',
      name,
    );
    if (host._isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    if (result && typeof result === 'object' && result.error) {
      host._showToast(
        `Switch failed: ${result.error}`,
        'error',
      );
      return;
    }
    const landedOn =
      result && typeof result === 'object' && result.branch
        ? result.branch
        : name;
    host._showToast(`Switched to ${landedOn}`, 'success');
    await host._loadFileTree();
  } catch (err) {
    console.error('[files-tab] checkout_branch failed', err);
    host._showToast(
      `Switch failed: ${err?.message || err}`,
      'error',
    );
  }
}