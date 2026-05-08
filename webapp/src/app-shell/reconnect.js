// Reconnection helpers for the app shell.
//
// Extracted from app-shell.js. These functions operate on a
// `host` parameter (the AppShell LitElement instance) rather
// than `this` — keeps them free of class-binding concerns and
// trivially testable.
//
// Governing spec: specs4/1-foundation/rpc-transport.md
// "exponential backoff (1s, 2s, 4s, 8s, cap 15s)".

import { RECONNECT_DELAYS_MS } from './constants.js';

export function scheduleReconnect(host) {
  if (host._reconnectTimer) return;
  const attempt = host.reconnectAttempt;
  const delayIdx = Math.min(attempt, RECONNECT_DELAYS_MS.length - 1);
  const delay = RECONNECT_DELAYS_MS[delayIdx];
  host.reconnectAttempt = attempt + 1;
  host._reconnectTimer = setTimeout(() => {
    host._reconnectTimer = null;
    host._attemptReconnect();
  }, delay);
}

export function attemptReconnect(host) {
  // jrpc-oo's JRPCClient reconnects by re-assigning serverURI
  // to the same value — its internal setter tears down the
  // old socket and opens a new one. Force a re-set by
  // nulling and restoring.
  const uri = host.serverURI;
  try {
    host.serverURI = null;
    host.serverURI = uri;
  } catch (err) {
    // If the setter is unavailable, fall through to the next
    // scheduled retry.
    scheduleReconnect(host);
  }
}