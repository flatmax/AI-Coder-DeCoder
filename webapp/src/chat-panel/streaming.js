// Stream lifecycle handlers for the ChatPanel.
//
// Owns:
//   - `onStreamChunk(panel, event)` — route chunks
//     to their owning tab, schedule a coalesced
//     re-render via rAF
//   - `onStreamComplete(panel, event)` — finalize
//     the streaming card into a settled assistant
//     message, surface errors and finish-reason
//     toasts, decide whether to spawn agent tabs
//     for the result, populate retry prompts
//   - `onUserMessage(panel, event)` — passive
//     observer dedup against the optimistic local
//     append in `_send`
//   - `onAgentsSpawned(panel, event)` — pre-spawn
//     agent tabs from the backend's
//     `agentsSpawned` broadcast so child stream
//     chunks have somewhere to land
//   - `scheduleFlush(panel)` — rAF batching for
//     pending chunks across all tabs
//   - Retry-prompt builders + error formatting
//     helpers used by the completion path
//
// Why functional with `panel` as a parameter:
// matches the pattern established in tabs.js — the
// chat-panel module is too large to fit on one
// prototype, and Lit's reactive-property
// machinery doesn't compose cleanly with multi-
// class inheritance. Functional modules with
// explicit `panel` parameters keep the
// dependencies visible.
//
// Architectural contracts preserved here:
//
//   - Streaming state keyed by request ID. Each
//     tab has its own `_streams` Map and
//     `_pendingChunks` Map; this module routes
//     by request ID via `findTabForRequest`.
//
//   - Chunks carry full accumulated content, not
//     deltas. The chunk handler replaces the
//     pending content; dropped or reordered
//     chunks are harmless because each carries a
//     superset of prior content.
//
//   - Chunks coalesced per animation frame via
//     `_pendingChunks`. Rapid-fire chunks (every
//     few ms) don't trigger Lit re-renders faster
//     than 60Hz. The synchronous write inside
//     `onStreamChunk` is insurance against rAF
//     starvation (tab backgrounded, panel briefly
//     display:none); both paths read from the
//     same pendingChunks entry so the rAF either
//     finds it drained (no-op) or re-applies the
//     same value (harmless).

import {
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
} from './helpers.js';
import { findTabForRequest, spawnAgentTabs } from './tabs.js';

// ---------------------------------------------------------------
// Last-completion outcome (LED row state)
// ---------------------------------------------------------------

/**
 * Derive the LED-row outcome for one stream completion.
 *
 * Inputs are the raw fields from the completion result:
 *
 *   - ``error`` — string from ``result.error`` (truthy
 *     means the stream itself failed; the response card
 *     renders a typed error and the LED goes red).
 *   - ``errorInfo`` — classified error dict from
 *     ``result.error_info`` (provider message, error
 *     type, model). Used to build a human-readable
 *     failure reason when present.
 *   - ``editResults`` — array of EditResult dicts. Each
 *     carries ``status`` (``applied`` /
 *     ``already_applied`` / ``failed`` / ``skipped`` /
 *     ``not_in_context``) plus ``error_type`` and
 *     ``message`` for failures.
 *
 * Returns the shape stored on ``tab.lastEditOutcome``:
 *
 *   - ``status: 'clean'`` — no stream error AND no
 *     EditResult with status === 'failed'. The agent
 *     finished cleanly (zero edits, all-applied, or any
 *     mix of applied / already-applied / skipped /
 *     not-in-context).
 *   - ``status: 'error'`` — stream error OR at least one
 *     failed EditResult. The LED goes red.
 *
 * ``appliedCount`` counts EditResults with
 * ``status === 'applied'`` — the number of files the
 * agent successfully wrote on this turn. Surfaced in
 * the LED tooltip as ``completed (N edits applied)``.
 *
 * ``failureReason`` is null on clean outcomes; on
 * errors it's a short diagnostic suitable for the LED
 * tooltip:
 *
 *   - Stream error → the typed error label or
 *     provider message
 *   - Anchor not found / ambiguous → the first failed
 *     EditResult's message
 *
 * No try/catch — every input is already a plain JSON
 * value off the streamComplete payload.
 */
