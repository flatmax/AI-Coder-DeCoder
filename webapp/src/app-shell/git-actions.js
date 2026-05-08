// Git action helpers extracted from app-shell.js. These drive
// the header git buttons (copy diff, commit, reset) and the
// state flags that gate them (committing, streaming, review).

/**
 * Git action button dispatch from the file picker
 * header. The picker doesn't know the RPC call proxy,
 * so it fires a bubbling `git-action` window event
 * carrying {action: 'copy-diff'|'commit'|'reset'} and
 * we route to the existing handlers.
 */
export function onGitAction(host, event) {
  const action = event?.detail?.action;
  if (action === 'copy-diff') {
    host._onCopyDiff();
  } else if (action === 'commit') {
    host._onCommit();
  } else if (action === 'reset') {
    host._onResetToHead();
  }
}

/**
 * Clear the _committing flag when commit_all finishes.
 * ChatPanel has its own _onCommitResult for its own
 * state; this is the header's copy. Both listen to
 * the same window event independently.
 */
export function onCommitResultHeader(host) {
  host._committing = false;
}

/**
 * Follow review-started / review-ended window events to
 * drive the commit button's disabled state, and refresh
 * the active viewer so any open file picks up the new
 * HEAD/working-copy content produced by the backend's
 * soft reset (or its undo on exit).
 *
 * Without the refresh, an open file's diff would show
 * stale pre/post-reset content — the backend moved HEAD
 * and the index, but the viewer's cached model pair
 * still reflects the old state. The diff viewer's
 * refreshOpenFiles re-fetches both sides; the SVG
 * viewer does the same for any open SVG. The detail
 * shape isn't inspected — the event type alone tells us
 * the direction.
 */
export function onReviewStateChanged(host, event) {
  host._reviewActive = event.type === 'review-started';
  // Reuse the existing refresh path. _onFilesReverted
  // ignores detail.paths (refreshes all open viewers
  // unconditionally) so passing no event detail is fine.
  host._onFilesReverted({ detail: { paths: [] } });
}

/**
 * First chunk of a stream flips the gate. Subsequent
 * chunks are idempotent no-ops. We don't care which
 * request is streaming — the single-stream invariant
 * means "any chunk in flight" is equivalent to
 * "streaming active" for button-gating purposes.
 */
export function onStreamChunkHeader(host) {
  if (!host._streaming) host._streaming = true;
}

/**
 * Stream completion — whether natural, cancelled, or
 * errored — clears the gate. The backend fires
 * streamComplete on all three paths, so this is the
 * single reliable release point.
 */
export function onStreamCompleteHeader(host) {
  host._streaming = false;
}

/**
 * Copy the current working-tree diff (staged + unstaged)
 * to the clipboard. Uses Repo.get_staged_diff and
 * Repo.get_unstaged_diff, concatenates with a section
 * header for each. If both are empty, toasts "Nothing
 * to copy" rather than silently copying an empty string.
 */
