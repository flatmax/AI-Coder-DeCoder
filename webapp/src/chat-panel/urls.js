// URL detection + fetch handlers for the ChatPanel.
//
// Three concerns:
//
//   1. Detection — as the user types, debounce a
//      ``LLMService.detect_urls`` call and forward
//      the results to the singleton ``ac-url-chips``
//      component. Generation-counter guard discards
//      stale responses.
//
//   2. Fetch — when the user clicks a detected
//      chip's fetch action, fire
//      ``LLMService.fetch_url`` and transition the
//      chip through fetching → fetched / errored
//      states based on the URLContent payload.
//      Error records (HTTP 404, clone failure)
//      render as errored chips; network failures
//      (RPC rejection) toast.
//
//   3. View dialog — clicking a fetched chip's view
//      action opens an overlay showing the cached
//      URLContent (title, body, optional symbol map
//      for GitHub repos). Falls back to
//      ``LLMService.get_url_content`` if the chip
//      doesn't carry the payload.
//
// Per-tab considerations:
//
//   - The chip component is a singleton in the
//     shadow DOM. Its ``_chips`` Map represents the
//     active tab's URL state. Tab switches snapshot
//     and restore via ``snapshotUrlChipsForTab`` /
//     ``restoreUrlChipsForTab`` in ``tabs.js``.
//
//   - There's a known cross-tab fetch bug: a fetch
//     started on tab A whose response arrives after
//     the user switched to tab B lands the chip
//     state on B's chip component (= the
//     just-active singleton), not A's snapshot.
//     Tracked in IMPLEMENTATION_NOTES.md.

// ---------------------------------------------------------------
// Detection
// ---------------------------------------------------------------

/**
 * Schedule a debounced URL detection scan. 300ms
 * matches the file-search debounce — long enough
 * to avoid thrashing on fast typing, short enough
 * to feel responsive when the user pauses.
 *
 * An empty input cancels the pending timer and
 * leaves the chip strip's existing state (fetched
 * chips survive). Detection is idempotent — the
 * chip component's updateDetected merges with
 * existing state rather than replacing.
 */
export function scheduleUrlDetection(panel) {
  if (panel._urlDetectDebounceTimer != null) {
    clearTimeout(panel._urlDetectDebounceTimer);
    panel._urlDetectDebounceTimer = null;
  }
  const text = panel._input;
  if (typeof text !== 'string' || !text.trim()) {
    // Empty input — let the chip component drop
    // any lingering detected entries. Pass an
    // empty array rather than skipping so the
    // "no longer in input" pruning rule fires.
    panel.updateComplete.then(() => {
      const chips = panel.shadowRoot?.querySelector('ac-url-chips');
      if (chips) chips.updateDetected([]);
    });
    return;
  }
  panel._urlDetectDebounceTimer = setTimeout(() => {
    panel._urlDetectDebounceTimer = null;
    runUrlDetection(panel, text);
  }, 300);
}

/**
 * Call ``LLMService.detect_urls`` and feed results
 * to the chip component. Generation-guarded so a
 * later response doesn't get rolled back by an
 * earlier one arriving late.
 *
 * Silently no-ops when RPC isn't connected —
 * detection is a best-effort enhancement, not
 * critical path. Toasting on failure would be
 * noisy for a feature the user didn't explicitly
 * invoke.
 */
export async function runUrlDetection(panel, text) {
  if (!panel.rpcConnected) return;
  const gen = ++panel._urlDetectGeneration;
  let detected;
  try {
    detected = await panel.rpcExtract('LLMService.detect_urls', text);
  } catch (err) {
    console.debug('[chat] detect_urls failed', err);
    return;
  }
  if (gen !== panel._urlDetectGeneration) return;
  const chips = panel.shadowRoot?.querySelector('ac-url-chips');
  if (!chips) return;
  chips.updateDetected(Array.isArray(detected) ? detected : []);
}

// ---------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------

/**
 * Handle the chip component's
 * ``url-fetch-requested`` event. Fires the
 * ``LLMService.fetch_url`` RPC and transitions the
 * chip through fetching → fetched/errored states
 * based on the result.
 *
 * The backend's URLContent carries a (possibly
 * empty) ``error`` field; an error record still
 * fetches successfully but should render as an
 * errored chip, not a fetched one. This
 * distinguishes "HTTP 404" (errored chip, user
 * can retry or dismiss) from "network failure"
 * (RPC rejected, we toast).
 *
 * Restricted-caller error in collab mode is treated
 * as errored chip + warning toast.
 */
