// Exclusion state — apply / send / dialog / event
// handlers.
//
// Extracted from index.js. Mirrors selection.js's
// shape: `applyExclusion` is the single mutation
// entry point, `applyExclusionWithPrompt` is the
// wrapper for user-driven exclusion flows that may
// open the L0-invalidation confirmation dialog.
//
// The L0 dialog renders here because it's tightly
// coupled to the exclusion flow — its three buttons
// (Apply / Defer / Cancel) all resolve via
// `resolveL0ExcludeDialog` which calls
// `applyExclusion` with the appropriate
// `invalidateL0` flag.
//
// Tab-aware RPC dispatch follows selection.js's
// pattern: main → set_excluded_index_files(files,
// invalidateL0), agent tab →
// set_agent_excluded_index_files(agent_id, files).
// The agent RPC drops the L0 flag — agent
// ContextManagers share the orchestrator's L0 prefix
// and can't invalidate it directly.

import { html } from 'lit';

import { parseAgentTabId } from '../chat-panel/index.js';

import {
  _L0_EXCLUDE_PREF_ALWAYS,
  _L0_EXCLUDE_PREF_ASK,
  _L0_EXCLUDE_PREF_KEY,
  _L0_EXCLUDE_PREF_NEVER,
} from './constants.js';
import { _saveL0ExcludePref } from './helpers.js';

/**
 * Apply a new exclusion set. Single entry point so
 * the set-equality short-circuit and the
 * direct-update push to the picker are uniform.
 *
 * `invalidateL0` flows to the main-tab RPC; agent
 * tabs drop it.
 */
export function applyExclusion(
  host, newExcluded, notifyServer, invalidateL0 = false,
) {
  // Fast-path no-op when the set hasn't actually
  // changed. Prevents loopback from the server
  // broadcast (when collab mode lands this for real)
  // doing another round-trip for our own update.
  if (host._setsEqual(host._excludedFiles, newExcluded)) return;
  host._excludedFiles = newExcluded;
  // Direct-update pattern. Assign to picker prop then
  // requestUpdate.
  const picker = host._picker();
  if (picker) {
    picker.excludedFiles = new Set(newExcluded);
    picker.requestUpdate();
  }
  if (notifyServer) {
    sendExclusionToServer(
      host, Array.from(newExcluded), invalidateL0,
    );
  }
}

/**
 * Apply an exclusion with the L0-invalidation prompt.
 *
 * Wraps `applyExclusion` for user-driven exclusion
 * paths: the picker's shift+click handler and the
 * context-menu Exclude / Exclude-all actions.
 * Inclusion paths skip this — they always pass
 * `invalidateL0=true` directly because the user wants
 * the file's structural block back in the map
 * immediately.
 *
 * Behaviour driven by the stored preference:
 *
 * - 'always' → invalidate L0 immediately, no prompt
 * - 'never' → defer L0 invalidation, no prompt
 * - 'ask' (default) → open the dialog; user's choice
 *   determines the flag and may also persist the
 *   preference for next time
 *
 * Set-equality short-circuit happens BEFORE the prompt
 * — there's no point asking about an exclusion change
 * that's a no-op.
 *
 * The added-paths list is computed here so the dialog
 * body can name what's being excluded ("foo.py" vs.
 * "3 files in src/"). Empty list when the diff is a
 * pure removal — shouldn't reach this method since
 * removals are inclusions, but defensive against a
 * future caller that passes a smaller set than the
 * current one.
 */
export function applyExclusionWithPrompt(host, nextExcluded) {
  if (host._setsEqual(host._excludedFiles, nextExcluded)) return;
  // Compute newly-excluded paths (set difference). If
  // the diff has no additions, treat it as a plain
  // exclusion-change call without prompt — there's
  // nothing the user is opting into invalidating.
  const addedPaths = [];
  for (const p of nextExcluded) {
    if (!host._excludedFiles.has(p)) addedPaths.push(p);
  }
  if (addedPaths.length === 0) {
    applyExclusion(
      host, nextExcluded, /* notifyServer */ true, /* invalidateL0 */ false,
    );
    return;
  }
  // Pref-driven dispatch.
  if (host._l0ExcludePref === _L0_EXCLUDE_PREF_ALWAYS) {
    applyExclusion(host, nextExcluded, true, true);
    return;
  }
  if (host._l0ExcludePref === _L0_EXCLUDE_PREF_NEVER) {
    applyExclusion(host, nextExcluded, true, false);
    return;
  }
  // 'ask' — open the dialog. Pending exclusion sits
  // in dialog state until the user picks; the user
  // can also cancel, which discards the pending
  // change entirely (the picker's optimistic state
  // will reconcile on the next render via the
  // direct-update path).
  host._l0ExcludeDialog = {
    nextExcluded,
    addedPaths,
  };
}

