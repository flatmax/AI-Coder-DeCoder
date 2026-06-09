// Input + composition handlers for the ChatPanel.
//
// Owns everything that mediates between the user's
// keystroke / paste / click and the textarea or
// composition state:
//
//   - Textarea input + auto-resize
//   - Enter/Shift+Enter, up-arrow recall, IME guard
//   - Paste handling (text fallthrough, image
//     extraction with size/count caps)
//   - Pending-image strip + lightbox
//   - Speech-to-text transcript insertion
//   - Snippet drawer toggle + insertion
//   - Reasoning toggle
//   - History browser open/close/load
//   - New session
//   - File mention detection (the `@filter` bridge
//     to the picker via `filter-from-chat`)
//   - Message text extraction for copy/paste
//   - File chip click + Add-All accumulation
//   - Code-block copy-button handling
//   - Mention click delegation
//   - Auto-scroll engagement
//
// Why one module rather than several: these
// handlers all cluster around the textarea + the
// message list. Splitting them further would
// require shared state (the textarea ref, the
// shadow root) to be threaded through three or
// four files. Keeping them together makes the
// cross-references explicit and keeps the file
// boundaries aligned with what the user perceives
// as one "input area".

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  estimateDataUriBytes,
  extractImagesFromClipboard,
} from '../image-utils.js';
import {
  AUTO_SCROLL_DISENGAGE_PX,
  AUTO_SCROLL_TOLERANCE_PX,
  _saveDrawerOpen,
  _saveReasoningEnabled,
  _saveReasoningEffort,
  _REASONING_EFFORT_LEVELS,
  buildAmbiguousRetryPrompt,
  buildInContextMismatchRetryPrompt,
  buildNotInContextRetryPrompt,
  generateRequestId,
  parseAgentTabId,
} from './helpers.js';
import { scheduleUrlDetection } from './urls.js';
import { handleStreamStartError } from './streaming.js';
import { setSearchMode } from './search.js';

// localStorage key for the in-progress textarea
// draft. Persisted on every input event so a
// browser refresh, tab reload, or accidental
// close doesn't lose unsent text. Cleared on
// send. Global rather than per-repo because the
// draft is short-lived and threading repoName
// into the chat panel isn't currently wired —
// worst case on repo switch the draft surfaces
// in another repo, which the user can clear with
// one keystroke.
//
// Exported so the test suite can clear it in
// afterEach — without that cleanup, persisted
// drafts from earlier tests leak into later
// mounts via `connectedCallback` and corrupt
// assertions on `_input`.
export const _DRAFT_STORAGE_KEY = 'ac-dc.chat.draft';

