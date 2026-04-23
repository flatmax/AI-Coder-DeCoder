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
    // Default picker width. Phase 3 wires a draggable handle
    // and localStorage persistence.
    this._pickerWidthPx = 280;
    this._treeLoaded = false;
    // Latest loaded file tree. Kept as a non-reactive field
    // so the template's `.tree=${this._latestTree}` bind
    // carries the most recent value across re-renders rather
    // than clobbering back to EMPTY_TREE.
    this._latestTree = EMPTY_TREE;

    // Bound event handlers — same binding used for add and
    // remove so cleanup matches.
    this._onFilesChanged = this._onFilesChanged.bind(this);
    this._onFilesModified = this._onFilesModified.bind(this);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('files-changed', this._onFilesChanged);
    window.addEventListener('files-modified', this._onFilesModified);
  }

  disconnectedCallback() {
    window.removeEventListener('files-changed', this._onFilesChanged);
    window.removeEventListener(
      'files-modified',
      this._onFilesModified,
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
    // The real RPC lives on Repo, not LLMService. Using
    // rpcExtract to unwrap the single-key envelope.
    let tree;
    try {
      tree = await this.rpcExtract('Repo.get_file_tree');
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
    const picker = this._picker();
    if (picker) {
      picker.tree = this._latestTree;
      picker.requestUpdate();
    }
    this._treeLoaded = true;
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

  // ---------------------------------------------------------------
  // File clicks
  // ---------------------------------------------------------------

  _onFileClicked(event) {
    // Picker emits `file-clicked` when the user clicks a
    // file's name (not its checkbox). We translate to a
    // `navigate-file` window event that Phase 3's viewer
    // will consume. No-op at the consumer side for now.
    const path = event.detail?.path;
    if (!path) return;
    window.dispatchEvent(
      new CustomEvent('navigate-file', {
        detail: { path },
        bubbles: false,
      }),
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
          .selectedFiles=${this._selectedFiles}
          @selection-changed=${this._onSelectionChanged}
          @file-clicked=${this._onFileClicked}
        ></ac-file-picker>
      </div>
      <div class="chat-pane">
        <ac-chat-panel></ac-chat-panel>
      </div>
    `;
  }
}

customElements.define('ac-files-tab', FilesTab);