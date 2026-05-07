// Window-event wiring + lifecycle hooks for the
// ChatPanel.
//
// Owns:
//
//   - connectedCallback / disconnectedCallback
//     attach/detach for every window-level event
//     the panel listens to
//   - Stream-related event delegation (the actual
//     handlers live in streaming.js — this module
//     just routes)
//   - Session lifecycle (`session-changed`,
//     `state-loaded`) — replaces messages, resets
//     streaming state, seeds input history
//   - Compaction events (URL fetch progress,
//     history compaction)
//   - Mode + cross-ref toggles (RPC calls +
//     broadcast sync)
//   - Commit result handler (appends system event
//     to the conversation)
//   - Snippet loading + reload on mode/review
//     changes
//   - Mode hydration from `get_current_state`
//   - Alt+` chat-tab cycling document listener
//   - `updated()` lifecycle hook helpers (auto-
//     scroll, lightbox focus)
//
// Why the lifecycle methods don't live on the
// component class: Lit's
// `connectedCallback`/`disconnectedCallback` need
// to be on the prototype because they're called
// by the framework. The component class
// (`index.js`) provides one-line forwarders that
// call `attachEventListeners(this)` and
// `detachEventListeners(this)` — keeping the
// wiring tables here means the events file is the
// one place to look when adding a new event.

import { normalizeMessageContent } from '../image-utils.js';
import { onChatTabShortcut } from './tabs.js';
import {
  onAgentsSpawned,
  onStreamChunk,
  onStreamComplete,
  onUserMessage,
} from './streaming.js';

// ---------------------------------------------------------------
// Event handler binding
// ---------------------------------------------------------------

/**
 * Bind every window-event handler the chat panel
 * needs. Called once at construction time
 * (before connectedCallback) so the references
 * are stable across attach/detach cycles.
 *
 * Each `_on*` field on the panel is a stable
 * function reference. addEventListener +
 * removeEventListener pairs in attach/detach
 * use those references directly so listener
 * cleanup actually fires.
 */
export function bindEventHandlers(panel) {
  panel._onStreamChunk = (e) => onStreamChunk(panel, e);
  panel._onStreamComplete = (e) => onStreamComplete(panel, e);
  panel._onUserMessage = (e) => onUserMessage(panel, e);
  panel._onAgentsSpawned = (e) => onAgentsSpawned(panel, e);
  panel._onSessionChanged = (e) => onSessionChanged(panel, e);
  panel._onStateLoaded = (e) => onStateLoaded(panel, e);
  panel._onCompactionEvent = (e) => onCompactionEvent(panel, e);
  panel._onModeOrReviewChanged = () => onModeOrReviewChanged(panel);
  panel._onModeChanged = (e) => onModeChanged(panel, e);
  panel._onCommitResult = (e) => onCommitResult(panel, e);
  panel._onChatTabShortcutBound = (e) => onChatTabShortcut(panel, e);
}

// ---------------------------------------------------------------
// Lifecycle attach/detach
// ---------------------------------------------------------------

/**
 * Attach every window-level listener. Called
 * from the component's connectedCallback.
 *
 * Listener channels (informational — the wiring
 * is one block below):
 *
 *   stream-chunk / stream-complete — server-push
 *     stream events, routed by request ID to the
 *     owning tab.
 *
 *   user-message — server broadcasts user
 *     messages to all clients; passive observers
 *     append, sender skips its own echo.
 *
 *   agents-spawned — backend pre-spawn signal so
 *     child stream chunks have somewhere to land.
 *
 *   session-changed — explicit session swap
 *     (new_session, load_session_into_context).
 *
 *   state-loaded — initial snapshot from
 *     get_current_state on connect/reconnect.
 *     Backend auto-restores the most recent
 *     session on boot; without consuming this
 *     event the chat panel would render empty.
 *
 *   compaction-event — URL fetch progress, history
 *     compaction stages, doc-enrichment stages
 *     (the last group is dropped here — the
 *     header progress bar handles them).
 *
 *   mode-changed / review-started / review-ended —
 *     mode-aware snippet reload + local mode
 *     state sync.
 *
 *   commit-result — broadcast from background
 *     commit task; appends system event to
 *     conversation, flips _committing off.
 */
