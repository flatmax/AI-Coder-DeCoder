// Mode-switching helpers extracted from app-shell.js. Manages
// primary mode (code/doc) and the cross-reference overlay
// toggle, both of which live on the backend authoritatively
// and propagate via mode-changed broadcasts.

/**
 * Handle mode-changed broadcasts. Fires for our own
 * switches and for any other admitted client's switches
 * — collaborators follow the server's authoritative
 * mode.
 *
 * Payload shape (per specs4/4-features/collaboration.md):
 *   { mode: 'code' | 'doc', cross_ref_enabled?: bool }
 * Cross-ref flag is only present on cross-ref toggle
 * events; mode-only switches omit it and we leave the
 * UI state alone (backend resets it to false on mode
 * switch, but the follow-up broadcast carries the new
 * mode value — the reset is implicit).
 */
export function onModeChanged(host, event) {
  const detail = event.detail || {};
  if (typeof detail.mode === 'string') {
    if (detail.mode !== host._mode) {
      // Mode actually changed — cross-ref resets per
      // spec. Backend does the reset; we mirror it so
      // the UI stays in sync without an extra RPC.
      host._mode = detail.mode;
      host._crossRefEnabled = false;
    }
  }
  if (typeof detail.cross_ref_enabled === 'boolean') {
    host._crossRefEnabled = detail.cross_ref_enabled;
  }
  // Enrichment status may piggyback on modeChanged — the
  // backend broadcasts when it flips to "unavailable" so
  // mid-session clients learn without polling. Route to
  // the one-shot toast helper; it no-ops for other values.
  if (typeof detail.enrichment_status === 'string') {
    host._maybeShowEnrichmentUnavailableToast(
      detail.enrichment_status,
    );
  }
}

/**
 * Switch to the given primary mode. No-op if already
 * in that mode (backend would also no-op, but saves an
 * RPC). Disabled for non-localhost callers — the button
 * is visually disabled, but we guard here too.
 */
export async function switchMode(host, mode) {
  if (mode !== 'code' && mode !== 'doc') return;
  if (mode === host._mode) return;
  if (!host.call) return;
  if (!host._isLocalhost) return;
  const fn = host.call['LLMService.switch_mode'];
  if (typeof fn !== 'function') return;
  try {
    const result = await fn(mode);
    // Unwrap single-key envelope.
    let payload = result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const keys = Object.keys(result);
      if (keys.length === 1) {
        const inner = result[keys[0]];
        if (inner && typeof inner === 'object') payload = inner;
      }
    }
    if (payload && payload.error) {
      const reason = payload.reason || payload.error;
      host._showToast(`Mode switch failed: ${reason}`, 'warning');
      return;
    }
    // mode-changed broadcast will update _mode; don't
    // set it optimistically or we'll race the broadcast.
    host._showToast(
      mode === 'doc' ? 'Switched to document mode'
                     : 'Switched to code mode',
      'info',
    );
  } catch (err) {
    host._showToast(
      `Mode switch failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}

/**
 * Toggle cross-reference mode. The backend holds
 * authoritative state; we fire the RPC and let the
 * mode-changed broadcast flip _crossRefEnabled.
 */
export async function toggleCrossRef(host) {
  if (!host.call) return;
  if (!host._isLocalhost) return;
  const fn = host.call['LLMService.set_cross_reference'];
  if (typeof fn !== 'function') return;
  const next = !host._crossRefEnabled;
  try {
    const result = await fn(next);
    let payload = result;
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const keys = Object.keys(result);
      if (keys.length === 1) {
        const inner = result[keys[0]];
        if (inner && typeof inner === 'object') payload = inner;
      }
    }
    if (payload && payload.error) {
      const reason = payload.reason || payload.error;
      host._showToast(
        `Cross-reference toggle failed: ${reason}`,
        'warning',
      );
      return;
    }
    if (next) {
      host._showToast(
        'Cross-reference enabled — both indexes active',
        'info',
      );
    } else {
      host._showToast('Cross-reference disabled', 'info');
    }
  } catch (err) {
    host._showToast(
      `Cross-reference toggle failed: ${err?.message || 'RPC error'}`,
      'error',
    );
  }
}