export function computeLastEditOutcome(
  error, errorInfo, editResults,
) {
  const results = Array.isArray(editResults) ? editResults : [];
  let appliedCount = 0;
  let firstFailure = null;
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    if (r.status === 'applied') {
      appliedCount += 1;
    } else if (r.status === 'failed' && !firstFailure) {
      firstFailure = r;
    }
  }
  if (error) {
    // Stream-level error wins over edit failures —
    // the response itself didn't complete, so any
    // edit results are partial-at-best.
    let reason;
    if (
      errorInfo
      && typeof errorInfo === 'object'
      && typeof errorInfo.message === 'string'
      && errorInfo.message
    ) {
      reason = errorInfo.message;
    } else {
      reason = String(error);
    }
    return {
      status: 'error',
      appliedCount,
      failureReason: reason,
    };
  }
  if (firstFailure) {
    const message = typeof firstFailure.message === 'string'
      ? firstFailure.message
      : '';
    const errType = typeof firstFailure.error_type === 'string'
      ? firstFailure.error_type
      : '';
    const file = typeof firstFailure.file === 'string'
      ? firstFailure.file
      : '';
    // Prefer the message when present (it's already
    // human-readable); fall back to "<errorType> in
    // <file>" so the tooltip is at least informative.
    let reason;
    if (message) {
      reason = file ? `${file}: ${message}` : message;
    } else if (errType) {
      reason = file
        ? `${errType} in ${file}`
        : errType;
    } else {
      reason = 'edit failed';
    }
    return {
      status: 'error',
      appliedCount,
      failureReason: reason,
    };
  }
  return {
    status: 'clean',
    appliedCount,
    failureReason: null,
  };
}

// ---------------------------------------------------------------
// Stream chunk routing
// ---------------------------------------------------------------

/**
 * Handle a `stream-chunk` window event.
 *
 * Routes by request ID. Drops unknown IDs —
 * collaboration broadcasts from other clients don't
 * belong to any of our tabs (passive stream
 * adoption is a separate feature, not yet wired).
 *
 * Writes the chunk through both fast paths:
 *
 *   1. Pending slot — keyed by request ID; rAF
 *      drains this batch later.
 *   2. Synchronous reactive update — only when
 *      the chunk matches the tab's CURRENT
 *      streaming request AND the owning tab is
 *      the active tab. Inactive tabs accumulate
 *      silently.
 */
export function onStreamChunk(panel, event) {
  const { requestId, content } = event.detail || {};
  if (!requestId) return;
  const ownerTabId = findTabForRequest(panel, requestId);
  if (!ownerTabId) return;
  const ownerTab = panel._tabs.get(ownerTabId);
  if (!ownerTab) return;
  // Full-content semantics — overwrite the pending
  // slot, don't append.
  const normalizedContent = content ?? '';
  ownerTab.pendingChunks.set(requestId, normalizedContent);
  // Apply synchronously in addition to scheduling
  // the rAF coalesce. The rAF caps re-render rate
  // for rapid chunks; the sync path is insurance
  // against rAF starvation. Both paths read from
  // the same pendingChunks entry so the rAF either
  // finds it drained (no-op) or re-applies the same
  // value (harmless).
  if (
    requestId === ownerTab.currentRequestId
    && ownerTab.streaming
  ) {
    ownerTab.streamingContent = normalizedContent;
    if (ownerTabId === panel._activeTabId) {
      panel.requestUpdate('_streamingContent');
    }
  }
  scheduleFlush(panel);
}

/**
 * Schedule (or coalesce) a deferred drain of all
 * tabs' pending chunks. One rAF active at a time;
 * subsequent calls before the rAF fires are no-ops
 * (the existing rAF will see all the writes).
 *
 * Drains every tab — inactive tabs' pending slots
 * are written through to their state but don't
 * trigger requestUpdate (the active tab's render
 * doesn't depend on inactive tabs' streamingContent).
 */
export function scheduleFlush(panel) {
  if (panel._rafHandle != null) return;
  panel._rafHandle = requestAnimationFrame(() => {
    panel._rafHandle = null;
    let activeChanged = false;
    for (const tab of panel._tabs.values()) {
      if (tab.pendingChunks.size === 0) continue;
      for (const [requestId, content] of tab.pendingChunks) {
        if (requestId !== tab.currentRequestId) continue;
        tab.pendingChunks.delete(requestId);
        tab.streamingContent = content;
        if (tab === panel._tabs.get(panel._activeTabId)) {
          activeChanged = true;
        }
      }
    }
    if (activeChanged) {
      panel.requestUpdate('_streamingContent');
    }
  });
}

