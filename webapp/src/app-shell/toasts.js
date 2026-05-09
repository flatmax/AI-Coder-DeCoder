// AppShell — toast helpers.
//
// Extracted from webapp/src/app-shell.js. Each function
// takes the AppShell instance (`host`) as its first
// argument; behaviour is otherwise unchanged.

import { ENRICHMENT_UNAVAILABLE_SHOWN_KEY } from './constants.js';

export function onToastEvent(host, event) {
  const { message, type } = event.detail || {};
  if (!message) return;
  showToast(host, message, type || 'info');
}

export function showToast(host, message, type = 'info') {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toast = { id, message, type };
  host.toasts = [...host.toasts, toast];
  // Auto-dismiss after 3s, with a 300ms fade handled by CSS.
  setTimeout(() => {
    host.toasts = host.toasts.filter((t) => t.id !== id);
  }, 3000);
}

/**
 * Show the one-shot "enrichment unavailable" warning toast.
 *
 * Called when the backend reports
 * `enrichment_status === "unavailable"` — either in the
 * initial state snapshot (page load) or via a modeChanged
 * broadcast (mid-session transition, e.g. the model-load
 * step failed after structural extraction succeeded).
 *
 * Suppressed after the first successful display within a
 * browser session via a localStorage flag. Rationale: the
 * condition is effectively permanent for the session
 * (user has to install `ac-dc[docs]` and restart the
 * backend to fix it), so repeated toasts would just be
 * noise. A page reload or a new session doesn't re-show
 * — the flag persists.
 *
 * Silently no-ops when `enrichment_status` is any other
 * value. Callers don't need to gate the call.
 */
export function maybeShowEnrichmentUnavailableToast(host, status) {
  if (status !== 'unavailable') return;
  // Check the suppression flag. Swallow localStorage errors
  // (private-browsing quirks) and proceed — one duplicate
  // toast across reloads is better than failing silently.
  let alreadyShown = false;
  try {
    alreadyShown = localStorage.getItem(
      ENRICHMENT_UNAVAILABLE_SHOWN_KEY,
    ) === 'true';
  } catch (_) {}
  if (alreadyShown) return;
  showToast(
    host,
    'Keyword enrichment disabled — install ac-dc[docs] '
    + 'for richer document outlines.',
    'warning',
  );
  try {
    localStorage.setItem(
      ENRICHMENT_UNAVAILABLE_SHOWN_KEY, 'true',
    );
  } catch (_) {}
}