export function attachEventListeners(panel) {
  window.addEventListener('stream-chunk', panel._onStreamChunk);
  window.addEventListener('stream-complete', panel._onStreamComplete);
  window.addEventListener('user-message', panel._onUserMessage);
  window.addEventListener('session-changed', panel._onSessionChanged);
  window.addEventListener('agents-spawned', panel._onAgentsSpawned);
  // D2 — chat-tab keyboard shortcuts. Alt+`
  // cycles to the next tab, Alt+Shift+` to the
  // previous. Installed at the document level
  // (bubble phase) so the shortcut works
  // regardless of focus location within the
  // chat panel, but does NOT intercept typing
  // in the textarea — backtick is a normal
  // character and the chat panel itself doesn't
  // consume it. Alt+` is not claimed by the
  // app shell's shortcuts (those own Alt+1..4
  // and Alt+M).
  document.addEventListener('keydown', panel._onChatTabShortcutBound);
  // `state-loaded` fires once on connect carrying
  // the full backend state snapshot. Distinct
  // from `session-changed`, which fires when the
  // active session is explicitly replaced. On
  // startup the backend silently auto-restores
  // the most recent prior session; without this
  // listener the chat panel would show an empty
  // message list even though the backend already
  // has the prior conversation in its context.
  window.addEventListener('state-loaded', panel._onStateLoaded);
  window.addEventListener(
    'compaction-event',
    panel._onCompactionEvent,
  );
  window.addEventListener('mode-changed', panel._onModeOrReviewChanged);
  window.addEventListener('mode-changed', panel._onModeChanged);
  window.addEventListener(
    'review-started',
    panel._onModeOrReviewChanged,
  );
  window.addEventListener(
    'review-ended',
    panel._onModeOrReviewChanged,
  );
  window.addEventListener('commit-result', panel._onCommitResult);
}

/**
 * Detach every listener bound by
 * `attachEventListeners`. Called from
 * `disconnectedCallback`. Also tears down any
 * capture-phase listeners installed by the
 * overflow menu (defensive — if the menu was
 * open at unmount, releasing the document
 * listeners prevents the stale handler from
 * keeping the panel reachable).
 *
 * Cancels any pending rAF or debounce timers
 * scoped to the panel itself (the per-tab
 * debounce timers held by `_fileSearchDebounceTimer`
 * and `_urlDetectDebounceTimer` get cleared too —
 * a brief delay between disconnect and re-attach
 * could otherwise produce a stale re-render).
 */
export function detachEventListeners(panel) {
  document.removeEventListener('keydown', panel._onChatTabShortcutBound);
  window.removeEventListener('stream-chunk', panel._onStreamChunk);
  window.removeEventListener('stream-complete', panel._onStreamComplete);
  window.removeEventListener('user-message', panel._onUserMessage);
  window.removeEventListener('session-changed', panel._onSessionChanged);
  window.removeEventListener('agents-spawned', panel._onAgentsSpawned);
  window.removeEventListener('state-loaded', panel._onStateLoaded);
  window.removeEventListener(
    'compaction-event',
    panel._onCompactionEvent,
  );
  window.removeEventListener(
    'mode-changed',
    panel._onModeOrReviewChanged,
  );
  window.removeEventListener('mode-changed', panel._onModeChanged);
  window.removeEventListener(
    'review-started',
    panel._onModeOrReviewChanged,
  );
  window.removeEventListener(
    'review-ended',
    panel._onModeOrReviewChanged,
  );
  window.removeEventListener('commit-result', panel._onCommitResult);
  // Defensive — if the overflow menu was open
  // at unmount, release the document listeners
  // so they don't keep a stale handler alive.
  // Closing via the setter would be cleaner but
  // also touches reactive state on an already-
  // tearing-down component.
  document.removeEventListener(
    'click',
    panel._onOverflowOutsideClick,
    true,
  );
  document.removeEventListener(
    'keydown',
    panel._onOverflowKeyDown,
    true,
  );
  if (panel._rafHandle != null) {
    cancelAnimationFrame(panel._rafHandle);
    panel._rafHandle = null;
  }
  if (panel._fileSearchDebounceTimer != null) {
    clearTimeout(panel._fileSearchDebounceTimer);
    panel._fileSearchDebounceTimer = null;
  }
  if (panel._urlDetectDebounceTimer != null) {
    clearTimeout(panel._urlDetectDebounceTimer);
    panel._urlDetectDebounceTimer = null;
  }
}