// ---------------------------------------------------------------
// Pre-spawn agents from broadcast
// ---------------------------------------------------------------

/**
 * Handle an `agents-spawned` window event.
 *
 * Fired by the backend right after the main LLM's
 * response is parsed and before child agent streams
 * begin. Creates agent tabs immediately so chunks
 * for the child request IDs route to their tabs as
 * they arrive, rather than being dropped while the
 * main stream is still finalizing.
 *
 * Payload: ``{turn_id, parent_request_id,
 * agent_blocks}`` where ``agent_blocks`` is
 * ``[{id, task, agent_idx}, ...]``.
 */
export function onAgentsSpawned(panel, event) {
  const detail = event.detail || {};
  const { turn_id, parent_request_id, agent_blocks } = detail;
  if (typeof turn_id !== 'string' || !turn_id) return;
  if (typeof parent_request_id !== 'string') return;
  if (!Array.isArray(agent_blocks)) return;
  if (agent_blocks.length === 0) return;
  spawnAgentTabs(panel, turn_id, agent_blocks, parent_request_id);
}

// ---------------------------------------------------------------
// Stream complete
// ---------------------------------------------------------------

/**
 * Handle a `stream-complete` window event.
 *
 * Routes to the owning tab. Drains any pending
 * chunk synchronously (the backend may have sent
 * `complete` immediately after the last chunk and
 * the rAF hasn't fired yet). Moves the streaming
 * content into the tab's message list as a
 * settled assistant message.
 *
 * Error responses surface as a dedicated error
 * message rather than assistant content, plus a
 * classified toast. Non-natural finish reasons
 * (length, content_filter, tool_calls) produce a
 * follow-up toast on top of the message badge.
 *
 * Spawns agent tabs from `result.agent_blocks` for
 * MAIN-tab completions only — agent tabs can't
 * spawn children (parallel-agents tree depth = 1).
 *
 * Populates a retry prompt in the textarea when
 * the response had recoverable edit failures
 * (ambiguous anchor, in-context mismatch,
 * not-in-context auto-add).
 */