export async function onCopyDiff(host) {
  if (!host.call) return;
  const getStaged = host.call['Repo.get_staged_diff'];
  const getUnstaged = host.call['Repo.get_unstaged_diff'];
  if (
    typeof getStaged !== 'function'
    || typeof getUnstaged !== 'function'
  ) {
    host._showToast('Diff not available', 'warning');
    return;
  }
  try {
    const [stagedRaw, unstagedRaw] = await Promise.all([
      getStaged(), getUnstaged(),
    ]);
    const unwrap = (raw) => {
      if (typeof raw === 'string') return raw;
      if (raw && typeof raw === 'object') {
        const keys = Object.keys(raw);
        if (keys.length === 1) {
          const v = raw[keys[0]];
          return typeof v === 'string' ? v : '';
        }
      }
      return '';
    };
    const staged = unwrap(stagedRaw);
    const unstaged = unwrap(unstagedRaw);
    const parts = [];
    if (staged.trim()) {
      parts.push('# === STAGED ===\n' + staged);
    }
    if (unstaged.trim()) {
      parts.push('# === UNSTAGED ===\n' + unstaged);
    }
    if (parts.length === 0) {
      host._showToast('No changes to copy', 'info');
      return;
    }
    const text = parts.join('\n\n');
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      host._showToast('Diff copied to clipboard', 'success');
    } else {
      host._showToast('Clipboard not available', 'warning');
    }
  } catch (err) {
    host._showToast(
      `Copy diff failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}

/**
 * Start a commit via LLMService.commit_all. The server
 * does staging → diff → LLM-generated message → commit
 * as a background task and broadcasts commit-result
 * when done. We just set _committing=true to disable
 * the button, and let commit-result flip it back.
 *
 * Disabled during review (read-only), during an
 * existing commit (reentrancy guard), and for
 * non-localhost callers.
 */
export async function onCommit(host) {
  if (!host.call) return;
  if (host._committing || host._reviewActive) return;
  if (host._streaming) return;
  if (!host._isLocalhost) return;
  const fn = host.call['LLMService.commit_all'];
  if (typeof fn !== 'function') {
    host._showToast('Commit not available', 'warning');
    return;
  }
  // Preflight: short-circuit on a clean tree so we don't
  // optimistically toast "Generating commit message…" and
  // burn a smaller-model RPC call before the backend's
  // own empty-diff guard fires. The backend's
  // commit_all_background runs stage_all first (which
  // stages untracked files too), so this check must use
  // is_clean rather than just inspecting staged+unstaged
  // diffs the way _onCopyDiff does — otherwise a repo
  // with only untracked files would pass the frontend
  // check, get staged by the backend, and produce a
  // non-empty diff the LLM would then summarise.
  // Repo.is_clean() matches the backend's view of "is
  // there anything stage_all could pick up".
  const isCleanFn = host.call['Repo.is_clean'];
  if (typeof isCleanFn === 'function') {
    try {
      const cleanRaw = await isCleanFn();
      let clean = cleanRaw;
      if (
        cleanRaw && typeof cleanRaw === 'object'
        && !Array.isArray(cleanRaw)
      ) {
        const keys = Object.keys(cleanRaw);
        if (keys.length === 1) clean = cleanRaw[keys[0]];
      }
      if (clean === true) {
        host._showToast('Nothing to commit', 'info');
        return;
      }
    } catch (_) {
      // is_clean failure shouldn't block commit — fall
      // through to the backend, which has its own guard.
    }
  }
  host._committing = true;
  try {
    const raw = await fn();
    let payload = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (keys.length === 1) {
        const inner = raw[keys[0]];
        if (inner && typeof inner === 'object') payload = inner;
      }
    }
    if (payload && payload.error) {
      host._committing = false;
      const reason = payload.reason || payload.error;
      host._showToast(`Commit failed: ${reason}`, 'warning');
      return;
    }
    // Server returns {status: "started"} — the actual
    // result arrives via the commit-result broadcast,
    // which is where _committing gets cleared.
    host._showToast('Generating commit message…', 'info');
  } catch (err) {
    host._committing = false;
    host._showToast(
      `Commit failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}

/**
 * Reset working tree + index to HEAD. Destructive —
 * requires confirmation. Disabled during an in-flight
 * commit and for non-localhost callers. Per
 * specs4/5-webapp/chat.md, review mode does NOT
 * disable reset — a user may legitimately want to
 * discard review-mode modifications.
 */
export async function onResetToHead(host) {
  if (!host.call) return;
  if (host._committing) return;
  if (host._streaming) return;
  if (!host._isLocalhost) return;
  const confirmed = window.confirm(
    'Reset working tree to HEAD?\n\nAll uncommitted changes (staged and unstaged) will be discarded. This cannot be undone.',
  );
  if (!confirmed) return;
  const fn = host.call['LLMService.reset_to_head'];
  if (typeof fn !== 'function') {
    host._showToast('Reset not available', 'warning');
    return;
  }
  try {
    const raw = await fn();
    let payload = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (keys.length === 1) {
        const inner = raw[keys[0]];
        if (inner && typeof inner === 'object') payload = inner;
      }
    }
    if (payload && payload.error) {
      const reason = payload.reason || payload.error;
      host._showToast(`Reset failed: ${reason}`, 'warning');
      return;
    }
    host._showToast('Reset to HEAD', 'success');
    // Refresh open viewers so the stale post-edit
    // content is replaced with the HEAD state.
    const diffViewer =
      host.shadowRoot?.querySelector('ac-diff-viewer');
    const svgViewer =
      host.shadowRoot?.querySelector('ac-svg-viewer');
    if (diffViewer?.refreshOpenFiles) {
      diffViewer.refreshOpenFiles().catch(() => {});
    }
    if (svgViewer?.refreshOpenFiles) {
      svgViewer.refreshOpenFiles().catch(() => {});
    }
  } catch (err) {
    host._showToast(
      `Reset failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}