// ---------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------

/**
 * Handle a `session-changed` event. Session load
 * or new-session — replace the message list
 * wholesale.
 *
 * Resets transient state — a session switch
 * cancels any in-flight stream from the caller's
 * perspective (the backend's stream may still be
 * running but we're no longer interested).
 *
 * Clears URL chips because URLService.clear_fetched
 * runs server-side on new_session; we mirror that
 * on the client. Also wipes per-tab snapshots so
 * switching back to a tab that had chips from a
 * prior session doesn't resurrect them.
 */
export function onSessionChanged(panel, event) {
  const data = event.detail || {};
  const msgs = Array.isArray(data.messages) ? data.messages : [];
  // Normalise to our internal shape — messages
  // from the backend carry extra metadata we
  // ignore here.
  //
  // Multimodal messages (images) arrive as an
  // array of `{type: 'text'/'image_url', ...}`
  // blocks; normalize to `{content: <string>,
  // images: [<data uri>]}`.
  panel.messages = msgs.map((m) => {
    const normalized = normalizeMessageContent(m);
    const images = Array.isArray(m.images)
      ? m.images
      : normalized.images;
    return {
      role: m.role,
      content: normalized.content,
      ...(images.length > 0 ? { images } : {}),
      ...(m.system_event ? { system_event: true } : {}),
    };
  });
  panel._streaming = false;
  panel._streamingContent = '';
  panel._currentRequestId = null;
  panel._streams.clear();
  panel._pendingChunks.clear();
  panel._autoScroll = true;
  // Seed input history from the loaded session's
  // user messages.
  seedInputHistory(panel, msgs);
  // Clear URL chips — fresh session.
  const chipsEl = panel.shadowRoot?.querySelector('ac-url-chips');
  if (chipsEl) chipsEl.reset();
  for (const tab of panel._tabs.values()) {
    tab.urlChips = null;
  }
}

/**
 * Handle the `state-loaded` event dispatched by
 * AppShell after `get_current_state` returns on
 * startup / reconnect.
 *
 * The backend auto-restores the most recent
 * prior session when it boots, so
 * `get_current_state` includes the restored
 * message list. Without consuming this event,
 * the chat panel would render empty even though
 * the backend's context already has the prior
 * conversation loaded.
 *
 * Guarded against wiping an in-flight stream:
 * if the user reconnects mid-stream (rare but
 * possible), we skip the replace. The stream's
 * own completion will bring the UI back into
 * sync.
 */
export function onStateLoaded(panel, event) {
  if (panel._streaming) return;
  const state = event.detail || {};
  const msgs = Array.isArray(state.messages) ? state.messages : [];
  // Only overwrite when we actually have
  // something to restore. An empty snapshot
  // during a fresh-install first-connect
  // shouldn't clobber any optimistic local state.
  if (msgs.length === 0 && panel.messages.length === 0) return;
  panel.messages = msgs.map((m) => {
    const normalized = normalizeMessageContent(m);
    const images = Array.isArray(m.images)
      ? m.images
      : normalized.images;
    return {
      role: m.role,
      content: normalized.content,
      ...(images.length > 0 ? { images } : {}),
      ...(m.system_event ? { system_event: true } : {}),
    };
  });
  seedInputHistory(panel, msgs);
}