export function onStreamComplete(panel, event) {
  const { requestId, result } = event.detail || {};
  if (!requestId) return;
  const ownerTabId = findTabForRequest(panel, requestId);
  if (!ownerTabId) return;
  const ownerTab = panel._tabs.get(ownerTabId);
  if (!ownerTab) return;
  const ownerIsActive = ownerTabId === panel._activeTabId;

  // Flush any pending chunk synchronously so the
  // final content is reflected before we move it
  // into messages.
  const pending = ownerTab.pendingChunks.get(requestId);
  if (pending !== undefined) {
    ownerTab.pendingChunks.delete(requestId);
    if (requestId === ownerTab.currentRequestId) {
      ownerTab.streamingContent = pending;
      if (ownerIsActive) {
        panel.requestUpdate('_streamingContent');
      }
    }
  }

  let wasOwnRequest = false;
  if (requestId === ownerTab.currentRequestId) {
    wasOwnRequest = true;
    const finalContent =
      result?.response ?? ownerTab.streamingContent ?? '';
    const error = result?.error;
    const errorInfo = result?.error_info;
    const editResults = Array.isArray(result?.edit_results)
      ? result.edit_results
      : undefined;
    const finishReason = result?.finish_reason || '';
    // Compute the last-completion outcome for this
    // tab. Drives the LED row's green/red state per
    // spec ``specs4/5-webapp/agent-browser.md`` §
    // Status LEDs. Cyan flashing is driven separately
    // by the live `streaming` flag.
    const lastEditOutcome = computeLastEditOutcome(
      error, errorInfo, editResults,
    );
    // Compose the assistant-card error body. Per
    // specs-reference/3-llm/streaming.md, classified
    // errors get a human-readable label + provider
    // metadata; unclassified fall through to the
    // legacy `**Error:** ...` format.
    const errorBody = error
      ? formatErrorBody(error, errorInfo)
      : null;
    // Thread turn_id and agent_blocks onto the
    // in-memory record so the "View agents (N)"
    // affordance in renderMessage (Increment D
    // commit 3) can find them. Without this,
    // the wire-level fields persisted by
    // Increment A never reach the message shape
    // Lit renders. Both fields are optional and
    // only present on assistant messages from
    // agentic turns.
    const turnId = result?.turn_id;
    const agentBlocks = Array.isArray(result?.agent_blocks)
      ? result.agent_blocks
      : null;
    const turnIdField =
      typeof turnId === 'string' && turnId
        ? { turn_id: turnId }
        : {};
    const agentBlocksField =
      agentBlocks && agentBlocks.length > 0
        ? { agent_blocks: agentBlocks }
        : {};
    ownerTab.messages = [
      ...ownerTab.messages,
      error
        ? {
            role: 'assistant',
            content: errorBody,
            ...turnIdField,
          }
        : {
            role: 'assistant',
            content: finalContent,
            editResults,
            // Per specs-reference/5-webapp/chat.md §
            // Finish-reason badge labels — every
            // finish reason (including natural
            // `stop` and `end_turn`) produces a
            // badge. Natural reasons render muted;
            // abnormal reasons render in amber/red.
            ...(finishReason ? { finishReason } : {}),
            ...turnIdField,
            ...agentBlocksField,
          },
    ];
    if (ownerIsActive) {
      panel.requestUpdate('messages');
    }
    if (error) {
      emitTypedErrorToast(panel, errorInfo, error);
    }
    // Surface non-natural stops as a toast on top
    // of the in-message badge. Cancelled streams
    // and errors are already surfaced through their
    // own channels.
    if (!error && finishReason) {
      maybeShowFinishReasonToast(panel, finishReason);
    }
    // Record the outcome for the LED row before
    // resetting streaming state. The LED row reads
    // this per tab via Map lookup; the requestUpdate
    // calls below cover both the active-tab and
    // inactive-tab render paths.
    ownerTab.lastEditOutcome = lastEditOutcome;
    // Reset streaming state on the owning tab.
    ownerTab.streaming = false;
    ownerTab.streamingContent = '';
    ownerTab.currentRequestId = null;
    if (ownerIsActive) {
      panel.requestUpdate('_streaming');
    } else {
      // Inactive tab — the active tab's reactive
      // state didn't change, but the tab strip
      // (which reads per-tab `streaming` directly
      // from the Map) needs to re-render so the
      // streaming indicator on this tab's button
      // disappears.
      panel.requestUpdate();
    }
    // Remember the completed request ID so
    // post-completion events (compaction, late URL
    // callbacks) can still be routed to this
    // conversation. Overwritten by each new
    // stream-complete the tab owns.
    ownerTab.lastRequestId = requestId;

    // Spawn agent tabs for valid agent blocks the
    // backend surfaced. Only fires for MAIN-tab
    // completions and not for cancelled / errored
    // turns — the backend doesn't fan out for
    // those, so opening tabs would be misleading.
    if (
      ownerTabId === 'main'
      && !result.error
      && !result.cancelled
      && typeof result.turn_id === 'string'
      && Array.isArray(result.agent_blocks)
      && result.agent_blocks.length > 0
    ) {
      spawnAgentTabs(
        panel,
        result.turn_id,
        result.agent_blocks,
        requestId,
      );
    }
  }

  ownerTab.streams.delete(requestId);

  // Retry prompts only fire for our own requests
  // on the active tab. If a prompt IS populated,
  // the textarea is focused so the user can review
  // and send immediately. Passive streams from
  // collaborators don't get retry prompts.
  if (wasOwnRequest && ownerIsActive && result && !result.error) {
    maybePopulateRetryPrompt(panel, result);
  }
}

// ---------------------------------------------------------------
// Passive observer for user messages
// ---------------------------------------------------------------

/**
 * Handle a `user-message` window event.
 *
 * The server broadcasts user messages to all
 * clients. If we are the sender, we've already
 * added it optimistically in `_send`, so we ignore
 * the echo. If we're a collaborator (no
 * in-flight request), add the message so it appears
 * before the streaming response arrives.
 */
export function onUserMessage(panel, event) {
  if (panel._currentRequestId) return;
  const data = event.detail || {};
  const content = data.content ?? '';
  if (!content) return;
  panel.messages = [
    ...panel.messages,
    { role: 'user', content },
  ];
}