export function _loadDraft() {
  try {
    return localStorage.getItem(_DRAFT_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function _saveDraft(value) {
  try {
    if (value) {
      localStorage.setItem(_DRAFT_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(_DRAFT_STORAGE_KEY);
    }
  } catch {
    /* localStorage unavailable — silent. */
  }
}

// ---------------------------------------------------------------
// Send + cancel
// ---------------------------------------------------------------

/**
 * Send the composed message + pending images.
 *
 * Drops the snippet drawer on send (auto-close —
 * users want vertical space back during streaming).
 * Clears detected URL chips per spec — fetched
 * and errored chips survive because they
 * represent committed work.
 *
 * Computes per-turn URL exclusion set from chips
 * whose include checkbox is unchecked. Chip stays
 * visible; only this turn's prompt omits its
 * content.
 *
 * Routes through ``parseAgentTabId`` so agent tabs
 * pass their agent_tag to the backend and main
 * tabs pass null (untagged = main scope).
 */
export async function send(panel) {
  const text = panel._input.trim();
  // Either text or at least one image must be
  // present. An image-only message is valid ("look
  // at this") — the LLM receives it as a user
  // message with just the image content.
  if (!text && panel._pendingImages.length === 0) return;
  if (panel._streaming) return;
  if (!panel.rpcConnected) return;
  // Read-only tab gate (Increment D commit 3) —
  // historical agent tabs target a
  // ``ContextManager`` that no longer exists on
  // the backend. The user can read the archive
  // but can't continue the conversation. Toast
  // and bail; the input stays so the user can
  // copy-paste it into a live tab if needed.
  const activeTab = panel._tabs.get(panel._activeTabId);
  if (activeTab && activeTab.readOnly) {
    panel._emitToast(
      'This is a historical archive — replies disabled. Switch to a live tab to send messages.',
      'warning',
    );
    return;
  }

  // Auto-exit file search mode on send — the user
  // is now composing a message, not scanning
  // results. Matches specs4/5-webapp/search.md.
  if (panel._searchMode === 'file') {
    setSearchMode(panel, 'message');
  }

  const requestId = generateRequestId();
  panel._currentRequestId = requestId;
  panel._streams.set(requestId, { content: '', sticky: true });

  // Snapshot pending images BEFORE we clear the
  // array. The optimistic message shows them; the
  // RPC receives them; the send state clears them
  // regardless of success. Deliberate symmetry:
  // even if the RPC rejects, the user doesn't
  // want their images reappearing in the pending
  // strip.
  const images = panel._pendingImages.slice();

  // Record this message in input history before
  // we clear the textarea — up-arrow recall
  // wants the full text, not the empty string
  // we're about to replace it with. Image-only
  // messages aren't recorded: there's no text
  // to recall and an empty entry would clutter
  // the up-arrow list.
  if (text) {
    const history = panel.shadowRoot?.querySelector(
      'ac-input-history',
    );
    if (history) history.addEntry(text, images);
  }

  // Add the user message optimistically. The
  // server will broadcast `userMessage` shortly;
  // our handler detects the in-flight request and
  // skips the echo.
  const optimistic = {
    role: 'user',
    content: text,
    ...(images.length > 0 ? { images } : {}),
  };
  panel.messages = [...panel.messages, optimistic];
  panel._input = '';
  // Draft has been committed — clear the
  // persisted copy so the next refresh starts
  // clean.
  _saveDraft('');
  panel._pendingImages = [];
  panel._streaming = true;
  panel._streamingContent = '';
  panel._autoScroll = true;
  // Reset the textarea's inline height after
  // clearing. Programmatic value clears don't
  // fire `input`, so the auto-resize logic in
  // `onInputChange` won't run — without this
  // reset, the textarea keeps the height it grew
  // to during composition.
  {
    const ta = panel.shadowRoot?.querySelector('.input-textarea');
    if (ta) ta.style.height = 'auto';
  }
  // Auto-close the snippet drawer on send.
  if (panel._snippetDrawerOpen) {
    panel._snippetDrawerOpen = false;
    _saveDrawerOpen(false);
  }
  // Clear detected / fetching URL chips — fetched
  // and errored chips survive because they
  // represent work the user already committed to.
  const chipsEl = panel.shadowRoot?.querySelector('ac-url-chips');
  if (chipsEl) chipsEl.clearDetected();

  try {
    // Compute per-turn URL exclusion set from the
    // chip component. Every fetched chip whose
    // include checkbox is unchecked ends up here.
    const excludedUrls = [];
    if (chipsEl && chipsEl._chips) {
      for (const chip of chipsEl._chips.values()) {
        if (chip.status === 'fetched' && chip.excluded) {
          excludedUrls.push(chip.url);
        }
      }
    }
    // agent_tag (6th positional) routes the call
    // to the agent's ConversationScope when the
    // active tab is an agent. Null for the main
    // tab — the backend's dispatcher treats null
    // as "use the main conversation".
    const agentTag = parseAgentTabId(panel._activeTabId);
    const result = await panel.rpcExtract(
      'LLMService.chat_streaming',
      requestId,
      text,
      Array.isArray(panel.selectedFiles)
        ? panel.selectedFiles
        : [],
      images,
      excludedUrls,
      agentTag,
      // 7th arg — reasoning override. Boolean (not
      // None) because the user's toggle is a
      // deliberate choice; the config-default
      // fallthrough only applies when a caller
      // doesn't pass the field at all.
      panel._reasoningEnabled,
      // 8th arg — effort level for adaptive models.
      // Backend defers to config when it doesn't
      // recognise the value.
      panel._reasoningEffort,
    );
    // Response is {status: "started"} on the
    // happy path. Chunks and completion arrive
    // via server-push events.
    //
    // Error responses (synchronous rejections
    // from the backend) don't become exceptions
    // — they resolve the Promise with an error
    // dict.
    if (result && typeof result === 'object' && result.error) {
      handleStreamStartError(
        panel, requestId, result.error, agentTag,
      );
      return;
    }
  } catch (err) {
    console.error('[chat] chat_streaming failed', err);
    panel.messages = [
      ...panel.messages,
      {
        role: 'assistant',
        content: `**Error:** ${err?.message || String(err)}`,
      },
    ];
    panel._streaming = false;
    panel._currentRequestId = null;
    panel._streams.delete(requestId);
  }
}

/**
 * Cancel the active stream. Best-effort — the
 * server may have already finished, so the cancel
 * call is fire-and-forget. Local cleanup happens
 * either way (cancel response arrives as
 * streamComplete with cancelled=true; handled
 * uniformly in the streaming module).
 */
export async function cancel(panel) {
  if (!panel._streaming || !panel._currentRequestId) return;
  if (!panel.rpcConnected) return;
  try {
    await panel.rpcExtract(
      'LLMService.cancel_streaming',
      panel._currentRequestId,
    );
  } catch (err) {
    console.warn('[chat] cancel_streaming failed', err);
    // Fall back to local cleanup.
    panel._streaming = false;
    panel._streamingContent = '';
    panel._currentRequestId = null;
    panel._streams.clear();
  }
}

// ---------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------

/**
 * Start a new session. The server generates a new
 * session ID, clears history, and broadcasts
 * `sessionChanged` with an empty messages array.
 * The chat panel's `onSessionChanged` handler
 * resets the message list and streaming state — so
 * this method is responsibility-light: call the
 * RPC, trust the broadcast.
 *
 * Disabled during streaming to avoid racing
 * against an in-flight stream.
 */
export async function onNewSession(panel) {
  if (panel._streaming) return;
  if (!panel.rpcConnected) return;
  try {
    await panel.rpcExtract('LLMService.new_session');
  } catch (err) {
    console.error('[chat] new_session failed', err);
  }
}

export function onOpenHistory(panel) {
  panel._historyOpen = true;
}

export function onHistoryClose(panel) {
  panel._historyOpen = false;
}

/**
 * Load-session event from the history browser.
 * The server broadcasts `sessionChanged`
 * independently, so this handler's only job is
 * to close the modal — the message list is
 * replaced via the broadcast path.
 */
export function onHistorySessionLoaded(panel) {
  panel._historyOpen = false;
}

// ---------------------------------------------------------------
// Snippet drawer + reasoning toggle
// ---------------------------------------------------------------

export function toggleSnippetDrawer(panel) {
  panel._snippetDrawerOpen = !panel._snippetDrawerOpen;
  _saveDrawerOpen(panel._snippetDrawerOpen);
}

/**
 * Toggle extended-thinking / reasoning mode. The
 * flag is forwarded as the ``reasoning`` argument
 * to ``LLMService.chat_streaming`` on every send
 * while enabled. Persisted globally so the
 * choice survives reload.
 */
export function toggleReasoning(panel) {
  panel._reasoningEnabled = !panel._reasoningEnabled;
  _saveReasoningEnabled(panel._reasoningEnabled);
  panel._emitToast(
    panel._reasoningEnabled
      ? '🧠 Reasoning enabled — slower, deeper'
      : 'Reasoning disabled',
    'info',
  );
}

/**
 * Set the per-request reasoning effort level (adaptive
 * models). Forwarded as the ``effort`` argument to
 * ``LLMService.chat_streaming``; persisted globally. The
 * provider rejects a level the active model doesn't
 * advertise (e.g. xhigh/max on older models), surfaced as
 * an error toast on send.
 */
export function setReasoningEffort(panel, effort) {
  if (!_REASONING_EFFORT_LEVELS.includes(effort)) return;
  panel._reasoningEffort = effort;
  _saveReasoningEffort(effort);
}

/**
 * Insert a snippet's message into the textarea at
 * the current cursor position. If the textarea
 * has a selection, the selection is replaced.
 * Focuses the textarea after insertion so the
 * user can continue typing directly.
 */
export function insertSnippet(panel, snippet) {
  const message =
    snippet && typeof snippet.message === 'string'
      ? snippet.message
      : '';
  if (!message) return;
  const ta = panel.shadowRoot?.querySelector('.input-textarea');
  if (!ta) {
    panel._input = `${panel._input}${message}`;
    return;
  }
  // Compute the new value and cursor position
  // from the CURRENT textarea state (not
  // panel._input). If the user has been typing
  // fast, panel._input might lag by one input
  // event; reading directly from the textarea is
  // authoritative.
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  const next = `${before}${message}${after}`;
  panel._input = next;
  ta.value = next;
  const cursor = before.length + message.length;
  ta.setSelectionRange(cursor, cursor);
  ta.focus();
  // Fire an input event so the auto-resize logic
  // runs. Without this, inserting a multi-line
  // snippet doesn't grow the textarea until the
  // next keystroke.
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------
// Textarea input
// ---------------------------------------------------------------

/**
 * Handle textarea `input` events. Updates state,
 * auto-resizes, and triggers @-mention detection
 * + URL detection.
 */
export function onInputChange(panel, event) {
  panel._input = event.target.value;
  // Persist the draft so a refresh / reload
  // doesn't lose unsent text. Cleared on send.
  _saveDraft(panel._input);
  // Auto-resize. Reset height first so shrinking
  // works when the user deletes content; then
  // measure and clamp to CSS max.
  const ta = event.target;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
  // @-filter detection. Runs after every input
  // event — we check whether the cursor is
  // inside an @word sequence and dispatch
  // edge-triggered `filter-from-chat` events.
  updateMentionFilter(panel, ta);
  // URL detection debounce.
  scheduleUrlDetection(panel);
}

/**
 * Detect an active @mention at the cursor
 * position and dispatch `filter-from-chat` when
 * the mention state changes. Edge-triggered:
 *
 *   - Entering a mention: emit with the query.
 *   - Mention query changed: emit with new query.
 *   - Exiting a mention: emit empty query to clear
 *     the filter.
 *
 * A mention is `@` followed by zero or more
 * non-whitespace characters, with the cursor
 * INSIDE the sequence. The `@` must be at a word
 * boundary.
 */
export function updateMentionFilter(panel, ta) {
  const value = ta.value;
  const cursor = ta.selectionStart;
  const mention = detectActiveMention(value, cursor);
  if (mention === null && panel._activeMention === null) {
    return;
  }
  if (
    mention !== null &&
    panel._activeMention !== null &&
    mention.start === panel._activeMention.start &&
    mention.end === panel._activeMention.end &&
    mention.query === panel._activeMention.query
  ) {
    return;
  }
  panel._activeMention = mention;
  const query = mention === null ? '' : mention.query;
  panel.dispatchEvent(
    new CustomEvent('filter-from-chat', {
      detail: { query },
      bubbles: true,
      composed: true,
    }),
  );
}

/**
 * Walk backward from the cursor to find an active
 * @mention. Returns `{start, end, query}` or
 * null.
 *
 * Returns null when:
 *   - No `@` found before cursor at word boundary
 *   - Whitespace between the `@` and cursor
 *     (mention terminated)
 *   - `@` is preceded by a word char (blocks
 *     `foo@bar` from matching)
 */
export function detectActiveMention(value, cursor) {
  for (let i = cursor - 1; i >= 0; i -= 1) {
    const ch = value[i];
    if (/\s/.test(ch)) {
      return null;
    }
    if (ch === '@') {
      const before = i > 0 ? value[i - 1] : '';
      if (before !== '' && !/\s/.test(before)) {
        // @ embedded in a word (email-like).
        return null;
      }
      return {
        start: i,
        end: cursor,
        query: value.slice(i + 1, cursor),
      };
    }
  }
  return null;
}

/**
 * Handle key events on the textarea. Up-arrow at
 * cursor 0 opens history recall; Enter sends
 * (Shift+Enter inserts a newline). The history
 * overlay gets first refusal on navigation keys
 * when open.
 *
 * `event.isComposing` guards against premature
 * send during IME input (Japanese/Chinese input
 * methods).
 */
export function onInputKeyDown(panel, event) {
  const history = panel.shadowRoot?.querySelector(
    'ac-input-history',
  );
  if (history && history.isOpen) {
    if (history.handleKey(event)) return;
  }
  if (
    event.key === 'ArrowUp' &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    event.target.selectionStart === 0 &&
    event.target.selectionEnd === 0
  ) {
    if (history && history.show(panel._input)) {
      event.preventDefault();
      return;
    }
  }
  if (
    event.key === 'Enter'
    && !event.shiftKey
    && !event.isComposing
  ) {
    event.preventDefault();
    send(panel);
  }
}

/**
 * Handle `history-select` from the input-history
 * component. The event carries the selected text
 * and any images that were attached when the
 * message was originally sent. We replace the
 * textarea content with the text, replace the
 * pending-image strip with the recalled images,
 * and focus the textarea so the user can edit
 * before re-sending.
 *
 * Image restore goes through `addPendingImage`
 * one-by-one so the standard limit / dedup /
 * size checks apply uniformly. If a stored
 * image now exceeds the size cap (e.g. config
 * was tightened since the original send) it
 * silently drops with a toast — better than
 * surfacing a recalled message in an
 * un-sendable state.
 */
export function onHistorySelect(panel, event) {
  const text = event.detail?.text ?? '';
  const images = Array.isArray(event.detail?.images)
    ? event.detail.images
    : [];
  panel._input = text;
  // Replace pending images with the recalled set.
  // Clear first so a recall doesn't accumulate
  // on top of whatever the user had drafted.
  panel._pendingImages = [];
  for (const dataUri of images) {
    addPendingImage(panel, dataUri);
  }
  panel.updateComplete.then(() => {
    const ta = panel.shadowRoot?.querySelector('.input-textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
    }
  });
}

/**
 * Handle `history-cancel`. The detail carries
 * the saved original input; we restore it
 * verbatim so Escape feels like an undo.
 */
export function onHistoryCancel(panel, event) {
  const text = event.detail?.text ?? '';
  panel._input = text;
  panel.updateComplete.then(() => {
    const ta = panel.shadowRoot?.querySelector('.input-textarea');
    if (ta) {
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
    }
  });
}

// ---------------------------------------------------------------
// Paste + images
// ---------------------------------------------------------------

/**
 * Handle paste events on the textarea. If the
 * clipboard contains image items, consume them
 * and add to the pending list. Text pastes fall
 * through to the textarea's native behaviour —
 * don't preventDefault unless we actually
 * captured at least one image.
 *
 * The one-shot `_suppressNextPaste` flag is set
 * by the files-tab's middle-click-insert flow to
 * block the Linux selection-buffer auto-paste
 * that follows the focus() call. The flag clears
 * on the same event, so a subsequent user paste
 * (Ctrl+V or right-click → paste) flows through
 * normally.
 */
export async function onInputPaste(panel, event) {
  if (panel._suppressNextPaste) {
    panel._suppressNextPaste = false;
    event.preventDefault();
    return;
  }
  const cb = event.clipboardData;
  if (!cb) return;
  const images = await extractImagesFromClipboard(cb);
  if (images.length === 0) return;
  // Consume the paste event so the browser
  // doesn't additionally try to paste a `[object
  // Object]` string representation.
  event.preventDefault();
  for (const dataUri of images) {
    addPendingImage(panel, dataUri);
  }
}

/**
 * Add a data URI to the pending images list.
 * Shared between paste and re-attach paths.
 * Enforces:
 *   - MAX_IMAGES_PER_MESSAGE
 *   - MAX_IMAGE_BYTES
 *   - Dedup by exact data URI
 *
 * Returns true if the image was added, false if
 * rejected.
 */
export function addPendingImage(panel, dataUri) {
  if (typeof dataUri !== 'string' || !dataUri) return false;
  if (panel._pendingImages.includes(dataUri)) return false;
  if (panel._pendingImages.length >= MAX_IMAGES_PER_MESSAGE) {
    panel._emitToast(
      `Maximum ${MAX_IMAGES_PER_MESSAGE} images per message`,
      'warning',
    );
    return false;
  }
  const bytes = estimateDataUriBytes(dataUri);
  if (bytes > MAX_IMAGE_BYTES) {
    const mb = Math.round(MAX_IMAGE_BYTES / (1024 * 1024));
    panel._emitToast(
      `Image exceeds ${mb} MiB limit`,
      'warning',
    );
    return false;
  }
  panel._pendingImages = [...panel._pendingImages, dataUri];
  return true;
}

/** Remove a pending image by index. */
export function removePendingImage(panel, index) {
  if (index < 0 || index >= panel._pendingImages.length) return;
  panel._pendingImages = [
    ...panel._pendingImages.slice(0, index),
    ...panel._pendingImages.slice(index + 1),
  ];
}

/**
 * Re-attach an image from a past message to the
 * current composition. Goes through the same
 * `addPendingImage` path so limit checks and
 * dedup apply uniformly. Emits a confirmation
 * toast on success since the visual feedback
 * (image appears in thumbnail strip below
 * textarea) may not be visible if the user is
 * scrolled up in the message list.
 */
export function reattachImage(panel, dataUri) {
  const wasAlreadyAttached = panel._pendingImages.includes(dataUri);
  if (addPendingImage(panel, dataUri)) {
    panel._emitToast('Image attached', 'success');
  } else if (wasAlreadyAttached) {
    panel._emitToast('Image already attached', 'info');
  }
}

export function openLightbox(panel, dataUri) {
  panel._lightboxImage = dataUri;
}

export function closeLightbox(panel) {
  panel._lightboxImage = null;
}

export function onLightboxKeyDown(panel, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLightbox(panel);
  }
}

// ---------------------------------------------------------------
// Speech-to-text
// ---------------------------------------------------------------

/**
 * Insert a transcribed speech segment at the
 * textarea's cursor position. Adds space
 * separators when adjacent text is non-whitespace
 * so successive utterances don't jam together
 * ("helloworld") and so dictation mid-sentence
 * inserts cleanly.
 *
 * Per specs4/5-webapp/speech.md — existing input
 * is preserved (never overwritten); cursor ends
 * up after the inserted text.
 */
export function onTranscript(panel, event) {
  const text = event.detail?.text;
  if (typeof text !== 'string' || !text) return;
  const ta = panel.shadowRoot?.querySelector('.input-textarea');
  if (!ta) {
    panel._input = `${panel._input}${text}`;
    return;
  }
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  // Auto-space: prepend a space if the char
  // before the cursor is non-whitespace, append
  // one if the char after is non-whitespace.
  // Mid-word dictation ("I am goinghome") would
  // otherwise be a garden-path parse problem
  // for the reader.
  const prefix =
    before.length > 0 && !/\s$/.test(before) ? ' ' : '';
  const suffix =
    after.length > 0 && !/^\s/.test(after) ? ' ' : '';
  const insertion = `${prefix}${text}${suffix}`;
  const next = `${before}${insertion}${after}`;
  panel._input = next;
  ta.value = next;
  const cursor = before.length + insertion.length;
  ta.setSelectionRange(cursor, cursor);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Surface a speech recognition error as a toast.
 * The component has already reverted to inactive
 * state by the time this fires.
 */
export function onRecognitionError(panel, event) {
  const errorCode = event.detail?.error || 'unknown';
  const messages = {
    'not-allowed': 'Microphone access denied',
    'service-not-allowed': 'Speech service unavailable',
    'audio-capture': 'No microphone detected',
    network: 'Speech recognition network error',
  };
  const message =
    messages[errorCode] || `Speech error: ${errorCode}`;
  panel._emitToast(message, 'warning');
}

// ---------------------------------------------------------------
// Message text extraction (copy / paste actions)
// ---------------------------------------------------------------

/**
 * Extract raw text from a message for copy /
 * paste actions. Handles both string and
 * multimodal-array content shapes — the backend
 * sends multimodal arrays for session-reloaded
 * messages that had images, plain strings for
 * everything else.
 *
 * Images are dropped — this is a text action.
 */
export function extractMessageText(msg) {
  if (!msg) return '';
  const raw = msg.content;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const parts = [];
    for (const block of raw) {
      if (
        block &&
        block.type === 'text' &&
        typeof block.text === 'string'
      ) {
        parts.push(block.text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Copy the message's raw text to the clipboard.
 * Toast on success/failure since the clipboard
 * write is silent otherwise.
 */
export async function copyMessageText(panel, msg) {
  const text = extractMessageText(msg);
  if (!text) {
    // Probably an image-only message. Silent
    // rather than emitting a noisy warning.
    return;
  }
  try {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      panel._emitToast('Copied to clipboard', 'success');
    } else {
      panel._emitToast('Clipboard not available', 'warning');
    }
  } catch (err) {
    panel._emitToast(
      `Copy failed: ${err?.message || 'permission denied'}`,
      'warning',
    );
  }
}

/**
 * Insert the message's raw text into the chat
 * input at the current cursor position. Replaces
 * any selection. Focuses the textarea after.
 */
export function pasteMessageToPrompt(panel, msg) {
  const text = extractMessageText(msg);
  if (!text) return;
  const ta = panel.shadowRoot?.querySelector('.input-textarea');
  if (!ta) {
    panel._input = `${panel._input}${text}`;
    return;
  }
  const before = ta.value.slice(0, ta.selectionStart);
  const after = ta.value.slice(ta.selectionEnd);
  const next = `${before}${text}${after}`;
  panel._input = next;
  ta.value = next;
  const cursor = before.length + text.length;
  ta.setSelectionRange(cursor, cursor);
  ta.focus();
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---------------------------------------------------------------
// Auto-scroll engagement
// ---------------------------------------------------------------

/**
 * Scroll listener on the messages container.
 * Engages auto-scroll when the user is at (or
 * very close to) the bottom; disengages when
 * they scroll up past the disengage threshold.
 *
 * Two thresholds (engage and disengage) prevent
 * flicker between states from sub-pixel scroll
 * events during smooth scrolling.
 */
export function onMessagesScroll(panel, event) {
  const el = event.currentTarget;
  const distanceFromBottom =
    el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distanceFromBottom > AUTO_SCROLL_DISENGAGE_PX) {
    panel._autoScroll = false;
  } else if (distanceFromBottom <= AUTO_SCROLL_TOLERANCE_PX) {
    panel._autoScroll = true;
  }
}

/**
 * Single click listener on the messages
 * container — event delegation for three kinds of
 * target:
 *
 *   1. `.file-mention` inside assistant prose —
 *      toggle file selection + navigate to diff
 *      viewer.
 *   2. `.code-copy-btn` inside a rendered code
 *      block — copy the sibling `<code>`'s
 *      textContent to the clipboard and flash a
 *      ✓ indicator.
 *   3. `.edit-file-path` inside an edit-block
 *      card — navigate to the file in the diff
 *      viewer, scrolling to the edit anchor.
 *
 * Delegation pattern rather than per-span
 * handlers so lit-html's template diffing
 * doesn't need to track handler attachment per
 * span — the wrapped HTML comes from
 * `unsafeHTML` and doesn't participate in Lit's
 * event binding anyway.
 */
export function onMessagesClick(panel, event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;

  // Copy-code button. Handled first so a copy
  // button nested inside some exotic parent
  // structure doesn't fall through to other
  // handlers.
  const copyBtn = target.closest('.code-copy-btn');
  if (copyBtn) {
    event.preventDefault();
    event.stopPropagation();
    handleCodeCopy(panel, copyBtn);
    return;
  }

  // Edit-block file path — navigate with anchor
  // text.
  const editPath = target.closest('.edit-file-path');
  if (editPath) {
    const path = editPath.getAttribute('data-edit-path');
    if (path) {
      event.preventDefault();
      event.stopPropagation();
      const anchor = editPath.getAttribute('data-edit-anchor') || '';
      window.dispatchEvent(
        new CustomEvent('navigate-file', {
          detail: {
            path,
            ...(anchor ? { searchText: anchor } : {}),
          },
          bubbles: false,
        }),
      );
    }
    return;
  }

  // File mention inside prose.
  if (
    !target.classList ||
    !target.classList.contains('file-mention')
  ) {
    return;
  }
  const path = target.getAttribute('data-file');
  if (!path) return;
  event.preventDefault();
  event.stopPropagation();
  panel.dispatchEvent(
    new CustomEvent('file-mention-click', {
      detail: { path },
      bubbles: true,
      composed: true,
    }),
  );
}

/**
 * Copy the contents of the `<code>` element
 * inside the same `<pre>` as the clicked button.
 * Flashes a ✓ via a temporary `.copied` class
 * for 1.5s, with a toast on failure.
 */
export async function handleCodeCopy(panel, copyBtn) {
  const pre = copyBtn.closest('pre.code-block');
  if (!pre) return;
  const codeEl = pre.querySelector('code');
  if (!codeEl) return;
  const text = codeEl.textContent || '';
  if (!text) return;
  try {
    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text);
      // Flash ✓ by swapping the icon content for
      // 1.5s. Preserve the original innerHTML so
      // the SVG icon comes back cleanly.
      const originalHtml = copyBtn.innerHTML;
      copyBtn.textContent = '✓';
      copyBtn.classList.add('copied');
      setTimeout(() => {
        copyBtn.classList.remove('copied');
        copyBtn.innerHTML = originalHtml;
      }, 1500);
    } else {
      panel._emitToast('Clipboard not available', 'warning');
    }
  } catch (err) {
    panel._emitToast(
      `Copy failed: ${err?.message || 'permission denied'}`,
      'warning',
    );
  }
}

// ---------------------------------------------------------------
// File chip click + Add-All
// ---------------------------------------------------------------

/**
 * Handle a chip click — dispatch
 * `file-chip-click` with `navigate: false` so
 * the files-tab toggles selection without
 * opening the file in the viewer.
 *
 * When adding a not-in-context file (not
 * removing an in-context one), accumulate
 * natural-language text in the chat input per
 * spec.
 */
export function onFileChipClick(panel, path) {
  if (typeof path !== 'string' || !path) return;
  const selected = new Set(
    Array.isArray(panel.selectedFiles) ? panel.selectedFiles : [],
  );
  const isAdd = !selected.has(path);
  panel.dispatchEvent(
    new CustomEvent('file-chip-click', {
      detail: { path, navigate: false },
      bubbles: true,
      composed: true,
    }),
  );
  if (isAdd) {
    accumulateAddedFilesInInput(panel, [path]);
  }
}

/**
 * Accumulate natural-language text into the chat
 * input announcing files the user just added to
 * context.
 *
 * Per specs4/5-webapp/chat.md §Input
 * Accumulation on Add:
 *   - Templates — "The file X added. Do you
 *     want to see more files before you
 *     continue?" for the first add; updated to
 *     join multiple files naturally on
 *     subsequent adds.
 *   - Only basename used in accumulated text.
 *   - Falls back to appending a parenthetical
 *     note for non-matching input states.
 *
 * The "matching input state" is text that
 * already follows the generated template — we
 * splice additional filenames into the existing
 * phrase. Anything else (the user typed their
 * own message, or the phrasing diverged) falls
 * back to a parenthetical note appended at the
 * end so we don't rewrite user content.
 */
export function accumulateAddedFilesInInput(panel, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return;
  // Basename only per spec — trailing segment
  // after the last slash. Works for both forward
  // and back slashes so Windows-style paths
  // don't slip through.
  const toBasename = (p) => {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx >= 0 ? p.slice(idx + 1) : p;
  };
  const newNames = paths
    .map(toBasename)
    .filter((n) => typeof n === 'string' && n);
  if (newNames.length === 0) return;

  const current = panel._input;
  const trailing =
    ' Do you want to see more files before you continue?';

  // Detect an existing accumulated phrase we can
  // extend. Matches both singular ("The file X
  // added.") and plural ("The files X, Y
  // added.") forms followed by the trailing
  // question.
  const existingRe =
    /^The files? ([^.]+?) added\. Do you want to see more files before you continue\?\s*$/;
  const match = current.match(existingRe);

  let next;
  if (match) {
    const existing = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const seen = new Set(existing);
    const merged = [...existing];
    for (const name of newNames) {
      if (!seen.has(name)) {
        seen.add(name);
        merged.push(name);
      }
    }
    const noun = merged.length === 1 ? 'file' : 'files';
    next = `The ${noun} ${merged.join(', ')} added.${trailing}`;
  } else if (current.trim() === '') {
    const noun = newNames.length === 1 ? 'file' : 'files';
    next = `The ${noun} ${newNames.join(', ')} added.${trailing}`;
  } else {
    // Non-matching input — user typed something
    // of their own. Don't rewrite their text;
    // append a parenthetical note.
    const noun = newNames.length === 1 ? 'file' : 'files';
    const suffix = ` (${noun} added: ${newNames.join(', ')})`;
    next = current + suffix;
  }

  panel._input = next;
  panel.updateComplete.then(() => {
    const ta = panel.shadowRoot?.querySelector('.input-textarea');
    if (!ta) return;
    ta.value = next;
    ta.setSelectionRange(next.length, next.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * "Add All" button handler. Dispatches
 * `file-chips-add-all` with `{paths: [...]}`
 * carrying the list of not-in-context paths. The
 * files-tab handler batches them into a single
 * `set_selected_files` call.
 *
 * Also accumulates natural-language text in the
 * chat input — same path as single-chip add.
 */
export function onAddAllFiles(panel, notInContext) {
  if (!Array.isArray(notInContext) || notInContext.length === 0) return;
  const paths = notInContext
    .map((f) => f.path)
    .filter((p) => typeof p === 'string' && p);
  if (paths.length === 0) return;
  panel.dispatchEvent(
    new CustomEvent('file-chips-add-all', {
      detail: { paths },
      bubbles: true,
      composed: true,
    }),
  );
  accumulateAddedFilesInInput(panel, paths);
}

// ---------------------------------------------------------------
// Auto-scroll target
// ---------------------------------------------------------------

/**
 * Scroll the messages container to the bottom.
 * Double rAF — wait for Lit's DOM commit, then
 * one more frame for browser layout to settle
 * before measuring scrollHeight. Without this,
 * the first chunk of a stream sometimes scrolls
 * to stale dimensions.
 */
export function scrollToBottom(panel) {
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