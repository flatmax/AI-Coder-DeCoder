// Review lifecycle, selector modal, and history
// graph modal.
//
// Three event surfaces, all related to code review:
//
//   1. Lifecycle — `review-started` / `review-ended`
//      window events, plus the `exit-review` request
//      from the picker banner.
//   2. Selector modal — opened from the picker's
//      Review button. User picks a base commit from
//      a commit graph, confirms, and start_review
//      fires.
//   3. History graph modal — opened from the picker's
//      "View graph" button during an active review.
//      Read-only graph with the review's base + tip
//      highlighted; clicking a commit loads its diff
//      into the diff viewer's left panel.
//
// Cross-module dependencies:
//
//   - host._loadFileTree (tree-loader) for refresh
//     after review state changes
//   - host._applyInitialAutoSelect (tree-loader) for
//     auto-selecting changed files on review entry
//   - host._isRestrictedError, host._showToast,
//     host._picker, host._chat — class-level helpers
//
// State on host: `_reviewState`, `_reviewSelector`,
// `_reviewGraphModal` are reactive properties (see
// properties block in index.js). Mutations here go
// through plain assignment — Lit picks up the change
// via the property descriptor's set hook.

import { html } from 'lit';

// ---------------------------------------------------------------
// Lifecycle handlers
// ---------------------------------------------------------------

/**
 * Enter review mode. Store the full state dict and
 * push to the picker so the banner appears. The
 * backend's `start_review` has already cleared its
 * own `_selected_files`, but we mirror the clear
 * locally (defense-in-depth, per
 * specs4/4-features/code-review.md) so the UI
 * reflects the empty selection without waiting for
 * the server's `filesChanged` broadcast.
 *
 * Detail shape matches backend's `get_review_state()`:
 * `{active: true, branch, base_commit, branch_tip,
 *   original_branch, commits, changed_files, stats}`.
 */
export async function onReviewStarted(host, event) {
  const state = event.detail || {};
  host._reviewState = state;
  // Clear selection — review starts with a clean slate.
  // Direct-update pattern (not `applySelection` with
  // `notifyServer=true`) because the server has
  // already cleared on its side; round-tripping would
  // be redundant.
  host._selectedFiles = new Set();
  const picker = host._picker();
  if (picker) {
    picker.reviewState = state;
    picker.selectedFiles = new Set();
    picker.requestUpdate();
  }
  const chat = host._chat();
  if (chat) {
    chat.selectedFiles = [];
    chat.requestUpdate();
  }
  // Refresh file tree so the picker reflects the
  // staged state produced by the soft reset. Wait
  // for the fetch to settle before the auto-select
  // pass below — it needs `_latestStatusData` to be
  // populated with the review's staged files.
  await host._loadFileTree();
  // Auto-select every file the review touches so the
  // user doesn't have to tick them individually to
  // get diffs into the LLM's context. The review's
  // soft-reset puts every branch-tip change into the
  // staged set, which `_loadFileTree` mapped into
  // `_latestStatusData.staged`. Reuse the same
  // union-with-existing-selection logic that the
  // first-load path uses — it handles the "expand
  // ancestors so the files are visible" step too.
  //
  // We skip the `_initialAutoSelect` flag entirely
  // here: that flag governs the first-ever tree load
  // (so subsequent reloads don't undo user
  // deselections). Review entry is a distinct event
  // — the user explicitly asked to review, and every
  // review starts from an empty selection cleared
  // above — so re-applying the auto-select rule is
  // expected, not a regression.
  host._applyInitialAutoSelect();
}

/**
 * Exit review mode. Clear local state and push null
 * to the picker so the banner disappears. Selection
 * is NOT cleared here — the server's `end_review`
 * doesn't touch `_selected_files`, and the user may
 * want to continue with the files they had in review
 * context. If the server's selection broadcast fires
 * later, the normal `files-changed` handler picks it
 * up.
 */
export function onReviewEnded(host) {
  host._reviewState = null;
  const picker = host._picker();
  if (picker) {
    picker.reviewState = null;
    picker.requestUpdate();
  }
  // Refresh file tree to reflect the restored
  // post-review state (HEAD reattached, staging
  // cleared).
  host._loadFileTree();
}