// ---------------------------------------------------------------
// Retry prompt population
// ---------------------------------------------------------------

/**
 * After a stream completes, inspect the result for
 * conditions that warrant a retry prompt in the
 * textarea. The prompt is populated but NOT sent —
 * user reviews and decides.
 *
 * Three cases, in priority order (later cases win
 * if multiple apply):
 *
 *   1. In-context mismatch — edits with
 *      anchor_not_found on files that ARE in the
 *      current selection. LLM has stale content;
 *      ask it to re-read and retry.
 *   2. Ambiguous anchor — edits with
 *      ambiguous_anchor error. Specific LLM
 *      mistake (not enough context for a unique
 *      match); ask it to add more.
 *   3. Not-in-context — files_auto_added is
 *      non-empty. Those edits weren't attempted at
 *      all; the auto-add made the files available
 *      for the next turn.
 *
 * The ordering matches
 * specs-reference/3-llm/edit-protocol.md —
 * not-in-context runs last so it overwrites
 * earlier prompts. This is acceptable per spec:
 * "Note: may overwrite an earlier ambiguous-anchor
 * prompt if both are present in the same response."
 *
 * If the user has already typed something in the
 * textarea, we skip the population — don't
 * clobber their typing.
 */
export function maybePopulateRetryPrompt(panel, result) {
  if (!result || typeof result !== 'object') return;
  // User typed between stream end and this
  // callback — leave their input alone. Tiny
  // window but the courtesy matters.
  if (panel._input.trim() !== '') return;

  const editResults = Array.isArray(result.edit_results)
    ? result.edit_results
    : [];
  const filesAutoAdded = Array.isArray(result.files_auto_added)
    ? result.files_auto_added
    : [];

  const selectedFiles = Array.isArray(panel.selectedFiles)
    ? panel.selectedFiles
    : [];
  let prompt = null;
  const mismatch = buildInContextMismatchRetryPrompt(
    editResults,
    selectedFiles,
  );
  if (mismatch) prompt = mismatch;
  const ambiguous = buildAmbiguousRetryPrompt(editResults);
  if (ambiguous) prompt = ambiguous;
  const notInContext = buildNotInContextRetryPrompt(
    filesAutoAdded,
  );
  if (notInContext) prompt = notInContext;

  if (!prompt) return;
  panel._input = prompt;
  // Focus and size the textarea on the next tick so
  // Lit has committed the value. Same pattern as
  // _onHistorySelect.
  panel.updateComplete.then(() => {
    const ta = panel.shadowRoot?.querySelector('.input-textarea');
    if (!ta) return;
    ta.focus();
    // Cursor at end so the user can continue typing
    // (e.g. to add context) without having to click
    // or arrow over first.
    ta.setSelectionRange(prompt.length, prompt.length);
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  });
}

// ---------------------------------------------------------------
// Stream-start error handling
// ---------------------------------------------------------------

/**
 * Handle a synchronous error response from
 * ``chat_streaming``. The backend resolves the
 * Promise with an error dict (not a rejection) for
 * gate failures — stale agent_tag, duplicate
 * stream, restricted caller, malformed payload.
 *
 * Two distinct UX paths:
 *
 * 1. ``agent not found`` — stale agent tab. The
 *    scope was closed server-side between tab
 *    creation and send. Close the tab locally,
 *    switch to main, toast the user. The tab's
 *    just-typed message is lost — acceptable
 *    because the scope itself is gone.
 *
 * 2. Everything else — append an error message to
 *    the current tab's message list so the user
 *    sees why the stream didn't start. Clear
 *    streaming state, keep the tab open. User can
 *    retry.
 *
 * Both paths clear request tracking so stream
 * events arriving for the failed request are
 * dropped.
 *
 * Owning-tab outcome write: ``send()`` flips
 * ``panel._streaming`` (the active-tab reactive
 * surface) but doesn't touch the per-tab
 * ``tab.streaming`` / ``tab.lastEditOutcome`` state
 * the LED row reads. Without writing those here,
 * a stream-start error on the main tab leaves the
 * LED at its prior outcome — green if a previous
 * turn succeeded — even though this turn failed.
 * Mirror the structure ``onStreamComplete`` uses:
 * find the owning tab (null agent_tag → main),
 * compute the error outcome, write it. The LED
 * row's next render then resolves to red.
 */
