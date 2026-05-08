// State-fetching helpers extracted from app-shell.js. These
// pull authoritative state snapshots from the backend and
// hydrate the host's reactive properties.

/**
 * Fetch get_current_state and dispatch the state-loaded
 * event so child components (files tab, chat panel) can
 * restore their UI.
 */
export async function fetchCurrentState(host) {
  if (!host.call) return;
  try {
    const fn = host.call['LLMService.get_current_state'];
    if (typeof fn !== 'function') return;
    const raw = await fn();
    // Unwrap jrpc-oo envelope.
    let state = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (keys.length === 1) {
        const inner = raw[keys[0]];
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          state = inner;
        }
      }
    }
    if (!state || typeof state !== 'object') return;
    // Update browser tab title from repo name.
    if (state.repo_name) {
      host._repoName = state.repo_name;
      document.title = state.repo_name;
    }
    host._initComplete = !!state.init_complete;
    // Hydrate mode state from the snapshot. Defaults
    // cover older backends that don't report these
    // fields yet.
    if (typeof state.mode === 'string') {
      host._mode = state.mode;
    }
    if (typeof state.cross_ref_enabled === 'boolean') {
      host._crossRefEnabled = state.cross_ref_enabled;
    }
    // Review state — the snapshot carries a `review_state`
    // object with `active: bool` (matching the
    // get_review_state RPC's return shape). Missing
    // field means no review in progress.
    if (
      state.review_state
      && typeof state.review_state === 'object'
    ) {
      host._reviewActive = !!state.review_state.active;
    } else {
      host._reviewActive = false;
    }
    // Doc Convert availability — true when markitdown is
    // importable on the server. Missing field (older
    // backend) keeps the tab hidden, which is the safe
    // degradation path.
    host._docConvertAvailable = !!state.doc_convert_available;
    // Enrichment status — show the one-shot toast if the
    // backend reports KeyBERT is unavailable. No-op for
    // other values. Older backends omit the field; in that
    // case we pass undefined and the helper returns silently.
    host._maybeShowEnrichmentUnavailableToast(
      state.enrichment_status,
    );
    // Fallback when the persisted active tab no longer
    // applies. Happens when the user's last session was
    // in a repo with doc-convert enabled and they've
    // reconnected to one without markitdown. Without
    // this, activeTab stays 'doc-convert' but the panel
    // is excluded from the DOM — producing a blank body.
    if (
      host.activeTab === 'doc-convert'
      && !host._docConvertAvailable
    ) {
      host._switchTab('files');
    }
    // If the backend reports init is already complete,
    // dismiss the startup overlay. Handles the common
    // race where Phase 2 finishes before the browser
    // registers AcApp — startupProgress events get
    // dropped, but get_current_state arrives afterward
    // with init_complete=true and we can dismiss based
    // on that.
    if (host._initComplete && host.overlayVisible) {
      host.startupPercent = 100;
      host.startupMessage = 'Ready';
      setTimeout(() => {
        host.overlayVisible = false;
        if (host._pendingReopen) {
          const path = host._loadLastOpenFile();
          if (path) host._doReopenLastFile(path);
        }
      }, 400);
    }
    // Dispatch state-loaded so child components restore.
    window.dispatchEvent(
      new CustomEvent('state-loaded', { detail: state }),
    );
    // After state is loaded, try to reopen the last file.
    host._tryReopenLastFile();
  } catch (err) {
    console.warn('[app-shell] get_current_state failed', err);
  }
}

/**
 * Event handler bound to stream-complete, session-changed,
 * and compaction-event. Fire-and-forget refresh — we don't
 * need to await the fetch here, the reactive property update
 * in _fetchHistoryStatus re-renders when the result lands.
 */
export function onCompactionStatusRefresh(host) {
  fetchHistoryStatus(host);
}

/**
 * Fetch the current history status from the backend and
 * update the reactive property. Guarded against overlapping
 * fetches — if one is in flight, new triggers are coalesced
 * into the pending call rather than queueing a second one.
 *
 * Non-fatal on failure: missing backend, method not found
 * on an older server, or transient network error all leave
 * the prior snapshot in place. The bar keeps showing the
 * last-known state; next event triggers a retry.
 */
export async function fetchHistoryStatus(host) {
  if (!host.call) return;
  if (host._historyStatusFetchInFlight) return;
  host._historyStatusFetchInFlight = true;
  try {
    // Call in the same style as _fetchCurrentState — no
    // typeof check on the method reference. The jrpc-oo
    // call proxy exposes methods as Proxy-wrapped
    // callables whose typeof is not necessarily
    // 'function', so guarding on typeof was rejecting
    // valid calls and silently leaving the bar empty.
    const raw = await host.call['LLMService.get_history_status']();
    // Unwrap single-key envelope the same way
    // _fetchCurrentState does. jrpc-oo returns
    // { ClassName: { ... } } for method calls.
    let status = raw;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const keys = Object.keys(raw);
      if (keys.length === 1) {
        const inner = raw[keys[0]];
        if (
          inner && typeof inner === 'object'
          && !Array.isArray(inner)
        ) {
          status = inner;
        }
      }
    }
    if (status && typeof status === 'object') {
      host._historyStatus = status;
    }
  } catch (err) {
    // Surface failures with console.warn — debug-level
    // messages are hidden by default in most browsers
    // and we'd lose visibility on genuine RPC errors.
    // method-not-found is still the only expected
    // non-fatal case (older backend), so filter that
    // to debug to avoid nagging.
    const msg = err?.message || '';
    if (msg.includes('method not found')) {
      console.debug(
        '[app-shell] get_history_status not available', err,
      );
    } else {
      console.warn(
        '[app-shell] get_history_status failed', err,
      );
    }
  } finally {
    host._historyStatusFetchInFlight = false;
  }
}