/**
 * Resolve an open L0-exclude dialog. Called by the
 * three button handlers (Apply now, Defer, Cancel).
 *
 * `choice` is one of:
 *   - 'invalidate' → apply with invalidateL0=true
 *   - 'defer' → apply with invalidateL0=false
 *   - 'cancel' → discard the pending exclusion
 *
 * `remember` is the "Don't ask again" checkbox state.
 * Only meaningful for invalidate / defer choices —
 * cancel never persists a preference.
 *
 * After resolving, the picker's checkbox state may be
 * stale (the user shift-clicked, the picker
 * optimistically updated, then the user cancelled).
 * The direct-update inside `applyExclusion` re-pushes
 * the canonical `excludedFiles` Set, which causes the
 * picker to re-render with the correct state.
 */
export function resolveL0ExcludeDialog(host, choice, remember) {
  const dialog = host._l0ExcludeDialog;
  host._l0ExcludeDialog = null;
  if (!dialog) return;
  if (choice === 'cancel') {
    // Re-push current excluded set to the picker so
    // its visual state reconciles with the unchanged
    // authoritative state. Without this, a
    // shift-click that opened the dialog and was
    // cancelled could leave the picker showing a
    // ticked checkbox even though our set is
    // unchanged.
    const picker = host._picker();
    if (picker) {
      picker.excludedFiles = new Set(host._excludedFiles);
      picker.requestUpdate();
    }
    return;
  }
  const invalidate = choice === 'invalidate';
  if (remember) {
    const pref = invalidate
      ? _L0_EXCLUDE_PREF_ALWAYS
      : _L0_EXCLUDE_PREF_NEVER;
    host._l0ExcludePref = pref;
    _saveL0ExcludePref(pref);
  }
  applyExclusion(host, dialog.nextExcluded, true, invalidate);
}

/**
 * Reset the stored L0-exclude preference back to
 * 'ask'. Exposed so the Settings tab can offer a
 * "reset preferences" affordance — users who picked
 * "always" once and now want the dialog back have an
 * escape hatch.
 */
export function resetL0ExcludePref(host) {
  host._l0ExcludePref = _L0_EXCLUDE_PREF_ASK;
  try {
    localStorage.removeItem(_L0_EXCLUDE_PREF_KEY);
  } catch (_) {}
}

/**
 * Send the new exclusion to the backend. Same
 * dispatch rule as selection.js's
 * `sendSelectionToServer`. Per
 * specs4/5-webapp/agent-browser.md § File Picker
 * Scope: "Excluded-files state is also per-tab."
 *
 * `invalidateL0` flows through to the main-tab RPC as
 * a third argument. Agent tabs don't accept it —
 * agent ContextManagers share the orchestrator's L0
 * per the parallel-agents design, so an agent-tab
 * exclusion can't invalidate the orchestrator's L0
 * cache directly. (The orchestrator's own next L0-
 * invalidation event refreshes when needed.) We
 * silently drop the flag for agent tabs rather than
 * raise — agent exclusions are still applied via the
 * per-agent tracker; only the L0 refresh decision
 * differs.
 */
export async function sendExclusionToServer(
  host, files, invalidateL0 = false,
) {
  const agentTag = parseAgentTabId(host._activeTabId);
  try {
    let result;
    if (agentTag) {
      // agentTag IS the agent's LLM-chosen id —
      // matches the backend's flat registry key.
      result = await host.rpcExtract(
        'LLMService.set_agent_excluded_index_files',
        agentTag,
        files,
      );
    } else {
      result = await host.rpcExtract(
        'LLMService.set_excluded_index_files',
        files,
        invalidateL0,
      );
    }
    if (
      result &&
      typeof result === 'object' &&
      !Array.isArray(result)
    ) {
      if (result.error === 'restricted') {
        host._showToast(
          result.reason || 'Restricted operation',
          'warning',
        );
      } else if (result.error === 'agent not found') {
        host._showToast(
          'Agent tab no longer available on server',
          'warning',
        );
      }
    }
  } catch (err) {
    console.error(
      '[files-tab] set_excluded_index_files failed', err,
    );
    host._showToast(
      `Failed to update exclusion: ${err?.message || err}`,
      'error',
    );
  }
}