export function handleStreamStartError(
  panel, requestId, errorMsg, agentTag,
) {
  panel._streaming = false;
  panel._streamingContent = '';
  panel._currentRequestId = null;
  panel._streams.delete(requestId);

  // Resolve the owning tab. Per the flat-registry
  // contract, ``agentTag`` is null for the main
  // tab and the agent's id (== tab id) otherwise.
  // Fall back to the active tab when the resolved
  // id isn't registered (defensive — shouldn't
  // happen because send() opens the stream against
  // the active tab) so we still surface error
  // outcome state somewhere visible.
  const ownerTabId = agentTag === null ? 'main' : agentTag;
  const ownerTab =
    panel._tabs.get(ownerTabId)
    || panel._tabs.get(panel._activeTabId);
  if (ownerTab) {
    ownerTab.streaming = false;
    ownerTab.streamingContent = '';
    ownerTab.currentRequestId = null;
    ownerTab.pendingChunks.delete(requestId);
    ownerTab.streams.delete(requestId);
    // Error outcome shape matches what
    // ``computeLastEditOutcome`` produces for the
    // stream-error path so the LED row's
    // green/red branch sees a uniform value.
    ownerTab.lastEditOutcome = {
      status: 'error',
      appliedCount: 0,
      failureReason: errorMsg || 'stream failed to start',
    };
  }

  const isStaleAgent =
    errorMsg === 'agent not found' && agentTag !== null;
  if (isStaleAgent) {
    const staleTabId = panel._activeTabId;
    // Remove the optimistic user message we added
    // before sending — the scope is gone, so the
    // message never landed anywhere useful.
    if (
      panel.messages.length > 0
      && panel.messages[panel.messages.length - 1].role === 'user'
    ) {
      panel.messages = panel.messages.slice(0, -1);
    }
    // The component class binds `_onTabClose` so
    // `tabs.onTabClose` fires with this panel. We
    // can also import directly, but going through
    // the panel's own handler keeps the close
    // path uniform.
    panel._onTabClose(staleTabId);
    panel._emitToast(
      'Agent tab closed — scope was no longer available',
      'warning',
    );
    return;
  }

  // Generic error — append as an assistant message
  // so it renders inline with the failed user
  // message. Keeps the tab open for retry. Update
  // the panel — the active tab's render now needs
  // to reflect both the new message and the
  // owner-tab outcome we just wrote (LED row
  // re-renders on every panel update).
  panel.messages = [
    ...panel.messages,
    {
      role: 'assistant',
      content: `**Error:** ${errorMsg}`,
    },
  ];
  panel.requestUpdate();
}

// ---------------------------------------------------------------
// Error formatting + toasts
// ---------------------------------------------------------------

/**
 * Format the assistant-card body for an error
 * result.
 *
 * Classified errors (`errorInfo` present) get a
 * human-readable label + provider metadata.
 * Unclassified errors fall through to the legacy
 * plain `**Error:** ...` format.
 */
export function formatErrorBody(error, errorInfo) {
  if (!errorInfo || typeof errorInfo !== 'object') {
    return `**Error:** ${error}`;
  }
  const label = errorTypeLabel(errorInfo.error_type);
  const parts = [`**Error:** ${label}`];
  // Provider message goes on its own line so long
  // tracebacks don't collide with the label. Fall
  // back to the raw error string if the
  // classifier didn't capture a message.
  const msg = errorInfo.message || error;
  if (msg) parts.push(msg);
  // Metadata line — provider and model when
  // known. Skipped when both are null
  // (self-hosted / local models).
  const provider = errorInfo.provider;
  const model = errorInfo.model;
  if (provider || model) {
    const metaParts = [];
    if (provider) metaParts.push(`provider: ${provider}`);
    if (model) metaParts.push(`model: ${model}`);
    parts.push(`*(${metaParts.join(', ')})*`);
  }
  return parts.join('\n\n');
}

/**
 * Human-readable label for each classified error
 * type. Kept separate from the toast dispatcher so
 * both consumers (assistant card, toast) use one
 * source of truth. Unknown types fall back to "LLM
 * error".
 */