/**
 * Seed the input-history component with user
 * messages from a just-loaded session. Called
 * after messages are replaced so up-arrow recall
 * works for messages from the loaded
 * conversation, not just messages typed since
 * mount.
 *
 * Handles multimodal messages — when `content`
 * is an array of `{type: 'text', text: ...}` /
 * `{type: 'image_url', ...}` blocks, concatenates
 * the text blocks and ignores the rest.
 */
function seedInputHistory(panel, msgs) {
  const history = panel.shadowRoot?.querySelector(
    'ac-input-history',
  );
  if (!history) {
    // Component isn't mounted yet. Defer until
    // it is. Adding entries is cheap, so we can
    // safely retry once Lit commits.
    panel.updateComplete.then(() => {
      const h = panel.shadowRoot?.querySelector('ac-input-history');
      if (h) seedIntoHistory(h, msgs);
    });
    return;
  }
  seedIntoHistory(history, msgs);
}

function seedIntoHistory(historyEl, msgs) {
  for (const m of msgs) {
    if (m.role !== 'user' || m.system_event) continue;
    let text;
    if (typeof m.content === 'string') {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      text = m.content
        .filter((b) => b && b.type === 'text' && b.text)
        .map((b) => b.text)
        .join('\n');
    } else {
      continue;
    }
    if (text && text.trim()) {
      historyEl.addEntry(text);
    }
  }
}

// ---------------------------------------------------------------
// Compaction events
// ---------------------------------------------------------------

/**
 * Handle a compaction / progress event from the
 * server.
 *
 * These events arrive on the same channel as
 * stream-chunk / stream-complete but carry a
 * `stage` field identifying what's happening:
 *
 *   - `url_fetch` — URL fetch started mid-stream.
 *   - `url_ready` — URL fetch completed.
 *   - `compacting` — history compaction starting.
 *   - `compacted` — compaction done. Replace the
 *     message list with the compacted messages.
 *   - `compaction_error` — compaction failed.
 *
 * Request ID filtering: compaction runs AFTER
 * stream-complete has fired, so
 * `_currentRequestId` is already null by the
 * time compaction events arrive. We also accept
 * events matching `_lastRequestId` (the most
 * recently completed request). Events for
 * unknown request IDs are silently dropped.
 *
 * Doc enrichment stages (`doc_enrichment_*`) are
 * ignored here. Per specs4/5-webapp/shell.md
 * they drive a header progress bar, not a
 * chat-panel toast.
 */
export function onCompactionEvent(panel, event) {
  const { requestId, event: payload } = event.detail || {};
  if (!payload || typeof payload !== 'object') return;
  const stage = payload.stage;
  if (!stage) return;
  // Request ID filter — accept current and
  // most-recent, drop anything else. Missing
  // requestId is accepted too (some progress
  // events may not carry one).
  if (
    requestId &&
    requestId !== panel._currentRequestId &&
    requestId !== panel._lastRequestId
  ) {
    return;
  }
  switch (stage) {
    case 'url_fetch': {
      const label = payload.url || 'URL';
      panel._emitToast(`Fetching ${label}…`, 'info');
      return;
    }
    case 'url_ready': {
      const label = payload.url || 'URL';
      panel._emitToast(`Fetched ${label}`, 'success');
      return;
    }
    case 'compacting': {
      panel._emitToast('Compacting history…', 'info');
      return;
    }
    case 'compacted': {
      // Replace the message list with the
      // compacted form. The backend's `case`
      // field tells us what kind of compaction
      // happened.
      const newMessages = Array.isArray(payload.messages)
        ? payload.messages
        : null;
      if (newMessages) {
        panel.messages = newMessages.map((m) => {
          const normalized = normalizeMessageContent(m);
          const images = Array.isArray(m.images)
            ? m.images
            : normalized.images;
          return {
            role: m.role,
            content: normalized.content,
            ...(images.length > 0 ? { images } : {}),
            ...(m.system_event ? { system_event: true } : {}),
          };
        });
      }
      const caseName = payload.case;
      const toastMsg =
        caseName === 'truncate'
          ? 'History truncated at topic boundary'
          : caseName === 'summarize'
            ? 'History summarised'
            : 'History compaction complete';
      panel._emitToast(toastMsg, 'success');
      return;
    }
    case 'compaction_error': {
      const detail = payload.error || 'unknown error';
      panel._emitToast(`Compaction failed: ${detail}`, 'error');
      return;
    }
    default:
      // Unknown stage — silent drop. Doc
      // enrichment stages fall through here (by
      // design) and any future backend stage we
      // haven't learned about is harmless to
      // ignore.
      return;
  }
}

