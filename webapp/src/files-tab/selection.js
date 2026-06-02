// Selection state — apply / send / event handlers.
//
// Extracted from index.js. Manages the authoritative
// selected-files Set per active tab. Coordinates with:
//
//   - the picker via direct-update pattern (assign
//     `picker.selectedFiles = new Set(...)` then
//     requestUpdate)
//   - the chat panel via direct-update for the
//     downstream file-mention summary
//   - the backend via main / agent split RPC dispatch
//     (parseAgentTabId on the active tab id)
//
// Under the membrane / flux cache model, deselected
// files (including those with working-tree or staged
// changes) are simply removed from context — the parent
// directory's symbol/doc dir-block continues to carry
// their structural presence, and re-selection brings
// the full text back. No pin protection is needed.

import { parseAgentTabId } from '../chat-panel/index.js';

/**
 * Apply a new selection set. Single entry point — every
 * selection mutation routes through here so the
 * set-equality short-circuit is honoured uniformly.
 *
 * `notifyServer` flag: false when applying a server
 * broadcast (avoids loopback), true when applying a
 * user action.
 */
export function applySelection(host, newSelection, notifyServer) {
  // Fast-path no-op when the set hasn't actually changed.
  // Prevents loopback from the server broadcast doing
  // another round-trip for our own update.
  if (host._setsEqual(host._selectedFiles, newSelection)) {
    return;
  }
  host._selectedFiles = newSelection;
  // Direct-update pattern (load-bearing — see class
  // docstring on FilesTab). Assign to child props then
  // requestUpdate.
  const picker = host._picker();
  if (picker) {
    picker.selectedFiles = new Set(newSelection);
    picker.requestUpdate();
  }
  const chat = host._chat();
  if (chat) {
    chat.selectedFiles = Array.from(newSelection);
    chat.requestUpdate();
  }
  if (notifyServer) {
    sendSelectionToServer(host, Array.from(newSelection));
  }
}

/**
 * Send the new selection to the backend. Routes by
 * active tab: main → set_selected_files, agent tab →
 * set_agent_selected_files(agent_id, files).
 *
 * `parseAgentTabId` returns null for 'main' or for
 * malformed IDs, in which case we use the main RPC
 * path (the tab-as-main case).
 *
 * Per specs4/5-webapp/agent-browser.md § File Picker
 * Scope: "A user granting a file to agent 2 doesn't
 * affect the main LLM's context on the next turn."
 * Without this dispatch, every selection change on
 * any tab would clobber the main tab's server-side
 * selection.
 */
export async function sendSelectionToServer(host, files) {
  const agentTag = parseAgentTabId(host._activeTabId);
  try {
    let result;
    if (agentTag) {
      // agentTag IS the agent's LLM-chosen id —
      // post-flat-identity refactor flattened the
      // (turn_id, agent_idx) tuple into a single
      // string keyed in the backend registry.
      result = await host.rpcExtract(
        'LLMService.set_agent_selected_files',
        agentTag,
        files,
      );
    } else {
      result = await host.rpcExtract(
        'LLMService.set_selected_files',
        files,
      );
    }
    // Server returns either an array of paths
    // (success) or an error dict. `{error:
    // "restricted", ...}` is the collab-mode localhost
    // gate. `{error: "agent not found"}` happens when
    // the tab was closed server-side between the last
    // tab switch and this selection change — treat it
    // as a warning; the tab's local state is stale but
    // the chat panel's close-tab flow will clean up
    // eventually.
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
      '[files-tab] set_selected_files failed', err,
    );
    host._showToast(
      `Failed to update selection: ${err?.message || err}`,
      'error',
    );
  }
}

/**
 * Picker emits `selection-changed` when the user
 * toggles a checkbox or clicks a directory checkbox.
 */
export function onSelectionChanged(host, event) {
  const incoming = event.detail?.selectedFiles;
  if (!Array.isArray(incoming)) return;
  applySelection(host, new Set(incoming), /* notifyServer */ true);
}

/**
 * Server broadcasts `files-changed` on another
 * client's `set_selected_files`, on auto-add for
 * not-in-context edits, and on our own
 * `set_selected_files` call (the server echoes back).
 *
 * Treat the broadcast as authoritative: even for our
 * own send, applying the echo is idempotent because
 * `applySelection` only mutates when the set actually
 * changes.
 */
export function onFilesChanged(host, event) {
  const incoming = event.detail?.selectedFiles;
  if (!Array.isArray(incoming)) return;
  applySelection(
    host, new Set(incoming), /* notifyServer */ false,
  );
}