export function errorTypeLabel(errorType) {
  switch (errorType) {
    case 'context_window_exceeded':
      return 'Context window exceeded';
    case 'rate_limit':
      return 'Rate limit exceeded';
    case 'authentication':
      return 'Authentication failed';
    case 'not_found':
      return 'Model not found';
    case 'bad_request':
      return 'Invalid request';
    case 'api_connection':
      return 'Connection failed';
    case 'service_unavailable':
      return 'Service unavailable';
    case 'timeout':
      return 'Request timed out';
    default:
      return 'LLM error';
  }
}

/**
 * Emit a toast for a classified LLM error. The
 * backend's `_classify_litellm_error` maps LiteLLM
 * exception types to nine distinct `error_type`
 * values; this dispatcher picks the right icon,
 * message, and severity for each.
 */
export function emitTypedErrorToast(panel, errorInfo, fallbackMessage) {
  if (!errorInfo || typeof errorInfo !== 'object') {
    panel._emitToast(
      `❌ ${fallbackMessage || 'LLM error'}`,
      'error',
    );
    return;
  }
  const errorType = errorInfo.error_type;
  const providerMsg = errorInfo.message || fallbackMessage || '';
  let icon;
  let label;
  let type;
  switch (errorType) {
    case 'context_window_exceeded':
      icon = '📏';
      label = 'Context too large — compact or remove files';
      type = 'error';
      break;
    case 'rate_limit': {
      icon = '⏱️';
      type = 'warning';
      // Retry-After is float seconds when the
      // provider populated the header. Render as
      // "retry in N s" or "retry in N min" so the
      // user knows roughly when to try again.
      const retryAfter = errorInfo.retry_after;
      if (typeof retryAfter === 'number' && retryAfter > 0) {
        const seconds = Math.round(retryAfter);
        const when =
          seconds >= 60
            ? `${Math.round(seconds / 60)} min`
            : `${seconds} s`;
        label = `Rate limited — retry in ${when}`;
      } else {
        label = 'Rate limited — wait and retry';
      }
      break;
    }
    case 'authentication':
      icon = '🔑';
      label = 'Authentication failed — check LLM config';
      type = 'error';
      break;
    case 'not_found': {
      icon = '❓';
      type = 'error';
      const model = errorInfo.model;
      label = model
        ? `Model not found: ${model}`
        : 'Model not found — check LLM config';
      break;
    }
    case 'bad_request':
      icon = '⚠️';
      label = `Invalid request: ${providerMsg}`;
      type = 'error';
      break;
    case 'api_connection':
      icon = '🌐';
      label = 'Connection failed — check network / proxy';
      type = 'warning';
      break;
    case 'service_unavailable':
      icon = '🔧';
      label = 'Provider unavailable — retry later';
      type = 'warning';
      break;
    case 'timeout':
      icon = '⏱️';
      label = 'Request timed out';
      type = 'warning';
      break;
    default:
      // Includes 'llm_error' and any future
      // backend classifications we haven't learned
      // about.
      icon = '❌';
      label = providerMsg || 'LLM error';
      type = 'error';
      break;
  }
  panel._emitToast(`${icon} ${label}`, type);
}

/**
 * Emit a toast for non-natural finish reasons.
 * Natural stops (`stop`, `end_turn`) produce
 * nothing.
 *
 * Per specs-reference/3-llm/streaming.md § Finish
 * Reason — `length` and `content_filter` are
 * `error` severity ("response incomplete");
 * `tool_calls` / `function_call` are `warning`
 * (the provider wanted something we don't support
 * yet, but the response itself isn't broken);
 * anything else is `warning` with the raw reason
 * surfaced.
 */
export function maybeShowFinishReasonToast(panel, reason) {
  if (!reason || reason === 'stop' || reason === 'end_turn') {
    return;
  }
  let message;
  let type = 'warning';
  switch (reason) {
    case 'length':
      message = '⚠️ Response truncated — hit max_tokens';
      type = 'error';
      break;
    case 'content_filter':
      message = '⚠️ Response blocked by content filter';
      type = 'error';
      break;
    case 'tool_calls':
    case 'function_call':
      message = `⚠️ Model requested a ${reason} (not supported)`;
      break;
    default:
      message = `⚠️ Stopped: ${reason}`;
      break;
  }
  panel._emitToast(message, type);
}