export async function onUrlFetchRequested(panel, event) {
  // TODO(url-fetch-cross-tab): this handler queries
  // the singleton ``ac-url-chips`` element rather
  // than the originating tab. Mid-fetch tab
  // switches land the result on the wrong tab.
  // Tracked in IMPLEMENTATION_NOTES.md §
  // "Known bugs — per-tab state".
  const url = event.detail?.url;
  if (typeof url !== 'string' || !url) return;
  if (!panel.rpcConnected) {
    panel._emitToast('Not connected — cannot fetch', 'warning');
    return;
  }
  const chips = panel.shadowRoot?.querySelector('ac-url-chips');
  if (!chips) return;
  chips.markFetching(url);
  let result;
  try {
    // Positional args per LLMService.fetch_url
    // signature: (url, use_cache=True,
    // summarize=True, user_text=None). We default
    // to cache + summarize — matches the streaming
    // handler's own fetch path.
    result = await panel.rpcExtract(
      'LLMService.fetch_url', url, true, true,
    );
  } catch (err) {
    console.error('[chat] fetch_url failed', err);
    chips.markErrored(url, err?.message || 'Network error');
    panel._emitToast(
      `Fetch failed: ${err?.message || 'unknown error'}`,
      'error',
    );
    return;
  }
  if (result && typeof result === 'object' && result.error) {
    // Restricted-caller shape in collab mode —
    // treat as errored chip so the user sees why
    // the fetch didn't happen; also toast since
    // this may not be obvious.
    if (result.error === 'restricted') {
      chips.markErrored(url, 'Not allowed');
      panel._emitToast(
        result.reason || 'Restricted operation',
        'warning',
      );
      return;
    }
    // The URLContent payload itself may carry an
    // error (HTTP 404, clone failure, etc.) —
    // render as an errored chip.
    chips.markErrored(url, result.error);
    return;
  }
  chips.markFetched(url, result);
}

// ---------------------------------------------------------------
// Remove
// ---------------------------------------------------------------

/**
 * Handle ``url-remove-requested``. Two
 * responsibilities:
 *
 *   1. Tell the backend to drop the URL from its
 *      in-memory fetched dict
 *      (``remove_fetched_url``). Cache stays
 *      intact so a later re-fetch hits it.
 *   2. Remove the chip from the local component.
 *
 * Fetched and errored chips need the RPC call;
 * detected chips haven't been fetched yet so the
 * backend has nothing to clean up. We call
 * ``remove_fetched_url`` unconditionally — the
 * backend returns ``removed: false`` for unknown
 * URLs, which is a safe idempotent no-op.
 *
 * Optimistic local remove — responsiveness first,
 * the RPC follows. If the RPC rejects we log but
 * don't restore the chip; the user clicked remove
 * and expects it to stay gone.
 */
export async function onUrlRemoveRequested(panel, event) {
  const url = event.detail?.url;
  if (typeof url !== 'string' || !url) return;
  const chips = panel.shadowRoot?.querySelector('ac-url-chips');
  if (!chips) return;
  chips.remove(url);
  if (!panel.rpcConnected) return;
  try {
    await panel.rpcExtract('LLMService.remove_fetched_url', url);
  } catch (err) {
    console.debug('[chat] remove_fetched_url failed', err);
  }
}

// ---------------------------------------------------------------
// View dialog
// ---------------------------------------------------------------

/**
 * Handle ``url-view-requested``. Opens the content
 * dialog with the chip's cached URLContent
 * payload. The payload was stored when the chip
 * transitioned to fetched, so no additional RPC is
 * needed for the common case.
 *
 * If the chip's content is missing (edge case —
 * e.g. the chip was restored from a future
 * persistence layer without the payload), fall
 * back to ``get_url_content``.
 */
export async function onUrlViewRequested(panel, event) {
  const url = event.detail?.url;
  if (typeof url !== 'string' || !url) return;
  const chips = panel.shadowRoot?.querySelector('ac-url-chips');
  if (!chips) return;
  const chip = chips._chips?.get(url);
  let content = chip?.content;
  if (!content && panel.rpcConnected) {
    try {
      content = await panel.rpcExtract(
        'LLMService.get_url_content', url,
      );
    } catch (err) {
      panel._emitToast(
        `View failed: ${err?.message || 'unknown error'}`,
        'error',
      );
      return;
    }
  }
  if (!content) return;
  panel._urlViewDialog = { url, content };
  panel._urlViewTab = 'content';
}

/** Close the URL view dialog. */
export function closeUrlViewDialog(panel) {
  panel._urlViewDialog = null;
}

/**
 * Keydown handler for the URL view overlay.
 * Escape closes; nothing else is intercepted.
 */
export function onUrlViewKeyDown(panel, event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeUrlViewDialog(panel);
  }
}