/**
 * User clicked the exit button on the review banner.
 * Call the server's `end_review` RPC; the server
 * broadcasts `reviewEnded` which comes back through
 * `onReviewEnded` to do the UI cleanup. No optimistic
 * local update — if the server rejects (e.g.
 * non-localhost caller), the banner should stay
 * visible so the user sees the error state.
 */
export async function onExitReview(host) {
  if (!host.rpcConnected) return;
  try {
    const result = await host.rpcExtract(
      'LLMService.end_review',
    );
    if (host._isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    // Partial-exit case — server couldn't reattach
    // the original branch. State was cleared on
    // the server regardless; surface the error so
    // the user knows git is in an unusual state.
    if (result && result.status === 'partial' && result.error) {
      host._showToast(
        `Review exited with warning: ${result.error}`,
        'warning',
      );
      return;
    }
    // Success — the server's `reviewEnded` broadcast
    // will trigger `onReviewEnded`.
  } catch (err) {
    console.error('[files-tab] end_review failed', err);
    host._showToast(
      `Failed to exit review: ${err?.message || err}`,
      'error',
    );
  }
}

// ---------------------------------------------------------------
// Review selector modal
// ---------------------------------------------------------------

/**
 * Handle the picker's `open-review-selector` event.
 * Runs the clean-tree gate first so dirty working
 * trees bail out with a clear message instead of
 * producing a modal that leads to an RPC failure.
 * Then opens the modal — the commit-graph component
 * fetches its own data via the RPC call proxy.
 */
export async function onOpenReviewSelector(host) {
  try {
    const readiness = await host.rpcExtract(
      'LLMService.check_review_ready',
    );
    if (readiness && readiness.clean === false) {
      const msg = readiness.message
        || 'Working tree must be clean to start a review.';
      host._showToast(msg, 'warning');
      return;
    }
  } catch (err) {
    console.error('[files-tab] check_review_ready failed', err);
    host._showToast(
      `Review check failed: ${err?.message || err}`,
      'error',
    );
    return;
  }
  host._reviewSelector = {
    selected: null,
    starting: false,
  };
}

/**
 * Commit-graph fired commit-selected — the user
 * clicked a commit (optionally chose a branch via
 * the disambiguation popover). Store the selection
 * so the Start Review action bar can display the
 * summary and fire start_review on confirm.
 *
 * Detail: `{commit, branch}`. `branch` may be null
 * when no branch in the loaded history reaches the
 * commit — the action bar handles that by disabling
 * the Start button.
 */
export function onCommitSelectedFromGraph(host, event) {
  if (!host._reviewSelector) return;
  const detail = event.detail || {};
  if (!detail.commit) return;
  host._reviewSelector = {
    ...host._reviewSelector,
    selected: {
      commit: detail.commit,
      branch: detail.branch || null,
    },
  };
}

/**
 * Graph fired graph-error — surface as a toast but
 * keep the modal open so the user can retry or close
 * it manually.
 */
export function onGraphError(host, event) {
  const message = event.detail?.message || 'Graph load failed';
  host._showToast(`Commit graph: ${message}`, 'error');
}

/**
 * Close the modal — user clicked the backdrop, the
 * close button, or pressed Escape. No RPC cleanup
 * needed; an in-flight fetch's resolve will find
 * `_reviewSelector` null and skip its update.
 */
export function closeReviewSelector(host) {
  host._reviewSelector = null;
}

/**
 * Start a review using the currently-selected commit
 * from the graph. The confirm button in the action
 * bar triggers this.
 *
 * `selected.branch` may be null when the graph walk
 * couldn't find any branch reaching the commit — the
 * confirm button is disabled in that case so this
 * method is only reachable when both fields are
 * populated. Defensive guard kept anyway.
 *
 * Backend's `start_review(branch, base_commit)`
 * accepts any commit SHA as the base — not just
 * branch tips — so the user can scroll down the
 * graph and pick an older commit to widen the review
 * scope.
 */
export async function confirmStartReview(host) {
  if (!host._reviewSelector) return;
  const selected = host._reviewSelector.selected;
  if (!selected || !selected.branch || !selected.commit) return;
  const branch = selected.branch.name;
  const baseCommit = selected.commit.sha;
  if (typeof branch !== 'string' || !branch) return;
  if (typeof baseCommit !== 'string' || !baseCommit) return;
  host._reviewSelector = {
    ...host._reviewSelector,
    starting: true,
  };
  try {
    const result = await host.rpcExtract(
      'LLMService.start_review',
      branch,
      baseCommit,
    );
    if (host._isRestrictedError(result)) {
      host._showToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      if (host._reviewSelector) {
        host._reviewSelector = {
          ...host._reviewSelector,
          starting: false,
        };
      }
      return;
    }
    if (result && result.error) {
      host._showToast(
        `Start review failed: ${result.error}`,
        'error',
      );
      if (host._reviewSelector) {
        host._reviewSelector = {
          ...host._reviewSelector,
          starting: false,
        };
      }
      return;
    }
    closeReviewSelector(host);
  } catch (err) {
    console.error('[files-tab] start_review failed', err);
    host._showToast(
      `Start review failed: ${err?.message || err}`,
      'error',
    );
    if (host._reviewSelector) {
      host._reviewSelector = {
        ...host._reviewSelector,
        starting: false,
      };
    }
  }
}

export function onReviewBackdropClick(host, event) {
  // Only close when the user clicks the backdrop
  // itself — clicks that bubbled from inside the
  // modal (buttons, rows) shouldn't close.
  if (event.target === event.currentTarget) {
    closeReviewSelector(host);
  }
}

export function renderReviewSelectorModal(host) {
  const state = host._reviewSelector;
  if (!state) return '';
  const selected = state.selected;
  const starting = !!state.starting;
  const canStart =
    !!selected && !!selected.branch && !!selected.commit && !starting;
  return html`
    <div
      class="review-modal-backdrop"
      @click=${(e) => onReviewBackdropClick(host, e)}
    >
      <div
        class="review-modal"
        role="dialog"
        aria-label="Start code review"
      >
        <div class="review-modal-header">
          <span class="review-modal-title">
            🔍 Start code review
          </span>
          <button
            class="review-modal-close"
            title="Close"
            aria-label="Close review selector"
            @click=${() => closeReviewSelector(host)}
          >✕</button>
        </div>
        <div class="review-modal-hint">
          Click a commit to select it as the review base.
          The review will compare the chosen branch tip
          against its merge-base with your current
          branch (or main / master).
        </div>
        <ac-commit-graph
          .rpcCall=${(method, ...args) => host.rpcExtract(method, ...args)}
          @commit-selected=${(e) => onCommitSelectedFromGraph(host, e)}
          @graph-error=${(e) => onGraphError(host, e)}
        ></ac-commit-graph>
        <div class="review-action-bar">
          <div class="review-action-summary">
            ${selected
              ? html`
                  Reviewing
                  <strong>${selected.branch?.name || '(no branch)'}</strong>
                  from base
                  <strong>${selected.commit.short_sha
                    || selected.commit.sha?.slice(0, 7)}</strong>
                `
              : html`<em>Click a commit to select it as the review base.</em>`}
          </div>
          <button
            class="review-start-btn"
            ?disabled=${!canStart}
            @click=${() => confirmStartReview(host)}
          >${starting ? 'Starting…' : 'Start review'}</button>
        </div>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------
// Review history graph modal
// ---------------------------------------------------------------

/**
 * Open the review history graph modal. Fired when
 * the picker's "View graph" button is clicked during
 * an active review. No-op when review isn't active
 * (defensive — the button is only rendered during
 * review, but guard against a stale dispatch racing
 * with an exit).
 */
export function onOpenReviewGraph(host) {
  if (!host._reviewState || !host._reviewState.active) {
    return;
  }
  host._reviewGraphModal = {};
}

export function closeReviewGraphModal(host) {
  host._reviewGraphModal = null;
}

export function onReviewGraphBackdropClick(host, event) {
  if (event.target === event.currentTarget) {
    closeReviewGraphModal(host);
  }
}

/**
 * Route a commit-inspected event from the read-only
 * graph to the diff viewer's ad-hoc panel. Shows the
 * commit's diff against its first parent on the
 * left, leaves the right panel with the current
 * branch-tip content so the user can compare the
 * commit's effect against their current view.
 *
 * Parent-diff is the conventional git-tool default
 * (Sourcetree, GitKraken) for "what did this commit
 * introduce?". A commit with no parent (root commit)
 * degrades to an empty-left panel — the diff viewer
 * shows the commit's full content as additions,
 * which is visually accurate.
 */
export async function onCommitInspectedFromGraph(host, event) {
  const commit = event.detail?.commit;
  if (!commit || typeof commit.sha !== 'string') return;
  if (!host.rpcConnected) return;
  // Close the modal first so the diff viewer has
  // focus and isn't competing with the backdrop.
  // The fetch runs afterward and populates the
  // panel when it lands.
  closeReviewGraphModal(host);
  try {
    // Without a bespoke RPC, we fall back to
    // `get_diff_to_branch(commit_sha)` which produces
    // the diff between that commit and the working
    // tree. That's not "this commit only" — it
    // includes every change between the commit and
    // now. Good enough for inspection during review
    // (user is asking "what did this commit touch?"
    // in the context of the feature branch), and
    // keeps the feature shippable without a backend
    // change.
    const result = await host.rpcExtract(
      'Repo.get_diff_to_branch',
      commit.sha,
    );
    if (result && typeof result === 'object' && result.error) {
      host._showToast(
        `Commit inspect failed: ${result.error}`,
        'warning',
      );
      return;
    }
    const diff =
      result && typeof result === 'object'
        ? result.diff || ''
        : typeof result === 'string' ? result : '';
    if (!diff) {
      host._showToast(
        'No diff available for that commit',
        'info',
      );
      return;
    }
    const label = `commit ${commit.short_sha || commit.sha.slice(0, 7)}`;
    window.dispatchEvent(
      new CustomEvent('load-diff-panel', {
        detail: {
          content: diff,
          panel: 'left',
          label,
        },
        bubbles: false,
      }),
    );
  } catch (err) {
    console.error('[files-tab] commit-inspected failed', err);
    host._showToast(
      `Commit inspect failed: ${err?.message || err}`,
      'error',
    );
  }
}

export function renderReviewGraphModal(host) {
  if (!host._reviewGraphModal) return '';
  const state = host._reviewState || {};
  // Build the highlight map from the current review
  // state. Base is the merge-base (parent_commit),
  // tip is the branch tip being reviewed.
  const highlighted = {
    base: state.parent_commit || null,
    tip: state.branch_tip || null,
  };
  const branch = state.branch || '(unknown)';
  const baseShort = (state.parent_commit || '').slice(0, 7);
  const tipShort = (state.branch_tip || '').slice(0, 7);
  return html`
    <div
      class="review-modal-backdrop"
      @click=${(e) => onReviewGraphBackdropClick(host, e)}
    >
      <div
        class="review-modal"
        role="dialog"
        aria-label="Review history graph"
      >
        <div class="review-modal-header">
          <span class="review-modal-title">
            🔍 Review history: ${branch}
          </span>
          <button
            class="review-modal-close"
            title="Close"
            aria-label="Close graph"
            @click=${() => closeReviewGraphModal(host)}
          >✕</button>
        </div>
        <div class="review-modal-hint">
          Amber ring = review base (${baseShort});
          green ring = branch tip (${tipShort}).
          Click any commit to see its diff in the left panel.
        </div>
        <ac-commit-graph
          .rpcCall=${(method, ...args) => host.rpcExtract(method, ...args)}
          .readOnly=${true}
          .highlightedCommits=${highlighted}
          includeRemote
          @commit-inspected=${(e) => onCommitInspectedFromGraph(host, e)}
          @graph-error=${(e) => onGraphError(host, e)}
        ></ac-commit-graph>
      </div>
    </div>
  `;
}