// ---------------------------------------------------------------
// Mode + cross-ref + snippets
// ---------------------------------------------------------------

/**
 * Mode or review state changed — snippets are
 * mode-aware (code / doc / review), so refetch.
 * The fetch is idempotent and cheap; a stray
 * event that doesn't actually change the mode
 * just re-sets the same list.
 */
export function onModeOrReviewChanged(panel) {
  loadSnippets(panel);
}

/**
 * Sync mode/cross-ref state from the broadcast.
 * Fires for our own switches and for
 * collaborators'. Backend resets cross-ref on
 * mode change; we mirror that locally so the UI
 * doesn't lag the broadcast.
 */
export function onModeChanged(panel, event) {
  const detail = event.detail || {};
  if (typeof detail.mode === 'string') {
    if (detail.mode !== panel._mode) {
      panel._mode = detail.mode;
      panel._crossRefEnabled = false;
    }
  }
  if (typeof detail.cross_ref_enabled === 'boolean') {
    panel._crossRefEnabled = detail.cross_ref_enabled;
  }
}

/**
 * Switch primary mode via RPC. Backend
 * broadcasts mode-changed which our handler
 * picks up — don't mutate _mode optimistically.
 */
export async function switchMode(panel, mode) {
  if (mode !== 'code' && mode !== 'doc') return;
  if (mode === panel._mode) return;
  if (!panel.rpcConnected) return;
  try {
    const result = await panel.rpcExtract(
      'LLMService.switch_mode', mode,
    );
    if (result && typeof result === 'object' && result.error) {
      const reason = result.reason || result.error;
      panel._emitToast(`Mode switch failed: ${reason}`, 'warning');
    }
  } catch (err) {
    panel._emitToast(
      `Mode switch failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}

/**
 * Toggle cross-reference. Same backend-
 * authoritative pattern as `switchMode`.
 */
export async function toggleCrossRef(panel) {
  if (!panel.rpcConnected) return;
  const next = !panel._crossRefEnabled;
  try {
    const result = await panel.rpcExtract(
      'LLMService.set_cross_reference', next,
    );
    if (result && typeof result === 'object' && result.error) {
      const reason = result.reason || result.error;
      panel._emitToast(
        `Cross-reference toggle failed: ${reason}`,
        'warning',
      );
    }
  } catch (err) {
    panel._emitToast(
      `Cross-reference toggle failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}

/**
 * Hydrate mode + cross-ref from the backend
 * state snapshot. Subsequent updates flow
 * through the `mode-changed` broadcast.
 */
export async function loadModeState(panel) {
  if (!panel.rpcConnected) return;
  try {
    const state = await panel.rpcExtract(
      'LLMService.get_current_state',
    );
    if (state && typeof state === 'object') {
      if (typeof state.mode === 'string') {
        panel._mode = state.mode;
      }
      if (typeof state.cross_ref_enabled === 'boolean') {
        panel._crossRefEnabled = state.cross_ref_enabled;
      }
    }
  } catch (err) {
    // Silent — mode-changed broadcasts will
    // catch us up.
  }
}

/**
 * Fetch snippets from the server. Fire-and-
 * forget; errors leave the snippet list
 * unchanged (preserving any previously-loaded
 * snippets) and log to console. The drawer
 * renders a placeholder when the list is empty,
 * so pre-load state and post-error state look
 * the same from the user's perspective.
 *
 * Distinguishes "method not on proxy" (expected
 * when the backend is a stripped-down test
 * fixture or an older server) from a real
 * failure (network, server error). Only the
 * latter is worth surfacing.
 */
export async function loadSnippets(panel) {
  if (!panel.rpcConnected) return;
  try {
    const snippets = await panel.rpcExtract(
      'LLMService.get_snippets',
    );
    panel._snippets = Array.isArray(snippets) ? snippets : [];
  } catch (err) {
    const message = err?.message || '';
    if (!message.includes('method not found')) {
      console.error('[chat] get_snippets failed', err);
    }
  }
}

// ---------------------------------------------------------------
// Commit result
// ---------------------------------------------------------------

/**
 * Handle the `commit-result` window event
 * dispatched by AppShell when the backend's
 * background commit_all task finishes.
 *
 * Two jobs:
 *   1. Flip `_committing` off so the commit
 *      button returns to idle.
 *   2. Append the commit's system event message
 *      to the local `messages` array so the
 *      user sees it in the chat. The server
 *      already persisted the same text to the
 *      history store, so a subsequent session
 *      reload picks it up too — this handler is
 *      what makes it appear in the current
 *      session's UI without waiting for a
 *      reload.
 *
 * Per specs-reference/5-webapp/chat.md § System
 * Event Messages — commit events render as
 * role=user with system_event=true, distinct
 * styling.
 *
 * Server broadcasts `commitResult` to all
 * connected clients (not just the initiator),
 * so every client appends exactly once per
 * commit. Unlike `userMessage`, there's no
 * dedupe needed — commits don't stream and
 * there's no optimistic local-add on the
 * initiator.
 */
export function onCommitResult(panel, event) {
  panel._committing = false;
  const detail = event?.detail;
  if (!detail || typeof detail !== 'object') return;
  // Error path — don't append a message; the
  // shell has already surfaced a toast. The
  // frontend error state stops here.
  if (detail.error) return;
  const text = detail.system_event_message;
  if (typeof text !== 'string' || !text) return;
  panel.messages = [
    ...panel.messages,
    { role: 'user', content: text, system_event: true },
  ];
}

// ---------------------------------------------------------------
// updated() lifecycle helpers
// ---------------------------------------------------------------

/**
 * Run side-effects after a Lit `updated` cycle:
 *
 *   - Auto-scroll to bottom when engaged
 *   - Focus the lightbox backdrop on open so
 *     Escape works without a click first
 *
 * Called from the component class's `updated`
 * hook. Kept here rather than on the prototype
 * so the wiring lives next to the events that
 * trigger it.
 */
export function onUpdated(panel, changedProps) {
  if (panel._autoScroll) {
    // scrollToBottom is in input.js — import
    // there would create a cycle. The component
    // class injects it as a callable, but to
    // avoid yet another binding we duplicate
    // the trivial double-rAF path here.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = panel.shadowRoot?.querySelector(
          '.messages',
        );
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
    });
  }
  // Focus the lightbox backdrop when it opens
  // so Escape works without the user having to
  // click first. Using `changedProps.has` checks
  // the transition, not the current value, so
  // we don't re-focus on every render while the
  // lightbox is open.
  if (
    changedProps.has('_lightboxImage') &&
    panel._lightboxImage &&
    !changedProps.get('_lightboxImage')
  ) {
    panel.updateComplete.then(() => {
      const backdrop =
        panel.shadowRoot?.querySelector('.lightbox-backdrop');
      if (backdrop) backdrop.focus();
    });
  }
}