/**
 * Picker emits `exclusion-changed` when the user
 * shift+clicks a file checkbox or a directory
 * checkbox (the latter applies to every descendant
 * file). The event carries an array of excluded
 * paths; we update our authoritative state, push to
 * the picker via direct-update, and notify the
 * server.
 *
 * User-driven exclusion goes through the L0
 * invalidation prompt — see `applyExclusionWithPrompt`
 * for the pref-driven dispatch. Pure removals (the
 * user un-excluded a file via shift+click on an
 * already-excluded entry) skip the prompt because
 * there's nothing for the user to opt into.
 */
export function onExclusionChanged(host, event) {
  const incoming = event.detail?.excludedFiles;
  if (!Array.isArray(incoming)) return;
  applyExclusionWithPrompt(host, new Set(incoming));
}

// ---------------------------------------------------------------
// L0 confirmation dialog rendering
// ---------------------------------------------------------------

/**
 * Render the L0-exclude confirmation dialog when
 * `_l0ExcludeDialog` is non-null. Three buttons:
 *
 *   - Apply now (primary) — invalidate L0
 *     immediately, full cache rewrite
 *   - Defer (secondary) — leave L0 cached as-is;
 *     the next mode switch / cross-ref toggle /
 *     manual rebuild / restart will refresh
 *   - Cancel — discard the pending exclusion
 *
 * Plus a "Don't ask again" checkbox that persists
 * the user's choice as the new default for both
 * exclusion paths. Cancel doesn't persist anything —
 * it's a "I changed my mind" gesture.
 */
export function renderL0ExcludeDialog(host) {
  const dialog = host._l0ExcludeDialog;
  if (!dialog) return '';
  const count = dialog.addedPaths.length;
  const target =
    count === 1
      ? dialog.addedPaths[0]
      : `${count} files`;
  return html`
    <div
      class="l0-dialog-backdrop"
      @click=${(e) => onL0DialogBackdropClick(host, e)}
      @keydown=${(e) => onL0DialogKeyDown(host, e)}
    >
      <div
        class="l0-dialog"
        role="dialog"
        aria-label="Confirm L0 cache invalidation"
        tabindex="0"
        @click=${(e) => e.stopPropagation()}
      >
        <div class="l0-dialog-title">
          Invalidate L0 cache?
        </div>
        <div class="l0-dialog-body">
          Excluding <strong>${target}</strong> from the
          index can either invalidate the L0 cache
          immediately (a full cache rewrite — typically
          100,000+ tokens) or leave the cached aggregate
          map stale until the next L0-invalidating event
          (mode switch, cross-reference toggle, manual
          rebuild, restart).
          <br /><br />
          <strong>Apply now</strong> if you want the
          exclusion to take effect on the next request
          and don't mind the cache cost. <strong>Defer</strong>
          if you'd rather not pay the cache cost yet —
          the LLM may still see ${target} in the
          structural map until the cache refreshes
          naturally.
        </div>
        <label class="l0-dialog-remember">
          <input
            type="checkbox"
            data-l0-remember
          />
          Don't ask again — remember this choice for
          future exclusions
        </label>
        <div class="l0-dialog-actions">
          <button
            class="l0-dialog-btn cancel"
            @click=${() => onL0DialogCancel(host)}
          >Cancel</button>
          <button
            class="l0-dialog-btn secondary"
            @click=${() => onL0DialogDefer(host)}
          >Defer</button>
          <button
            class="l0-dialog-btn primary"
            @click=${() => onL0DialogApplyNow(host)}
          >Apply now</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Read the "Don't ask again" checkbox state from the
 * rendered dialog. Returns false when the dialog
 * isn't mounted or the checkbox can't be queried —
 * defensive against a race between button click and
 * dialog close.
 */
function readL0DialogRememberFlag(host) {
  const cb = host.shadowRoot?.querySelector(
    '.l0-dialog input[data-l0-remember]',
  );
  return !!(cb && cb.checked);
}

export function onL0DialogApplyNow(host) {
  const remember = readL0DialogRememberFlag(host);
  resolveL0ExcludeDialog(host, 'invalidate', remember);
}

export function onL0DialogDefer(host) {
  const remember = readL0DialogRememberFlag(host);
  resolveL0ExcludeDialog(host, 'defer', remember);
}

export function onL0DialogCancel(host) {
  // Cancel never persists a preference — the checkbox
  // value is irrelevant.
  resolveL0ExcludeDialog(host, 'cancel', false);
}

export function onL0DialogBackdropClick(host, event) {
  // Backdrop click = cancel. Same gesture as the
  // review selector modal's backdrop click.
  if (event.target === event.currentTarget) {
    onL0DialogCancel(host);
  }
}

export function onL0DialogKeyDown(host, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    onL0DialogCancel(host);
  }
}