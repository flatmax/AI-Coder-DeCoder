// Shared test helpers for the chat-panel test suite.
//
// The chat panel tests were originally a single ~5500-line
// file that was split alongside the source-module refactor.
// Each test file under webapp/src/chat-panel/ pairs with one
// implementation module and shares this helper kit:
//
//   - `mountPanel` / `_mounted` — DOM-mount lifecycle with
//     automatic teardown so tests don't leak elements
//     between cases.
//   - `publishFakeRpc` — install a fake JRPC proxy via the
//     `SharedRpc` singleton; methods return single-key
//     envelopes so `rpcExtract` unwraps cleanly.
//   - `settle` — await Lit's update + two animation frames,
//     covering the chat panel's rAF-coalesced render path.
//   - `pushEvent` — dispatch a `CustomEvent` on `window`,
//     simulating server-push events the AppShell would
//     otherwise translate from JRPC notifications.
//   - `seedTab` / `seedLabeledTab` — populate `_tabs` /
//     `_tabLabels` directly so tests can exercise multi-tab
//     code paths without going through the spawn machinery.
//   - `afterEach` cleanup — removes mounted elements and
//     resets the SharedRpc proxy + persistence keys so tests
//     don't bleed state.

import { afterEach } from 'vitest';

import { SharedRpc } from '../rpc.js';
import '../chat-panel/index.js';
import {
  _DRAWER_STORAGE_KEY,
  _SEARCH_IGNORE_CASE_KEY,
  _SEARCH_REGEX_KEY,
  _SEARCH_WHOLE_WORD_KEY,
} from '../chat-panel/index.js';

export const _mounted = [];

/** Mount a fresh `ac-chat-panel` with optional initial props. */
export function mountPanel(props = {}) {
  const p = document.createElement('ac-chat-panel');
  Object.assign(p, props);
  document.body.appendChild(p);
  _mounted.push(p);
  return p;
}

/** Install a fake RPC proxy matching jrpc-oo's multi-remote shape. */
export function publishFakeRpc(methods) {
  const proxy = {};
  for (const [name, impl] of Object.entries(methods)) {
    proxy[name] = async (...args) => {
      const value = await impl(...args);
      // Single-key envelope so rpcExtract unwraps cleanly.
      return { fake: value };
    };
  }
  SharedRpc.set(proxy);
  return proxy;
}

/** Await Lit's update + a couple of animation frames. */
export async function settle(panel) {
  await panel.updateComplete;
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  await panel.updateComplete;
}

/** Dispatch a server-push event on window. */
export function pushEvent(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Seed a fresh tab in the chat panel's `_tabs` Map. Used by
 * tests that need multi-tab state without going through the
 * spawn path. Caller must call `requestUpdate()` afterward;
 * `settle()` picks up the re-render.
 */
export function seedTab(panel, tabId) {
  panel._tabs.set(tabId, panel._makeTabState());
}

/**
 * Same as `seedTab` but also sets a label so the tab strip
 * renders human-readable text rather than the raw id.
 */
export function seedLabeledTab(panel, tabId, label) {
  panel._tabs.set(tabId, panel._makeTabState());
  if (typeof label === 'string' && label) {
    panel._tabLabels.set(tabId, label);
  }
}

afterEach(() => {
  while (_mounted.length) {
    const p = _mounted.pop();
    if (p.isConnected) p.remove();
  }
  SharedRpc.reset();
  try {
    localStorage.removeItem(_DRAWER_STORAGE_KEY);
    localStorage.removeItem(_SEARCH_IGNORE_CASE_KEY);
    localStorage.removeItem(_SEARCH_REGEX_KEY);
    localStorage.removeItem(_SEARCH_WHOLE_WORD_KEY);
  } catch (_) {
    // Ignore — tests that run outside a localStorage-capable
    // environment don't need the cleanup.
  }
});